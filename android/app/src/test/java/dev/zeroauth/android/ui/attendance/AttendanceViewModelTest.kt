package dev.zeroauth.android.ui.attendance

import android.content.Context
import dev.zeroauth.android.net.AttendanceApi
import dev.zeroauth.android.net.ClaimRequest
import dev.zeroauth.android.net.ClaimResponse
import dev.zeroauth.android.net.CompanyDto
import dev.zeroauth.android.net.CompanyResponse
import dev.zeroauth.android.net.CompanyWifiDto
import dev.zeroauth.android.net.InitRequest
import dev.zeroauth.android.net.InitResponse
import dev.zeroauth.android.net.RecordRequest
import dev.zeroauth.android.net.RecordResponse
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.WifiAnchorChecker
import dev.zeroauth.android.util.FakeMobileProver
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import retrofit2.HttpException
import retrofit2.Response

/**
 * Unit tests for [AttendanceViewModel] — the check-in / check-out state
 * machine. Robolectric powers the test (the VM uses `Build.MODEL` +
 * `viewModelScope`, and the deps need a Context). The prover + API are
 * fakes; the WiFi checker is subclassed to return a canned reading so the
 * presence gate is deterministic. The real [dev.zeroauth.android.sec.FaceSecretCredential]
 * derivation runs (it is pure JVM crypto).
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class AttendanceViewModelTest {

    private val scheduler = kotlinx.coroutines.test.TestCoroutineScheduler()
    private val mainDispatcher = StandardTestDispatcher(scheduler)
    private val context: Context get() = RuntimeEnvironment.getApplication()

    private val onAnchorBssid = "aa:bb:cc:dd:ee:ff"
    private val company = CompanyDto(
        name = "Anchor Corp",
        location = "Anchor Corp HQ",
        wifi = CompanyWifiDto(
            ssidLabel = "AnchorCorp-Office",
            bssids = listOf(onAnchorBssid),
            minSignalPercent = 85,
        ),
    )

    @Before fun setUp() { Dispatchers.setMain(mainDispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    private fun stubWifi(reading: WifiAnchorChecker.WifiReading?) =
        object : WifiAnchorChecker(context) {
            override fun currentReading(): WifiReading? = reading
        }

    private fun onNetworkReading() =
        WifiAnchorChecker.WifiReading(ssid = "AnchorCorp-Office", bssid = onAnchorBssid, signalPercent = 92)

    private fun fakeApi(throwOnRecord: Throwable? = null) = object : AttendanceApi {
        override suspend fun company(companyId: String?): CompanyResponse = CompanyResponse(company)
        override suspend fun init(body: InitRequest): InitResponse = InitResponse(
            sessionId = "11111111-2222-3333-4444-555555555555",
            nonce = "a".repeat(62),
            company = company,
        )
        override suspend fun record(body: RecordRequest): RecordResponse {
            throwOnRecord?.let { throw it }
            return RecordResponse(ok = true, type = body.type, result = "accepted", occurredAt = "2026-06-12T09:02:00.000Z")
        }
        override suspend fun claim(body: ClaimRequest): ClaimResponse =
            throw UnsupportedOperationException("claim not exercised in AttendanceViewModel tests")
    }

    private fun vm(wifi: WifiAnchorChecker, api: AttendanceApi = fakeApi()) =
        AttendanceViewModel(
            mobileProver = FakeMobileProver(delayMs = 0),
            attendanceApi = api,
            wifiChecker = wifi,
            stateStore = AttendanceStateStore(context),
            ioDispatcher = mainDispatcher,
        )

    @Test
    fun `off-network reading lands on OffNetwork before any face capture`() = runTest(mainDispatcher) {
        val viewModel = vm(stubWifi(WifiAnchorChecker.WifiReading("Cafe", "99:99:99:99:99:99", 99)))
        viewModel.start("check_in")
        advanceUntilIdle()
        assertTrue(viewModel.state.value is AttendanceUiState.OffNetwork)
    }

    @Test
    fun `happy path on-network records a check-in and ends in Done`() = runTest(mainDispatcher) {
        val viewModel = vm(stubWifi(onNetworkReading()))
        viewModel.start("check_in")
        advanceUntilIdle()
        assertTrue(viewModel.state.value is AttendanceUiState.AwaitingFaceCapture)

        viewModel.onFaceCaptureSucceeded(ByteArray(32) { 7 })
        advanceUntilIdle()

        val s = viewModel.state.value
        assertTrue("expected Done, got $s", s is AttendanceUiState.Done)
        assertEquals("check_in", (s as AttendanceUiState.Done).type)
        // Local state is cached for Home (there is no server status read).
        assertTrue(AttendanceStateStore(context).isCheckedIn())
    }

    @Test
    fun `face-capture cancel surfaces a face_capture_cancelled error`() = runTest(mainDispatcher) {
        val viewModel = vm(stubWifi(onNetworkReading()))
        viewModel.start("check_in")
        advanceUntilIdle()
        assertTrue(viewModel.state.value is AttendanceUiState.AwaitingFaceCapture)

        viewModel.onFaceCaptureCancelled()
        advanceUntilIdle()

        val s = viewModel.state.value
        assertTrue("expected Error, got $s", s is AttendanceUiState.Error)
        assertEquals("face_capture_cancelled", (s as AttendanceUiState.Error).code)
    }

    @Test
    fun `server outside_anchor reply collapses to OffNetwork`() = runTest(mainDispatcher) {
        val body = "{\"error\":\"outside_anchor\"}".toResponseBody("application/json".toMediaType())
        val http = HttpException(Response.error<Any>(403, body))
        val viewModel = vm(stubWifi(onNetworkReading()), api = fakeApi(throwOnRecord = http))

        viewModel.start("check_in")
        advanceUntilIdle()
        viewModel.onFaceCaptureSucceeded(ByteArray(32) { 7 })
        advanceUntilIdle()

        assertTrue(viewModel.state.value is AttendanceUiState.OffNetwork)
    }
}
