package dev.zeroauth.android.sec

import java.security.SecureRandom

/**
 * SecureRandom that returns a pinned byte stream. Used by
 * [AndroidKeystoreManagerTest] to drive a deterministic enrollment whose
 * output matches a hand-computed JS reference vector.
 *
 * Once the pinned buffer is exhausted, `nextBytes` throws — this catches
 * any test drift where the manager grew an extra RNG draw without the
 * fixture being updated.
 */
internal class DeterministicRandom(private val source: ByteArray) : SecureRandom() {
    private var offset: Int = 0

    override fun nextBytes(bytes: ByteArray) {
        val end = offset + bytes.size
        check(end <= source.size) {
            "DeterministicRandom exhausted: need ${bytes.size} bytes at offset $offset; source.size=${source.size}"
        }
        System.arraycopy(source, offset, bytes, 0, bytes.size)
        offset = end
    }
}
