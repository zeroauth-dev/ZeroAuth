package dev.zeroauth.biometric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger

/**
 * Pins the mobile-side Poseidon port to poseidon-lite's JavaScript output.
 *
 * The constants in [PoseidonConstants] are byte-identical to
 * poseidon-lite@^0.3.0 (see PoseidonConstants.kt's header for the
 * regeneration recipe). If a value drifts, either the constants got
 * corrupted or the core kernel changed shape; either way the
 * server-side `expected === publicSignals[…]` check in
 * `tests/proof-pairing.test.ts` will reject every proof until the
 * drift is repaired, which is the desired blast radius.
 *
 * Vectors copied from the `android/` sibling implementation in
 * `android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt`
 * — that file's vectors have been pinned against poseidon-lite since
 * the W3 cycle. The two files share a single source of truth so the
 * cross-module compatibility holds without a separate fixture export.
 */
class PoseidonTest {

    // ─── BN128 field modulus assertion ─────────────────────────────────

    @Test
    fun `field modulus matches BN128`() {
        val expected = BigInteger(
            "21888242871839275222246405745257275088548364400416034343698204186575808495617"
        )
        assertEquals(expected, Poseidon.FIELD)
    }

    @Test
    fun `toField reduces 32-byte input below FIELD`() {
        val highBits = ByteArray(32) { 0xFF.toByte() }
        val reduced = Poseidon.toField(highBits)
        assertTrue("reduced value in [0, FIELD)", reduced >= BigInteger.ZERO)
        assertTrue("reduced value in [0, FIELD)", reduced < Poseidon.FIELD)
    }

    @Test
    fun `toField rejects non-32-byte input`() {
        try {
            Poseidon.toField(ByteArray(31))
            assert(false) { "expected IllegalArgumentException" }
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("32") == true)
        }
    }

    // ─── JS-reference vector tests (BigInteger interface) ──────────────

    @Test
    fun `poseidon1Bi(5) matches the JS reference`() {
        val expected = BigInteger(
            "19065150524771031435284970883882288895168425523179566388456001105768498065277"
        )
        assertEquals(expected, Poseidon.hash1Bi(BigInteger.valueOf(5)))
    }

    @Test
    fun `poseidon2Bi(1, 2) matches the JS reference`() {
        val expected = BigInteger(
            "7853200120776062878684798364095072458815029376092732009249414926327459813530"
        )
        assertEquals(expected, Poseidon.hash2Bi(BigInteger.ONE, BigInteger.valueOf(2)))
    }

    @Test
    fun `poseidon2Bi is order-sensitive`() {
        val ab = Poseidon.hash2Bi(BigInteger.valueOf(7), BigInteger.valueOf(11))
        val ba = Poseidon.hash2Bi(BigInteger.valueOf(11), BigInteger.valueOf(7))
        assertNotEquals("poseidon2 must be order-sensitive", ab, ba)
    }

    @Test
    fun `poseidon is deterministic`() {
        val a = Poseidon.hash2Bi(BigInteger.valueOf(42), BigInteger.valueOf(99))
        val b = Poseidon.hash2Bi(BigInteger.valueOf(42), BigInteger.valueOf(99))
        assertEquals(a, b)
    }

    @Test
    fun `poseidon stays within the BN254 field`() {
        val almostField = PoseidonConstants.FIELD.subtract(BigInteger.ONE)
        val out = Poseidon.hash2Bi(almostField, almostField)
        assertTrue("Poseidon output is non-negative", out >= BigInteger.ZERO)
        assertTrue("Poseidon output stays in the field", out < PoseidonConstants.FIELD)
    }

    // ─── Byte-array wrappers (the CommitmentBuilder boundary) ──────────

    @Test
    fun `hash2(ByteArray) produces a 32-byte output`() {
        val a = ByteArray(32) { 0x01 }
        val b = ByteArray(32) { 0x02 }
        val out = Poseidon.hash2(a, b)
        assertEquals(32, out.size)
    }

    @Test
    fun `hash2(ByteArray) round-trips through toField for the (1, 2) vector`() {
        val a = ByteArray(32); a[31] = 0x01           // = 1
        val b = ByteArray(32); b[31] = 0x02           // = 2
        val bytesResult = Poseidon.hash2(a, b)
        val biResult = Poseidon.hash2Bi(BigInteger.ONE, BigInteger.valueOf(2))
        assertEquals(biResult, BigInteger(1, bytesResult))
    }

    @Test
    fun `hash2(ByteArray) tolerates 2-bit-overflow inputs via toField`() {
        val highBitsSet = ByteArray(32) { 0xFF.toByte() }
        val zero = ByteArray(32)
        val out = Poseidon.hash2(highBitsSet, zero)
        assertEquals(32, out.size)
        val biOut = BigInteger(1, out)
        assertTrue("output within field", biOut >= BigInteger.ZERO)
        assertTrue("output within field", biOut < Poseidon.FIELD)
    }

    @Test
    fun `hash1(ByteArray) matches hash1Bi after toField`() {
        val x = ByteArray(32); x[31] = 0x05   // = 5
        val bytesResult = Poseidon.hash1(x)
        val biResult = Poseidon.hash1Bi(BigInteger.valueOf(5))
        assertEquals(biResult, BigInteger(1, bytesResult))
    }

    @Test
    fun `hash2(ByteArray) is order-sensitive`() {
        val a = ByteArray(32); a[31] = 0x07
        val b = ByteArray(32); b[31] = 0x0B
        val ab = Poseidon.hash2(a, b).toList()
        val ba = Poseidon.hash2(b, a).toList()
        assertNotEquals("hash2 byte-array form is order-sensitive", ab, ba)
    }

    @Test
    fun `hash2(ByteArray) is deterministic`() {
        val a = ByteArray(32) { 0x42 }
        val b = ByteArray(32) { 0x63 }
        val a1 = Poseidon.hash2(a, b).toList()
        val a2 = Poseidon.hash2(a, b).toList()
        assertEquals(a1, a2)
    }
}
