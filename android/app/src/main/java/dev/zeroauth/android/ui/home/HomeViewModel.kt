package dev.zeroauth.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.zeroauth.android.net.AttendanceApi
import dev.zeroauth.android.sec.AttendanceStateStore
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
 * Home hub view model. On [refresh] it fetches the company anchor, reads
 * the current WiFi, and reads the phone's own last attendance action
 * (local — there's no did-keyed server status read). The Home screen
 * renders the auto-detected company + a Check in/out CTA from this.
 */
class HomeViewModel(
    private val attendanceApi: AttendanceApi,
    private val wifiChecker: WifiAnchorChecker,
    private val stateStore: AttendanceStateStore,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _state.value = HomeUiState.Loading
            val company = try {
                withContext(ioDispatcher) { attendanceApi.company() }.company
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "company fetch failed")
                _state.value = HomeUiState.Error("Couldn't reach the attendance server.")
                return@launch
            }
            val reading = wifiChecker.currentReading()
            val last = stateStore.last()
            _state.value = HomeUiState.Loaded(
                companyName = company.name,
                locationLabel = company.location,
                onNetwork = wifiChecker.matches(reading, company.wifi),
                detectedSsid = reading?.ssid,
                checkedIn = last?.type == "check_in",
                lastAt = last?.occurredAt,
            )
        }
    }

    class Factory(
        private val attendanceApi: AttendanceApi,
        private val wifiChecker: WifiAnchorChecker,
        private val stateStore: AttendanceStateStore,
    ) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            require(modelClass.isAssignableFrom(HomeViewModel::class.java)) {
                "HomeViewModel.Factory only constructs HomeViewModel"
            }
            return HomeViewModel(attendanceApi, wifiChecker, stateStore) as T
        }
    }

    companion object {
        private const val TAG = "HomeViewModel"
    }
}

sealed interface HomeUiState {
    object Loading : HomeUiState
    data class Loaded(
        val companyName: String,
        val locationLabel: String,
        val onNetwork: Boolean,
        val detectedSsid: String?,
        val checkedIn: Boolean,
        val lastAt: String?,
    ) : HomeUiState
    data class Error(val message: String) : HomeUiState
}
