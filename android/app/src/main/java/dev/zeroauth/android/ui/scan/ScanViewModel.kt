package dev.zeroauth.android.ui.scan

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.net.ZeroAuthApi
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.BiometricResult
import dev.zeroauth.android.sec.CredentialMissingException
import dev.zeroauth.android.sec.KeystoreLockedException
import dev.zeroauth.android.sec.KeystoreManager
import dev.zeroauth.android.sec.UnlockedCredential
import dev.zeroauth.android.util.ClientMeta
import dev.zeroauth.android.util.DesktopChallenge
import dev.zeroauth.android.util.ProofEnvelope
import dev.zeroauth.android.util.QrParseException
import dev.zeroauth.android.util.QrPayload
import kotlinx.coroutines.CoroutineDispatcher
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
 *                └─ (approve)─> AwaitingBiometric
 *                     └─ ok  ─> Proving (progress callback)
 *                          └─> ProofReady (phone shows proof-QR)
 *                               └─ (done) ─> Idle (reset)
 *
 * Error transitions land in [ScanState.Error] with a stable code so
 * the UI can render the same red-accented card for any failure.
 *
 * The ViewModel takes the three sec/prover interfaces in its
 * constructor so the test suite passes the fakes from
 * `util/FakeProverAndSec.kt`. Production builds wire the real
 * implementations via [Factory] once the parallel agents land their
 * code.
 */
class ScanViewModel(
    private val keystoreManager: KeystoreManager,
    private val biometricGate: BiometricGate,
    private val mobileProver: MobileProver,
    private val api: ZeroAuthApi = ApiFactory.create(),
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val clientMetaFactory: () -> ClientMeta = DefaultClientMeta,
) : ViewModel() {

    private val _state = MutableStateFlow<ScanState>(ScanState.Idle)
    val state: StateFlow<ScanState> = _state.asStateFlow()

    /** Held while [Proving] so [retry] can cancel the in-flight prover. */
    private var inFlightJob: Job? = null

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

    // ─── Approve → biometric → prover → QR ────────────────────────

    /**
     * Approve the desktop sign-in. Triggers the biometric prompt,
     * then the prover, then the phone-QR generation. All side effects
     * are coroutine-scoped to the ViewModel so the screen pop tears
     * them down cleanly.
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

    private suspend fun runProofFlow(
        activity: FragmentActivity,
        email: String,
        challenge: DesktopChallenge,
    ) {
        _state.value = ScanState.AwaitingBiometric

        // 1. Biometric authentication. The gate returns a
        //    Keystore-bound Cipher — or a stable failure variant.
        val biometric = try {
            biometricGate.authenticateForProof(activity, email)
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "Biometric gate threw")
            _state.value = ScanState.Error(
                code = "biometric_failed",
                message = t.message ?: "Biometric authentication failed.",
            )
            return
        }

        val cipher = when (biometric) {
            is BiometricResult.Success -> biometric.cipher
            BiometricResult.Cancelled -> {
                _state.value = ScanState.Error(
                    code = "biometric_cancelled",
                    message = "Biometric prompt cancelled.",
                )
                return
            }
            BiometricResult.NotAvailable -> {
                _state.value = ScanState.Error(
                    code = "biometric_unavailable",
                    message = "No enrolled biometric available on this device.",
                )
                return
            }
            BiometricResult.LockedOut -> {
                _state.value = ScanState.Error(
                    code = "biometric_locked_out",
                    message = "Too many attempts. Wait a moment and try again.",
                )
                return
            }
            is BiometricResult.Error -> {
                _state.value = ScanState.Error(
                    code = "biometric_failed",
                    message = biometric.message,
                )
                return
            }
        }

        // 2. Unlock the credential. The handle MUST be closed before
        //    we return; the try/finally below owns it.
        val unlocked: UnlockedCredential = try {
            keystoreManager.loadAccountForProof(email, cipher)
        } catch (t: KeystoreLockedException) {
            Timber.tag(TAG).w(t, "Keystore locked")
            _state.value = ScanState.Error(
                code = "keystore_locked",
                message = "Your credential needs to be re-enrolled. " +
                    "Adding a new biometric resets the secure store.",
            )
            return
        } catch (t: CredentialMissingException) {
            Timber.tag(TAG).w(t, "No credential for %s", email)
            _state.value = ScanState.Error(
                code = "credential_missing",
                message = "No credential is enrolled for this account.",
            )
            return
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "Keystore load threw")
            _state.value = ScanState.Error(
                code = "keystore_failed",
                message = t.message ?: "Unable to read your stored credential.",
            )
            return
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

            _state.value = ScanState.ProofReady(qrText = qrText)
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

    fun retry() {
        // Cancel any in-flight prover, drop the error state, go back
        // to Idle so the camera permission flow re-runs.
        inFlightJob?.cancel()
        inFlightJob = null
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
    object AwaitingBiometric : ScanState
    data class Proving(val progress: Float) : ScanState
    /**
     * The phone's encoded `za:proof:1:...` QR text. Compose renders
     * this as a Bitmap via ZXing's QRCodeWriter.
     */
    data class ProofReady(val qrText: String) : ScanState
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
