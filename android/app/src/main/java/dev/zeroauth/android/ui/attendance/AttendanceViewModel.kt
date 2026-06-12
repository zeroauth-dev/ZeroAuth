package dev.zeroauth.android.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.AttendanceApi
import dev.zeroauth.android.net.ClientMetaDto
import dev.zeroauth.android.net.ProofDto
import dev.zeroauth.android.net.RecordRequest
import dev.zeroauth.android.net.WifiDto
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.FaceSecretCredential
import dev.zeroauth.android.sec.UnlockedCredential
import dev.zeroauth.android.sec.WifiAnchorChecker
import kotlinx.coroutines.CompletableDeferred
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
 * State machine for the office attendance check-in / check-out ceremony.
 *
 * Lifecycle (mirrors the sign-in [dev.zeroauth.android.ui.scan.ScanViewModel],
 * sourcing the nonce from the attendance bridge instead of a scanned QR):
 *
 *   Idle
 *    └─ start(type) ─> Locating              (fetch anchor + read WiFi)
 *         ├─ off-network ─> OffNetwork        (stop before any face scan)
 *         └─ on-network  ─> AwaitingFaceCapture
 *              └─ secret ─> Proving(progress) (snarkjs prover, nonce-bound)
 *                   └─ ok ─> Done(type, occurredAt)
 *
 * The WiFi reading is attached to the /record request and re-checked
 * server-side; an off-network reply (`outside_anchor`) collapses back to
 * [OffNetwork]. Identity is the exact proof-pairing path — the captured
 * face, the embedding, and the template never leave the device; only the
 * Groth16 proof + DID cross the wire.
 */
class AttendanceViewModel(
    private val mobileProver: MobileProver,
    private val attendanceApi: AttendanceApi,
    private val wifiChecker: WifiAnchorChecker,
    private val stateStore: AttendanceStateStore,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _state = MutableStateFlow<AttendanceUiState>(AttendanceUiState.Idle)
    val state: StateFlow<AttendanceUiState> = _state.asStateFlow()

    private var inFlightJob: Job? = null

    @Volatile
    private var pendingFaceCapture: CompletableDeferred<FaceOutcome>? = null

    /** Begin a check-in or check-out ceremony. `type` ∈ check_in,check_out. */
    fun start(type: String) {
        inFlightJob?.cancel()
        inFlightJob = viewModelScope.launch { runCeremony(type) }
    }

    fun onFaceCaptureSucceeded(secret: ByteArray) {
        require(secret.size == 32) { "expected 32-byte secret, got ${secret.size}" }
        val copy = secret.copyOf()
        val deferred = pendingFaceCapture
        if (deferred == null) {
            Timber.tag(TAG).w("face capture resolved with no pending ceremony")
            copy.fill(0)
            return
        }
        deferred.complete(FaceOutcome.Succeeded(copy))
    }

    fun onFaceCaptureCancelled() {
        pendingFaceCapture?.complete(FaceOutcome.Cancelled)
    }

    fun retry() {
        inFlightJob?.cancel()
        inFlightJob = null
        pendingFaceCapture?.complete(FaceOutcome.Cancelled)
        pendingFaceCapture = null
        _state.value = AttendanceUiState.Idle
    }

    private suspend fun runCeremony(type: String) {
        _state.value = AttendanceUiState.Locating

        // 1. Company anchor + local WiFi presence gate (UX pre-check; the
        //    server is authoritative).
        val company = try {
            withContext(ioDispatcher) { attendanceApi.company() }.company
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "company fetch failed")
            _state.value = AttendanceUiState.Error(
                "company_unavailable",
                "Couldn't reach the attendance server. Check your connection.",
            )
            return
        }
        val reading = wifiChecker.currentReading()
        if (!wifiChecker.matches(reading, company.wifi)) {
            _state.value = AttendanceUiState.OffNetwork(
                requiredLabel = company.wifi.ssidLabel.ifBlank { company.location },
                detectedSsid = reading?.ssid,
            )
            return
        }

        // 2. Open a pairing session — the nonce the prover binds to.
        val init = try {
            withContext(ioDispatcher) { attendanceApi.init() }
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "attendance init failed")
            _state.value = AttendanceUiState.Error(
                "attendance_init_failed",
                "Couldn't start attendance. Try again.",
            )
            return
        }

        // 3. On-device face match → 32-byte secret.
        val deferred = CompletableDeferred<FaceOutcome>()
        pendingFaceCapture = deferred
        _state.value = AttendanceUiState.AwaitingFaceCapture(type)
        val outcome = try {
            deferred.await()
        } finally {
            if (pendingFaceCapture === deferred) pendingFaceCapture = null
        }
        val secret = when (outcome) {
            is FaceOutcome.Succeeded -> outcome.secret
            FaceOutcome.Cancelled -> {
                _state.value = AttendanceUiState.Error("face_capture_cancelled", "Face check was cancelled.")
                return
            }
        }

        // 4. Derive the witness + generate the proof bound to the nonce.
        val unlocked: UnlockedCredential = try {
            FaceSecretCredential.fromSecret(secret)
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "credential derivation failed")
            secret.fill(0)
            _state.value = AttendanceUiState.Error(
                "credential_derivation_failed",
                "Couldn't read your identity from the face capture.",
            )
            return
        } finally {
            secret.fill(0)
        }

        val generated = try {
            _state.value = AttendanceUiState.Proving(0f)
            mobileProver.generate(GenerateInput(unlocked, init.nonce)) { progress ->
                _state.value = AttendanceUiState.Proving(progress.coerceIn(0f, 1f))
            }
        } catch (t: ProverException) {
            Timber.tag(TAG).w(t, "prover failed: %s", t.code)
            _state.value = AttendanceUiState.Error(t.code, t.message ?: "Proof generation failed.")
            return
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "prover threw")
            _state.value = AttendanceUiState.Error(ProverException.PROVER_FAILED, t.message ?: "Proof generation failed.")
            return
        } finally {
            try { unlocked.close() } catch (t: Throwable) { Timber.tag(TAG).w(t, "credential close threw") }
        }

        // 5. Record — the server re-verifies the proof AND the WiFi anchor.
        val request = RecordRequest(
            sessionId = init.sessionId,
            type = type,
            did = generated.did,
            proof = ProofDto(
                pi_a = generated.proof.pi_a,
                pi_b = generated.proof.pi_b,
                pi_c = generated.proof.pi_c,
                protocol = generated.proof.protocol,
                curve = generated.proof.curve,
            ),
            publicSignals = generated.publicSignals,
            wifi = WifiDto(bssid = reading?.bssid, signal = reading?.signalPercent),
            clientMeta = ClientMetaDto(
                appVersion = dev.zeroauth.android.BuildConfig.VERSION_NAME,
                platform = "android",
                model = android.os.Build.MODEL ?: "unknown",
                proofMs = generated.proofMs,
            ),
        )
        try {
            val resp = withContext(ioDispatcher) { attendanceApi.record(request) }
            val occurredAt = resp.occurredAt
            if (resp.ok && occurredAt != null) {
                val recordedType = resp.type ?: type
                stateStore.record(recordedType, occurredAt)
                _state.value = AttendanceUiState.Done(recordedType, occurredAt)
            } else {
                _state.value = AttendanceUiState.Error("attendance_record_failed", "Attendance wasn't recorded. Try again.")
            }
        } catch (t: Throwable) {
            val (code, message) = decodeError(t)
            if (code == "outside_anchor") {
                _state.value = AttendanceUiState.OffNetwork(
                    requiredLabel = company.wifi.ssidLabel.ifBlank { company.location },
                    detectedSsid = reading?.ssid,
                )
            } else {
                Timber.tag(TAG).w(t, "record failed: %s", code)
                _state.value = AttendanceUiState.Error(code, message)
            }
        }
    }

    /** Lift the server's `{ error, message }` out of a Retrofit failure. */
    private fun decodeError(t: Throwable): Pair<String, String> {
        if (t is retrofit2.HttpException) {
            val raw = runCatching { t.response()?.errorBody()?.string() }.getOrNull()
            val parsed = if (!raw.isNullOrBlank()) runCatching { org.json.JSONObject(raw) }.getOrNull() else null
            val code = parsed?.optString("error")?.takeIf { it.isNotBlank() } ?: "attendance_record_failed"
            val message = parsed?.optString("message")?.takeIf { it.isNotBlank() }
                ?: "Attendance failed (HTTP ${t.code()}). Try again."
            return code to message
        }
        return "network_unreachable" to
            "Couldn't reach the attendance server. Check your connection and try again."
    }

    override fun onCleared() {
        inFlightJob?.cancel()
        inFlightJob = null
        pendingFaceCapture?.complete(FaceOutcome.Cancelled)
        pendingFaceCapture = null
        super.onCleared()
    }

    class Factory(
        private val mobileProver: MobileProver,
        private val attendanceApi: AttendanceApi,
        private val wifiChecker: WifiAnchorChecker,
        private val stateStore: AttendanceStateStore,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(AttendanceViewModel::class.java)) {
                "AttendanceViewModel.Factory only constructs AttendanceViewModel"
            }
            return AttendanceViewModel(mobileProver, attendanceApi, wifiChecker, stateStore) as T
        }
    }

    private sealed interface FaceOutcome {
        data class Succeeded(val secret: ByteArray) : FaceOutcome
        object Cancelled : FaceOutcome
    }

    companion object {
        private const val TAG = "AttendanceViewModel"
    }
}

/**
 * UI-facing state for the attendance ceremony. Sealed so the Compose
 * layer renders an exhaustive `when`. [Error] carries a stable code for
 * the same red card across failures.
 */
sealed interface AttendanceUiState {
    object Idle : AttendanceUiState
    object Locating : AttendanceUiState
    data class OffNetwork(val requiredLabel: String, val detectedSsid: String?) : AttendanceUiState
    data class AwaitingFaceCapture(val type: String) : AttendanceUiState
    data class Proving(val progress: Float) : AttendanceUiState
    data class Done(val type: String, val occurredAt: String) : AttendanceUiState
    data class Error(val code: String, val message: String) : AttendanceUiState
}
