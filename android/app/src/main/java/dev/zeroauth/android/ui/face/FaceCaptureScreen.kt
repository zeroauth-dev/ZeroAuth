package dev.zeroauth.android.ui.face

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.net.Uri
import android.provider.Settings
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn as AndroidXOptIn
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import dev.zeroauth.android.biometric.FaceEmbedder
import dev.zeroauth.android.biometric.FaceEmbedderFactory
import dev.zeroauth.android.biometric.Quantizer
import dev.zeroauth.android.biometric.Sha256
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Single reusable face-capture Composable for registration + login.
 *
 * Drives the front camera with CameraX, runs ML Kit face detection on
 * each frame, surfaces a centred circular alignment guide, and — once
 * a single face has been centred + sized + held still for 750 ms —
 * captures a 112x112 ARGB_8888 crop, runs it through the on-device
 * face-embedding pipeline (FaceEmbedder -> Quantizer -> Sha256), and
 * fires [onCaptured] with the resulting 32-byte secret.
 *
 * ## Contract
 *
 * On success, [onCaptured] is invoked exactly ONCE with the 32-byte
 * SHA-256(Quantize(L2Normalise(FaceEmbedder(face_crop)))) secret. The
 * caller is responsible for:
 *
 *   * Zeroing the byte array when it's done (e.g. wrap in
 *     `ByteArray.fill(0)` after the BigInteger conversion).
 *   * Routing the secret through the registration / login pipeline.
 *
 * On user-initiated cancel (back arrow), [onCancelled] is invoked
 * exactly ONCE and the composable expects to leave composition.
 *
 * Both callbacks fire on the main thread (Compose launches the capture
 * via `rememberCoroutineScope()` which dispatches back to Main).
 *
 * ## Bitmap-flow guarantee
 *
 * The captured Bitmap and intermediate embedding bytes NEVER leave
 * this composable. The 32-byte secret is the only thing handed to the
 * caller; the bitmap is recycled before the secret is returned. This
 * matches the Scene 1 demo guarantee in
 * `docs/plan/bfsi-v1/02-bank-demo.md`: "the face image never leaves
 * the device."
 *
 * ## Permission handling
 *
 * Three permission states are surfaced cleanly:
 *
 *   * Granted: camera preview + face detection live.
 *   * Pending (first launch): system permission dialog auto-launches.
 *   * Denied: full-screen rationale + "Open settings" deeplink + a
 *     "Cancel" CTA that fires [onCancelled].
 *
 * ## Stability detection
 *
 * A face counts as "stable" when ALL of:
 *
 *   1. Exactly one face is in the frame.
 *   2. Face centre is inside the central 30-50% (vertical) and 35-65%
 *      (horizontal) of the preview.
 *   3. Face bounding box width is at least 30% of the preview width.
 *   4. Across consecutive frames the face centre has moved less than
 *      [MAX_CENTRE_DRIFT_FRAC] of the preview dimension AND the size
 *      has changed less than [MAX_SIZE_DRIFT_FRAC] of the previous
 *      size. (Stillness gate — a face that jitters fast resets the
 *      stability timer.)
 *
 * The status pill at the top reflects the current state:
 *
 *   * "Looking for your face..." — no face detected (or > 1).
 *   * "Center your face in the circle" — face present but not yet
 *     inside the alignment band.
 *   * "Move a little closer" / "Move back a bit" — size out of band.
 *   * "Hold still..." — gate predicates satisfied, stability timer
 *     accumulating but below the threshold.
 *   * "Almost there..." — within 200 ms of the threshold.
 *   * "Capturing..." — threshold reached; capture in flight.
 *
 * @param onCaptured Callback fired with the 32-byte biometric secret
 *                   once stability + capture succeed.
 * @param onCancelled Callback fired when the user cancels (back arrow
 *                    in the top-left, or "Cancel" on the permission-
 *                    denied rationale).
 */
@Composable
fun FaceCaptureScreen(
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
) {
    val context = LocalContext.current

    // Track permission grant state. We recompute on resume because the
    // user can flip it from system settings while we're showing the
    // denied state.
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED,
        )
    }
    var permissionRequested by remember { mutableStateOf(false) }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        hasPermission = granted
        permissionRequested = true
    }

    LaunchedEffect(Unit) {
        if (!hasPermission && !permissionRequested) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
            permissionRequested = true
        }
    }

    if (!hasPermission) {
        PermissionDeniedScreen(
            onRequestPermission = {
                permissionLauncher.launch(Manifest.permission.CAMERA)
            },
            onOpenSettings = { openAppSettings(context) },
            onCancel = onCancelled,
        )
        return
    }

    CapturePipeline(
        onCaptured = onCaptured,
        onCancelled = onCancelled,
    )
}

/* ─── Camera + face-detection pipeline ──────────────────────────────── */

/**
 * Internal capture pipeline — runs only after the camera permission is
 * granted. Owns the CameraX use cases, the ML Kit face detector, the
 * stability state machine, and the secret-derivation coroutine.
 */
@Composable
@AndroidXOptIn(ExperimentalGetImage::class)
private fun CapturePipeline(
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }

    // ML Kit face detector — fast mode, no landmarks/contours/
    // classification (we only need the bounding box + count).
    val detector: FaceDetector = remember {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
                .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
                .setMinFaceSize(0.20f)
                .enableTracking()
                .build(),
        )
    }

    val embedder = remember { FaceEmbedderFactory.default() }

    DisposableEffect(detector, embedder, analysisExecutor) {
        onDispose {
            runCatching { detector.close() }
            runCatching { embedder.close() }
            analysisExecutor.shutdown()
        }
    }

    // ─── Visual / stability state. Held in mutable state so the
    // composables re-render in response to analyzer-thread updates.

    var status by remember { mutableStateOf(CaptureStatus.SearchingForFace) }
    var stableSinceMs by remember { mutableStateOf(0L) }
    // The captured-and-already-handled latch. Prevents two onCaptured
    // calls if the analyzer manages to fire a "stable" frame twice
    // before the composable leaves composition.
    var captureLatched by remember { mutableStateOf(false) }
    // Most recent frame snapshot — used by the capture coroutine when
    // the stability threshold fires.
    var latestSnapshot: FrameSnapshot? by remember { mutableStateOf(null) }
    // Most recent face geometry — for the drift / size guards.
    var lastFaceCentre: Offset? by remember { mutableStateOf(null) }
    var lastFaceSize: Float? by remember { mutableStateOf(null) }

    // The preview view is captured in `remember` so the AndroidView
    // factory and the CameraX use-case binding share the same surface.
    val previewView = remember { PreviewView(context) }

    DisposableEffect(Unit) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        cameraProviderFuture.addListener({
            try {
                val cameraProvider = cameraProviderFuture.get()
                previewView.implementationMode = PreviewView.ImplementationMode.PERFORMANCE
                previewView.scaleType = PreviewView.ScaleType.FILL_CENTER

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val resolutionSelector = ResolutionSelector.Builder()
                    .setResolutionStrategy(
                        ResolutionStrategy(
                            Size(1280, 720),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                        ),
                    ).build()

                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(resolutionSelector)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(
                    analysisExecutor,
                    FaceFrameAnalyzer(
                        detector = detector,
                        onResult = { result ->
                            // The analyzer thread posts back to the
                            // PreviewView's event queue (main thread)
                            // so the Compose state mutations happen on
                            // Main.
                            previewView.post {
                                if (captureLatched) return@post
                                handleAnalyzerResult(
                                    result = result,
                                    setStatus = { status = it },
                                    getLastCentre = { lastFaceCentre },
                                    setLastCentre = { lastFaceCentre = it },
                                    getLastSize = { lastFaceSize },
                                    setLastSize = { lastFaceSize = it },
                                    getStableSinceMs = { stableSinceMs },
                                    setStableSinceMs = { stableSinceMs = it },
                                    setLatestSnapshot = { latestSnapshot = it },
                                )
                            }
                        },
                    ),
                )

                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_FRONT_CAMERA,
                    preview,
                    analysis,
                )
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "Camera bind failed")
                status = CaptureStatus.CameraError
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            runCatching {
                ProcessCameraProvider.getInstance(context).get().unbindAll()
            }
        }
    }

    // Capture trigger: when status flips to Capturing AND a snapshot
    // is available, derive the secret on a background thread and fire
    // the callback.
    LaunchedEffect(status, captureLatched) {
        if (status == CaptureStatus.Capturing && !captureLatched) {
            captureLatched = true
            val snapshot = latestSnapshot
            if (snapshot == null) {
                // Defensive — Capturing should only fire after we
                // recorded a frame. Reset and let the analyzer try
                // again on the next frame.
                captureLatched = false
                status = CaptureStatus.SearchingForFace
                stableSinceMs = 0L
                return@LaunchedEffect
            }
            scope.launch {
                try {
                    val secret = withContext(Dispatchers.Default) {
                        deriveSecret(embedder, snapshot)
                    }
                    onCaptured(secret)
                } catch (t: Throwable) {
                    Timber.tag(TAG).e(t, "Secret derivation failed")
                    captureLatched = false
                    status = CaptureStatus.SearchingForFace
                    stableSinceMs = 0L
                }
            }
        }
    }

    // ─── UI ──────────────────────────────────────────────────────────

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
    ) {
        // Mirrored CameraX preview (front camera). PreviewView already
        // handles mirroring for the FRONT lens when display rotation
        // is 0 — the user sees themselves the right way.
        AndroidView(
            factory = { previewView },
            modifier = Modifier.fillMaxSize(),
        )

        // Gradient + alignment-circle overlay.
        AlignmentOverlay()

        // Top bar: back arrow + status pill.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 12.dp),
        ) {
            TopBar(
                statusLabel = status.label,
                onCancel = onCancelled,
            )
            Spacer(Modifier.height(8.dp))
        }

        // Bottom strip — only shown when the camera failed.
        AnimatedVisibility(
            visible = status == CaptureStatus.CameraError,
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .systemBarsPadding()
                    .padding(16.dp),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "Could not start the camera. Try again from the previous screen.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Button(
                        onClick = onCancelled,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Go back")
                    }
                }
            }
        }

        // Capturing overlay (small spinner over the alignment ring).
        if (status == CaptureStatus.Capturing) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 4.dp,
                )
            }
        }
    }
}

/* ─── UI sub-pieces ─────────────────────────────────────────────────── */

@Composable
private fun TopBar(
    statusLabel: String,
    onCancel: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth(),
    ) {
        // Back arrow (top-left).
        TextButton(
            onClick = onCancel,
            modifier = Modifier.align(Alignment.CenterStart),
        ) {
            Text(
                text = "Cancel",
                color = Color.White,
                style = MaterialTheme.typography.titleMedium,
            )
        }
        // Status pill (centered).
        Card(
            modifier = Modifier
                .align(Alignment.Center)
                .padding(horizontal = 64.dp),
            shape = CircleShape,
            colors = CardDefaults.cardColors(
                containerColor = Color.Black.copy(alpha = 0.55f),
                contentColor = Color.White,
            ),
        ) {
            Text(
                text = statusLabel,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Renders a centred circular alignment guide and a subtle radial
 * gradient around it that darkens the corners. Cosmetic only — the
 * detection geometry uses screen-percent thresholds, not the visual
 * circle, so the alignment guide is purely a "where to put your face"
 * affordance.
 */
@Composable
private fun AlignmentOverlay() {
    Canvas(modifier = Modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        val cx = w / 2f
        val cy = h / 2f
        // Circle radius — fraction of the shorter dimension.
        val r = (minOf(w, h)) * 0.36f

        // Radial darkening gradient outside the circle. Compose's
        // Brush.radialGradient interpolates from centre outwards, so
        // a transparent-to-translucent-black gradient gives us a
        // vignette effect.
        drawRect(
            brush = Brush.radialGradient(
                colorStops = arrayOf(
                    0.0f to Color.Transparent,
                    0.55f to Color.Transparent,
                    1.0f to Color.Black.copy(alpha = 0.55f),
                ),
                center = Offset(cx, cy),
                radius = maxOf(w, h) * 0.65f,
            ),
        )

        // Dashed alignment ring.
        drawCircle(
            color = Color.White.copy(alpha = 0.85f),
            radius = r,
            center = Offset(cx, cy),
            style = Stroke(
                width = 5f,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(20f, 14f), 0f),
            ),
        )
    }
}

@Composable
private fun PermissionDeniedScreen(
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Camera access is required to use your face as a key",
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = "ZeroAuth uses the front camera to capture your face entirely on-device. " +
                "No image, embedding, or template ever leaves your phone — only a one-way " +
                "32-byte commitment is derived locally.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onRequestPermission,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            contentPadding = PaddingValues(horizontal = 24.dp),
        ) {
            Text("Allow camera access")
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = onOpenSettings,
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            Text("Open system settings")
        }
        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onCancel,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Cancel")
        }
    }
}

/* ─── Analyzer + stability logic ────────────────────────────────────── */

/**
 * Result of a single ML Kit face-detection pass — shipped from the
 * analyzer thread back to the main thread.
 */
private data class FaceAnalyzerResult(
    val face: Face?,
    val frame: Bitmap?,
    val frameWidth: Int,
    val frameHeight: Int,
    val rotationDegrees: Int,
    val timestampMs: Long,
)

/**
 * A snapshot of the most recent good frame — used by the capture
 * coroutine when the stability threshold fires.
 */
private data class FrameSnapshot(
    val bitmap: Bitmap,
    val faceBounds: Rect,
)

/**
 * Tracks the latest analyzer result against the stability state so the
 * caller can update Compose state on the main thread. Pulled out as a
 * top-level function so the parameters are explicit and the
 * recomputation logic is testable in isolation if we ever need to.
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun handleAnalyzerResult(
    result: FaceAnalyzerResult,
    setStatus: (CaptureStatus) -> Unit,
    getLastCentre: () -> Offset?,
    setLastCentre: (Offset?) -> Unit,
    getLastSize: () -> Float?,
    setLastSize: (Float?) -> Unit,
    getStableSinceMs: () -> Long,
    setStableSinceMs: (Long) -> Unit,
    setLatestSnapshot: (FrameSnapshot?) -> Unit,
) {
    val face = result.face
    if (face == null) {
        setStatus(CaptureStatus.SearchingForFace)
        setStableSinceMs(0L)
        setLastCentre(null)
        setLastSize(null)
        return
    }

    val box = face.boundingBox
    val frameW = result.frameWidth.toFloat()
    val frameH = result.frameHeight.toFloat()
    val cx = box.exactCenterX()
    val cy = box.exactCenterY()
    val faceWidth = box.width().toFloat()

    // Centring band: eyes between 35-65% horizontal, 30-50% vertical.
    // We approximate eyes by face-centre - 5% (eyes sit roughly at
    // the upper third of the face).
    val eyeY = cy - box.height() * 0.18f
    val xFrac = cx / frameW
    val yFrac = eyeY / frameH
    val sizeFrac = faceWidth / frameW

    // Off-centre? Surface the directional hint.
    if (xFrac < MIN_CENTRE_X_FRAC || xFrac > MAX_CENTRE_X_FRAC ||
        yFrac < MIN_CENTRE_Y_FRAC || yFrac > MAX_CENTRE_Y_FRAC
    ) {
        setStatus(CaptureStatus.CenterFace)
        setStableSinceMs(0L)
        setLastCentre(Offset(cx, cy))
        setLastSize(faceWidth)
        return
    }

    // Size band check.
    if (sizeFrac < MIN_FACE_SIZE_FRAC) {
        setStatus(CaptureStatus.MoveCloser)
        setStableSinceMs(0L)
        setLastCentre(Offset(cx, cy))
        setLastSize(faceWidth)
        return
    }
    if (sizeFrac > MAX_FACE_SIZE_FRAC) {
        setStatus(CaptureStatus.MoveBack)
        setStableSinceMs(0L)
        setLastCentre(Offset(cx, cy))
        setLastSize(faceWidth)
        return
    }

    // Stillness check — face must not have jumped since the last
    // frame. Otherwise the user is moving and we reset the timer.
    val lastCentre = getLastCentre()
    val lastSize = getLastSize()
    val drifted = lastCentre?.let { prev ->
        val dx = (cx - prev.x) / frameW
        val dy = (cy - prev.y) / frameH
        dx * dx + dy * dy > MAX_CENTRE_DRIFT_FRAC * MAX_CENTRE_DRIFT_FRAC
    } ?: false
    val sizeJumped = lastSize?.let { prev ->
        kotlin.math.abs(faceWidth - prev) / prev > MAX_SIZE_DRIFT_FRAC
    } ?: false

    setLastCentre(Offset(cx, cy))
    setLastSize(faceWidth)

    if (drifted || sizeJumped) {
        setStatus(CaptureStatus.HoldStill)
        setStableSinceMs(result.timestampMs)
        // Record the (possibly stale) frame so capture has something
        // to work with if stability is reached next tick.
        result.frame?.let {
            setLatestSnapshot(FrameSnapshot(it, box))
        }
        return
    }

    // Predicates all green — accumulate stability time.
    val stableSince = getStableSinceMs()
    val stableStart = if (stableSince == 0L) result.timestampMs else stableSince
    setStableSinceMs(stableStart)
    val stableFor = result.timestampMs - stableStart

    result.frame?.let { setLatestSnapshot(FrameSnapshot(it, box)) }

    when {
        stableFor >= STABILITY_THRESHOLD_MS -> setStatus(CaptureStatus.Capturing)
        stableFor >= STABILITY_THRESHOLD_MS - 200L -> setStatus(CaptureStatus.AlmostThere)
        else -> setStatus(CaptureStatus.HoldStill)
    }
}

/**
 * CameraX analyzer that runs ML Kit face detection on each frame.
 *
 * The analyzer:
 *
 *   1. Converts the YUV ImageProxy to an ARGB Bitmap.
 *   2. Hands the Bitmap to ML Kit via `InputImage.fromBitmap`.
 *   3. Invokes [onResult] on the analyzer thread (callers must dispatch
 *      back to Main if they touch Compose state).
 *   4. Closes the ImageProxy in the completion listener.
 */
private class FaceFrameAnalyzer(
    private val detector: FaceDetector,
    private val onResult: (FaceAnalyzerResult) -> Unit,
) : ImageAnalysis.Analyzer {

    @ExperimentalGetImage
    override fun analyze(imageProxy: ImageProxy) {
        val media = imageProxy.image
        if (media == null) {
            imageProxy.close()
            return
        }
        val rotation = imageProxy.imageInfo.rotationDegrees
        val frameBitmap = try {
            imageProxyToBitmap(imageProxy, rotation)
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "Frame -> Bitmap conversion failed")
            null
        }
        val input = InputImage.fromMediaImage(media, rotation)
        val timestampMs = System.currentTimeMillis()
        detector.process(input)
            .addOnSuccessListener { faces ->
                val face = if (faces.size == 1) faces[0] else null
                onResult(
                    FaceAnalyzerResult(
                        face = face,
                        frame = frameBitmap,
                        frameWidth = frameBitmap?.width ?: imageProxy.width,
                        frameHeight = frameBitmap?.height ?: imageProxy.height,
                        rotationDegrees = rotation,
                        timestampMs = timestampMs,
                    ),
                )
            }
            .addOnFailureListener { t ->
                Timber.tag(TAG).w(t, "ML Kit face detection failed")
            }
            .addOnCompleteListener { imageProxy.close() }
    }
}

/**
 * YUV_420_888 (and JPEG fallback) -> Bitmap converter. CameraX gives
 * us a NV21-shaped buffer for the common front-camera modes; we
 * convert by stitching together the Y/U/V planes and feeding them to
 * YuvImage. Then rotate to match the imageInfo rotationDegrees so
 * downstream face-bounds line up with the bitmap orientation.
 *
 * This is the same conversion pattern the existing
 * `mobile/face/FaceCaptureScreen.kt` uses (just inlined here so the
 * `:face` Gradle module dependency isn't needed).
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun imageProxyToBitmap(imageProxy: ImageProxy, rotation: Int): Bitmap {
    val image = imageProxy.image
        ?: throw IllegalStateException("ImageProxy.image was null")

    val raw: Bitmap = when (image.format) {
        ImageFormat.YUV_420_888 -> yuv420ToBitmap(imageProxy)
        else -> {
            // Fall back to the JPEG-decode path (legacy ImageProxy
            // formats). Works for the few devices that report JPEG
            // from the analyzer surface.
            val buffer = imageProxy.planes[0].buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: throw IllegalStateException("Bitmap decode returned null")
        }
    }

    return if (rotation == 0) {
        raw
    } else {
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
        if (rotated != raw) raw.recycle()
        rotated
    }
}

/**
 * Stitch a YUV_420_888 ImageProxy into a single NV21 byte array, then
 * encode as JPEG and decode back as ARGB. Not the fastest path (the
 * canonical mobile/face implementation has a hand-rolled YUV->RGB
 * converter), but it's compact and works on every device the W3 demo
 * targets.
 */
@AndroidXOptIn(ExperimentalGetImage::class)
private fun yuv420ToBitmap(imageProxy: ImageProxy): Bitmap {
    val yBuffer = imageProxy.planes[0].buffer
    val uBuffer = imageProxy.planes[1].buffer
    val vBuffer = imageProxy.planes[2].buffer

    val ySize = yBuffer.remaining()
    val uSize = uBuffer.remaining()
    val vSize = vBuffer.remaining()

    val nv21 = ByteArray(ySize + uSize + vSize)
    yBuffer.get(nv21, 0, ySize)
    // NV21 wants VU interleaved, but the U/V planes from CameraX are
    // already separated; the YuvImage constructor knows how to read
    // back from the contiguous NV21 layout, so concatenate V then U.
    vBuffer.get(nv21, ySize, vSize)
    uBuffer.get(nv21, ySize + vSize, uSize)

    val yuvImage = YuvImage(nv21, ImageFormat.NV21, imageProxy.width, imageProxy.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, imageProxy.width, imageProxy.height), 90, out)
    val bytes = out.toByteArray()
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalStateException("YUV -> JPEG -> Bitmap decode returned null")
}

/* ─── Capture finalisation ──────────────────────────────────────────── */

/**
 * Cropped + resized 112x112 ARGB_8888 face crop, then run through the
 * full FaceEmbedder -> Quantizer -> Sha256 pipeline. Returns the final
 * 32-byte secret. The intermediate buffers are zeroed in [Sha256.digest]'s
 * post-condition; the cropped bitmap is recycled before this returns.
 */
private suspend fun deriveSecret(
    embedder: FaceEmbedder,
    snapshot: FrameSnapshot,
): ByteArray {
    val crop = cropToFaceSquare(snapshot.bitmap, snapshot.faceBounds)
    val resized = resizeTo(crop, FaceEmbedder.INPUT_SIZE)
    if (crop != resized) crop.recycle()

    try {
        val embedding = embedder.embed(resized)
        check(embedding.size == Quantizer.EMBEDDING_DIM) {
            "FaceEmbedder produced ${embedding.size}-dim vector, expected ${Quantizer.EMBEDDING_DIM}"
        }
        val quantised = Quantizer.quantize(embedding)
        // Zero the embedding floats — defensive overwrite, the
        // resized bitmap is recycled below.
        for (i in embedding.indices) embedding[i] = 0f
        return Sha256.digest(quantised)
    } finally {
        if (!resized.isRecycled) resized.recycle()
        if (!snapshot.bitmap.isRecycled) snapshot.bitmap.recycle()
    }
}

/**
 * Crop the source bitmap to a centred square that covers the detected
 * face bounding box with a small padding margin. Square because the
 * downstream embedder wants 112x112 (1:1).
 */
private fun cropToFaceSquare(source: Bitmap, faceBounds: Rect): Bitmap {
    val padding = (maxOf(faceBounds.width(), faceBounds.height()) * 0.15f).toInt()
    val side = maxOf(faceBounds.width(), faceBounds.height()) + 2 * padding
    val cx = faceBounds.exactCenterX().toInt()
    val cy = faceBounds.exactCenterY().toInt()
    var left = cx - side / 2
    var top = cy - side / 2
    var right = left + side
    var bottom = top + side

    // Clamp to source bounds — the crop is shifted (not shrunk) when
    // the face is near an edge so the output is always square.
    if (left < 0) { right -= left; left = 0 }
    if (top < 0) { bottom -= top; top = 0 }
    if (right > source.width) { left -= (right - source.width); right = source.width }
    if (bottom > source.height) { top -= (bottom - source.height); bottom = source.height }
    left = left.coerceAtLeast(0)
    top = top.coerceAtLeast(0)
    val w = (right - left).coerceAtMost(source.width - left)
    val h = (bottom - top).coerceAtMost(source.height - top)
    val sideClamped = minOf(w, h)
    return Bitmap.createBitmap(source, left, top, sideClamped, sideClamped)
}

/**
 * Resize a square bitmap to [edge] x [edge] ARGB_8888. If the source is
 * already at the target size + config, returns the source unchanged.
 */
private fun resizeTo(source: Bitmap, edge: Int): Bitmap {
    if (source.width == edge && source.height == edge && source.config == Bitmap.Config.ARGB_8888) {
        return source
    }
    val scaled = Bitmap.createScaledBitmap(source, edge, edge, true)
    return if (scaled.config == Bitmap.Config.ARGB_8888) {
        scaled
    } else {
        val argb = scaled.copy(Bitmap.Config.ARGB_8888, false)
        scaled.recycle()
        argb
    }
}

/* ─── Helpers ───────────────────────────────────────────────────────── */

private fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}

/* ─── Capture state machine ─────────────────────────────────────────── */

/**
 * Operator-facing capture status. The label drives the status pill at
 * the top of the screen.
 */
private enum class CaptureStatus(val label: String) {
    SearchingForFace("Looking for your face..."),
    CenterFace("Center your face in the circle"),
    MoveCloser("Move a little closer"),
    MoveBack("Move back a bit"),
    HoldStill("Hold still..."),
    AlmostThere("Almost there..."),
    Capturing("Capturing..."),
    CameraError("Camera unavailable"),
}

/* ─── Tuning constants ──────────────────────────────────────────────── */

private const val TAG = "FaceCaptureScreen"

/** How long the face must be still + centred + sized correctly. */
private const val STABILITY_THRESHOLD_MS: Long = 750L

/** Face-centre horizontal band — eyes between 35-65% of preview width. */
private const val MIN_CENTRE_X_FRAC: Float = 0.35f
private const val MAX_CENTRE_X_FRAC: Float = 0.65f

/** Eye-vertical band — eyes between 30-50% of preview height. */
private const val MIN_CENTRE_Y_FRAC: Float = 0.30f
private const val MAX_CENTRE_Y_FRAC: Float = 0.50f

/** Minimum face width as a fraction of preview width. */
private const val MIN_FACE_SIZE_FRAC: Float = 0.30f

/** Maximum face width as a fraction of preview width (avoid too-close). */
private const val MAX_FACE_SIZE_FRAC: Float = 0.85f

/**
 * Maximum frame-to-frame centre drift (Euclidean distance, as a
 * fraction of the preview dimension) before we reset the stability
 * timer. Higher = less sensitive to small motion; lower = pickier.
 */
private const val MAX_CENTRE_DRIFT_FRAC: Float = 0.04f

/**
 * Maximum frame-to-frame face-size jump (relative to the previous size)
 * before we reset the stability timer.
 */
private const val MAX_SIZE_DRIFT_FRAC: Float = 0.10f
