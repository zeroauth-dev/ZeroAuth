package dev.zeroauth.android.ui.scan

import androidx.fragment.app.FragmentActivity
import app.cash.turbine.test
import dev.zeroauth.android.net.PairingSession
import dev.zeroauth.android.net.SessionResponse
import dev.zeroauth.android.net.ZeroAuthApi
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.BiometricResult
import dev.zeroauth.android.util.ClientMeta
import dev.zeroauth.android.util.FakeBiometricGate
import dev.zeroauth.android.util.FakeKeystoreManager
import dev.zeroauth.android.util.FakeMobileProver
import javax.crypto.Cipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.mock
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Unit tests for [ScanViewModel].
 *
 * Robolectric powers the test because [ScanViewModel] uses
 * `android.os.Build.MODEL` and `androidx.lifecycle.viewModelScope`,
 * both of which need an Android-shadowed JVM environment.
 *
 * The six required cases from the W3 brief:
 *   1. Idle → Scanning on permission grant
 *   2. Scanning → ChallengeParsed on valid QR
 *   3. Scanning stays on invalid QR
 *   4. ChallengeParsed → AwaitingBiometric on Approve
 *   5. Happy path (fake prover) ends in ProofReady
 *   6. Biometric cancel ⇒ Error("biometric_cancelled")
 *   7. Prover failure ⇒ Error("prover_failed")
 *
 * All dependencies are fakes from `util/FakeProverAndSec.kt`. The
 * FragmentActivity is mocked because the BiometricGate signature
 * requires it — the FakeBiometricGate never reads the activity.
 *
 * Test dispatcher: [Dispatchers.Main] is swapped for a
 * [StandardTestDispatcher] in `setUp`, scrubbed in `tearDown`. Most
 * tests use [advanceUntilIdle] to drain the viewModelScope.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30]) // Match minSdk so any APIs that check Build.VERSION pass.
class ScanViewModelTest {

    private val testScheduler = kotlinx.coroutines.test.TestCoroutineScheduler()
    private val mainDispatcher = StandardTestDispatcher(testScheduler)

    @Before
    fun setUp() {
        Dispatchers.setMain(mainDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    /**
     * Run a test against the SAME scheduler the ViewModel's coroutines
     * use. Without this, `runTest`'s default scheduler is independent
     * of [mainDispatcher.scheduler] and `advanceUntilIdle()` inside the
     * block doesn't drain `viewModelScope` launches.
     */
    private fun runVmTest(block: suspend kotlinx.coroutines.test.TestScope.() -> Unit) =
        runTest(testScheduler, testBody = block)

    // ─── Helpers ─────────────────────────────────────────────────

    /** A challenge QR whose integrity tag verifies. Recompute when
     * editing — see DesktopChallenge.verifyIntegrityTag. */
    private val validChallengeQr: String by lazy {
        val sessionId = "9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1"
        val nonceHex  = "deadbeefcafebabe1234567890abcdef0123456789abcdef0123456789abcd"
        val tenantDomain = "demo.zeroauth.dev"
        val canonical = "$sessionId|$nonceHex|$tenantDomain"
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray())
        val tag = digest.copyOfRange(0, 2).joinToString("") { "%02x".format(it) }
        "za:pair:1:$sessionId:$nonceHex:$tenantDomain:$tag"
    }

    /** Mock activity — the FakeBiometricGate never reads it. */
    private val mockActivity: FragmentActivity = mock()

    /** A no-op ZeroAuthApi that throws on any call — exercising the
     * "metadata fetch is optional and failure-tolerant" branch. */
    private val throwingApi: ZeroAuthApi = object : ZeroAuthApi {
        override suspend fun getSession(bearer: String, id: String): SessionResponse {
            throw RuntimeException("simulated network failure")
        }
    }

    /** A successful ZeroAuthApi that returns a labelled session. */
    private fun labelledApi(label: String): ZeroAuthApi = object : ZeroAuthApi {
        override suspend fun getSession(bearer: String, id: String): SessionResponse =
            SessionResponse(
                session = PairingSession(
                    id = id,
                    nonce = "00".repeat(31),
                    state = "issued",
                    expiresAt = "2026-05-25T14:35:00.000Z",
                    initiatorLabel = label,
                    tenantName = "ZeroAuth Demo Tenant",
                ),
            )
    }

    private fun newViewModel(
        keystore: FakeKeystoreManager = FakeKeystoreManager(),
        biometric: FakeBiometricGate = FakeBiometricGate(
            nextResult = BiometricResult.Success(Cipher.getInstance("AES/GCM/NoPadding")),
        ),
        prover: FakeMobileProver = FakeMobileProver(delayMs = 0L),
        api: ZeroAuthApi = throwingApi,
    ): ScanViewModel = ScanViewModel(
        keystoreManager = keystore,
        biometricGate   = biometric,
        mobileProver    = prover,
        api             = api,
        ioDispatcher    = UnconfinedTestDispatcher(mainDispatcher.scheduler),
        clientMetaFactory = {
            ClientMeta(
                appVersion = "test",
                model      = "RobolectricEmu",
                proofMs    = 0L,
            )
        },
    )

    // ─── 1. Idle → Scanning on permission grant ──────────────────

    @Test
    fun `permission grant transitions Idle to Scanning`() = runVmTest {
        val vm = newViewModel()
        vm.state.test {
            assertEquals(ScanState.Idle, awaitItem())
            vm.onPermissionGranted()
            assertEquals(ScanState.Scanning, awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── 2. Scanning → ChallengeParsed on valid QR ───────────────

    @Test
    fun `valid challenge QR transitions Scanning to ChallengeParsed`() = runVmTest {
        val vm = newViewModel()
        vm.state.test {
            assertEquals(ScanState.Idle, awaitItem())
            vm.onPermissionGranted()
            assertEquals(ScanState.Scanning, awaitItem())

            vm.onQrDetected(validChallengeQr)
            val parsed = awaitItem()
            assertTrue(parsed is ScanState.ChallengeParsed)
            assertEquals(
                "9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1",
                (parsed as ScanState.ChallengeParsed).challenge.sessionId,
            )
            // tenantLabel starts null; the metadata fetch is async.
            assertEquals(null, parsed.tenantLabel)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── Bonus: tenantLabel updates when /public returns one ─────

    @Test
    fun `tenant label is populated when the public metadata endpoint succeeds`() = runVmTest {
        val vm = newViewModel(api = labelledApi("Chrome on MacBook Pro"))
        vm.state.test {
            assertEquals(ScanState.Idle, awaitItem())
            vm.onPermissionGranted()
            assertEquals(ScanState.Scanning, awaitItem())
            vm.onQrDetected(validChallengeQr)
            // First emission: ChallengeParsed with null label.
            val first = awaitItem() as ScanState.ChallengeParsed
            assertEquals(null, first.tenantLabel)

            advanceUntilIdle() // drain the metadata fetch coroutine

            val updated = awaitItem() as ScanState.ChallengeParsed
            assertEquals("Chrome on MacBook Pro", updated.tenantLabel)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── 3. Scanning stays on invalid QR ─────────────────────────

    @Test
    fun `invalid QR keeps the state machine in Scanning`() = runVmTest {
        val vm = newViewModel()
        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        assertEquals(ScanState.Scanning, vm.state.value)

        // Wrong prefix
        vm.onQrDetected("https://zeroauth.dev")
        assertEquals(ScanState.Scanning, vm.state.value)

        // Right prefix, wrong segment count
        vm.onQrDetected("za:pair:1:only-one-segment")
        assertEquals(ScanState.Scanning, vm.state.value)

        // Right prefix + count, wrong integrity tag
        vm.onQrDetected("za:pair:1:abc:def:zeroauth.dev:0000")
        assertEquals(ScanState.Scanning, vm.state.value)
    }

    // ─── 4. ChallengeParsed → AwaitingBiometric on Approve ───────

    @Test
    fun `approve from ChallengeParsed transitions through AwaitingBiometric`() = runVmTest {
        // Use a biometric gate that BLOCKS so we can observe the
        // AwaitingBiometric state before it resolves.
        val biometric = FakeBiometricGate(
            nextResult = BiometricResult.Success(Cipher.getInstance("AES/GCM/NoPadding")),
            delayMs    = 1_000,
        )
        val vm = newViewModel(biometric = biometric)

        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        assertTrue(vm.state.value is ScanState.ChallengeParsed)

        vm.onBiometricApproved(mockActivity, FakeKeystoreManager.DEMO_EMAIL)
        mainDispatcher.scheduler.runCurrent()
        assertEquals(ScanState.AwaitingBiometric, vm.state.value)
    }

    // ─── 5. End-to-end happy path → ProofReady ───────────────────

    @Test
    fun `happy path ends in ProofReady with a za_proof_1 QR text`() = runVmTest {
        val keystore = FakeKeystoreManager()
        val prover   = FakeMobileProver(delayMs = 0L)
        val vm = newViewModel(keystore = keystore, prover = prover)

        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        vm.onBiometricApproved(mockActivity, FakeKeystoreManager.DEMO_EMAIL)
        mainDispatcher.scheduler.advanceUntilIdle()

        val terminal = vm.state.value
        assertTrue(
            "Expected ProofReady but got ${terminal::class.simpleName}",
            terminal is ScanState.ProofReady,
        )
        terminal as ScanState.ProofReady
        assertTrue(
            "QR text should carry the proof prefix; was ${terminal.qrText.take(20)}",
            terminal.qrText.startsWith("za:proof:1:"),
        )

        // The fake credential should have been closed after generate.
        val issued = keystore.lastIssued
        assertNotNull("FakeKeystoreManager should have issued a credential", issued)
    }

    // ─── 6. Biometric cancel ⇒ Error("biometric_cancelled") ──────

    @Test
    fun `biometric cancel transitions to Error with stable code`() = runVmTest {
        val biometric = FakeBiometricGate(nextResult = BiometricResult.Cancelled)
        val vm = newViewModel(biometric = biometric)

        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        vm.onBiometricApproved(mockActivity, FakeKeystoreManager.DEMO_EMAIL)
        mainDispatcher.scheduler.advanceUntilIdle()

        val terminal = vm.state.value
        assertTrue(terminal is ScanState.Error)
        terminal as ScanState.Error
        assertEquals("biometric_cancelled", terminal.code)
    }

    // ─── 7. Prover failure ⇒ Error("prover_failed") ──────────────

    @Test
    fun `prover failure transitions to Error with prover_failed code`() = runVmTest {
        val prover = FakeMobileProver(
            delayMs = 0L,
            failWith = ProverException(
                code = ProverException.PROVER_FAILED,
                message = "snarkjs threw",
            ),
        )
        val vm = newViewModel(prover = prover)

        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        vm.onBiometricApproved(mockActivity, FakeKeystoreManager.DEMO_EMAIL)
        mainDispatcher.scheduler.advanceUntilIdle()

        val terminal = vm.state.value
        assertTrue(terminal is ScanState.Error)
        terminal as ScanState.Error
        assertEquals("prover_failed", terminal.code)
    }

    // ─── Bonus: retry from Error → Idle ──────────────────────────

    @Test
    fun `retry from Error returns to Idle`() = runVmTest {
        val biometric = FakeBiometricGate(nextResult = BiometricResult.Cancelled)
        val vm = newViewModel(biometric = biometric)

        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        vm.onBiometricApproved(mockActivity, FakeKeystoreManager.DEMO_EMAIL)
        mainDispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.state.value is ScanState.Error)

        vm.retry()
        assertEquals(ScanState.Idle, vm.state.value)
    }

    // ─── Bonus: Cancel from ChallengeParsed → Scanning ───────────

    @Test
    fun `cancel from ChallengeParsed returns to Scanning`() = runVmTest {
        val vm = newViewModel()
        vm.onPermissionGranted()
        mainDispatcher.scheduler.advanceUntilIdle()
        vm.onQrDetected(validChallengeQr)
        mainDispatcher.scheduler.runCurrent()
        assertTrue(vm.state.value is ScanState.ChallengeParsed)

        vm.onChallengeCancelled()
        assertEquals(ScanState.Scanning, vm.state.value)
    }
}
