package dev.zeroauth.android.biometric

import android.graphics.Bitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.Closeable
import kotlin.math.sqrt

/**
 * Face -> 128-dim L2-normalised embedding.
 *
 * Mirrors `mobile/biometric/FaceEmbedder.kt`'s contract: in, a 112x112
 * ARGB_8888 face crop; out, a 128-element FloatArray with
 * `sqrt(sum(e_i^2)) == 1.0` modulo floating-point epsilon.
 *
 * Two implementations:
 *
 *   * [DeterministicPixelHashEmbedder] — the default for this POC.
 *     Hashes the 112x112 ARGB pixel grid into 128 floats. Same pixel
 *     bytes ALWAYS produce the same embedding. NOT face-recognition
 *     accurate — two different faces under identical lighting could
 *     theoretically collide; two captures of the same face under
 *     different lighting produce different embeddings (because the
 *     pixel bytes differ). This is deliberately positioned as a
 *     pipeline-exercising placeholder, NOT a production embedder.
 *
 *     Why this and not the real MobileFaceNet? The TFLite model is
 *     ~5 MB and not committed to the repo (see
 *     mobile/biometric/src/main/assets/MODEL.md). Pulling the model in
 *     during build is a separate three-file patch; the goal here is
 *     to land the face-capture composable so the registration + login
 *     flows have a Composable to call. Wiring in the real model is the
 *     follow-up that this composable unblocks.
 *
 *   * (Future) TfliteFaceEmbedder — wired in once the `:biometric`
 *     Gradle module is included. The interface is shaped exactly like
 *     `mobile/biometric/FaceEmbedder.kt` so the swap is a single
 *     constructor parameter at the call site.
 *
 * ## TODO (follow-up):
 *
 * 1. Add `tensorflow-lite` + `tensorflow-lite-support` deps to
 *    `android/gradle/libs.versions.toml`.
 * 2. Ship the `mobilefacenet.tflite` model under
 *    `android/app/src/main/assets/mobilefacenet.tflite` via the
 *    same build-time copy mechanism that `mobile/biometric/` uses.
 * 3. Replace [DeterministicPixelHashEmbedder] with `TfliteFaceEmbedder`
 *    in [Composition.productionFaceEmbedder] (or wire the `:biometric`
 *    module into `android/settings.gradle.kts` and use the canonical
 *    implementation directly).
 *
 * Until that lands, this embedder gives a deterministic 128-dim vector
 * for any 112x112 bitmap, which is sufficient to:
 *
 *   * exercise the FaceCapture -> Quantizer -> Sha256 -> secret pipeline
 *   * verify the registration ceremony produces a stable secret across
 *     step 2 (submit-commitment) and step 3 (verify) when the same
 *     112x112 face crop is captured both times
 *   * compile + run the Composable on a real device or emulator
 */
internal interface FaceEmbedder : Closeable {

    /**
     * Compute a 128-dim L2-normalised face embedding from [bitmap].
     *
     * @param bitmap The face crop. MUST be 112x112 RGB ARGB_8888.
     * @return A 128-element FloatArray. `sqrt(sum(e_i^2)) == 1.0`
     *         modulo floating-point epsilon.
     * @throws IllegalArgumentException if the bitmap is the wrong size
     *         or format.
     */
    suspend fun embed(bitmap: Bitmap): FloatArray

    override fun close() {
        // No-op by default. Subclasses with native resources (TFLite
        // interpreter) override.
    }

    companion object {
        /** MobileFaceNet input edge length — pinned by ADR-0018. */
        const val INPUT_SIZE: Int = 112

        /** MobileFaceNet output embedding dimension. */
        const val EMBEDDING_DIM: Int = 128
    }
}

/**
 * Deterministic pixel-hash embedder.
 *
 * Walks the 112x112 ARGB grid and folds it into 128 floats via a fixed
 * accumulation pattern. Same input pixels -> same output, every time.
 *
 * The reduction is intentionally simple:
 *
 *   1. Group the 12544 pixels into 128 buckets (98 pixels per bucket).
 *   2. For each bucket sum the (R + 2*G + B) luminance proxy.
 *   3. Map each bucket sum into a float in `[-1, +1]` via a periodic
 *      sinusoid so the L2 norm is bounded and the components are
 *      well-distributed (avoids the all-positive case where the
 *      L2-normalised vector has every component close to 1/sqrt(128)).
 *   4. L2-normalise the 128 floats.
 *
 * The composition is deliberate: a 112x112 bitmap with all zero pixels
 * produces an all-zero pre-normalisation vector, which would trip the
 * "embedding is the zero vector" guard. We seed the accumulator with a
 * small non-zero bias derived from the pixel count so the all-black
 * case still produces a valid (but distinct) embedding.
 */
internal class DeterministicPixelHashEmbedder : FaceEmbedder {

    private val mutex = Mutex()

    override suspend fun embed(bitmap: Bitmap): FloatArray = withContext(Dispatchers.Default) {
        require(bitmap.width == FaceEmbedder.INPUT_SIZE && bitmap.height == FaceEmbedder.INPUT_SIZE) {
            "FaceEmbedder: bitmap must be ${FaceEmbedder.INPUT_SIZE}x${FaceEmbedder.INPUT_SIZE}, " +
                "got ${bitmap.width}x${bitmap.height}"
        }
        require(bitmap.config == Bitmap.Config.ARGB_8888) {
            "FaceEmbedder: bitmap config must be ARGB_8888, got ${bitmap.config}"
        }

        mutex.withLock {
            val edge = FaceEmbedder.INPUT_SIZE
            val totalPixels = edge * edge
            val pixels = IntArray(totalPixels)
            bitmap.getPixels(pixels, 0, edge, 0, 0, edge, edge)

            // 128 buckets, ~98 pixels each.
            val bucketSums = DoubleArray(FaceEmbedder.EMBEDDING_DIM)
            for (i in 0 until totalPixels) {
                val pixel = pixels[i]
                // Standard luminance-ish proxy. Bytes are unsigned;
                // mask explicitly.
                val r = (pixel shr 16) and 0xFF
                val g = (pixel shr 8) and 0xFF
                val b = pixel and 0xFF
                val luminance = (r + 2 * g + b).toDouble()  // [0, 1020]
                val bucket = i % FaceEmbedder.EMBEDDING_DIM
                bucketSums[bucket] += luminance
            }

            // Map each bucket sum to a bounded float via sin(). Without
            // the sin() pass an all-bright bitmap yields all-positive
            // floats and the L2-normalised vector collapses to a
            // near-uniform direction.
            val raw = FloatArray(FaceEmbedder.EMBEDDING_DIM)
            for (i in 0 until FaceEmbedder.EMBEDDING_DIM) {
                // Bias the input so all-zero pixels still produce a
                // non-zero (but stable) signal — defeats the
                // "embedding is the zero vector" guard.
                val biased = bucketSums[i] + (i + 1) * 0.5
                raw[i] = kotlin.math.sin(biased * 0.001).toFloat()
            }

            l2Normalise(raw)
        }
    }

    companion object {
        /**
         * Renormalise to unit length. Refuses the zero vector (the
         * sin-bias pre-step ensures we never actually hit that case,
         * but the guard is kept for defense).
         */
        internal fun l2Normalise(v: FloatArray): FloatArray {
            var sumSq = 0.0
            for (e in v) sumSq += (e * e).toDouble()
            require(sumSq > 1e-10) {
                "FaceEmbedder: pre-normalisation vector is too close to zero"
            }
            val norm = sqrt(sumSq).toFloat()
            return FloatArray(v.size) { i -> v[i] / norm }
        }
    }
}

/**
 * Default factory — returns the [DeterministicPixelHashEmbedder] for
 * this POC. Once the real TFLite model is wired in, this is the single
 * spot that flips to return the production embedder.
 */
internal object FaceEmbedderFactory {
    fun default(): FaceEmbedder {
        Timber.tag("FaceEmbedder").i(
            "Using DeterministicPixelHashEmbedder (POC placeholder). " +
                "Real MobileFaceNet inference is a follow-up task — see " +
                "FaceEmbedder.kt kdoc.",
        )
        return DeterministicPixelHashEmbedder()
    }
}
