package dev.zeroauth.biometric

import java.security.MessageDigest
import java.util.Arrays

/**
 * SHA-256 wrapper with a zeroing post-condition.
 *
 * Used exactly once in the pipeline: the 256-byte quantised embedding
 * feeds into [digest] to produce the 32-byte biometricSecret. After
 * the digest is computed, the input buffer is overwritten with zeros
 * so the quantised embedding cannot be read out of a heap dump.
 *
 * The CLAUDE.md non-goal ("Never log biometric-derived raw data")
 * applies all the way down to byte arrays in memory — a heap snapshot
 * taken during enrollment must not contain the quantised embedding,
 * because that buffer is reversible to a face fingerprint (the
 * quantisation is one-to-one within the L2-normalised hypersphere
 * cell). The post-digest zeroing is the practical guard.
 *
 * Note that the **input array is mutated**. Callers must not hold a
 * reference to the array after this returns. This is a known sharp
 * edge — the alternative (defensive copy + zero the copy) would leave
 * the caller's copy in memory anyway, defeating the purpose. The
 * mutation contract is documented in the function kdoc.
 */
object Sha256 {

    /** Output length of SHA-256 in bytes. */
    const val DIGEST_LENGTH: Int = 32

    /**
     * Compute SHA-256 of [input] and zero [input] in place.
     *
     * @param input The 256-byte quantised embedding (or any byte
     *              array whose contents must not survive the call).
     *              MUTATED IN PLACE: after this returns, every byte
     *              of [input] is 0x00.
     * @return A fresh 32-byte digest.
     */
    fun digest(input: ByteArray): ByteArray {
        // We instantiate a fresh MessageDigest per call. SHA-256 setup
        // is microseconds; the alternative (singleton) would require
        // synchronisation across the enrollment + verification paths
        // and is not worth the complexity.
        val md = MessageDigest.getInstance("SHA-256")
        val out = md.digest(input)
        check(out.size == DIGEST_LENGTH) {
            "Sha256: MessageDigest produced ${out.size} bytes, expected $DIGEST_LENGTH"
        }
        // Overwrite the input. Arrays.fill is the canonical Java
        // primitive-zeroing call; on the HotSpot JVM it lowers to
        // a single intrinsic memset.
        Arrays.fill(input, 0.toByte())
        return out
    }
}
