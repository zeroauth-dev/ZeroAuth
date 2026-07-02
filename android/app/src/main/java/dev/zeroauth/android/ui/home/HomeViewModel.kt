package dev.zeroauth.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.AttendanceApi
import dev.zeroauth.android.net.DemoPortalApi
import dev.zeroauth.android.net.PendingRequestsBody
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.PassStore
import dev.zeroauth.android.sec.WifiAnchorChecker
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * Home hub view model. On [refresh] it reads the device's locally-cached
 * passes (the companies it has joined — there is no did-keyed server status
 * read), and for each one fetches the company anchor to compute the local
 * "on network" hint and reads the phone's own last in/out for that company.
 * The Home screen renders one card per pass plus a Scan-to-join affordance.
 *
 * The bank-2FA approval inbox is a SEPARATE flow ([pendingApprovals]) so
 * the Empty and Loaded pass states both render it without reshaping
 * [HomeUiState]: the Home screen drives [pollPending] on a 3-second loop
 * while STARTED and shows a "Verification requests" section above the
 * passes list whenever the inbox is non-empty.
 */
class HomeViewModel(
    private val attendanceApi: AttendanceApi,
    private val wifiChecker: WifiAnchorChecker,
    private val stateStore: AttendanceStateStore,
    private val passStore: PassStore,
    private val demoPortalApi: DemoPortalApi? = null,
    private val didProvider: () -> String? = { null },
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    private val _pendingApprovals = MutableStateFlow<List<PendingApproval>>(emptyList())

    /** Pending DID-pinned bank-login approvals (UPI-collect style). */
    val pendingApprovals: StateFlow<List<PendingApproval>> = _pendingApprovals.asStateFlow()

    /**
     * One poll of the approval inbox. No-ops when the device has no
     * derivable DID (nothing enrolled yet) or the inbox API wasn't
     * wired. Network/derivation work runs on [ioDispatcher]; failures
     * keep the previous list so a flaky poll doesn't blink the UI.
     */
    suspend fun pollPending() {
        val api = demoPortalApi ?: return
        try {
            val did = withContext(ioDispatcher) { didProvider() } ?: return
            val resp = withContext(ioDispatcher) {
                api.pendingRequests(PendingRequestsBody(did = did))
            }
            _pendingApprovals.value = resp.requests.map { r ->
                PendingApproval(
                    sessionId = r.sessionId,
                    qrPayload = r.qrPayload,
                    bank = r.bank ?: "NeoBank",
                    deviceHint = r.deviceHint,
                    requestedAt = r.requestedAt,
                    expiresAt = r.expiresAt,
                    contextLabel = r.contextLabel,
                    kind = r.kind,
                )
            }
        } catch (t: Throwable) {
            // Polling is best-effort — the phone may be offline between
            // demos. Log at debug (public metadata only) and keep the
            // last-known list.
            Timber.tag(TAG).d("pending poll skipped: %s", t.message)
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = HomeUiState.Loading
            val passes = passStore.list()
            if (passes.isEmpty()) {
                _state.value = HomeUiState.Empty
                return@launch
            }
            val reading = wifiChecker.currentReading()
            val cards = passes.map { pass ->
                val wifi = try {
                    withContext(ioDispatcher) { attendanceApi.company(pass.companyId) }.company.wifi
                } catch (t: Throwable) {
                    Timber.tag(TAG).w(t, "company fetch failed for %s", pass.companyId)
                    null
                }
                val last = stateStore.last(pass.companyId)
                PassCard(
                    companyId = pass.companyId,
                    companyName = pass.companyName,
                    locationLabel = pass.locationLabel,
                    onNetwork = wifi != null && wifiChecker.matches(reading, wifi),
                    detectedSsid = reading?.ssid,
                    checkedIn = last?.type == "check_in",
                    lastAt = last?.occurredAt,
                )
            }
            _state.value = HomeUiState.Loaded(cards)
        }
    }

    class Factory(
        private val attendanceApi: AttendanceApi,
        private val wifiChecker: WifiAnchorChecker,
        private val stateStore: AttendanceStateStore,
        private val passStore: PassStore,
        private val demoPortalApi: DemoPortalApi? = null,
        private val didProvider: () -> String? = { null },
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(HomeViewModel::class.java)) {
                "HomeViewModel.Factory only constructs HomeViewModel"
            }
            return HomeViewModel(
                attendanceApi = attendanceApi,
                wifiChecker = wifiChecker,
                stateStore = stateStore,
                passStore = passStore,
                demoPortalApi = demoPortalApi,
                didProvider = didProvider,
            ) as T
        }
    }

    companion object {
        private const val TAG = "HomeViewModel"
    }
}

/**
 * One pending bank-login approval on the Home hub (UPI-collect style).
 * [qrPayload] is the exact `za:pair:1:...` challenge string the desktop
 * QR would have shown — Approve routes it into the existing
 * scan→face→prove→authorize flow.
 */
data class PendingApproval(
    val sessionId: String,
    val qrPayload: String,
    val bank: String,
    /** Truncated desktop User-Agent — best-effort browser hint. */
    val deviceHint: String?,
    /** ISO-8601, nullable — server always sends it today. */
    val requestedAt: String?,
    val expiresAt: String?,
    /**
     * Human-readable payment line — e.g. "Pay ₹5,000 to Priya". Null for
     * a plain bank LOGIN, which keeps the original login rendering.
     */
    val contextLabel: String? = null,
    /** "login" | "payment" — drives the payment-vs-login card styling. */
    val kind: String? = null,
) {
    /** A payment approval reads distinctly from a login in the inbox. */
    val isPayment: Boolean
        get() = kind == "payment" || contextLabel != null
}

/** One claimed company on the Home hub. */
data class PassCard(
    val companyId: String,
    val companyName: String,
    val locationLabel: String,
    val onNetwork: Boolean,
    val detectedSsid: String?,
    val checkedIn: Boolean,
    val lastAt: String?,
)

sealed interface HomeUiState {
    object Loading : HomeUiState
    /** No passes joined yet — prompt the user to scan an invite. */
    object Empty : HomeUiState
    data class Loaded(val passes: List<PassCard>) : HomeUiState
    data class Error(val message: String) : HomeUiState
}
