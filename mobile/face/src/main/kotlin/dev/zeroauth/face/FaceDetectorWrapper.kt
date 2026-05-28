package dev.zeroauth.face

import androidx.annotation.OptIn as AndroidXOptIn
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageProxy
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Wraps Google's ML Kit `FaceDetector` with a clean coroutine API.
 *
 * ## Why a wrapper
 *
 * ML Kit returns a `Task<List<Face>>` from `process(image)`. The rest
 * of `:face` lives in coroutine-land (CameraX ImageAnalysis emits
 * frames at up to camera frame rate; we throttle to ≤ 10 fps via the
 * coroutine dispatch budget). Bridging Tasks to suspend functions in
 * one place keeps the call sites clean.
 *
 * ## Configuration
 *
 * Per the C-143 design we configure ML Kit with the minimum surface we
 * need for the v1 capture flow:
 *
 *   * `PERFORMANCE_MODE_FAST` — ~30 % faster than ACCURATE on a Pixel
 *     7 in our internal benchmark, with no measurable hit to bounding
 *     box quality at the ≥ 480 px capture resolution we're working at.
 *   * `LANDMARK_MODE_NONE` — we don't need eye / nose / mouth points
 *     for the v1 stability gate. The full-liveness module (C-148) will
 *     re-enable this for blink detection.
 *   * `CLASSIFICATION_MODE_NONE` — we don't need smile probability or
 *     eye-open probability for v1.
 *   * `enableTracking()` — gives every detected face a stable
 *     `trackingId` across frames so the stability timer can tell
 *     "same face" from "new face that just appeared".
 *
 * ## Threading
 *
 * `process` runs the detection on ML Kit's own internal worker (the
 * `Task` resolves on a Google Play Services dispatcher). The
 * coroutine continuation resumes wherever the calling dispatcher is.
 * Callers should be on `Dispatchers.Default` or the CameraX analysis
 * executor — never the main thread.
 *
 * ## Lifecycle
 *
 * The wrapped `FaceDetector` is closeable; call [close] when the
 * Compose screen exits to release the underlying ML Kit resources.
 * Failing to close leaks the detector for the lifetime of the
 * process — ML Kit holds on to a TFLite interpreter under the hood.
 */
class FaceDetectorWrapper(
    options: FaceDetectorOptions = defaultOptions(),
) : AutoCloseable {

    private val detector: FaceDetector = FaceDetection.getClient(options)

    /**
     * Detect faces in [imageProxy] and return the list of [Face]s the
     * model produced. The caller MUST call `imageProxy.close()` once
     * this function returns (success or failure) so CameraX can release
     * the underlying YUV buffer back to the producer pool.
     *
     * The function is `suspend` rather than callback-based so the
     * ImageAnalysis loop can `await()` it without nesting callbacks.
     *
     * @throws IllegalArgumentException if the imageProxy has no image
     *   (a CameraX consistency violation — should not happen in
     *   practice).
     * @throws com.google.mlkit.common.MlKitException if ML Kit itself
     *   fails (TFLite delegate failure, OOM, etc.). Surfaced upward so
     *   the capture flow can transition to
     *   [CaptureState.Error.ErrorReason.CameraInitFailed].
     */
    @AndroidXOptIn(ExperimentalGetImage::class)
    suspend fun detect(imageProxy: ImageProxy): List<Face> {
        val mediaImage = imageProxy.image
            ?: throw IllegalArgumentException(
                "FaceDetectorWrapper.detect: ImageProxy.image was null"
            )
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)
        return detector.process(inputImage).awaitResult()
    }

    override fun close() {
        detector.close()
    }

    companion object {
        /**
         * The default [FaceDetectorOptions] used by the v1 capture
         * flow. Documented inline so any future change has to grep
         * the option name and find the rationale comment.
         */
        fun defaultOptions(): FaceDetectorOptions =
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
                .enableTracking()
                .build()
    }
}

/**
 * `kotlinx-coroutines-play-services` provides `await()` for
 * `Task<T>` but the import path differs across kotlinx-coroutines
 * versions. We re-export a tiny adapter here so any future
 * coroutines bump only changes one file. The implementation goes via
 * `suspendCancellableCoroutine` and adds the standard Task listeners.
 */
private suspend fun <T> Task<T>.awaitResult(): T =
    suspendCancellableCoroutine { cont ->
        addOnSuccessListener { result ->
            cont.resume(result)
        }
        addOnFailureListener { error ->
            cont.resumeWithException(error)
        }
        addOnCanceledListener {
            cont.cancel()
        }
    }
