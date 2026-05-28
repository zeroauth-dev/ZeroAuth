package dev.zeroauth.biometric

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Sha256Test — digest correctness + input-zeroing post-condition.
 *
 * The zeroing post-condition is the security-load-bearing assertion
 * here: a heap dump taken between the quantiser and the prover MUST
 * NOT contain the quantised embedding. Sha256.digest mutates its input
 * to zero immediately after the digest is computed.
 */
class Sha256Test {

    @Test
    fun `digest returns 32 bytes`() {
        val input = ByteArray(256) { 0x42 }
        val out = Sha256.digest(input)
        assertEquals(32, out.size)
    }

    @Test
    fun `digest matches the known SHA-256 vector for the empty string`() {
        // RFC 4634 / FIPS-180-2 test vector: SHA-256("") =
        // e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        val empty = ByteArray(0)
        val out = Sha256.digest(empty)
        val expected = byteArrayOf(
            0xe3.toByte(), 0xb0.toByte(), 0xc4.toByte(), 0x42.toByte(),
            0x98.toByte(), 0xfc.toByte(), 0x1c.toByte(), 0x14.toByte(),
            0x9a.toByte(), 0xfb.toByte(), 0xf4.toByte(), 0xc8.toByte(),
            0x99.toByte(), 0x6f.toByte(), 0xb9.toByte(), 0x24.toByte(),
            0x27.toByte(), 0xae.toByte(), 0x41.toByte(), 0xe4.toByte(),
            0x64.toByte(), 0x9b.toByte(), 0x93.toByte(), 0x4c.toByte(),
            0xa4.toByte(), 0x95.toByte(), 0x99.toByte(), 0x1b.toByte(),
            0x78.toByte(), 0x52.toByte(), 0xb8.toByte(), 0x55.toByte(),
        )
        assertArrayEquals(expected, out)
    }

    @Test
    fun `digest zeroes the input buffer in place`() {
        val input = ByteArray(256) { 0x42 }
        // Snapshot a pre-call hash so we can verify the call did
        // produce SOMETHING from the non-zero bytes (a regression
        // where digest does nothing would also leave the buffer
        // untouched, so we need both checks).
        val originalCopy = input.copyOf()
        val out = Sha256.digest(input)
        // The digest of 256 × 0x42 must not be all-zero (sanity).
        assertNotAllZero("digest output", out)
        // The input array MUST be all-zero after the call.
        for (i in input.indices) {
            assertEquals(
                "input[$i] must be zero after Sha256.digest, was ${input[i]}",
                0.toByte(),
                input[i],
            )
        }
        // Sanity: the snapshot retains the pre-call value, proving we
        // didn't accidentally compare two references to the same array.
        assertEquals(0x42.toByte(), originalCopy[0])
    }

    @Test
    fun `digest is deterministic`() {
        val a = Sha256.digest(ByteArray(256) { (it and 0xFF).toByte() })
        val b = Sha256.digest(ByteArray(256) { (it and 0xFF).toByte() })
        assertArrayEquals(a, b)
    }

    @Test
    fun `digest distinguishes different inputs`() {
        val a = Sha256.digest(ByteArray(256) { 0 })
        val b = Sha256.digest(ByteArray(256) { 1 })
        val same = a.contentEquals(b)
        assert(!same) { "SHA-256 must produce different output for different input" }
    }

    private fun assertNotAllZero(label: String, bytes: ByteArray) {
        var sum = 0
        for (b in bytes) sum = sum or (b.toInt() and 0xFF)
        assert(sum != 0) { "$label was unexpectedly all-zero" }
    }
}
