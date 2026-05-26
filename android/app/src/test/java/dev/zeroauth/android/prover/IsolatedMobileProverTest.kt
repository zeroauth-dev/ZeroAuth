package dev.zeroauth.android.prover

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Message
import android.os.Messenger
import dev.zeroauth.android.sec.UnlockedCredential
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Unit tests for [IsolatedMobileProver].
 *
 * Strategy: Robolectric doesn't simulate cross-process Binder, so we
 * bypass the real `bindService` machinery via the internal test
 * constructor that takes a pre-baked outgoing [Messenger]. A
 * [FakeProverService] handler stands in for the real Service: it
 * receives [MESSAGE_PROVE_REQUEST], records the [ProverRequest],
 * routes the canned response of the test's choosing back through
 * `msg.replyTo` exactly as [ProverService] would.
 *
 * Looper choreography: both the prover internals and the fake
 * Service run on dedicated [HandlerThread]s — NOT the main looper —
 * because Robolectric's main looper runs in PAUSED mode (4.10+) and
 * `runBlocking` on the test thread (which IS the main thread under
 * Robolectric) would deadlock waiting for itself to pump. With both
 * sides on their own threads, message dispatch happens immediately
 * and `runBlocking` resolves naturally.
 *
 * What this exercises:
 *   * Wire format — every [ProverRequest] field round-trips through
 *     [ProverIpc]'s Parcelable encoder.
 *   * Continuation routing — Progress events fire onProgress before
 *     the terminal Success/Failure resolves the suspended generate().
 *   * Binding death — calling [IsolatedMobileProver.simulateBindingDied]
 *     mid-request maps to [ProverException.WEBVIEW_CRASHED].
 *   * Client-side validation — generate() throws WITNESS_INVALID
 *     before any IPC happens when biometricSecret is malformed.
 *   * Binding reuse — sequential generate calls reuse the same
 *     outgoing Messenger (asserted by counting how many requests the
 *     fake Service receives).
 *   * Failure mapping — a [ProverResponse.Failure] surfaces as a
 *     [ProverException] with the same code.
 *
 * What this DOES NOT exercise:
 *   * The actual `bindService` flow through the AndroidManifest entry.
 *     That's an instrumentation-test concern; ShadowApplication's
 *     bindService is enough for the wiring but spinning up the full
 *     ProverService inside a Robolectric host re-imports the WebView
 *     stack, which doesn't run under Robolectric anyway. The
 *     ProverService is exercised at the WebViewMobileProver layer in
 *     [WebViewMobileProverTest], and the ProverIpc layer is exercised
 *     here.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE)
@OptIn(ExperimentalCoroutinesApi::class)
class IsolatedMobileProverTest {

    private lateinit var context: Context

    /**
     * Background looper that hosts the prover's internal state. Mirrors
     * production (main looper) in role, but lives on a dedicated thread
     * so `runBlocking` in the test body never tries to pump a looper
     * it's also blocking on.
     */
    private lateinit var proverThread: HandlerThread

    /**
     * Background looper for the fake Service-side Messenger.
     */
    private lateinit var serviceThread: HandlerThread
    private lateinit var serviceHandler: Handler

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        proverThread = HandlerThread("FakeProverInternal").apply { start() }
        serviceThread = HandlerThread("FakeProverService").apply { start() }
        serviceHandler = Handler(serviceThread.looper)
    }

    @After
    fun tearDown() {
        proverThread.quitSafely()
        serviceThread.quitSafely()
    }

    private fun newProver(outgoing: Messenger): IsolatedMobileProver =
        IsolatedMobileProver(
            context = context,
            timeoutMs = 5_000L,
            looper = proverThread.looper,
            testOutgoing = outgoing,
        )

    // ─── 1. Happy path: generate returns the relayed proof ───────────

    @Test
    fun `generate returns the proof relayed from the Service`() {
        val service = FakeProverService(serviceHandler)
        service.scriptedSuccess = ProverResponse.Success(
            pi_a = listOf("11", "22", "1"),
            pi_b = listOf(listOf("3", "4"), listOf("5", "6"), listOf("1", "0")),
            pi_c = listOf("7", "8", "1"),
            protocol = "groth16",
            curve = "bn128",
            publicSignals = listOf("aaa", "bbb", "ccc"),
            did = "did:zeroauth:demo:test",
            proofMs = 123L,
        )

        val prover = newProver(service.outgoing)

        val progressValues = CopyOnWriteArrayList<Float>()
        val result = runBlocking {
            prover.generate(TEST_INPUT) { progress ->
                progressValues.add(progress)
            }
        }

        // The Service's recorded request must match what the client built.
        val received = service.lastRequest
        assertNotNull("Service should have received a ProverRequest", received)
        assertEquals(TEST_INPUT.unlocked.biometricSecret, received!!.biometricSecret)
        assertEquals(TEST_INPUT.unlocked.salt, received.salt)
        assertEquals(TEST_INPUT.unlocked.commitment, received.commitment)
        assertEquals(TEST_INPUT.unlocked.didHash, received.didHash)
        assertEquals(TEST_INPUT.unlocked.did, received.did)
        assertEquals(TEST_INPUT.sessionNonceHex, received.sessionNonceHex)

        // The result must mirror the canned Success values.
        assertEquals(listOf("11", "22", "1"), result.proof.pi_a)
        assertEquals(listOf("aaa", "bbb", "ccc"), result.publicSignals)
        // The client always overrides `did` with the input's did
        // (defensive against future Service-side drift).
        assertEquals(TEST_INPUT.unlocked.did, result.did)
        assertEquals(123L, result.proofMs)

        // Progress fired before the terminal Success.
        assertTrue(
            "expected progress events; got $progressValues",
            progressValues.isNotEmpty(),
        )
    }

    // ─── 2. Binding death mid-request ────────────────────────────────

    @Test
    fun `generate throws WEBVIEW_CRASHED when binding dies mid-request`() {
        val service = FakeProverService(serviceHandler).apply {
            // Don't reply — keep generate() suspended until
            // simulateBindingDied trips below.
            holdResponses = true
        }
        val prover = newProver(service.outgoing)

        val gotRequest = CountDownLatch(1)
        service.onRequestReceived = { gotRequest.countDown() }

        val generateError = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
        val generateDone = CountDownLatch(1)

        // Run generate() on its own thread so the test thread can
        // race ahead and trigger simulateBindingDied while the
        // continuation is suspended.
        Thread {
            try {
                runBlocking { prover.generate(TEST_INPUT) }
                generateError.set(
                    AssertionError("Expected ProverException(WEBVIEW_CRASHED)")
                )
            } catch (e: Throwable) {
                generateError.set(e)
            } finally {
                generateDone.countDown()
            }
        }.start()

        // Wait for the request to reach the fake Service before
        // simulating the crash — without this we can race the
        // bindingDied call ahead of the generate's IPC, which
        // wouldn't reproduce the "mid-request" scenario.
        assertTrue(
            "Service should have received the request within 5s",
            gotRequest.await(5, TimeUnit.SECONDS),
        )

        prover.simulateBindingDied()
        assertTrue(
            "generate() must complete within 5s of simulated crash",
            generateDone.await(5, TimeUnit.SECONDS),
        )

        val exception = generateError.get()
        assertNotNull("generate() must have thrown", exception)
        assertTrue(
            "Expected ProverException, got $exception",
            exception is ProverException,
        )
        assertEquals(
            ProverException.WEBVIEW_CRASHED,
            (exception as ProverException).code,
        )
    }

    // ─── 3. Client-side validation ───────────────────────────────────

    @Test
    fun `generate throws WITNESS_INVALID when biometricSecret is malformed`() {
        val service = FakeProverService(serviceHandler)
        val prover = newProver(service.outgoing)

        val badInput = GenerateInput(
            unlocked = TestCredential(biometricSecret = "not-a-decimal-number"),
            sessionNonceHex = VALID_NONCE_HEX,
        )
        try {
            runBlocking { prover.generate(badInput) }
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
        // Crucially: NO request must have reached the Service. The
        // bad witness was rejected client-side before any IPC.
        assertEquals(0, service.requestCount)
    }

    @Test
    fun `generate throws WITNESS_INVALID when sessionNonceHex is the wrong length`() {
        val service = FakeProverService(serviceHandler)
        val prover = newProver(service.outgoing)

        val badInput = GenerateInput(
            unlocked = TestCredential(),
            // ADR-0009 pins 31-byte nonces (62 hex chars). 32 bytes
            // == 64 hex chars; this must be rejected by the precondition
            // check (the task's hint that says "biometricSecret length
            // != 32" describes the conceptual class; the nonce-shape
            // check is the actual precondition that fires here).
            sessionNonceHex = "00".repeat(32),
        )
        try {
            runBlocking { prover.generate(badInput) }
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
            assertTrue(
                "expected message to mention 62 hex chars: ${e.message}",
                e.message?.contains("62 hex") == true,
            )
        }
        assertEquals(0, service.requestCount)
    }

    // ─── 4. Sequential calls reuse the binding ────────────────────────

    @Test
    fun `sequential generate calls reuse the same binding`() {
        val service = FakeProverService(serviceHandler)
        service.scriptedSuccess = ProverResponse.Success(
            pi_a = listOf("1", "2", "1"),
            pi_b = listOf(listOf("3", "4"), listOf("5", "6"), listOf("1", "0")),
            pi_c = listOf("7", "8", "1"),
            protocol = "groth16",
            curve = "bn128",
            publicSignals = listOf("x", "y", "z"),
            did = "did:zeroauth:demo:test",
            proofMs = 42L,
        )

        val prover = newProver(service.outgoing)

        runBlocking {
            // Three back-to-back proofs.
            prover.generate(TEST_INPUT)
            prover.generate(TEST_INPUT)
            prover.generate(TEST_INPUT)
        }

        // All three reached the same Messenger — i.e. we did NOT
        // rebind between calls. The fake Service's requestCount
        // monotonically increments per inbound message.
        assertEquals(3, service.requestCount)
    }

    // ─── 5. Service-side Failure surfaces as a ProverException ───────

    @Test
    fun `generate maps Service Failure response to ProverException`() {
        val service = FakeProverService(serviceHandler).apply {
            scriptedFailure = ProverResponse.Failure(
                code = ProverException.PROVER_FAILED,
                errorMessage = "self_verify_failed",
            )
        }
        val prover = newProver(service.outgoing)

        try {
            runBlocking { prover.generate(TEST_INPUT) }
            fail("Expected ProverException(PROVER_FAILED)")
        } catch (e: ProverException) {
            assertEquals(ProverException.PROVER_FAILED, e.code)
            assertTrue(e.message?.contains("self_verify_failed") == true)
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /**
     * Stands in for [ProverService] in tests. Receives the
     * [ProverRequest] payload on a background looper (mirroring how
     * the real `:prover` process runs the Service), records what it
     * saw, and emits the [scriptedSuccess] or [scriptedFailure] response
     * via `msg.replyTo`.
     *
     * When [holdResponses] is true, requests are recorded but no
     * response is sent — used by the binding-death test to keep
     * generate() suspended.
     */
    private class FakeProverService(handler: Handler) {

        @Volatile
        var lastRequest: ProverRequest? = null

        @Volatile
        var requestCount: Int = 0

        @Volatile
        var scriptedSuccess: ProverResponse.Success? = null

        @Volatile
        var scriptedFailure: ProverResponse.Failure? = null

        @Volatile
        var holdResponses: Boolean = false

        /** Called from the Service handler thread whenever a request lands. */
        @Volatile
        var onRequestReceived: () -> Unit = {}

        val outgoing: Messenger = Messenger(object : Handler(handler.looper) {
            override fun handleMessage(msg: Message) {
                if (msg.what != MESSAGE_PROVE_REQUEST) return
                val bundle = msg.data ?: return
                bundle.classLoader = ProverRequest::class.java.classLoader
                @Suppress("DEPRECATION")
                val req: ProverRequest? = bundle.getParcelable(ProverService.KEY_REQUEST)
                lastRequest = req
                requestCount += 1
                onRequestReceived.invoke()
                val replyTo = msg.replyTo ?: return
                if (holdResponses) return

                // Emit a progress beat then the terminal response so
                // the test can assert onProgress fires.
                sendResponse(replyTo, ProverResponse.Progress(0.5f))

                val terminal: ProverResponse = scriptedFailure
                    ?: scriptedSuccess
                    ?: ProverResponse.Failure(
                        code = ProverException.PROVER_FAILED,
                        errorMessage = "FakeProverService: no scripted response",
                    )
                sendResponse(replyTo, terminal)
            }

            private fun sendResponse(replyTo: Messenger, response: ProverResponse) {
                val out = Message.obtain().apply {
                    what = MESSAGE_PROVE_RESPONSE
                    data = Bundle().apply {
                        classLoader = ProverResponse::class.java.classLoader
                        putParcelable(ProverService.KEY_RESPONSE, response)
                    }
                }
                runCatching { replyTo.send(out) }
            }
        })
    }

    private class TestCredential(
        override val biometricSecret: String = "12345678901234567890",
        override val salt: String = "98765432109876543210",
        override val commitment: String = "1111111111111111111",
        override val didHash: String = "2222222222222222222",
        override val did: String = "did:zeroauth:demo:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b",
    ) : UnlockedCredential() {
        override fun close() {}
    }

    companion object {
        private const val VALID_NONCE_HEX =
            "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

        private val TEST_INPUT = GenerateInput(
            unlocked = TestCredential(),
            sessionNonceHex = VALID_NONCE_HEX,
        )
    }
}
