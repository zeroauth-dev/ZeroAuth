package dev.zeroauth.android.biometric

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Deterministic quantiser from a 128-dim L2-normalised embedding to a
 * stable 256-byte representation.
 *
 * Copied byte-for-byte from `mobile/biometric/Quantizer.kt`. The
 * `:biometric` Gradle module is not yet wired into the Android project
 * (see the TODO in [dev.zeroauth.android.ui.reg.RealBiometricSecretSource]),
 * so the canonical implementation is inlined here so the face-capture
 * composable in `ui/face/FaceCaptureScreen.kt` can use it directly.
 *
 * Drift between this file and `mobile/biometric/Quantizer.kt` is a
 * SHIP-BLOCKER — the commitment derived from these bytes backs the
 * BN128 field element the Groth16 circuit verifies, and a one-byte
 * drift fails `publicSignals[0]` on the server.
 *
 * See `mobile/biometric/Quantizer.kt` for the full kdoc on why
 * scale-by-1000 absorbs jitter and why the big-endian int16 encoding
 * is pinned.
 */
internal object Quantizer {

    /** Scaling factor before integer rounding. */
    const val SCALE: Float = 1000.0f

    /** Output length in bytes. Matches 128 components x 2 bytes/int16. */
    const val OUTPUT_LENGTH: Int = 256

    /** Embedding dimension. */
    const val EMBEDDING_DIM: Int = 128

    private const val INT16_MIN: Int = -32768
    private const val INT16_MAX: Int = 32767

    /**
     * Quantise [embedding] to a deterministic 256-byte sequence.
     *
     * @throws IllegalArgumentException on wrong-size / NaN / Inf /
     *         non-normalised inputs.
     */
    fun quantize(embedding: FloatArray): ByteArray {
        require(embedding.size == EMBEDDING_DIM) {
            "Quantizer: expected $EMBEDDING_DIM-dim embedding, got ${embedding.size}"
        }
        for (i in embedding.indices) {
            val v = embedding[i]
            require(!v.isNaN() && !v.isInfinite()) {
                "Quantizer: embedding[$i] is NaN or Infinity"
            }
            require(v >= -1.0001f && v <= 1.0001f) {
                "Quantizer: embedding[$i]=$v out of [-1, +1]"
            }
        }

        val buffer = ByteBuffer.allocate(OUTPUT_LENGTH).order(ByteOrder.BIG_ENDIAN)
        for (i in embedding.indices) {
            val scaled = embedding[i] * SCALE
            val q = scaled.roundToInt().coerceIn(INT16_MIN, INT16_MAX)
            buffer.put(((q shr 8) and 0xFF).toByte())
            buffer.put((q and 0xFF).toByte())
        }
        return buffer.array()
    }
}
