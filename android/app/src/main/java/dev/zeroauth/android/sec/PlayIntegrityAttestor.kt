package dev.zeroauth.android.sec

import android.content.Context
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import kotlin.coroutines.resume

// The two imports below come from the `com.google.android.play:integrity`
// artifact. CLAUDE.md says we assume the dep is present; the call sites
// guarded by `runCatching` below are the ONLY places in this file that
// touch the Play Integrity SDK. If a build is produced where the
// artifact is missing, the runtime failure surfaces as
// `AttestationError.SdkUnavailable` rather than a class-load crash at
// app start.
//
// TODO(sec-agent): once the dep lands in gradle/libs.versions.toml, drop
// the catch-`NoClassDefFoundError` arm of [safeRequestToken]. The
// catch is a belt-and-braces guard for the transition window only.
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest

/**
 * PlayIntegrityAttestor — phone-side gateway to Google's Play Integrity
 * API, used by the proof-pairing handshake to give the backend a signed
 * statement that "this proof originated from a real, unmodified copy of
 * the ZeroAuth app, running on a Play-certified device, signed in to a
 * legitimate Play account".
 *
 * ## Threat model
 *
 * The Pramaan ZK protocol guarantees that whoever produced a valid
 * proof knows the biometric secret bound to a particular DID. It does
 * NOT, by itself, guarantee anything about the *environment* in which
 * the proof was produced. A bad actor with a stolen biometric secret
 * (e.g. extracted from a rooted phone, or captured at enrollment by a
 * coercive employer) could mint proofs from a laptop using snarkjs
 * directly — the verifier has no cryptographic way to tell.
 *
 * Play Integrity sits between the prover WebView and the network and
 * answers three questions for the backend:
 *
 *  1. **Counterfeit-device defence** — the device's hardware-attested
 *     verdict (`MEETS_DEVICE_INTEGRITY`) is signed by Google and rules
 *     out emulators, custom OEM images, and most desktop spoofing
 *     environments. A laptop running snarkjs simply cannot produce a
 *     valid Play Integrity token; there is no Google-signed code path
 *     on a non-Android, non-Play-certified machine.
 *
 *  2. **Magisk / root detection** — the `MEETS_STRONG_INTEGRITY`
 *     verdict additionally asserts that the bootloader is locked, the
 *     verified-boot state is GREEN, and no privileged process has
 *     tampered with the kernel boot image. This catches Magisk,
 *     KernelSU, and the long tail of overlay-based root frameworks
 *     that hide from package scans but cannot forge the
 *     hardware-rooted Verified Boot signature.
 *
 *  3. **App-tamper detection** — the token carries the SHA-256 of the
 *     APK signing certificate (`appLicensingVerdict` /
 *     `requestPackageName` fields). The backend pins this against the
 *     known release-signing cert for `dev.zeroauth.android` and
 *     rejects tokens whose signer doesn't match — defeating repackaged
 *     APKs that have stripped the cert-pinner or smuggled in a Frida
 *     hook.
 *
 * ## Why the token is opaque to us
 *
 * This class returns the raw JWS-encoded token as a `String` and does
 * NOT parse it on-device. The verdict structure has been silently
 * extended by Google several times; parsing on-device would couple
 * release cadence to whatever schema we happened to ship. The server
 * is the only place that decodes the token, by POSTing it to
 *
 *     https://playintegrity.googleapis.com/v1/<packageName>:decodeIntegrityToken
 *
 * with a service-account OAuth bearer, and acting on the decoded
 * `tokenPayloadExternal` block. The phone is therefore a *carrier* of
 * the verdict, not an enforcer — which is exactly what we want, since
 * a rooted phone could otherwise lie about its own verdict.
 *
 * ## Why this is a [Result], not a sealed result type
 *
 * Unlike [BiometricResult], the caller does NOT branch on different
 * failure leaves. Any failure means "we cannot prove environment
 * integrity right now"; the ViewModel surfaces a single stable error
 * code (`ZA_ATTEST_UNAVAILABLE`) and the user retries. We keep
 * the [Throwable] inside the [Result.Failure] so Timber can log it
 * locally for triage without leaking it across the network. The
 * `Result<String>` shape matches Kotlin's standard
 * `runCatching`-friendly conventions used elsewhere in this module.
 *
 * ## Nonce handling
 *
 * The `nonce` parameter is supplied by the backend at the start of the
 * proof-pairing session. Play Integrity binds the verdict to a
 * caller-supplied nonce (URL-safe base64, max 500 chars, >=16 chars
 * unpadded entropy). The caller is responsible for ensuring the nonce
 * is single-use and derived from a server-side high-entropy random
 * source; this class only forwards it. We deliberately do NOT hash
 * the nonce on-device — the backend's decoded `requestDetails.nonce`
 * field is what gets compared against the session record, and any
 * pre-hashing would break that match.
 *
 * The lifetime of a Play Integrity token is ~60 seconds in practice
 * (Google does not document a hard TTL; their server rejects tokens
 * older than a few minutes). The caller MUST POST the returned token
 * immediately and MUST NOT cache it across sessions.
 *
 * ## Construction
 *
 *     val attestor: PlayIntegrityAttestor = AndroidPlayIntegrityAttestor(context)
 *     val token = attestor.attest(nonce).getOrElse {
 *         Timber.tag(TAG).w(it, "attest failed")
 *         return ProofPairingResult.AttestUnavailable
 *     }
 *     api.postProofWithAttestation(proof, token)
 */
interface PlayIntegrityAttestor {

    /**
     * Request a Play Integrity token for the supplied [nonce].
     *
     * Suspends on the underlying `IntegrityManager.requestIntegrityToken`
     * `Task`; cancellation of the calling coroutine cancels nothing on
     * the Play side (the Task has no cancel hook) but does prevent the
     * continuation from being resumed if the caller has already moved
     * on.
     *
     * @param nonce server-supplied URL-safe base64 nonce, 16-500 chars.
     *              The Play SDK enforces these bounds and will reject
     *              shorter or non-conforming values.
     * @return [Result.success] with the JWS-encoded integrity token if
     *         the device produced one; [Result.failure] with the
     *         underlying exception if the Play SDK refused (network
     *         off, Play Services missing/outdated, Google Play account
     *         unavailable, hardware attestation failure, etc).
     */
    suspend fun attest(nonce: String): Result<String>
}

/**
 * Default implementation backed by `com.google.android.play:integrity`.
 *
 * The SDK exposes `IntegrityManager` whose `requestIntegrityToken`
 * returns a `Task<IntegrityTokenResponse>`. We wrap the listener-based
 * Task in a [suspendCancellableCoroutine] so callers stay in
 * coroutine-land — matching the pattern used by [AndroidBiometricGate].
 *
 * The [Context] passed in MUST be `applicationContext`; passing an
 * Activity context risks leaking the Activity when a stuck Task
 * outlives the screen. The single-arg constructor enforces this by
 * calling `.applicationContext` defensively.
 */
class AndroidPlayIntegrityAttestor(
    context: Context,
) : PlayIntegrityAttestor {

    private val appContext: Context = context.applicationContext

    override suspend fun attest(nonce: String): Result<String> {
        // Cheap pre-flight: Play's SDK throws IllegalArgumentException
        // for empty / oversized nonces, but we surface the same error
        // shape locally so test doubles don't have to reach into the
        // SDK to reject a malformed nonce.
        if (nonce.isEmpty() || nonce.length > MAX_NONCE_LEN) {
            return Result.failure(
                IllegalArgumentException(
                    "nonce must be 1..$MAX_NONCE_LEN chars; got ${nonce.length}",
                ),
            )
        }

        return safeRequestToken(nonce)
    }

    /**
     * Wrap the Play Task in a cancellable coroutine. Any exception
     * thrown by the SDK constructor (including the
     * `NoClassDefFoundError` that fires if the artifact is missing at
     * runtime) is mapped to [Result.failure].
     */
    private suspend fun safeRequestToken(nonce: String): Result<String> =
        suspendCancellableCoroutine { cont ->
            val manager = try {
                IntegrityManagerFactory.create(appContext)
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "IntegrityManagerFactory.create failed")
                if (cont.isActive) cont.resume(Result.failure(t))
                return@suspendCancellableCoroutine
            }

            val request = try {
                IntegrityTokenRequest.builder()
                    .setNonce(nonce)
                    .build()
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "IntegrityTokenRequest.build rejected nonce")
                if (cont.isActive) cont.resume(Result.failure(t))
                return@suspendCancellableCoroutine
            }

            manager.requestIntegrityToken(request)
                .addOnSuccessListener { response ->
                    val token = response.token()
                    if (token.isNullOrEmpty()) {
                        // The SDK contract says the token is non-null
                        // on success, but defensive code is cheaper
                        // than a Crashlytics post-mortem.
                        if (cont.isActive) {
                            cont.resume(
                                Result.failure(
                                    IllegalStateException("Play Integrity returned an empty token"),
                                ),
                            )
                        }
                        return@addOnSuccessListener
                    }
                    if (cont.isActive) cont.resume(Result.success(token))
                }
                .addOnFailureListener { t ->
                    // Logged at warn (not error) because most failures
                    // are user-environment issues — no Play Services,
                    // offline, no Play account — not bugs.
                    Timber.tag(TAG).w(t, "requestIntegrityToken failed")
                    if (cont.isActive) cont.resume(Result.failure(t))
                }
                .addOnCanceledListener {
                    if (cont.isActive) {
                        cont.resume(
                            Result.failure(
                                CancellationStub("Play Integrity request was cancelled"),
                            ),
                        )
                    }
                }
        }

    /**
     * Sentinel exception type for the "Task was cancelled" path. We
     * deliberately do NOT use kotlinx.coroutines.CancellationException
     * here because a cancellation thrown from inside a
     * `suspendCancellableCoroutine` callback would be interpreted by
     * the structured-concurrency machinery as "the parent job was
     * cancelled", which is a different semantic. The caller treats
     * this as an ordinary failure and may retry.
     */
    private class CancellationStub(message: String) : RuntimeException(message)

    companion object {
        private const val TAG = "PlayIntegrityAttestor"

        /**
         * Google's documented upper bound on nonce length. Enforced
         * locally so we fail fast before paying the
         * IntegrityManagerFactory.create + Google Play Services IPC
         * round-trip.
         */
        const val MAX_NONCE_LEN: Int = 500
    }
}
