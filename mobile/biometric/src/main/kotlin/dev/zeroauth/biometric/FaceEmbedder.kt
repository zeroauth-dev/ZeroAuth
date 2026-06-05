package dev.zeroauth.biometric

import android.content.Context
import android.graphics.Bitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.common.FileUtil
import org.tensorflow.lite.support.image.TensorImage
import org.tensorflow.lite.support.image.ops.ResizeOp
import org.tensorflow.lite.support.image.ImageProcessor
// NormalizeOp lives under `common.ops`, not `image.ops`. The TFLite-support
// AAR (0.4.4) groups image-pipeline ops (Resize, Crop) under image.ops and
// tensor-level numeric ops (Normalize, Cast, Quantize, Dequantize) under
// common.ops. The previous import path resolved at IDE-time against an
// older tflite-support build that since moved NormalizeOp.
import org.tensorflow.lite.support.common.ops.NormalizeOp
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * Face → embedding interface.
 *
 * The input MUST be a Bitmap cropped to the face region and resized to
 * the model's input dimensions (112x112 for MobileFaceNet). The CameraX
 * face-capture surface (lands in a later commit) is responsible for
 * detecting the face, asserting liveness, and producing the cropped
 * Bitmap. This module does NOT do face detection — it is strictly an
 * embedding service.
 *
 * Why the interface is suspend-shaped: TFLite inference takes ~50 ms
 * on a Pixel 6 CPU and ~15 ms on the NNAPI delegate. Either way we
 * never block the main thread. `embed()` runs on `Dispatchers.Default`
 * by default (see [TfliteFaceEmbedder]).
 *
 * **Caller-owned input**: the Bitmap pixel buffer is read once and not
 * stored. The embedder does NOT recycle the Bitmap (that's the
 * caller's contract — the FaceCapture surface owns the Bitmap
 * lifecycle and recycles after a successful embed).
 *
 * The 128 floats returned are L2-normalised (unit length, sum-of-
 * squares = 1.0). Quantizer.kt depends on the L2 invariant for
 * the bit-stability guarantee — see ADR-0018 for why.
 */
interface FaceEmbedder {

    /**
     * Compute a 128-dim L2-normalised face embedding from [bitmap].
     *
     * @param bitmap The face crop. MUST be 112x112 RGB ARGB_8888.
     *               The alpha channel is ignored.
     * @return A 128-element FloatArray. `sqrt(sum(e_i^2)) == 1.0` modulo
     *         floating-point epsilon.
     * @throws IllegalArgumentException if the bitmap is the wrong size
     *         or format. (We refuse to scale here — the caller's crop
     *         contract is the architectural contract; silent resizing
     *         hides bugs.)
     */
    suspend fun embed(bitmap: Bitmap): FloatArray
}

/**
 * Production TFLite-backed [FaceEmbedder].
 *
 * Loads the interpreter lazily on the first `embed()` call and reuses
 * it for the lifetime of the process. Holding a singleton avoids the
 * ~200 ms per-call TFLite cold start; releasing native memory only
 * happens at process death (or via [close] if the host decides to
 * tear the embedder down).
 *
 * Thread-safety: the underlying TFLite interpreter is NOT thread-safe.
 * We guard it with a [Mutex] so concurrent enrollment + verification
 * paths serialise through the same interpreter rather than each
 * loading its own copy. The lock is held only for the ~50 ms of
 * inference; suspend semantics keep callers responsive.
 *
 * @param context Application context; used for asset lookup only.
 * @param modelAssetPath The path inside src/main/assets/ to the TFLite
 *                      model file. Defaults to "mobilefacenet.tflite"
 *                      (see assets/MODEL.md for how it gets there).
 */
class TfliteFaceEmbedder(
    private val context: Context,
    private val modelAssetPath: String = DEFAULT_MODEL_PATH,
) : FaceEmbedder, Closeable {

    private val mutex = Mutex()

    @Volatile
    private var interpreter: Interpreter? = null

    /** Lazy init guarded by the mutex; safe to call repeatedly. */
    private suspend fun ensureInterpreter(): Interpreter = mutex.withLock {
        val existing = interpreter
        if (existing != null) return@withLock existing
        val model = FileUtil.loadMappedFile(context, modelAssetPath)
        val options = Interpreter.Options().apply {
            // CPU-only for now. NNAPI / GPU delegates are added in a
            // later optimisation pass per the ADR-0018 deferred work.
            numThreads = 4
        }
        val fresh = Interpreter(model, options)
        interpreter = fresh
        fresh
    }

    override suspend fun embed(bitmap: Bitmap): FloatArray = withContext(Dispatchers.Default) {
        require(bitmap.width == INPUT_SIZE && bitmap.height == INPUT_SIZE) {
            "FaceEmbedder: bitmap must be ${INPUT_SIZE}x${INPUT_SIZE}, " +
                "got ${bitmap.width}x${bitmap.height}. Resize upstream " +
                "in the FaceCapture surface, not here — silent resizing " +
                "would mask crop bugs."
        }
        require(bitmap.config == Bitmap.Config.ARGB_8888) {
            "FaceEmbedder: bitmap config must be ARGB_8888, got ${bitmap.config}"
        }

        val tensorImage = TensorImage.fromBitmap(bitmap)
        // Normalise [0, 255] -> [-1.0, 1.0] per MobileFaceNet's pinned
        // input range (see assets/MODEL.md). The +/- 127.5 scaling is
        // the model's pinned convention; if the model is ever swapped
        // (e.g. ArcFace, FaceNet), the normalisation factors change.
        val processor = ImageProcessor.Builder()
            .add(ResizeOp(INPUT_SIZE, INPUT_SIZE, ResizeOp.ResizeMethod.BILINEAR))
            .add(NormalizeOp(127.5f, 127.5f))
            .build()
        val processed = processor.process(tensorImage)

        val output = Array(1) { FloatArray(EMBEDDING_DIM) }
        val outputBuffer = ByteBuffer.allocateDirect(EMBEDDING_DIM * 4).apply {
            order(ByteOrder.nativeOrder())
        }

        val interp = ensureInterpreter()
        mutex.withLock {
            interp.run(processed.buffer, outputBuffer)
        }

        // Drain the direct buffer into the FloatArray. We use a direct
        // ByteBuffer for the TFLite output to avoid the JNI auto-copy,
        // then unpack into managed memory so the rest of the pipeline
        // can be tested with plain Kotlin.
        outputBuffer.rewind()
        for (i in 0 until EMBEDDING_DIM) {
            output[0][i] = outputBuffer.float
        }

        l2Normalise(output[0])
    }

    override fun close() {
        interpreter?.close()
        interpreter = null
    }

    companion object {
        /** MobileFaceNet input edge length. Pinned by assets/MODEL.md. */
        const val INPUT_SIZE: Int = 112

        /**
         * MobileFaceNet output embedding dimension.
         *
         * Originally 128 per the upstream sirius-ai .pb conversion.
         * The .tflite shipped at src/main/assets/mobilefacenet.tflite
         * is the MCarlomagno mirror — a 192-dim variant of the same
         * MobileFaceNet architecture with the same input contract
         * ([1,112,112,3] float32 normalised to [-1,1]). The tensor
         * shape error `768 bytes / 4-bytes-per-float = 192 floats`
         * surfaced this mismatch on first real-device run.
         *
         * Bumping to 192 matches the model. The Quantizer downstream
         * scales linearly with this constant (192 × 2 = 384 bytes
         * BE int16); SHA-256 normalises that to 32 bytes regardless.
         * If a future model bumps embedding size, only this constant
         * needs to change — the rest of the pipeline is dimension-
         * agnostic by construction.
         */
        const val EMBEDDING_DIM: Int = 192

        /** Default asset path. Overridable for A/B testing alternate models. */
        const val DEFAULT_MODEL_PATH: String = "mobilefacenet.tflite"

        /**
         * Renormalise an embedding to unit length. Hoisted as internal
         * so [TfliteFaceEmbedder] and any test fixture can share the
         * same normalisation routine — the commitment derivation chain
         * downstream depends on the L2 invariant.
         */
        @JvmStatic
        internal fun l2Normalise(v: FloatArray): FloatArray {
            var sumSq = 0.0
            for (e in v) sumSq += (e * e).toDouble()
            // Floating-point guard: an all-zero embedding is the
            // pathological case (model returned an empty tensor or the
            // caller fed a black bitmap). We refuse to normalise it,
            // because dividing by ~0 produces NaN/Inf and the quantiser
            // would then emit a stable-looking byte string for any
            // black image — a fingerprint collision waiting to happen.
            require(sumSq > 1e-10) {
                "FaceEmbedder: embedding is the zero vector — model " +
                    "returned an empty tensor or upstream face crop was " +
                    "all-black. Re-capture before proceeding."
            }
            val norm = sqrt(sumSq).toFloat()
            return FloatArray(v.size) { i -> v[i] / norm }
        }
    }
}
