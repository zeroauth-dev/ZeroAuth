package dev.zeroauth.android.ui.face

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.SystemClock
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
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import com.google.mlkit.vision.face.FaceDetectorOptions
import dev.zeroauth.android.sec.FaceTemplateStore
import dev.zeroauth.android.ui.reg.BiometricEmbedderHolder
import dev.zeroauth.android.ui.reg.embeddingFromBitmap
import dev.zeroauth.biometric.FaceMatcher
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Face-match verification for the login (proof-pairing) flow.
 *
 * ## What this is, and why it replaces the legacy login face-capture
 *
 * The legacy login path re-ran the enrollment's secret-derivation
 * pipeline (face → MobileFaceNet embed → Quantize → SHA-256) and handed
 * the resulting 32-byte secret to the prover. That pipeline depends on
 * the fresh embedding being byte-identical to the enrollment-time
 * embedding after quantisation — a property that the Quantizer's
 * int16 rounding tolerance (~5e-4) cannot uphold against MobileFaceNet's
 * within-class drift (~1e-2). Same face on the same phone produced
 * different bytes across sign-ins → different DIDs → server-side
 * `tenant_users.metadata.did` miss → `pairing_did_unknown`.
 *
 * The fix is to STOP re-deriving and START matching. Enrollment
 * persists `{secret, template}` (see [FaceTemplateStore] +
 * [dev.zeroauth.android.ui.reg.RegistrationFaceCapture]). Verification
 * captures a fresh face, runs MobileFaceNet, computes cosine similarity
 * against the persisted template via [FaceMatcher.matchesTemplate], and
 * — if the score crosses the threshold — RELEASES the persisted secret
 * to the caller.
 *
 * Same face on the same device → same byte-identical secret on every
 * sign-in (because we read the same persisted bytes), which means same
 * DID, which means the server-side lookup hits.
 *
 * ## ZK property
 *
 * Unchanged. The captured Bitmap, the fresh embedding, and the stored
 * template never cross the composable boundary. The server only ever
 * sees `{ DID, commitment(secret, salt), Groth16 proof }`.
 *
 * ## Liveness
 *
 * We require an open→close→open blink to release the secret. A printed
 * photo of the user does not blink (and even an animated video struggles
 * to produce the exact eye-probability transition pattern that ML Kit
 * is trained on under FRONT camera input). This is a soft liveness gate
 * — full anti-spoofing (depth, screen-replay detection, deepfake
 * detection) is a larger workstream tracked in ADR-0019.
 *
 * ## API surface (matches the registration flow's RegistrationFaceCapture)
 *
 * @param onCaptured Fires with the released 32-byte secret on a
 *                   successful match. Called once per mount.
 * @param onCancelled Fires when the user cancels (back arrow, Cancel
 *                    CTA, permission denied, or "Try again later" after
 *                    a match failure).
 */
@Composable
fun FaceMatchVerification(
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED,
        )
    }
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> hasPermission = granted }

    if (!hasPermission) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Face sign-in needs camera access",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Verifying your identity runs entirely on this device. " +
                    "Your face never leaves the phone — only a 32-byte zero-knowledge " +
                    "proof reaches the bank.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) {
                Text("Allow camera access")
            }
            OutlinedButton(onClick = onCancelled) { Text("Cancel") }
        }
        return
    }

    // Block early if no enrollment exists on this device. The user
    // must complete the registration ceremony before they can sign in.
    val store = remember { FaceTemplateStore(context) }
    if (!store.hasEnrollment()) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "No face enrolled on this device",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Open the bank's sign-up portal on your laptop and " +
                    "scan the QR codes to register your face on this phone " +
                    "before you can sign in.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            OutlinedButton(onClick = onCancelled) { Text("Back") }
        }
        return
    }

    FaceMatchPipeline(
        modifier = modifier,
        store = store,
        onCaptured = onCaptured,
        onCancelled = onCancelled,
    )
}

@Composable
@AndroidXOptIn(ExperimentalGetImage::class)
private fun FaceMatchPipeline(
    modifier: Modifier,
    store: FaceTemplateStore,
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val captureScope = rememberCoroutineScope()

    // Pre-warm the embedder.
    remember(context) { BiometricEmbedderHolder.get(context.applicationContext) }

    val detector = remember {
        FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_NONE)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .setMinFaceSize(0.20f)
                .enableTracking()
                .build(),
        )
    }

    // Load the persisted template ONCE per mount. Defensive copies so
    // we don't churn the FaceTemplateStore on every frame.
    val template = remember(store) { store.readTemplate() ?: emptyList() }

    // Latch — single capture per mount. The match runs once; if it
    // fails, the [errorMessage] state surfaces the retry CTA.
    val matchLatched = remember { AtomicBoolean(false) }
    // Blink state machine — same shape as enrollment's blink stage.
    val blinkState = remember { AtomicReference(BlinkState.WaitingForOpen) }

    var statusMessage by remember { mutableStateOf("Look at the camera") }
    var progress by remember { mutableStateOf(0f) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var processing by remember { mutableStateOf(false) }
    var matched by remember { mutableStateOf(false) }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { detector.close() }
            analysisExecutor.shutdown()
        }
    }

    /** Re-arm so the user can retry a failed match without remounting. */
    fun resetForRetry() {
        matchLatched.set(false)
        blinkState.set(BlinkState.WaitingForOpen)
        errorMessage = null
        processing = false
        progress = 0f
        statusMessage = "Look at the camera"
    }

    fun onBlinkCaptured(bitmap: Bitmap) {
        captureScope.launch {
            processing = true
            statusMessage = "Verifying…"
            try {
                val fresh = embeddingFromBitmap(context.applicationContext, bitmap)
                if (!bitmap.isRecycled) bitmap.recycle()
                if (!FaceMatcher.isWellFormed(fresh)) {
                    Timber.tag(TAG).w("fresh embedding is not L2-unit length; rejecting")
                    errorMessage = "Camera produced an unusable frame. Try again."
                    processing = false
                    matchLatched.set(false)
                    blinkState.set(BlinkState.WaitingForOpen)
                    return@launch
                }
                if (template.isEmpty()) {
                    errorMessage = "No face enrolled on this device."
                    processing = false
                    return@launch
                }
                val result = FaceMatcher.matchesTemplate(fresh, template)
                Timber.tag(TAG).i(
                    "match best=%.3f anchor=%d threshold=%.3f → %s",
                    result.bestScore,
                    result.bestAnchorIndex,
                    result.threshold,
                    if (result.matched) "ACCEPT" else "REJECT",
                )
                if (!result.matched) {
                    errorMessage = "We couldn't match that to your enrolled face. " +
                        "Make sure it's you and the lighting is similar to when you signed up."
                    processing = false
                    matchLatched.set(false)
                    blinkState.set(BlinkState.WaitingForOpen)
                    return@launch
                }
                val secret = store.readSecret()
                if (secret == null) {
                    errorMessage = "Couldn't read the stored face key. Re-enroll on this device."
                    processing = false
                    return@launch
                }
                matched = true
                statusMessage = "Verified"
                progress = 1f
                onCaptured(secret)
                // Note: do NOT zero `secret` here — onCaptured's caller
                // (ScanViewModel) immediately consumes the bytes into a
                // BigInteger inside FaceSecretCredential and then zeros
                // its local copy. Zeroing here would null the caller's
                // copy before they could read it.
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "verification failed")
                errorMessage = "Verification failed: ${t.message ?: "unknown error"}. Try again."
                processing = false
                matchLatched.set(false)
                blinkState.set(BlinkState.WaitingForOpen)
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(360.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Color.Black),
        ) {
            AndroidView(
                factory = { ctx ->
                    val previewView = PreviewView(ctx).apply {
                        layoutParams = android.widget.FrameLayout.LayoutParams(
                            MATCH_PARENT,
                            MATCH_PARENT,
                        )
                        implementationMode = PreviewView.ImplementationMode.PERFORMANCE
                        scaleType = PreviewView.ScaleType.FILL_CENTER
                    }
                    val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        try {
                            val cameraProvider = cameraProviderFuture.get()
                            val preview = Preview.Builder()
                                .setTargetAspectRatio(AspectRatio.RATIO_4_3)
                                .build()
                                .apply { setSurfaceProvider(previewView.surfaceProvider) }
                            val analysis = ImageAnalysis.Builder()
                                .setTargetAspectRatio(AspectRatio.RATIO_4_3)
                                .setBackpressureStrategy(
                                    ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST,
                                )
                                .build()
                                .apply {
                                    setAnalyzer(
                                        analysisExecutor,
                                        VerificationAnalyzer(
                                            detector = detector,
                                            matchLatched = matchLatched,
                                            blinkState = blinkState,
                                            onStatus = { msg, prog ->
                                                statusMessage = msg
                                                progress = prog
                                            },
                                            onBlinkComplete = ::onBlinkCaptured,
                                        ),
                                    )
                                }
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                CameraSelector.DEFAULT_FRONT_CAMERA,
                                preview,
                                analysis,
                            )
                        } catch (ex: Exception) {
                            Log.w(TAG, "CameraX bind failed for face match", ex)
                            errorMessage = "Couldn't start the camera. Close and reopen the app."
                        }
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
                modifier = Modifier.fillMaxSize(),
            )

            LinearProgressIndicator(
                progress = progress,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(start = 24.dp, end = 24.dp, bottom = 16.dp)
                    .fillMaxWidth(),
            )

            OutlinedButton(
                onClick = onCancelled,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp),
            ) {
                Text("Cancel")
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = if (matched) "Verified" else if (processing) "Verifying…" else statusMessage,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = when {
                    matched -> "Releasing the proof witness to the prover."
                    processing -> "Matching your face against the template on this device."
                    else -> "Center your face in the camera, then blink once to sign in. " +
                        "Everything happens on this phone — your face never leaves the device."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        AnimatedVisibility(visible = errorMessage != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = errorMessage ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                    Spacer(Modifier.height(2.dp))
                    Button(onClick = ::resetForRetry, modifier = Modifier.fillMaxWidth()) {
                        Text("Try again")
                    }
                }
            }
        }
    }
}

/* ──────────────────── Analyzer ──────────────────── */

private enum class BlinkState { WaitingForOpen, SawOpen, SawClose }

private class VerificationAnalyzer(
    private val detector: com.google.mlkit.vision.face.FaceDetector,
    private val matchLatched: AtomicBoolean,
    private val blinkState: AtomicReference<BlinkState>,
    private val onStatus: (String, Float) -> Unit,
    private val onBlinkComplete: (Bitmap) -> Unit,
) : ImageAnalysis.Analyzer {

    private var lastTransitionMs: Long = 0L

    @AndroidXOptIn(ExperimentalGetImage::class)
    override fun analyze(proxy: ImageProxy) {
        if (matchLatched.get()) {
            proxy.close()
            return
        }
        val media = proxy.image
        if (media == null) {
            proxy.close()
            return
        }
        val rotation = proxy.imageInfo.rotationDegrees
        val input = InputImage.fromMediaImage(media, rotation)
        detector.process(input)
            .addOnSuccessListener { faces ->
                runCatching { handleResult(faces, proxy, rotation) }
                    .onFailure { t -> Log.w(TAG, "verification predicate eval failed", t) }
            }
            .addOnFailureListener { ex -> Log.w(TAG, "ML Kit face detect failed", ex) }
            .addOnCompleteListener { proxy.close() }
    }

    @AndroidXOptIn(ExperimentalGetImage::class)
    private fun handleResult(faces: List<Face>, proxy: ImageProxy, rotation: Int) {
        val face = pickPrimaryFace(faces, proxy.width, proxy.height)
        if (face == null) {
            onStatus("Looking for your face…", 0f)
            return
        }
        val yawAbs = kotlin.math.abs(face.headEulerAngleY)
        if (yawAbs > 15f) {
            onStatus("Face the camera straight on", 0f)
            return
        }
        val leftProb = face.leftEyeOpenProbability
        val rightProb = face.rightEyeOpenProbability
        if (leftProb == null || rightProb == null) {
            // Classification not surfaced for this frame; wait.
            return
        }

        val nowMs = SystemClock.elapsedRealtime()
        val open = leftProb > 0.7f && rightProb > 0.7f
        val closed = leftProb < 0.3f && rightProb < 0.3f
        val state = blinkState.get()

        // Time-out partial states so a stalled blink resets cleanly.
        if (state != BlinkState.WaitingForOpen &&
            lastTransitionMs > 0L &&
            nowMs - lastTransitionMs > BLINK_WINDOW_MS
        ) {
            blinkState.set(BlinkState.WaitingForOpen)
            lastTransitionMs = 0L
            onStatus("Blink to sign in", 0f)
            return
        }

        when (state) {
            BlinkState.WaitingForOpen -> {
                if (open) {
                    blinkState.set(BlinkState.SawOpen)
                    lastTransitionMs = nowMs
                    onStatus("Now blink to confirm", 0.33f)
                } else {
                    onStatus("Open both eyes, then blink", 0f)
                }
            }
            BlinkState.SawOpen -> {
                if (closed) {
                    blinkState.set(BlinkState.SawClose)
                    lastTransitionMs = nowMs
                    onStatus("Open them again", 0.66f)
                } else {
                    onStatus("Blink to confirm", 0.33f)
                }
            }
            BlinkState.SawClose -> {
                if (open) {
                    // Full blink — verify on this frame.
                    if (!matchLatched.compareAndSet(false, true)) return
                    onStatus("Matching…", 0.9f)
                    val cropped = cropFrameToFace(proxy, face, rotation) ?: run {
                        matchLatched.set(false)
                        blinkState.set(BlinkState.WaitingForOpen)
                        return
                    }
                    onBlinkComplete(cropped)
                }
                // Still closed → wait.
            }
        }
    }

    private fun pickPrimaryFace(faces: List<Face>, w: Int, h: Int): Face? {
        if (faces.size != 1) return null
        val f = faces.first()
        val box = f.boundingBox
        val cx = box.exactCenterX()
        val cy = box.exactCenterY()
        if (cx < w * 0.10f || cx > w * 0.90f) return null
        if (cy < h * 0.10f || cy > h * 0.90f) return null
        val shorter = minOf(w, h).toFloat()
        val faceSize = maxOf(box.width(), box.height()).toFloat()
        val sizeFrac = faceSize / shorter
        if (sizeFrac < 0.15f || sizeFrac > 0.95f) return null
        return f
    }
}

/* ──────────────────── Bitmap helpers (local copies) ──────────────────── */

@AndroidXOptIn(ExperimentalGetImage::class)
private fun cropFrameToFace(
    proxy: ImageProxy,
    face: Face,
    rotation: Int,
): Bitmap? {
    val raw = imageProxyToBitmap(proxy, rotation) ?: return null
    val cropped = cropAndResize(raw, face.boundingBox)
    if (raw !== cropped && !raw.isRecycled) raw.recycle()
    return cropped
}

@AndroidXOptIn(ExperimentalGetImage::class)
private fun imageProxyToBitmap(proxy: ImageProxy, rotation: Int): Bitmap? {
    val image = proxy.image ?: return null
    val raw: Bitmap = when (image.format) {
        ImageFormat.YUV_420_888 -> yuv420ToBitmap(proxy)
        else -> {
            val buffer = proxy.planes[0].buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
        }
    }
    return if (rotation == 0) {
        raw
    } else {
        val m = Matrix().apply { postRotate(rotation.toFloat()) }
        val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
        if (rotated !== raw) raw.recycle()
        rotated
    }
}

@AndroidXOptIn(ExperimentalGetImage::class)
private fun yuv420ToBitmap(proxy: ImageProxy): Bitmap {
    val yBuffer = proxy.planes[0].buffer
    val uBuffer = proxy.planes[1].buffer
    val vBuffer = proxy.planes[2].buffer
    val ySize = yBuffer.remaining()
    val uSize = uBuffer.remaining()
    val vSize = vBuffer.remaining()
    val nv21 = ByteArray(ySize + uSize + vSize)
    yBuffer.get(nv21, 0, ySize)
    vBuffer.get(nv21, ySize, vSize)
    uBuffer.get(nv21, ySize + vSize, uSize)
    val yuvImage = YuvImage(nv21, ImageFormat.NV21, proxy.width, proxy.height, null)
    val out = ByteArrayOutputStream()
    yuvImage.compressToJpeg(Rect(0, 0, proxy.width, proxy.height), 90, out)
    val bytes = out.toByteArray()
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        ?: throw IllegalStateException("YUV → JPEG → Bitmap decode returned null")
}

private fun cropAndResize(source: Bitmap, faceBounds: Rect): Bitmap {
    val w = source.width
    val h = source.height
    if (w <= 0 || h <= 0) return source
    val padding = (maxOf(faceBounds.width(), faceBounds.height()) * 0.15f).toInt()
    val side = maxOf(faceBounds.width(), faceBounds.height()) + 2 * padding
    val cx = faceBounds.exactCenterX().toInt()
    val cy = faceBounds.exactCenterY().toInt()
    var left = cx - side / 2
    var top = cy - side / 2
    var right = left + side
    var bottom = top + side
    if (left < 0) { right -= left; left = 0 }
    if (top < 0) { bottom -= top; top = 0 }
    if (right > w) { left -= (right - w); right = w }
    if (bottom > h) { top -= (bottom - h); bottom = h }
    left = left.coerceAtLeast(0)
    top = top.coerceAtLeast(0)
    val cw = (right - left).coerceAtMost(w - left)
    val ch = (bottom - top).coerceAtMost(h - top)
    val sideClamped = minOf(cw, ch)
    if (sideClamped <= 0) {
        return Bitmap.createScaledBitmap(source, FACE_EDGE, FACE_EDGE, true)
    }
    val sub = Bitmap.createBitmap(source, left, top, sideClamped, sideClamped)
    val resized = Bitmap.createScaledBitmap(sub, FACE_EDGE, FACE_EDGE, true)
    if (sub !== resized) sub.recycle()
    val argb = if (resized.config == Bitmap.Config.ARGB_8888) {
        resized
    } else {
        val converted = resized.copy(Bitmap.Config.ARGB_8888, false)
        if (converted !== resized) resized.recycle()
        converted
    }
    return argb
}

private const val TAG = "FaceMatchVerification"
private const val FACE_EDGE = 112
private const val BLINK_WINDOW_MS = 3_000L
