package dev.zeroauth.android.ui.reg

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.net.CompleteRequest
import dev.zeroauth.android.net.PairDeviceRequest
import dev.zeroauth.android.net.RegistrationApi
import dev.zeroauth.android.net.SubmitCommitmentRequest
import dev.zeroauth.android.prover.Groth16Proof
import dev.zeroauth.android.util.DeviceFingerprint
import dev.zeroauth.android.util.RegChallenge
import dev.zeroauth.android.util.RegQrPayload
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Orchestrates the three-QR end-user signup ceremony (ADR 0023) from
 * the phone side.
 *
 * The state machine is intentionally small — three "doing this step"
 * states + idle/success/error — because each step is just:
 *   1. parse the scanned QR
 *   2. produce the step-specific payload
 *   3. POST to the corresponding registration endpoint
 *   4. transition to "ready for the next QR" (or terminal)
 *
 * Biometric capture for steps 2 and 3 is intentionally injectable via
 * [BiometricSecretSource] — the constructor default is
 * [RealBiometricSecretSource] which branches at runtime on
 * `BuildConfig.DEMO_USE_STABLE_SECRET`:
 *
 *   * `true` (default in debug builds) — delegates to
 *     [PerInstallStableSecret] so the AVD demo flow works without a
 *     live face camera. The SharedPreferences-persisted SecureRandom
 *     blob guarantees step 2 and step 3 derive the same commitment so
 *     the server's `publicSignals[0]` check passes.
 *   * `false` (default in release builds) — runs the canonical
 *     CameraX + ML Kit + MobileFaceNet pipeline documented in
 *     adr/0018-mobile-face-embedding-pipeline.md. The quantiser's
 *     same-face-same-bytes contract upholds the publicSignals[0]
 *     invariant for two captures of the same user on the same device.
 *
 * The dispatch is internal to [RealBiometricSecretSource] — the
 * ViewModel sees a single `BiometricSecretSource` either way. The
 * registration screen surfaces the active mode via
 * [BiometricSecretMode] so operators + investors can see which
 * pipeline is running on this build.
 *
 * The proof generation hook (step 3) is similarly injectable via
 * [ProofGenerator]. The default returns a structurally-valid but
 * cryptographically-empty Groth16 envelope so the route plumbing can
 * be exercised end-to-end without a working snarkjs WebView. The
 * server's `verifyProofOffChain` will reject the empty proof — the
 * demo treats that as expected and surfaces a "wire up the real
 * prover" message. Real proof generation lives in
 * `dev.zeroauth.android.prover.WebViewMobileProver`; the integration
 * lands when the registration circuit's witness shape is finalised
 * (Phase 1 Sprint 4).
 */
class RegistrationViewModel(
    private val context: Context,
    private val api: RegistrationApi = ApiFactory.createRegistrationApi(),
    // The default secret source is now [CapturedFaceSecret] which holds
    // the 32-byte secret captured by the on-device face-capture composable
    // for the lifetime of the registration session. The previous default
    // ([RealBiometricSecretSource]) is still available — tests + the
    // RegistrationScreen pass it explicitly when the demo-stable-secret
    // toggle is desired — but the production three-QR ceremony now wires
    // the face capture between QR1 (pair) and QR2 (commit) and reuses
    // the cached secret for QR3 (verify).
    private val secretSource: BiometricSecretSource = CapturedFaceSecret(context.applicationContext),
    private val proofGenerator: ProofGenerator = StubProofGenerator,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    sealed class State {
        data object Idle : State()
        data object Pairing : State()

        /**
         * Inserted between QR1 (pair) and QR2 (commit). The UI host
         * renders the on-device face-capture composable; once the
         * 32-byte secret is produced, the ViewModel transitions to
         * [AwaitingEnrollScan].
         *
         * @property sessionId The pair-step session ID — round-tripped
         *   into [AwaitingEnrollScan] so the operator-facing "scan QR2"
         *   text still shows the in-flight session.
         * @property step Which ceremony step this capture feeds. Today
         *   only step 2 needs an in-line capture (step 3 reuses the
         *   cached secret); the field is kept for future use.
         */
        data class AwaitingFaceCapture(val sessionId: String, val step: Int) : State()
        data class AwaitingEnrollScan(val sessionId: String) : State()
        data object Committing : State()
        data class AwaitingVerifyScan(val sessionId: String) : State()
        data object Verifying : State()
        data class Completed(val sessionId: String, val tenantUser: JsonElement?) : State()
        data class Failed(val code: String, val message: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    /**
     * Entry point — the UI calls this with the raw text it scanned (or
     * pasted) from the QR. The VM parses, routes to the right step,
     * and updates [state] as the call progresses.
     */
    fun onQrText(text: String) {
        val parsed = RegQrPayload.parse(text)
        if (parsed.isFailure) {
            val ex = parsed.exceptionOrNull()
            _state.value = State.Failed(
                code = "reg_qr_parse_failed",
                message = ex?.message ?: "Could not parse QR",
            )
            return
        }
        val challenge = parsed.getOrThrow()
        when (challenge.step) {
            RegQrPayload.Step.Pair -> pairDevice(challenge)
            RegQrPayload.Step.Enroll -> submitCommitment(challenge)
            RegQrPayload.Step.Verify -> complete(challenge)
        }
    }

    private fun pairDevice(challenge: RegChallenge) {
        _state.value = State.Pairing
        viewModelScope.launch {
            runCatching {
                val fingerprint = DeviceFingerprint.forCurrentInstall(context)
                withContext(io) {
                    api.pairDevice(
                        PairDeviceRequest(
                            pairCode = challenge.code,
                            fingerprint = fingerprint,
                            attestationKind = "none",
                        ),
                    )
                }
            }.onSuccess { res ->
                // Insert the face-capture step between QR1 (pair) and QR2
                // (commit). The UI host renders the inline face-capture
                // composable when state == AwaitingFaceCapture; once the
                // 32-byte secret is captured, [onFaceCaptured] transitions
                // the machine into AwaitingEnrollScan.
                //
                // When the secret source isn't a CapturedFaceSecret (e.g.
                // tests use a PerInstallStableSecret directly) we skip the
                // capture step and transition straight to AwaitingEnrollScan
                // — there's no on-device pipeline that needs to run.
                if (secretSource is CapturedFaceSecret && !secretSource.hasCapturedSecret()) {
                    _state.value = State.AwaitingFaceCapture(res.sessionId, step = 2)
                } else {
                    _state.value = State.AwaitingEnrollScan(res.sessionId)
                }
            }.onFailure { ex ->
                _state.value = State.Failed("pair_failed", ex.message ?: "Pair step failed")
            }
        }
    }

    /**
     * Entry point the [RegistrationScreen]'s face-capture composable
     * calls when it produces a 32-byte secret. Stores the secret in the
     * [CapturedFaceSecret] backing the [secretSource] slot (if that's
     * what's wired) and transitions out of [State.AwaitingFaceCapture]
     * into [State.AwaitingEnrollScan].
     *
     * Both step 2 (submit-commitment) and step 3 (verify) call
     * `secretSource.secret()` later — they both see the same 32-byte
     * buffer this method stores, so the server's `publicSignals[0]`
     * commitment-equality check passes without a second capture.
     *
     * @param secret 32-byte buffer derived from the captured face. The
     *               caller is responsible for not retaining the buffer
     *               outside this call site; [CapturedFaceSecret] copies
     *               internally so the caller may zero its copy.
     */
    fun onFaceCaptured(secret: ByteArray) {
        val current = _state.value
        if (current !is State.AwaitingFaceCapture) {
            // Out-of-order capture — drop the secret and surface the bug
            // rather than silently overwriting. The UI shouldn't reach
            // this path; defending against it keeps the state machine
            // honest.
            _state.value = State.Failed(
                code = "face_capture_out_of_order",
                message = "onFaceCaptured fired while state=$current; expected AwaitingFaceCapture",
            )
            return
        }
        require(secret.size == 32) {
            "onFaceCaptured: expected 32-byte secret, got ${secret.size}"
        }
        val source = secretSource
        if (source is CapturedFaceSecret) {
            source.acceptCapturedSecret(secret)
        }
        _state.value = State.AwaitingEnrollScan(current.sessionId)
    }

    /**
     * Entry point the [RegistrationScreen] calls when the user cancels
     * the face-capture composable (back button, cancel CTA, or permission
     * denied). Transitions to a [State.Failed] so the operator can
     * restart the ceremony.
     */
    fun onFaceCaptureCancelled() {
        _state.value = State.Failed(
            code = "face_capture_cancelled",
            message = "Face capture was cancelled. Re-scan QR1 to restart.",
        )
    }

    private fun submitCommitment(challenge: RegChallenge) {
        _state.value = State.Committing
        viewModelScope.launch {
            runCatching {
                val secret = secretSource.secret()
                val (did, commitment) = DeriveDidAndCommitment.from(secret)
                withContext(io) {
                    api.submitCommitment(
                        SubmitCommitmentRequest(
                            enrollCode = challenge.code,
                            did = did,
                            commitment = commitment,
                            attestationKind = "none",
                        ),
                    )
                }
            }.onSuccess { res ->
                _state.value = State.AwaitingVerifyScan(res.sessionId)
            }.onFailure { ex ->
                _state.value = State.Failed("enroll_failed", ex.message ?: "Submit step failed")
            }
        }
    }

    private fun complete(challenge: RegChallenge) {
        val nonce = challenge.challengeNonce
        if (nonce.isNullOrBlank()) {
            _state.value = State.Failed("verify_failed", "QR3 missing ?challenge")
            return
        }
        _state.value = State.Verifying
        viewModelScope.launch {
            runCatching {
                val secret = secretSource.secret()
                val (_, commitment) = DeriveDidAndCommitment.from(secret)
                // The prover returns BOTH the Groth16 envelope AND the
                // publicSignals snarkjs emitted. We forward the
                // snarkjs publicSignals verbatim — they are decimal
                // BigInt strings, which is the canonical wire format
                // and what the server's BigInt-based commitment
                // compare in registration.ts::completeRegistration
                // expects. Previously we synthesised `listOf(commitment)`
                // (a one-element HEX list), which (a) didn't match
                // the circuit's 3-element [commitment, didHash,
                // identityBinding] declaration and (b) failed the
                // hex-vs-decimal commitment compare on the server.
                val proofResult = proofGenerator.generate(secret, commitment, nonce)
                withContext(io) {
                    api.complete(
                        CompleteRequest(
                            verifyCode = challenge.code,
                            challengeNonce = nonce,
                            proof = proofResult.proof.toJson(),
                            publicSignals = proofResult.publicSignals,
                        ),
                    )
                }
            }.onSuccess { res ->
                _state.value = State.Completed(res.sessionId, res.tenantUser)
            }.onFailure { ex ->
                _state.value = State.Failed("verify_failed", ex.message ?: "Verify step failed")
            }
        }
    }

    fun reset() {
        _state.value = State.Idle
    }

    private fun Groth16Proof.toJson(): JsonElement = buildJsonObject {
        put("pi_a", JsonArray(pi_a.map { JsonPrimitive(it) }))
        put("pi_b", JsonArray(pi_b.map { row -> JsonArray(row.map { JsonPrimitive(it) }) }))
        put("pi_c", JsonArray(pi_c.map { JsonPrimitive(it) }))
        put("protocol", JsonPrimitive(protocol))
        put("curve", JsonPrimitive(curve))
    }

    // ─── Injection seams ──────────────────────────────────────────

    interface BiometricSecretSource {
        /** 32-byte secret derived from the biometric. */
        suspend fun secret(): ByteArray
    }

    /**
     * Bundle returned by [ProofGenerator] — the snarkjs Groth16 envelope
     * plus the publicSignals array snarkjs emitted. These MUST be
     * forwarded together to /v1/registrations/complete; the server's
     * commitment-equality check reads publicSignals[0], and the
     * Groth16 verifier needs all three signals in declaration order
     * ([commitment, didHash, identityBinding]).
     *
     * The publicSignals strings are decimal BN128 field elements
     * (snarkjs's canonical output), NOT hex. The server's commitment
     * comparator parses them as BigInt and compares against the
     * stored (hex) session.commitment numerically, so the
     * representation mismatch between submit-commitment (hex) and
     * complete (decimal) is reconciled on the server side.
     */
    data class ProofResult(
        val proof: Groth16Proof,
        val publicSignals: List<String>,
    )

    interface ProofGenerator {
        suspend fun generate(secret: ByteArray, commitmentHex: String, challengeNonceHex: String): ProofResult
    }
}
