package dev.zeroauth.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.AttendanceApi
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
 */
class HomeViewModel(
    private val attendanceApi: AttendanceApi,
    private val wifiChecker: WifiAnchorChecker,
    private val stateStore: AttendanceStateStore,
    private val passStore: PassStore,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

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
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(HomeViewModel::class.java)) {
                "HomeViewModel.Factory only constructs HomeViewModel"
            }
            return HomeViewModel(attendanceApi, wifiChecker, stateStore, passStore) as T
        }
    }

    companion object {
        private const val TAG = "HomeViewModel"
    }
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
