package dev.zeroauth.android.biometric

import java.security.MessageDigest
import java.util.Arrays

/**
 * SHA-256 wrapper with a zeroing post-condition.
 *
 * Byte-identical to `mobile/biometric/Sha256.kt`. See the canonical
 * implementation for the full kdoc explaining the mutation contract.
 *
 * The input array is OVERWRITTEN with 0x00 after the digest is taken so
 * the quantised embedding cannot be read out of a heap dump. Callers
 * must not hold a reference to the array after this returns.
 */
internal object Sha256 {

    /** Output length of SHA-256 in bytes. */
    const val DIGEST_LENGTH: Int = 32

    /**
     * Compute SHA-256 of [input] and zero [input] in place.
     *
     * @param input MUTATED IN PLACE: every byte is 0x00 after this returns.
     * @return A fresh 32-byte digest.
     */
    fun digest(input: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        val out = md.digest(input)
        check(out.size == DIGEST_LENGTH) {
            "Sha256: MessageDigest produced ${out.size} bytes, expected $DIGEST_LENGTH"
        }
        Arrays.fill(input, 0.toByte())
        return out
    }
}
