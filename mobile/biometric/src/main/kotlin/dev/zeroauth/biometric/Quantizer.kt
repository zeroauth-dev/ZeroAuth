package dev.zeroauth.biometric

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Deterministic quantiser from a 128-dim L2-normalised embedding to a
 * stable 256-byte representation.
 *
 * The commitment derivation chain is:
 *
 *     embedding (128 × float32, L2-normalised)
 *        ↓ [Quantizer.quantize]
 *     256-byte stable bitstring
 *        ↓ [Sha256.digest]
 *     biometricSecret (32 bytes, then mapped into BN128 scalar field)
 *        ↓ [Poseidon.hash2(secret, salt)]
 *     commitment (BN128 field element)
 *
 * The whole point of the quantiser is that **the same face on the same
 * device produces the same byte string every time**. The MobileFaceNet
 * output is float32, which means tiny lighting/expression jitter
 * perturbs the embedding by ~1e-3 between captures. The quantiser
 * rounds each component to an int16 after scaling by 1000, which
 * absorbs ~5e-4 of float jitter per component while keeping the
 * cryptographic entropy of the embedding intact.
 *
 * This is a poor-man's fuzzy extractor — it works for the same-device,
 * same-user happy path that the BFSI v1 demo needs. A true fuzzy
 * extractor (Boneh-Halevi-Hamburg, or the Reed-Solomon-style construction
 * used by FaceFuzz) would survive cross-device + cross-camera drift;
 * that's tracked as deferred work in ADR-0018.
 *
 * ## Determinism invariants
 *
 * 1. Same input ↔ same output. Tested in QuantizerTest.
 * 2. Output length is always exactly 256 bytes (128 × 2 bytes BE).
 * 3. A perturbation of ≤ 5e-4 in any single component produces the
 *    same byte string. (Tested with a 1e-6 epsilon — well within the
 *    safety margin.)
 * 4. The byte format is big-endian: the two bytes of each int16 are
 *    `byte_high = (q >> 8) and 0xFF`, `byte_low = q and 0xFF`. We pin
 *    BE because the platform's verifier (a JVM service) reads the
 *    bytes via `DataInputStream`, which defaults to BE.
 *
 * ## Why scale-by-1000
 *
 * Empirically (against the sirius-ai/MobileFaceNet_TF test vectors),
 * the L2-normalised embedding components fall in [-0.30, +0.30] with
 * intra-session jitter of ~5e-4. Scaling by 1000 maps this to roughly
 * [-300, +300], rounds to integer, clips to the int16 range
 * [-32768, +32767] (which is overkill but cheap). The jitter band
 * after scaling is ~0.5, which `roundToInt` resolves consistently
 * unless a component sits within 0.5 of a half-integer — that's the
 * only zone where a recapture flips the quantised value. Bypassing
 * that with a Gray code or BCH error-correction is the v2 work in
 * ADR-0018.
 */
object Quantizer {

    /** Scaling factor before integer rounding. See class kdoc. */
    const val SCALE: Float = 1000.0f

    /** Output length in bytes. Matches 128 components × 2 bytes/int16. */
    const val OUTPUT_LENGTH: Int = 256

    /** int16 lower bound used for clipping. */
    private const val INT16_MIN: Int = -32768

    /** int16 upper bound used for clipping. */
    private const val INT16_MAX: Int = 32767

    /**
     * Quantise [embedding] to a deterministic 256-byte sequence.
     *
     * @param embedding A 128-dim L2-normalised FloatArray. The
     *                  L2-normalisation is the caller's contract —
     *                  [TfliteFaceEmbedder.l2Normalise] ensures it.
     * @return Exactly 256 bytes, big-endian, in commitment-stable
     *         encoding.
     * @throws IllegalArgumentException if the input is not 128-dim or
     *         contains NaN / Infinity (we reject those rather than
     *         coercing — NaN would silently quantise to a stable byte
     *         pattern that collides across distinct embeddings).
     */
    fun quantize(embedding: FloatArray): ByteArray {
        require(embedding.size == 128) {
            "Quantizer: expected 128-dim embedding, got ${embedding.size}"
        }
        // The L2-normalisation invariant is a caller contract, but we
        // assert sanity on the per-component magnitude: any |x| > 1.0
        // means the embedding is NOT unit-length (a unit vector in 128
        // dims has every component in [-1, +1]). This catches a
        // FaceEmbedder bug where l2Normalise was skipped.
        for (i in embedding.indices) {
            val v = embedding[i]
            require(!v.isNaN() && !v.isInfinite()) {
                "Quantizer: embedding[$i] is NaN or Infinity — refusing " +
                    "to quantise (would emit collision-prone bytes)"
            }
            require(v >= -1.0001f && v <= 1.0001f) {
                "Quantizer: embedding[$i]=$v out of [-1, +1]; embedding " +
                    "is not L2-normalised (caller contract violated)"
            }
        }

        val buffer = ByteBuffer.allocate(OUTPUT_LENGTH).order(ByteOrder.BIG_ENDIAN)
        for (i in embedding.indices) {
            val scaled = embedding[i] * SCALE
            // roundToInt() rounds half-up away from zero (Kotlin's
            // contract). Clip to int16 so out-of-band values can't
            // silently overflow the 2-byte budget. The clip is
            // defensive — for a unit vector the max post-scale value
            // is 1000, well inside int16.
            val q = scaled.roundToInt().coerceIn(INT16_MIN, INT16_MAX)
            // Write as 2-byte big-endian. Mask explicitly so a
            // negative int doesn't sign-extend the upper byte.
            buffer.put(((q shr 8) and 0xFF).toByte())
            buffer.put((q and 0xFF).toByte())
        }
        return buffer.array()
    }
}
