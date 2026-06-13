package dev.zeroauth.android.ui.join

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.AttendanceApi
import dev.zeroauth.android.net.ClaimRequest
import dev.zeroauth.android.net.InitRequest
import dev.zeroauth.android.net.ProofDto
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.FaceSecretCredential
import dev.zeroauth.android.sec.PassStore
import dev.zeroauth.android.sec.UnlockedCredential
import dev.zeroauth.android.util.EmpClaimInvite
import dev.zeroauth.android.util.EmpClaimParseException
import dev.zeroauth.android.util.EmpClaimPayload
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
import java.time.Instant

/**
 * State machine for the "join a company" ceremony.
 *
 *   Scanning
 *    └─ onQrText ─> Resolving (parse invite + open /init session)
 *         └─ ok ─> Confirm("Join <company>?")
 *              └─ onConfirm ─> AwaitingFaceCapture
 *                   └─ secret ─> Proving (snarkjs prover, nonce-bound)
 *                        └─ Claiming ─> POST /api/attendance/claim
 *                             └─ ok ─> Done (pass stored locally)
 *
 * The claim binds the device's (did, commitment) to the HR-provisioned
 * membership: the proof is bound to the `/init` nonce (so a captured proof
 * can't be replayed) and the single-use invite is consumed server-side. On
 * success the pass is cached locally via [PassStore] (there is no server
 * status read). Mirrors [dev.zeroauth.android.ui.attendance.AttendanceViewModel].
 */
class JoinViewModel(
    private val mobileProver: MobileProver,
    private val attendanceApi: AttendanceApi,
    private val passStore: PassStore,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _state = MutableStateFlow<JoinUiState>(JoinUiState.Scanning)
    val state: StateFlow<JoinUiState> = _state.asStateFlow()

    private var confirmContext: ConfirmContext? = null
    private var inFlightJob: Job? = null

    @Volatile
    private var pendingFaceCapture: CompletableDeferred<FaceOutcome>? = null

    private data class ConfirmContext(
        val companyId: String,
        val companyName: String,
        val locationLabel: String,
        val inviteCode: String,
        val sessionId: String,
        val nonceHex: String,
    )

    /** A QR frame was decoded. Non-join QRs are ignored (keep scanning). */
    fun onQrText(text: String) {
        if (_state.value !is JoinUiState.Scanning) return
        val invite = EmpClaimPayload.parse(text).getOrElse { e ->
            val code = (e as? EmpClaimParseException)?.code ?: "emp_claim_parse_failed"
            // A QR that simply isn't a join invite (wrong scheme/host) is not
            // an error — the user may be pointing at the wrong code. Keep
            // scanning. A *malformed* join invite (bad code/company) surfaces.
            if (code == "emp_claim_parse_failed") return
            _state.value = JoinUiState.Error(code, e.message ?: "That QR isn't a valid join invite.")
            return
        }
        inFlightJob?.cancel()
        inFlightJob = viewModelScope.launch { resolveSession(invite) }
    }

    private suspend fun resolveSession(invite: EmpClaimInvite) {
        _state.value = JoinUiState.Resolving
        val init = try {
            withContext(ioDispatcher) { attendanceApi.init(InitRequest(companyId = invite.companyId)) }
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "join init failed")
            _state.value = JoinUiState.Error(
                "attendance_init_failed",
                "Couldn't reach the attendance server. Check your connection.",
            )
            return
        }
        val company = init.company
        val ctx = ConfirmContext(
            companyId = invite.companyId,
            companyName = company?.name?.takeIf { it.isNotBlank() } ?: "this company",
            locationLabel = company?.location ?: "",
            inviteCode = invite.inviteCode,
            sessionId = init.sessionId,
            nonceHex = init.nonce,
        )
        confirmContext = ctx
        _state.value = JoinUiState.Confirm(ctx.companyName, ctx.locationLabel)
    }

    fun onConfirm() {
        val ctx = confirmContext ?: return
        inFlightJob?.cancel()
        inFlightJob = viewModelScope.launch { runClaim(ctx) }
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

    /** Back to scanning (from Confirm/Error), discarding any open session. */
    fun rescan() {
        inFlightJob?.cancel()
        inFlightJob = null
        pendingFaceCapture?.complete(FaceOutcome.Cancelled)
        pendingFaceCapture = null
        confirmContext = null
        _state.value = JoinUiState.Scanning
    }

    private suspend fun runClaim(ctx: ConfirmContext) {
        // 1. On-device face match → 32-byte secret.
        val deferred = CompletableDeferred<FaceOutcome>()
        pendingFaceCapture = deferred
        _state.value = JoinUiState.AwaitingFaceCapture
        val outcome = try {
            deferred.await()
        } finally {
            if (pendingFaceCapture === deferred) pendingFaceCapture = null
        }
        val secret = when (outcome) {
            is FaceOutcome.Succeeded -> outcome.secret
            FaceOutcome.Cancelled -> {
                _state.value = JoinUiState.Error("face_capture_cancelled", "Face check was cancelled.")
                return
            }
        }

        // 2. Derive the witness.
        val unlocked: UnlockedCredential = try {
            FaceSecretCredential.fromSecret(secret)
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "credential derivation failed")
            secret.fill(0)
            _state.value = JoinUiState.Error(
                "credential_derivation_failed",
                "Couldn't read your identity from the face capture.",
            )
            return
        } finally {
            secret.fill(0)
        }

        // 3. Generate the proof bound to the /init nonce.
        val generated = try {
            _state.value = JoinUiState.Proving(0f)
            mobileProver.generate(GenerateInput(unlocked, ctx.nonceHex)) { progress ->
                _state.value = JoinUiState.Proving(progress.coerceIn(0f, 1f))
            }
        } catch (t: ProverException) {
            Timber.tag(TAG).w(t, "prover failed: %s", t.code)
            _state.value = JoinUiState.Error(t.code, t.message ?: "Proof generation failed.")
            return
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "prover threw")
            _state.value = JoinUiState.Error(ProverException.PROVER_FAILED, t.message ?: "Proof generation failed.")
            return
        } finally {
            try { unlocked.close() } catch (t: Throwable) { Timber.tag(TAG).w(t, "credential close threw") }
        }

        if (generated.publicSignals.isEmpty()) {
            _state.value = JoinUiState.Error("invalid_proof", "The proof was malformed. Try again.")
            return
        }
        val commitment = generated.publicSignals[0]

        // 4. Claim — the server binds the membership + consumes the invite.
        _state.value = JoinUiState.Claiming
        val resp = try {
            withContext(ioDispatcher) {
                attendanceApi.claim(
                    ClaimRequest(
                        companyId = ctx.companyId,
                        inviteCode = ctx.inviteCode,
                        sessionId = ctx.sessionId,
                        did = generated.did,
                        commitment = commitment,
                        proof = ProofDto(
                            pi_a = generated.proof.pi_a,
                            pi_b = generated.proof.pi_b,
                            pi_c = generated.proof.pi_c,
                            protocol = generated.proof.protocol,
                            curve = generated.proof.curve,
                        ),
                        publicSignals = generated.publicSignals,
                    ),
                )
            }
        } catch (t: Throwable) {
            val (code, message) = decodeError(t)
            Timber.tag(TAG).w(t, "claim failed: %s", code)
            _state.value = JoinUiState.Error(code, message)
            return
        }

        val emp = resp.employee
        if (resp.ok && emp != null) {
            passStore.upsert(
                PassStore.Pass(
                    companyId = ctx.companyId,
                    companyName = ctx.companyName,
                    locationLabel = ctx.locationLabel,
                    employeeId = emp.employeeId,
                    membershipId = emp.id,
                    joinedAt = nowIso(),
                ),
            )
            _state.value = JoinUiState.Done(ctx.companyName, emp.employeeId, emp.fullName, ctx.companyId)
        } else {
            _state.value = JoinUiState.Error("attendance_claim_failed", "Couldn't join. Ask HR for a fresh invite.")
        }
    }

    /** Lift the server's `{ error, message }` out of a Retrofit failure. */
    private fun decodeError(t: Throwable): Pair<String, String> {
        if (t is retrofit2.HttpException) {
            val raw = runCatching { t.response()?.errorBody()?.string() }.getOrNull()
            val parsed = if (!raw.isNullOrBlank()) runCatching { org.json.JSONObject(raw) }.getOrNull() else null
            val code = parsed?.optString("error")?.takeIf { it.isNotBlank() } ?: "attendance_claim_failed"
            val message = parsed?.optString("message")?.takeIf { it.isNotBlank() }
                ?: "Couldn't join (HTTP ${t.code()}). Try again."
            return code to message
        }
        return "network_unreachable" to
            "Couldn't reach the attendance server. Check your connection and try again."
    }

    private fun nowIso(): String = runCatching { Instant.now().toString() }.getOrDefault("")

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
        private val passStore: PassStore,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(JoinViewModel::class.java)) {
                "JoinViewModel.Factory only constructs JoinViewModel"
            }
            return JoinViewModel(mobileProver, attendanceApi, passStore) as T
        }
    }

    private sealed interface FaceOutcome {
        data class Succeeded(val secret: ByteArray) : FaceOutcome
        object Cancelled : FaceOutcome
    }

    companion object {
        private const val TAG = "JoinViewModel"
    }
}

/** UI-facing state for the join ceremony. */
sealed interface JoinUiState {
    object Scanning : JoinUiState
    object Resolving : JoinUiState
    data class Confirm(val companyName: String, val locationLabel: String) : JoinUiState
    object AwaitingFaceCapture : JoinUiState
    data class Proving(val progress: Float) : JoinUiState
    object Claiming : JoinUiState
    data class Done(
        val companyName: String,
        val employeeId: String,
        val fullName: String,
        val companyId: String,
    ) : JoinUiState
    data class Error(val code: String, val message: String) : JoinUiState
}
