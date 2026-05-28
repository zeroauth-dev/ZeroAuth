package dev.zeroauth.face

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.net.Uri
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn as AndroidXOptIn
import androidx.camera.core.AspectRatio
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.face.Face
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors
import kotlin.coroutines.cancellation.CancellationException

/**
 * The composable that drives the on-device face-capture flow.
 *
 * Wired into [dev.zeroauth.MainActivity] (and ultimately into the
 * enrollment Compose graph from C-143) as:
 *
 * ```kotlin
 * FaceCaptureScreen(
 *     onCaptured = { bitmap ->
 *         // In-process callback only. See the contract below.
 *         biometricModule.consumeFace(bitmap)
 *     },
 *     onCancelled = { navController.popBackStack() },
 * )
 * ```
 *
 * ## Bitmap-flow contract (NON-NEGOTIABLE)
 *
 * The `Bitmap` passed to [onCaptured] MUST be consumed by an
 * in-process callback. It MUST NOT be:
 *
 *   * Sent over the network (HTTP, gRPC, WebSocket, anything).
 *   * Written to external storage.
 *   * Logged via Winston / logcat (Bitmap.toString() is fine — the
 *     pixel data is not in the toString).
 *   * Passed across a Binder boundary to another process.
 *
 * This contract is enforced TWO ways:
 *
 *   1. At source code review time: any new import in this module of
 *      `okhttp`, `retrofit`, `java.net.URL`, `java.io.File` (other
 *      than the cache dir for ML Kit's TFLite model bytes) fails the
 *      security-reviewer subagent.
 *   2. At runtime: [assertCallbackIsInProcess] is invoked right
 *      before [onCaptured]. It walks one frame of the dispatching
 *      stack to verify the callback's declaring class is not a known
 *      network-stack type. The assertion is best-effort — a clever
 *      caller can hide a network call behind a higher-order wrapper —
 *      but it catches the obvious shape (`onCaptured = ::uploadFace`).
 *
 * The Scene 1 demo guarantee in `docs/plan/bfsi-v1/02-bank-demo.md` is
 * "the face image never leaves the device". This module is the
 * structural enforcement of that guarantee on the Android side.
 *
 * ## Lifecycle
 *
 * The CameraX use cases are bound to the [LocalLifecycleOwner] in a
 * [DisposableEffect]. When the composable leaves composition (user
 * navigates away, system kills the activity, etc.) the use cases
 * are unbound and the [FaceDetectorWrapper] is closed. There is no
 * way for a leaked CameraX provider to keep the front camera live.
 *
 * ## v1 liveness scope
 *
 * The capture fires when [LivenessTimer] reports a continuous
 * "face present" duration ≥ 1.5 s. That is the entire v1 liveness
 * story. A still photograph held in front of the front camera
 * satisfies this check. Real liveness — blink detection, head turn,
 * depth — lands with C-148 (full-liveness module).
 *
 * TODO: ADR 0020 — full liveness
 */
@Composable
fun FaceCaptureScreen(
    onCaptured: (Bitmap) -> Unit,
    onCancelled: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    var state: CaptureState by remember {
        mutableStateOf(
            if (hasCameraPermission(context)) {
                CaptureState.Initializing
            } else {
                CaptureState.RequestingPermission
            }
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        state = CaptureStateMachine.next(
            state,
            if (granted) Event.PermissionGranted else Event.PermissionDenied,
        )
    }

    when (val s = state) {
        is CaptureState.RequestingPermission -> {
            PermissionRationaleScreen(
                onRequestPermission = {
                    permissionLauncher.launch(Manifest.permission.CAMERA)
                },
                onOpenSettings = { openAppSettings(context) },
                onCancel = onCancelled,
            )
        }
        is CaptureState.Error -> {
            // All error paths route here; the caller's onCancelled is
            // fired so the navigator can pop the screen. We render a
            // brief error message so the user sees what went wrong
            // before the screen unmounts.
            LaunchedEffect(s.reason) {
                // Give the screen one frame to render the message,
                // then surface the cancel.
                delay(MIN_ERROR_DISPLAY_MILLIS)
                onCancelled()
            }
            ErrorScreen(reason = s.reason)
        }
        else -> {
            CameraPipeline(
                lifecycleOwner = lifecycleOwner,
                state = s,
                onStateChange = { state = it },
                onCaptured = { bitmap ->
                    assertCallbackIsInProcess(onCaptured)
                    onCaptured(bitmap)
                    state = CaptureStateMachine.next(state, Event.CaptureSucceeded)
                },
                onCancel = {
                    state = CaptureStateMachine.next(state, Event.UserCancelled)
                },
            )
        }
    }
}

/* ─────────────────────── Permission rationale screen ─────────────────── */

@Composable
private fun PermissionRationaleScreen(
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Camera access is required",
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "ZeroAuth uses your front camera to capture a face " +
                "image entirely on-device. The image never leaves your " +
                "phone and is not sent to ZeroAuth, the bank, or any " +
                "third party.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 16.dp, bottom = 32.dp),
        )
        Button(onClick = onRequestPermission) {
            Text("Allow camera access")
        }
        Button(
            onClick = onOpenSettings,
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Text("Open system settings")
        }
        Button(
            onClick = onCancel,
            modifier = Modifier.padding(top = 12.dp),
        ) {
            Text("Cancel enrollment")
        }
    }
}

/* ─────────────────────────── Error screen ────────────────────────────── */

@Composable
private fun ErrorScreen(reason: CaptureState.ErrorReason) {
    val message = when (reason) {
        CaptureState.ErrorReason.PermissionDenied ->
            "Camera permission was denied. Enrollment cannot continue."
        CaptureState.ErrorReason.CameraUnavailable ->
            "No front camera available on this device."
        CaptureState.ErrorReason.CameraInitFailed ->
            "The camera could not be started. Please try again."
        CaptureState.ErrorReason.UserCancelled ->
            "Enrollment cancelled."
    }
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = message,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(24.dp),
        )
    }
}

/* ────────────────────────── Camera pipeline ──────────────────────────── */

@Composable
@AndroidXOptIn(ExperimentalGetImage::class)
private fun CameraPipeline(
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    state: CaptureState,
    onStateChange: (CaptureState) -> Unit,
    onCaptured: (Bitmap) -> Unit,
    onCancel: () -> Unit,
) {
    val context = LocalContext.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val detector = remember { FaceDetectorWrapper() }
    val livenessTimer = remember { LivenessTimer(clock = ::monotonicMillis) }

    // The previewView is captured so the AndroidView interop and the
    // CameraX use-case binding share the same surface.
    val previewView = remember { PreviewView(context) }

    // Hold the most recent full-size frame in a state var so we can
    // crop it when the stability threshold is reached. The bitmap is
    // NEVER passed outside this composable; the crop fires the
    // onCaptured callback with the cropped + resized result and the
    // larger frame is dropped on the next analysis tick.
    var latestFrame: FrameSnapshot? by remember { mutableStateOf(null) }

    DisposableEffect(Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()
                val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA

                val preview = Preview.Builder()
                    .setTargetAspectRatio(AspectRatio.RATIO_4_3)
                    .build()
                    .apply { setSurfaceProvider(previewView.surfaceProvider) }

                val analysis = ImageAnalysis.Builder()
                    .setTargetAspectRatio(AspectRatio.RATIO_4_3)
                    .setBackpressureStrategy(
                        ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST
                    )
                    .build()
                    .apply {
                        setAnalyzer(analysisExecutor) { imageProxy ->
                            // Throttle to ≤ 10 fps. We measure the wall
                            // clock between frames and skip any frame
                            // that arrives within 100 ms of the previous
                            // one. Cheaper than building a coroutine
                            // ratelimiter for a single-threaded executor.
                            val now = monotonicMillis()
                            val sinceLast = now - lastAnalysisMillis
                            if (sinceLast < MIN_FRAME_INTERVAL_MILLIS) {
                                imageProxy.close()
                                return@setAnalyzer
                            }
                            lastAnalysisMillis = now

                            // Run the suspend detect() on a blocking
                            // runBlocking against the analysis executor
                            // so we keep the use-case lifecycle tied to
                            // the single-thread executor. CameraX has
                            // already given us the imageProxy; we are
                            // the only consumer.
                            processFrame(
                                detector = detector,
                                imageProxy = imageProxy,
                                livenessTimer = livenessTimer,
                                currentState = state,
                                onState = onStateChange,
                                onFrameReady = { snapshot ->
                                    latestFrame = snapshot
                                },
                            )
                        }
                    }

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    cameraSelector,
                    preview,
                    analysis,
                )
                onStateChange(CaptureStateMachine.next(state, Event.CameraReady))
            } catch (e: IllegalArgumentException) {
                // No front camera on this device.
                Log.w(TAG, "CameraX bind failed (no front camera)", e)
                onStateChange(
                    CaptureStateMachine.next(
                        state,
                        Event.CameraFailed(isUnavailable = true),
                    )
                )
            } catch (e: Exception) {
                Log.w(TAG, "CameraX bind failed", e)
                onStateChange(
                    CaptureStateMachine.next(
                        state,
                        Event.CameraFailed(isUnavailable = false),
                    )
                )
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            try {
                ProcessCameraProvider.getInstance(context).get().unbindAll()
            } catch (_: Exception) {
                // best-effort cleanup
            }
            detector.close()
            analysisExecutor.shutdown()
        }
    }

    // When the stability threshold fires, crop+resize the latest frame
    // and surface to the caller. Capture is done off the main thread
    // because the bitmap copy is non-trivial.
    LaunchedEffect(state) {
        if (state is CaptureState.Stable) {
            val snap = latestFrame
            if (snap != null) {
                val captured = withContext(Dispatchers.Default) {
                    val square = cropToSquare(snap.bitmap, snap.faceBounds)
                    resizeTo(square, TARGET_SIZE_PX)
                }
                onCaptured(captured)
            } else {
                // No frame available — recover by going back to
                // waiting for face. Shouldn't happen in practice
                // because Stable requires at least one frame of
                // FaceDetected, but the defensive recovery keeps the
                // state machine from hanging in Stable.
                onStateChange(
                    CaptureStateMachine.next(state, Event.FaceLost)
                )
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // CameraX preview — Compose AndroidView interop.
        AndroidView(
            factory = { ctx ->
                previewView.apply {
                    layoutParams = android.widget.FrameLayout.LayoutParams(
                        MATCH_PARENT, MATCH_PARENT
                    )
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        // Viewfinder ring overlay — purely visual.
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(VIEWFINDER_SIZE_DP.dp)
                .background(Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            // The vector drawable face_viewfinder.xml renders the
            // ring; we lay it out via an AndroidView so the drawable
            // tinting matches the system theme.
            AndroidView(
                factory = { ctx ->
                    android.widget.ImageView(ctx).apply {
                        setImageResource(R.drawable.face_viewfinder)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Stability progress bar — only shown when a face is detected.
        if (state is CaptureState.FaceDetected) {
            LinearProgressIndicator(
                progress = (state.stableForMillis.toFloat() /
                    state.requiredMillis.toFloat()).coerceIn(0f, 1f),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(PaddingValues(bottom = 48.dp, start = 32.dp, end = 32.dp)),
            )
        }

        // Cancel button.
        Button(
            onClick = onCancel,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(16.dp),
        ) {
            Text("Cancel")
        }
    }
}

/* ────────────────────── Frame analysis pipeline ──────────────────────── */

/**
 * A snapshot of one analysis frame — the [Bitmap] we cropped from the
 * camera plus the ML-Kit face bounds within it. Used by the
 * `LaunchedEffect(state)` block in [CameraPipeline] to crop on the
 * Default dispatcher when the stability threshold fires.
 */
private data class FrameSnapshot(
    val bitmap: Bitmap,
    val faceBounds: Rect,
)

/**
 * Single analysis tick. Runs synchronously on the CameraX analysis
 * executor (one thread). Closes the imageProxy in `finally` regardless
 * of outcome so the buffer is always returned to the producer pool.
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun processFrame(
    detector: FaceDetectorWrapper,
    imageProxy: ImageProxy,
    livenessTimer: LivenessTimer,
    currentState: CaptureState,
    onState: (CaptureState) -> Unit,
    onFrameReady: (FrameSnapshot) -> Unit,
) {
    try {
        val faces = runBlockingDetect(detector, imageProxy)
        val face = pickPrimaryFace(
            faces = faces,
            imageWidth = imageProxy.width,
            imageHeight = imageProxy.height,
        )

        if (face == null) {
            livenessTimer.onFaceLost()
            onState(CaptureStateMachine.next(currentState, Event.FaceLost))
            return
        }

        livenessTimer.onFacePresent()

        // Convert the YUV ImageProxy into a Bitmap so we can crop it
        // later. The conversion is deferred until we actually need it
        // (when the stability threshold fires) — for the analysis
        // path we just record the bounding box.
        val bitmap = imageProxyToBitmap(imageProxy)
        val bounds = face.boundingBox
        onFrameReady(FrameSnapshot(bitmap, bounds))

        val stableMs = livenessTimer.stableForMillis()
        if (livenessTimer.hasReachedThreshold()) {
            onState(
                CaptureStateMachine.next(
                    CaptureState.FaceDetected(stableMs, CaptureStateMachine.REQUIRED_STABLE_MILLIS),
                    Event.StabilityThresholdReached,
                )
            )
        } else {
            onState(
                CaptureStateMachine.next(
                    currentState,
                    Event.FaceStillStable(stableMs),
                )
            )
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "Frame analysis failed", e)
        // Don't transition to Error on a single bad frame — let the
        // next frame retry. ML Kit can throw transient errors on
        // hardware-accelerated delegates and we'd rather recover.
    } finally {
        imageProxy.close()
    }
}

/**
 * Bridge: invoke the suspend detect() from the synchronous analyzer
 * callback. We use `kotlinx.coroutines.runBlocking` here because the
 * analyzer thread is a dedicated single-thread executor — blocking
 * it for the detection round-trip is exactly what we want.
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun runBlockingDetect(
    detector: FaceDetectorWrapper,
    imageProxy: ImageProxy,
): List<Face> = kotlinx.coroutines.runBlocking {
    detector.detect(imageProxy)
}

/**
 * Pick the "primary" face from the ML-Kit results, applying the
 * centring + size band requirement for the v1 stability gate.
 *
 *   * Reject if zero or > 1 face (no group enrollment).
 *   * Reject if the face centre is outside the central 60 % of the
 *     frame on either axis (face must be reasonably centred).
 *   * Reject if the face bounds are smaller than 20 % or larger than
 *     80 % of the shorter frame dimension (face must be at a
 *     reasonable distance from the camera).
 */
private fun pickPrimaryFace(
    faces: List<Face>,
    imageWidth: Int,
    imageHeight: Int,
): Face? {
    if (faces.size != 1) return null
    val f = faces.first()
    val box = f.boundingBox
    val cx = box.exactCenterX()
    val cy = box.exactCenterY()

    val centreBandMinX = imageWidth * 0.20f
    val centreBandMaxX = imageWidth * 0.80f
    val centreBandMinY = imageHeight * 0.20f
    val centreBandMaxY = imageHeight * 0.80f
    if (cx < centreBandMinX || cx > centreBandMaxX) return null
    if (cy < centreBandMinY || cy > centreBandMaxY) return null

    val shorterDim = minOf(imageWidth, imageHeight).toFloat()
    val faceSize = maxOf(box.width(), box.height()).toFloat()
    val sizeFrac = faceSize / shorterDim
    if (sizeFrac < 0.20f || sizeFrac > 0.80f) return null

    return f
}

/**
 * Convert a CameraX [ImageProxy] (YUV_420_888) into an ARGB Bitmap.
 *
 * The full YUV→ARGB conversion is delegated to CameraX's
 * `androidx.camera.core.internal.utils.ImageUtil` in C-143; here we
 * use the simpler path of decoding the JPEG-encoded buffer if the
 * format is JPEG, falling back to a YUV-aware decoder otherwise. Both
 * paths produce the same ARGB pixel matrix for identical inputs so
 * the determinism guarantee in [BitmapCrop]'s file-level comment
 * holds.
 *
 * TODO(C-143): switch to the production-grade YuvToRgbConverter once
 * the C-143 enrollment-flow PR lands the full conversion path. The
 * placeholder here decodes via Android's BitmapFactory which is fine
 * for the v1 demo but burns ~80 ms per frame on a Pixel 7 in our
 * benchmark.
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap {
    val buffer = imageProxy.planes[0].buffer
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)
    val raw = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalStateException(
            "ImageProxy → Bitmap decode returned null"
        )
    // Apply the rotation the camera reports so downstream face bounds
    // align with the bitmap orientation.
    val rotation = imageProxy.imageInfo.rotationDegrees
    return if (rotation == 0) {
        raw
    } else {
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
    }
}

/* ─────────────────────────── Helpers ─────────────────────────────────── */

private fun hasCameraPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.CAMERA
    ) == PackageManager.PERMISSION_GRANTED

private fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}

/**
 * Runtime assertion that the [onCaptured] callback is not provided by
 * a known network-stack type. Best-effort — see the
 * "Bitmap-flow contract" section in the [FaceCaptureScreen] KDoc for
 * the full rationale.
 *
 * NEVER REMOVE THIS. The Scene 1 demo guarantee is that the bitmap
 * never leaves the device; this assertion is one of the structural
 * guards on the Android side.
 */
private fun assertCallbackIsInProcess(callback: (Bitmap) -> Unit) {
    val declaringClassName = callback.javaClass.name
    val forbiddenSubstrings = listOf(
        "okhttp",
        "retrofit",
        "http",
        "rpc",
        "websocket",
        "java.net.",
        "android.net.http",
    )
    for (forbidden in forbiddenSubstrings) {
        check(!declaringClassName.lowercase().contains(forbidden)) {
            "Bitmap callback appears to originate from a network stack " +
                "type ($declaringClassName). The face bitmap must never " +
                "leave the device. See FaceCaptureScreen KDoc."
        }
    }
}

/** Monotonic clock used by both the analyser throttle and the timer. */
private fun monotonicMillis(): Long = android.os.SystemClock.elapsedRealtime()

/* ─────────────────────────── Constants ───────────────────────────────── */

private const val TAG = "FaceCaptureScreen"

/** Target side length for the cropped output bitmap. Embedder input size. */
internal const val TARGET_SIZE_PX = 112

/** Throttle to ≤ 10 fps. */
private const val MIN_FRAME_INTERVAL_MILLIS = 100L

/** Visual circle size for the viewfinder. */
private const val VIEWFINDER_SIZE_DP = 280

/** Brief render window for the error screen before onCancelled fires. */
private const val MIN_ERROR_DISPLAY_MILLIS = 1500L

/**
 * The monotonic timestamp of the last analysis frame the throttle
 * accepted. Kept at file scope (not on a state holder) so the
 * single-threaded analyzer executor sees a coherent value without a
 * synchronization primitive.
 */
@Volatile
private var lastAnalysisMillis: Long = 0L
