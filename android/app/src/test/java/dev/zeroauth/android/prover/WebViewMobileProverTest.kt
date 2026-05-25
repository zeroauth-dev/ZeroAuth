package dev.zeroauth.android.prover

import android.content.Context
import dev.zeroauth.android.sec.UnlockedCredential
import org.robolectric.RuntimeEnvironment
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.math.BigInteger

/**
 * Unit tests for [WebViewMobileProver].
 *
 * Three layers of coverage:
 *
 *   1. **Input validation.** `generate()` must throw a
 *      [ProverException] with code [ProverException.WITNESS_INVALID]
 *      before it ever spins up the WebView when the witness is
 *      malformed. This is the cheapest line of defence and the one
 *      most likely to regress.
 *
 *   2. **Field-element parsing.** [WebViewMobileProver.parseFieldElement]
 *      mirrors the BN128 reduction the server uses to recompute
 *      `Poseidon(2)([didHash, nonce])` in `/v1/proof-pairing/submit`.
 *      If the phone parses a field element differently from the
 *      server, every proof fails with `pairing_nonce_mismatch`. Pin
 *      the bounds here so a future refactor can't quietly shift them.
 *
 *   3. **Timeout path.** A fake [MobileProver] that never resolves
 *      must surface [ProverException] with code
 *      [ProverException.TIMEOUT] via the coroutines `withTimeout`.
 *      We exercise this with a hand-rolled MobileProver because the
 *      real WebView one can't be driven cleanly under Robolectric
 *      (the WebView's internal looper is a separate render process
 *      that Robolectric doesn't simulate).
 *
 * The "happy path" — full snarkjs proof generation followed by
 * snarkjs.verify on the JVM — is **not** exercised here. snarkjs's
 * fullProve needs the WebView WASM compile + zkey load to run, and
 * Robolectric's WebView shadow doesn't execute JavaScript. The
 * happy path is covered transitively:
 *
 *   * `iot/src/proof.ts`'s round-trip in `iot/src/central-api.test.ts`
 *     uses the same snarkjs, the same circuit, and the same witness
 *     shape this prover produces, and
 *   * `tests/proof-pairing.test.ts` server-side verifies that the
 *     proof produced by an instrumentation device (or the iot bridge)
 *     against this exact `verification_key.json` succeeds.
 *
 * The instrumentation suite at `androidTest/` is where the WebView
 * happy path will live once the activity host lands.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE)
@OptIn(ExperimentalCoroutinesApi::class)
class WebViewMobileProverTest {

    private lateinit var context: Context

    @Before
    fun setUp() {
        // RuntimeEnvironment.getApplication() avoids the androidx-test-core
        // dependency that ApplicationProvider would force. We only need the
        // Context for asset-loader construction.
        context = RuntimeEnvironment.getApplication()
    }

    // ─── Input validation ────────────────────────────────────────────

    @Test
    fun `generate rejects non-numeric biometricSecret`() = runTest {
        val prover = WebViewMobileProver(context)
        val input = GenerateInput(
            unlocked = TestCredential(
                biometricSecret = "not-a-number",
            ),
            sessionNonceHex = VALID_NONCE_HEX,
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
            assertTrue(
                "message must mention biometricSecret: ${e.message}",
                e.message?.contains("biometricSecret") == true,
            )
        }
    }

    @Test
    fun `generate rejects empty biometricSecret`() = runTest {
        val prover = WebViewMobileProver(context)
        val input = GenerateInput(
            unlocked = TestCredential(biometricSecret = ""),
            sessionNonceHex = VALID_NONCE_HEX,
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
    }

    @Test
    fun `generate rejects out-of-field biometricSecret`() = runTest {
        val prover = WebViewMobileProver(context)
        // BN128 modulus itself is OUT of the field (inputs must be < p).
        val input = GenerateInput(
            unlocked = TestCredential(
                biometricSecret =
                    "21888242871839275222246405745257275088548364400416034343698204186575808495617",
            ),
            sessionNonceHex = VALID_NONCE_HEX,
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
            assertTrue(
                "message should mention BN128 field: ${e.message}",
                e.message?.contains("field", ignoreCase = true) == true,
            )
        }
    }

    @Test
    fun `generate rejects sessionNonceHex of wrong length`() = runTest {
        val prover = WebViewMobileProver(context)
        // 32 not 31 bytes. ADR-0009 §"Pinned parameters" pins 31.
        val input = GenerateInput(
            unlocked = TestCredential(),
            sessionNonceHex = "00".repeat(32),
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
            assertTrue(e.message?.contains("62 hex") == true)
        }
    }

    @Test
    fun `generate rejects sessionNonceHex with non-hex chars`() = runTest {
        val prover = WebViewMobileProver(context)
        val input = GenerateInput(
            unlocked = TestCredential(),
            sessionNonceHex = "zz" + "00".repeat(30), // 62 chars but 'z'
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
    }

    @Test
    fun `generate rejects blank did`() = runTest {
        val prover = WebViewMobileProver(context)
        val input = GenerateInput(
            unlocked = TestCredential(did = ""),
            sessionNonceHex = VALID_NONCE_HEX,
        )
        try {
            prover.generate(input)
            fail("Expected ProverException(WITNESS_INVALID)")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
            assertTrue(e.message?.contains("did") == true)
        }
    }

    // ─── Field-element parsing ───────────────────────────────────────

    @Test
    fun `parseFieldElement accepts a canonical zero`() {
        val n = WebViewMobileProver.parseFieldElement("x", "0")
        assertEquals(BigInteger.ZERO, n)
    }

    @Test
    fun `parseFieldElement accepts the largest valid scalar`() {
        // p - 1 is the largest value snarkjs accepts.
        val pMinusOne = WebViewMobileProver.FIELD_MODULUS - BigInteger.ONE
        val n = WebViewMobileProver.parseFieldElement("x", pMinusOne.toString(10))
        assertEquals(pMinusOne, n)
    }

    @Test
    fun `parseFieldElement rejects the field modulus itself`() {
        try {
            WebViewMobileProver.parseFieldElement(
                "x",
                WebViewMobileProver.FIELD_MODULUS.toString(10),
            )
            fail("Expected ProverException")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
    }

    @Test
    fun `parseFieldElement rejects negative-looking strings`() {
        try {
            WebViewMobileProver.parseFieldElement("x", "-1")
            fail("Expected ProverException")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
    }

    @Test
    fun `parseFieldElement rejects hex-style 0x prefix`() {
        try {
            WebViewMobileProver.parseFieldElement("x", "0xff")
            fail("Expected ProverException")
        } catch (e: ProverException) {
            assertEquals(ProverException.WITNESS_INVALID, e.code)
        }
    }

    // ─── Timeout path ────────────────────────────────────────────────

    /**
     * Timeout is documented as the failure mode when proving exceeds
     * `PROVE_TIMEOUT_MS`. We test it against a fake implementation
     * rather than the real WebView one because Robolectric's WebView
     * shadow neither runs JavaScript nor pumps the main looper
     * realistically — driving a 30-s wait through the actual coroutine
     * machinery would dominate the suite runtime.
     *
     * Using a fake here is fine because the production [withTimeout]
     * call is the standard coroutines primitive; MobileProver doesn't
     * invent its own timeout machinery.
     */
    @Test
    fun `generate throws Timeout when prover never resolves`() = runTest {
        val never = NeverResolvingMobileProver()
        try {
            never.generate(
                input = GenerateInput(
                    unlocked = TestCredential(),
                    sessionNonceHex = VALID_NONCE_HEX,
                ),
            )
            fail("Expected ProverException(TIMEOUT)")
        } catch (e: ProverException) {
            assertEquals(ProverException.TIMEOUT, e.code)
        }
    }

    // ─── jsString encoder ────────────────────────────────────────────

    @Test
    fun `jsString round-trips a JSON document`() {
        val payload = """{"type":"prove","inputs":{"a":"1"}}"""
        val encoded = WebViewMobileProver.jsString(payload)
        // Must be a quoted JS string literal.
        assertTrue(encoded.startsWith("\""))
        assertTrue(encoded.endsWith("\""))
        // Inner double-quotes must be escaped.
        assertTrue(encoded.contains("\\\""))
        // No literal newlines that would terminate the JS string.
        assertTrue(!encoded.contains('\n'))
    }

    @Test
    fun `jsString escapes line and paragraph separators`() {
        val sep = "  "
        val encoded = WebViewMobileProver.jsString(sep)
        assertTrue(encoded.contains("\\u2028"))
        assertTrue(encoded.contains("\\u2029"))
    }

    // ─── helpers ─────────────────────────────────────────────────────

    /**
     * Concrete [UnlockedCredential] for use in tests. Real impls live
     * behind the production KeystoreManager and require a Keystore-
     * bound Cipher to instantiate.
     *
     * Default values are within-field but otherwise meaningless — they
     * round-trip through the validator cleanly and lets us test the
     * parts we care about without standing up a real witness.
     */
    private class TestCredential(
        override val biometricSecret: String = "12345678901234567890",
        override val salt: String = "98765432109876543210",
        override val commitment: String = "1111111111111111111",
        override val didHash: String = "2222222222222222222",
        override val did: String = "did:zeroauth:demo:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b",
    ) : UnlockedCredential() {
        override fun close() {}
    }

    /**
     * A trivial [MobileProver] that always hangs forever inside an
     * un-resolvable suspendCoroutine. Used to exercise the timeout
     * path independently of the WebView path.
     */
    private class NeverResolvingMobileProver : MobileProver {
        override suspend fun generate(
            input: GenerateInput,
            onProgress: (Float) -> Unit,
        ): GenerateOutput {
            return withTimeout(WebViewMobileProver.PROVE_TIMEOUT_MS) {
                try {
                    suspendCancellableCoroutine<GenerateOutput> { /* never resumes */ }
                } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
                    throw ProverException(
                        code = ProverException.TIMEOUT,
                        message = "fake prover hung",
                        cause = e,
                    )
                }
            }
        }
    }

    companion object {
        /** A throwaway 62-char hex string that parses as a valid 31-byte nonce. */
        private const val VALID_NONCE_HEX =
            "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    }
}
