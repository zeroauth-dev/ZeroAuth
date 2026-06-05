package dev.zeroauth.android.ui.scan

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.net.DemoPortalApi
import dev.zeroauth.android.net.SubmitProofRequest
import dev.zeroauth.android.net.ZeroAuthApi
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.FaceSecretCredential
import dev.zeroauth.android.sec.KeystoreManager
import dev.zeroauth.android.sec.UnlockedCredential
import dev.zeroauth.android.util.ClientMeta
import dev.zeroauth.android.util.DesktopChallenge
import dev.zeroauth.android.util.ProofEnvelope
import dev.zeroauth.android.util.QrParseException
import dev.zeroauth.android.util.QrPayload
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * State machine for the desktop sign-in scan flow.
 *
 * Lifecycle (ADR-0009 § "Protocol (Option B′)" - phone side):
 *
 *   Idle / PermissionMissing
 *      └─ (permission grant) ─> Scanning
 *           └─ (valid QR)    ─> ChallengeParsed
 *                └─ (approve)─> AwaitingFaceCapture
 *                     └─ ok  ─> Proving (progress callback)
 *                          └─> ProofReady (phone shows proof-QR)
 *                               └─ (done) ─> Idle (reset)
 *
 * Error transitions land in [ScanState.Error] with a stable code so
 * the UI can render the same red-accented card for any failure.
 *
 * As of the Phase 1 face-first pivot (ADR-0017), the login flow no
 * longer drives `BiometricPrompt`. Instead, the
 * [ScanState.AwaitingFaceCapture] state hands control to the on-device
 * face-capture composable (the same one used by the registration
 * ceremony). When the composable produces a 32-byte secret it calls
 * back into [onFaceCaptureSucceeded] which reconstructs an
 * [UnlockedCredential] from the secret (mirroring
 * `AndroidKeystoreManager.buildRegistrationFallbackCredential`) and
 * runs the WebView snarkjs prover against it.
 *
 * The legacy [BiometricGate] dependency is still accepted in the
 * constructor + factory so the existing wiring sites (and the
 * `AndroidBiometricGate` + `AndroidKeystoreManager` classes) compile
 * unchanged — but the runProofFlow path no longer invokes the gate.
 * That sidesteps the historical "crypto primitive not initialized,
 * biometric_failed" failure that happened when the keystore manager's
 * registration-fallback path handed back an uninitialised Cipher to
 * BiometricPrompt.CryptoObject; with no BiometricPrompt in the flow
 * there is no cipher to mis-init in the first place.
 *
 * Production builds wire the real prover via [Factory] and the
 * Compose host drives the face capture. Unit tests construct the
 * ViewModel directly with the [FakeBiometricGate] (kept for backward
 * compat) and bypass the face-capture UI by calling
 * [onFaceCaptureSucceeded] directly with a canned 32-byte secret.
 */
class ScanViewModel(
    private val keystoreManager: KeystoreManager,
    private val biometricGate: BiometricGate,
    private val mobileProver: MobileProver,
    private val api: ZeroAuthApi = ApiFactory.create(),
    private val demoPortalApi: DemoPortalApi = ApiFactory.createDemoPortalApi(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val clientMetaFactory: () -> ClientMeta = DefaultClientMeta,
) : ViewModel() {

    private val _state = MutableStateFlow<ScanState>(ScanState.Idle)
    val state: StateFlow<ScanState> = _state.asStateFlow()

    /** Held while [Proving] so [retry] can cancel the in-flight prover. */
    private var inFlightJob: Job? = null

    /**
     * Completed by [onFaceCaptureSucceeded] / [onFaceCaptureCancelled]
     * when the Compose host's face-capture composable resolves. The
     * proof-flow coroutine awaits this so the suspend chain stays
     * linear and the existing `try { ... } finally { unlocked.close() }`
     * block can still own credential lifetime cleanly.
     *
     * Set to null when no capture is in flight.
     */
    @Volatile
    private var pendingFaceCapture: CompletableDeferred<FaceCaptureOutcome>? = null

    // ─── Camera permission ────────────────────────────────────────

    fun onPermissionGranted() {
        if (_state.value is ScanState.PermissionMissing || _state.value is ScanState.Idle) {
            _state.value = ScanState.Scanning
        }
    }

    fun onPermissionDenied() {
        // Idempotent — if we're already in PermissionMissing, no churn.
        if (_state.value !is ScanState.PermissionMissing) {
            _state.value = ScanState.PermissionMissing
        }
    }

    // ─── QR detection ────────────────────────────────────────────

    /**
     * The camera analyzer calls this on the main thread (or any
     * thread — we tolerate either). Idempotent: a duplicate detection
     * while we are already past Scanning is ignored.
     */
    fun onQrDetected(rawText: String) {
        if (_state.value !is ScanState.Scanning) {
            // Quietly ignore — the analyzer fires on every frame and
            // the first match wins.
            return
        }
        QrPayload.parseChallenge(rawText)
            .onSuccess { challenge ->
                _state.value = ScanState.ChallengeParsed(
                    challenge = challenge,
                    tenantLabel = null, // populated by optional fetchSessionMeta
                )
                // Best-effort metadata fetch. We do NOT block the UI
                // on this — the phone proceeds with QR-derived data
                // regardless.
                fetchSessionMeta(challenge)
            }
            .onFailure { err ->
                val code = (err as? QrParseException)?.code ?: "qr_parse_failed"
                Timber.tag(TAG).w(err, "QR parse failed: $code")
                // Stay in Scanning so the analyzer keeps trying — a
                // single bad frame should not kick us back to Idle.
                _state.value = ScanState.Scanning
            }
    }

    /**
     * Optional GET /v1/proof-pairing/sessions/:id/public (read-only,
     * unauthenticated). Failure is fine — we log and stay with what
     * the QR gave us. ADR-0009 explicitly allows the phone to
     * operate offline-after-scan.
     */
    private fun fetchSessionMeta(challenge: DesktopChallenge) {
        viewModelScope.launch {
            try {
                val resp = withContext(ioDispatcher) {
                    api.getSession(id = challenge.sessionId)
                }
                val label = resp.session.initiatorLabel?.takeIf { it.isNotBlank() }
                    ?: resp.session.tenantName?.takeIf { it.isNotBlank() }
                if (label != null) {
                    // Only update if we're still on this challenge.
                    val current = _state.value
                    if (current is ScanState.ChallengeParsed &&
                        current.challenge.sessionId == challenge.sessionId
                    ) {
                        _state.value = current.copy(tenantLabel = label)
                    }
                }
            } catch (t: Throwable) {
                // Public endpoint may not exist on the backend yet —
                // this is documented behaviour, NOT a UI failure.
                Timber.tag(TAG).d(
                    "session metadata fetch skipped (endpoint optional): %s",
                    t.message,
                )
            }
        }
    }

    // ─── Approve → face capture → prover → QR ─────────────────────

    /**
     * Approve the desktop sign-in. Transitions into
     * [ScanState.AwaitingFaceCapture] so the Compose host can render
     * the on-device face-capture composable. When the composable
     * resolves it calls back into [onFaceCaptureSucceeded] /
     * [onFaceCaptureCancelled]; the proof-flow coroutine awaits that
     * outcome.
     *
     * The `activity` parameter is retained for compatibility with the
     * legacy BiometricGate wiring (the FakeBiometricGate signature
     * needs a FragmentActivity even though the proof flow no longer
     * invokes the prompt). We forward it into [GenerateInput] only
     * insofar as the WebView prover may need it down the road — today
     * the parameter is unread once the face capture resolves.
     */
    fun onBiometricApproved(
        activity: FragmentActivity,
        email: String,
    ) {
        val current = _state.value
        if (current !is ScanState.ChallengeParsed) {
            Timber.tag(TAG).w("onBiometricApproved called from state %s", current::class.simpleName)
            return
        }
        val challenge = current.challenge

        inFlightJob?.cancel()
        inFlightJob = viewModelScope.launch {
            runProofFlow(activity, email, challenge)
        }
    }

    /**
     * Invoked by the Compose host when the face-capture composable
     * produces a 32-byte secret. Resumes the in-flight proof coroutine
     * with the captured bytes; the coroutine then derives an
     * [UnlockedCredential] from the secret (matching
     * `AndroidKeystoreManager.buildRegistrationFallbackCredential`)
     * and runs the WebView snarkjs prover.
     *
     * Safe to call from any thread. If no capture is in flight (e.g.
     * the user navigated away mid-capture) the secret is dropped and
     * a warning is logged — the failure surfaces as
     * `ScanState.Error("face_capture_out_of_order")` only if the state
     * machine was sitting in [ScanState.AwaitingFaceCapture] but had
     * no Deferred awaiter, which would indicate an internal bug.
     */
    fun onFaceCaptureSucceeded(secret: ByteArray) {
        require(secret.size == 32) {
            "onFaceCaptureSucceeded: expected 32-byte secret, got ${secret.size}"
        }
        // Copy so the caller can zero its own buffer (and so we
        // outlive any caller-side `secret.fill(0)` cleanup).
        val copy = secret.copyOf()
        val deferred = pendingFaceCapture
        if (deferred == null) {
            Timber.tag(TAG).w(
                "onFaceCaptureSucceeded fired with no pending capture (state=%s)",
                _state.value::class.simpleName,
            )
            copy.fill(0)
            if (_state.value is ScanState.AwaitingFaceCapture) {
                _state.value = ScanState.Error(
                    code = "face_capture_out_of_order",
                    message = "Face capture resolved without an active proof flow.",
                )
            }
            return
        }
        deferred.complete(FaceCaptureOutcome.Succeeded(copy))
    }

    /**
     * Invoked by the Compose host when the user cancels the
     * face-capture composable (back press, "Cancel" CTA, permission
     * denied, etc.). Resumes the proof-flow coroutine with a
     * cancelled outcome so it transitions to
     * [ScanState.Error] with the stable `face_capture_cancelled` code.
     */
    fun onFaceCaptureCancelled() {
        val deferred = pendingFaceCapture
        if (deferred == null) {
            Timber.tag(TAG).w("onFaceCaptureCancelled fired with no pending capture")
            return
        }
        deferred.complete(FaceCaptureOutcome.Cancelled)
    }

    private suspend fun runProofFlow(
        activity: FragmentActivity,
        email: String,
        challenge: DesktopChallenge,
    ) {
        // 1. Hand control to the face-capture surface. The Compose
        //    host observes the AwaitingFaceCapture state, renders the
        //    on-device FaceCaptureScreen, and calls back into
        //    onFaceCaptureSucceeded / onFaceCaptureCancelled.
        val deferred = CompletableDeferred<FaceCaptureOutcome>()
        pendingFaceCapture = deferred
        _state.value = ScanState.AwaitingFaceCapture(email = email)

        val outcome = try {
            deferred.await()
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "Face capture await threw")
            pendingFaceCapture = null
            _state.value = ScanState.Error(
                code = "face_capture_failed",
                message = t.message ?: "Face capture failed.",
            )
            return
        } finally {
            // Clear regardless of outcome so a future approval gets a
            // fresh Deferred.
            if (pendingFaceCapture === deferred) {
                pendingFaceCapture = null
            }
        }

        val secret = when (outcome) {
            is FaceCaptureOutcome.Succeeded -> outcome.secret
            FaceCaptureOutcome.Cancelled -> {
                _state.value = ScanState.Error(
                    code = "face_capture_cancelled",
                    message = "Face capture was cancelled.",
                )
                return
            }
        }

        // 2. Derive an UnlockedCredential from the 32-byte secret.
        //    Same derivation AndroidKeystoreManager's
        //    buildRegistrationFallbackCredential uses, so a proof
        //    generated under this path verifies against
        //    tenant_users.metadata.{commitment, did_hash} byte-for-byte.
        val unlocked: UnlockedCredential = try {
            FaceSecretCredential.fromSecret(secret)
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "FaceSecretCredential.fromSecret threw")
            secret.fill(0)
            _state.value = ScanState.Error(
                code = "credential_derivation_failed",
                message = t.message ?: "Could not derive the proof witness from the captured face.",
            )
            return
        } finally {
            // The secret has been consumed (copied into BigInteger /
            // Poseidon-derived buffers inside FaceSecretCredential).
            // Zero the local copy so a heap dump after this point
            // doesn't capture the biometric-derived bytes.
            secret.fill(0)
        }

        try {
            // 3. Generate the proof. Progress updates flow into a
            //    Proving state so the UI animates.
            _state.value = ScanState.Proving(progress = 0f)

            val generated = try {
                mobileProver.generate(
                    GenerateInput(
                        unlocked = unlocked,
                        sessionNonceHex = challenge.nonceHex,
                    ),
                ) { progress ->
                    _state.value = ScanState.Proving(progress = progress.coerceIn(0f, 1f))
                }
            } catch (t: ProverException) {
                Timber.tag(TAG).w(t, "Prover failed: %s", t.code)
                _state.value = ScanState.Error(
                    code = t.code,
                    message = t.message ?: "Proof generation failed.",
                )
                return
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "Prover threw")
                _state.value = ScanState.Error(
                    code = ProverException.PROVER_FAILED,
                    message = t.message ?: "Proof generation failed.",
                )
                return
            }

            // 4. Encode into the phone→desktop QR.
            val envelope = ProofEnvelope(
                sessionId = challenge.sessionId,
                proof = generated.proof,
                publicSignals = generated.publicSignals,
                did = generated.did,
                meta = clientMetaFactory().copy(
                    proofMs = generated.proofMs,
                ),
            )
            val qrText = try {
                QrPayload.encodeProof(envelope)
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "QR encode failed")
                _state.value = ScanState.Error(
                    code = "qr_encode_failed",
                    message = t.message ?: "Could not encode the proof for display.",
                )
                return
            }

            _state.value = ScanState.ProofReady(
                qrText = qrText,
                sessionId = challenge.sessionId,
            )
        } finally {
            // Always close the credential — even on a successful path
            // we want the zeroing to happen before the screen idles.
            try {
                unlocked.close()
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "Credential close threw")
            }
        }
    }

    // ─── Terminal transitions ────────────────────────────────────

    fun onProofShownToWebcam() {
        // The operator tapped "Done" after the desktop scanned the
        // phone-QR. Reset to Idle so a second sign-in can start clean.
        inFlightJob = null
        _state.value = ScanState.Idle
    }

    /**
     * Phone-push sign-in: POST the generated proof straight to the
     * demo-portal bridge instead of waiting for the desktop to scan the
     * proof-QR with a webcam. This is the primary login path now —
     * most desktops have no usable camera.
     *
     * Reads the `za:proof:1:...` string + session id out of the current
     * [ScanState.ProofReady], transitions through [ScanState.Authorizing]
     * while the request is in flight, and lands on
     * [ScanState.Authorized] when the server has verified the proof and
     * flipped the pairing row to `consumed`. The desktop's open SSE
     * stream sees the same transition and navigates to the dashboard;
     * the two paths are independent and both idempotent.
     *
     * On failure we surface the server's documented error code (e.g.
     * `pairing_session_expired`, `pairing_proof_invalid`) so the UI can
     * tell the user whether to retry the whole flow or just wait.
     */
    fun authorizeOnPhone() {
        val current = _state.value
        if (current !is ScanState.ProofReady) {
            Timber.tag(TAG).w("authorizeOnPhone called from state %s", current::class.simpleName)
            return
        }
        val qrText = current.qrText
        val sessionId = current.sessionId

        inFlightJob?.cancel()
        inFlightJob = viewModelScope.launch {
            _state.value = ScanState.Authorizing
            try {
                val resp = withContext(ioDispatcher) {
                    demoPortalApi.submitProof(
                        SubmitProofRequest(sessionId = sessionId, qrPayload = qrText),
                    )
                }
                if (resp.ok) {
                    _state.value = ScanState.Authorized
                } else {
                    // 2xx with ok=false shouldn't happen on the documented
                    // contract, but guard so we never strand the user on a
                    // spinner.
                    _state.value = ScanState.Error(
                        code = "authorize_failed",
                        message = "The laptop didn't accept the sign-in. Try again.",
                    )
                }
            } catch (t: Throwable) {
                val (code, message) = decodeSubmitError(t)
                Timber.tag(TAG).w(t, "authorizeOnPhone failed: %s", code)
                _state.value = ScanState.Error(code = code, message = message)
            }
        }
    }

    /**
     * Map a submit-proof failure into a (code, message) the UI renders.
     * Retrofit raises [retrofit2.HttpException] on any non-2xx; we lift
     * the server's `{ error, message }` body out of it so the investor
     * sees the precise failure class. Transport-level failures (USB
     * tunnel down, phone offline) collapse to a generic offline message.
     */
    private fun decodeSubmitError(t: Throwable): Pair<String, String> {
        if (t is retrofit2.HttpException) {
            val raw = runCatching { t.response()?.errorBody()?.string() }.getOrNull()
            val parsed = if (!raw.isNullOrBlank()) {
                runCatching { org.json.JSONObject(raw) }.getOrNull()
            } else {
                null
            }
            val code = parsed?.optString("error")?.takeIf { it.isNotBlank() }
                ?: "authorize_failed"
            val message = parsed?.optString("message")?.takeIf { it.isNotBlank() }
                ?: "Sign-in failed (HTTP ${t.code()}). Try again."
            return code to message
        }
        return "network_unreachable" to
            "Couldn't reach the bank to finish signing in. Check your connection and try again."
    }

    fun retry() {
        // Cancel any in-flight prover, drop the error state, go back
        // to Idle so the camera permission flow re-runs.
        inFlightJob?.cancel()
        inFlightJob = null
        // Cancel any pending face capture so the Compose host stops
        // waiting for a callback that will never come.
        pendingFaceCapture?.complete(FaceCaptureOutcome.Cancelled)
        pendingFaceCapture = null
        _state.value = ScanState.Idle
    }

    /**
     * Cancel from the ChallengeParsed state without consuming the
     * proof flow. Used by the "Cancel" button on the approve card.
     */
    fun onChallengeCancelled() {
        if (_state.value is ScanState.ChallengeParsed) {
            _state.value = ScanState.Scanning
        }
    }

    override fun onCleared() {
        inFlightJob?.cancel()
        inFlightJob = null
        pendingFaceCapture?.complete(FaceCaptureOutcome.Cancelled)
        pendingFaceCapture = null
        super.onCleared()
    }

    // ─── Factory ─────────────────────────────────────────────────

    /**
     * Compose-side `viewModel(factory = ScanViewModel.Factory(...))`
     * entry point. The composition root builds this with the real
     * (or fake) sec/prover deps; the Robolectric tests instantiate
     * the ViewModel directly.
     */
    class Factory(
        private val keystoreManager: KeystoreManager,
        private val biometricGate: BiometricGate,
        private val mobileProver: MobileProver,
        private val api: ZeroAuthApi = ApiFactory.create(),
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(ScanViewModel::class.java)) {
                "ScanViewModel.Factory only constructs ScanViewModel"
            }
            return ScanViewModel(
                keystoreManager = keystoreManager,
                biometricGate   = biometricGate,
                mobileProver    = mobileProver,
                api             = api,
            ) as T
        }
    }

    /**
     * Internal helper sum-type for the face-capture callback
     * resolution. Kept private to the ViewModel — the public surface
     * is the [onFaceCaptureSucceeded] / [onFaceCaptureCancelled]
     * methods, which mirror the registration ViewModel's shape.
     */
    private sealed interface FaceCaptureOutcome {
        data class Succeeded(val secret: ByteArray) : FaceCaptureOutcome
        object Cancelled : FaceCaptureOutcome
    }

    companion object {
        private const val TAG = "ScanViewModel"
    }
}

/**
 * UI-facing state. Sealed interface so the Compose layer can render a
 * `when` block with exhaustive coverage. The Error variant intentionally
 * carries a stable string code so the screen renders the same red card
 * for any error and tests can assert on `code` directly.
 */
sealed interface ScanState {
    object Idle : ScanState
    object PermissionMissing : ScanState
    object Scanning : ScanState
    data class ChallengeParsed(
        val challenge: DesktopChallenge,
        val tenantLabel: String?,
    ) : ScanState

    /**
     * The proof flow is waiting for the on-device face-capture
     * composable to produce a 32-byte secret. Replaces the legacy
     * [AwaitingBiometric] state — the login flow no longer drives
     * BiometricPrompt; instead, the Compose host renders the same
     * FaceCaptureScreen used by the registration ceremony and routes
     * the captured bytes into [ScanViewModel.onFaceCaptureSucceeded].
     *
     * @property email Forwarded purely for diagnostics — the
     *                 face-capture pipeline is account-agnostic.
     */
    data class AwaitingFaceCapture(val email: String) : ScanState

    /**
     * Legacy biometric-prompt waiting state. No longer emitted by the
     * proof flow but retained as a sealed-interface leaf so any
     * Compose tooling that pattern-matches on [ScanState] compiles
     * unchanged. Will be removed after the StrongBox-backed salt
     * pivot lands (ADR-0018).
     */
    @Deprecated(
        message = "Login flow no longer drives BiometricPrompt. Use AwaitingFaceCapture.",
        replaceWith = ReplaceWith("AwaitingFaceCapture"),
    )
    object AwaitingBiometric : ScanState

    data class Proving(val progress: Float) : ScanState
    /**
     * The proof is generated and ready to submit. The primary action is
     * now [ScanViewModel.authorizeOnPhone] — the phone POSTs [qrText]
     * (the `za:proof:1:...` string) to the demo-portal bridge keyed by
     * [sessionId]. [qrText] is also rendered as a Bitmap (via ZXing) for
     * the legacy "scan with the laptop camera" fallback path.
     *
     * @property qrText The encoded `za:proof:1:...` proof envelope.
     * @property sessionId The pairing session id (from the scanned
     *           challenge QR) the proof is submitted against.
     */
    data class ProofReady(val qrText: String, val sessionId: String) : ScanState

    /**
     * The phone is POSTing the proof to the server (phone-push login).
     * Transient — resolves to [Authorized] or [Error].
     */
    object Authorizing : ScanState

    /**
     * The server verified the proof and bound the desktop session. The
     * phone shows a success affordance; the desktop has already (or is
     * about to) navigate to its dashboard via the SSE stream.
     */
    object Authorized : ScanState

    data class Error(val code: String, val message: String) : ScanState
}

/**
 * Default factory for the phone-side metadata block. Reads
 * BuildConfig + Build.MODEL — exposed as a function reference so
 * tests can inject a fixed value.
 */
private val DefaultClientMeta: () -> ClientMeta = {
    ClientMeta(
        appVersion = dev.zeroauth.android.BuildConfig.VERSION_NAME,
        platform = "android",
        model = android.os.Build.MODEL ?: "unknown",
        proofMs = 0L,
        playIntegrityVerdict = null,
    )
}
