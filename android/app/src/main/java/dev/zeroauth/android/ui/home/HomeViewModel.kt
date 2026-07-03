package dev.zeroauth.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import dev.zeroauth.android.net.DemoPortalApi
import dev.zeroauth.android.net.PendingRequestsBody
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * Home view model for the authenticator hub. Its only responsibility is the
 * approval inbox ([pendingApprovals]): DID-pinned login / payment approvals
 * pushed to this device (UPI-collect style). The Home screen drives
 * [pollPending] on a short loop while STARTED. Everything else on Home
 * (Scan-to-sign-in, My identity) is stateless navigation.
 */
class HomeViewModel(
    private val demoPortalApi: DemoPortalApi? = null,
    private val didProvider: () -> String? = { null },
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _pendingApprovals = MutableStateFlow<List<PendingApproval>>(emptyList())

    /** Pending DID-pinned approvals (bank login or payment step-up). */
    val pendingApprovals: StateFlow<List<PendingApproval>> = _pendingApprovals.asStateFlow()

    /**
     * One poll of the approval inbox. No-ops when the device has no
     * derivable DID (nothing enrolled yet) or the inbox API wasn't wired.
     * Network/derivation work runs on [ioDispatcher]; failures keep the
     * previous list so a flaky poll doesn't blink the UI.
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
            Timber.tag(TAG).d("pending poll skipped: %s", t.message)
        }
    }

    class Factory(
        private val demoPortalApi: DemoPortalApi? = null,
        private val didProvider: () -> String? = { null },
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(HomeViewModel::class.java)) {
                "HomeViewModel.Factory only constructs HomeViewModel"
            }
            return HomeViewModel(
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
 * One pending approval on the Home hub (UPI-collect style). [qrPayload] is
 * the exact `za:pair:1:...` challenge string the desktop QR would have shown
 * — Approve routes it into the existing scan→face→prove→authorize flow.
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
     * Human-readable payment line — e.g. "Pay ₹5,000 to Priya". Null for a
     * plain LOGIN, which keeps the login rendering.
     */
    val contextLabel: String? = null,
    /** "login" | "payment" — drives the payment-vs-login card styling. */
    val kind: String? = null,
) {
    /** A payment approval reads distinctly from a login in the inbox. */
    val isPayment: Boolean
        get() = kind == "payment" || contextLabel != null
}
