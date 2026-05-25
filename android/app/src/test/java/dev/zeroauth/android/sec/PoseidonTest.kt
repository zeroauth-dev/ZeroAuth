package dev.zeroauth.android.sec

import org.junit.Test
import org.junit.Assert.assertEquals
import java.math.BigInteger

/**
 * Pins the Kotlin Poseidon port to poseidon-lite's JavaScript output.
 *
 * Each vector below was produced by running poseidon-lite@^0.3.0 directly
 * (see PoseidonConstants.kt's header for the regeneration recipe). If a
 * value drifts, either the constants got corrupted or the core kernel
 * changed shape; either way the server-side `expected === publicSignals[…]`
 * check in tests/proof-pairing.test.ts will reject every proof until the
 * drift is repaired, which is the desired blast radius.
 */
class PoseidonTest {

    @Test
    fun `poseidon1(5) matches the JS reference`() {
        val expected = BigInteger(
            "19065150524771031435284970883882288895168425523179566388456001105768498065277"
        )
        assertEquals(expected, Poseidon.hash1(BigInteger.valueOf(5)))
    }

    @Test
    fun `poseidon2(1, 2) matches the JS reference`() {
        val expected = BigInteger(
            "7853200120776062878684798364095072458815029376092732009249414926327459813530"
        )
        assertEquals(
            expected,
            Poseidon.hash2(BigInteger.ONE, BigInteger.valueOf(2)),
        )
    }

    @Test
    fun `poseidon2 is order-sensitive`() {
        val ab = Poseidon.hash2(BigInteger.valueOf(7), BigInteger.valueOf(11))
        val ba = Poseidon.hash2(BigInteger.valueOf(11), BigInteger.valueOf(7))
        // Sanity: swapping inputs changes the output. Without this, the
        // commitment / identityBinding equations would conflate roles.
        assert(ab != ba) { "poseidon2 must be order-sensitive" }
    }

    @Test
    fun `poseidon is deterministic`() {
        val a = Poseidon.hash2(BigInteger.valueOf(42), BigInteger.valueOf(99))
        val b = Poseidon.hash2(BigInteger.valueOf(42), BigInteger.valueOf(99))
        assertEquals(a, b)
    }

    @Test
    fun `poseidon stays within the BN254 field`() {
        // A worst-case input just below the field modulus.
        val almostField = PoseidonConstants.FIELD.subtract(BigInteger.ONE)
        val out = Poseidon.hash2(almostField, almostField)
        assert(out >= BigInteger.ZERO) { "Poseidon output is non-negative" }
        assert(out < PoseidonConstants.FIELD) { "Poseidon output stays in the field" }
    }
}
