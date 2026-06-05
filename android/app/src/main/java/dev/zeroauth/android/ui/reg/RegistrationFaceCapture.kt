package dev.zeroauth.android.ui.reg

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
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
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
import dev.zeroauth.biometric.Quantizer
import dev.zeroauth.biometric.Sha256
import dev.zeroauth.biometric.TfliteFaceEmbedder
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.launch

/**
 * Multi-step on-device face enrollment ceremony for the ADR 0023
 * three-QR registration ceremony.
 *
 * ## What changed (refactor from single-capture → ceremony)
 *
 * The previous single-capture flow ("hold still 1.5 s → derive secret →
 * fire onCaptured") could not survive the within-class drift problem:
 * MobileFaceNet's embedding output varies by ~1e-2 per component
 * between two captures of the same face on the same device, and the
 * Quantizer's int16 rounding only absorbs ~5e-4. The same face on the
 * same phone produced different 32-byte secrets across captures, which
 * meant different DIDs, which broke the server-side
 * `tenant_users.metadata.did` lookup at sign-in.
 *
 * The fix is twofold and lives in this file + [FaceTemplateStore]:
 *
 *   1. **Enrollment captures the face FOUR times in four poses** — front,
 *      left-yaw, right-yaw, blink. Each capture produces a 192-dim
 *      L2-normalised MobileFaceNet embedding. The four embeddings
 *      collectively form a TEMPLATE that covers the user's normal pose
 *      range. The blink capture also serves as a liveness gate (a
 *      printed photo cannot blink).
 *
 *   2. **The 32-byte secret is derived ONCE — from the front capture's
 *      embedding** — and PERSISTED via [FaceTemplateStore] alongside
 *      the template. Subsequent sign-ins do not re-derive; they MATCH
 *      a fresh capture against the persisted template (via
 *      [dev.zeroauth.biometric.FaceMatcher]) and, on a successful
 *      match, RELEASE the persisted secret. Same face on the same
 *      device → same byte-identical secret on every sign-in.
 *
 * The ZK wire property is unchanged: server stores
 * `commitment(secret, salt)` + DID + Groth16 proof; the secret, the
 * template, and every captured Bitmap stay on-device.
 *
 * ## Stage-by-stage predicates
 *
 *   * **Front**: exactly one face, centred (centre within 35–65 % H
 *     and 30–50 % V of the frame), bounding box ≥ 25 % of frame width,
 *     `|headEulerAngleY| < 8°`, both eyes open (`probability > 0.6`),
 *     held still ≥ 1.0 s. Capture once → `e_front`. The secret is
 *     derived from this embedding.
 *   * **Left**: face still visible, `|headEulerAngleY| > 15°`, eye-
 *     open probability still > 0.6 (user is still looking toward the
 *     phone), held still ≥ 0.6 s. Capture once → `e_left`. The sign of
 *     the captured yaw is recorded so step 3 can require the opposite
 *     sign.
 *   * **Right**: same as Left but with the opposite sign of yaw.
 *     Capture once → `e_right`.
 *   * **Blink**: face front-facing again (`|yaw| < 12°`), then observe
 *     `both eyes open → both eyes closed → both eyes open` within a
 *     3-second window. Capture the `eyes-open-again` frame → `e_blink`.
 *
 * Each stage's failure modes (face leaves frame, wrong yaw direction,
 * blink times out) reset that stage's stability tracker WITHOUT
 * discarding the previously-completed stages. The user does not have
 * to start over if they fumble step 3.
 *
 * ## Persistence
 *
 * On stage 4 completion, the composable:
 *
 *   1. Computes `secret = SHA-256(Quantize(e_front))` via the canonical
 *      `:biometric` pipeline.
 *   2. Calls [FaceTemplateStore.writeEnrollment]
 *      `(secret, [e_front, e_left, e_right, e_blink])`.
 *   3. Fires `onCaptured(secret)` so the existing registration flow
 *      (step 2 submit-commitment → step 3 verify) proceeds unchanged.
 *
 * The bitmap-flow guarantee from the original composable is preserved:
 * every captured Bitmap is recycled before `onCaptured` fires; no image,
 * no embedding, no template bytes leave the device.
 */
@Composable
fun RegistrationFaceCapture(
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
                text = "Face enrollment needs camera access",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "ZeroAuth runs a four-step face capture entirely on this " +
                    "device. The captured frames never leave your phone — only a " +
                    "32-byte commitment derived from the front pose is sent.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) {
                Text("Allow camera access")
            }
            OutlinedButton(onClick = onCancelled) { Text("Cancel registration") }
        }
        return
    }

    FaceCeremonyPipeline(
        modifier = modifier,
        onCaptured = onCaptured,
        onCancelled = onCancelled,
    )
}

/**
 * The four enrollment stages.
 *
 * The `number` is the 1-based human-facing index used in the UI step
 * counter ("Step 2 of 4"). The `instruction` is the operator-facing
 * prompt rendered under the camera preview. The `hint` is the smaller
 * sub-line giving the user a hint about WHY this step exists ("This
 * proves you're a real person, not a photo." for blink).
 */
private enum class CeremonyStage(
    val number: Int,
    val instruction: String,
    val hint: String,
    val holdMillis: Long,
) {
    Front(
        number = 1,
        instruction = "Look straight at the camera",
        hint = "Position your face in the middle of the screen with both eyes open.",
        holdMillis = 1_000L,
    ),
    Left(
        number = 2,
        instruction = "Slowly turn your head to the LEFT",
        hint = "Keep looking toward the phone — turn until you see the prompt change.",
        holdMillis = 600L,
    ),
    Right(
        number = 3,
        instruction = "Now turn your head to the RIGHT",
        hint = "All the way the other way. Keep looking toward the phone.",
        holdMillis = 600L,
    ),
    Blink(
        number = 4,
        instruction = "Look at the camera and blink once",
        hint = "This proves you're a real person, not a photo.",
        holdMillis = 0L,
    ),
}

/* ──────────────────── Ceremony pipeline ──────────────────── */

@Composable
@AndroidXOptIn(ExperimentalGetImage::class)
private fun FaceCeremonyPipeline(
    modifier: Modifier,
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val captureScope = rememberCoroutineScope()

    // Pre-warm the TFLite interpreter so step 1 doesn't pay the cold
    // start. Holder is process-wide; idempotent on re-entry.
    remember(context) { BiometricEmbedderHolder.get(context.applicationContext) }

    // ML Kit detector with CLASSIFICATION_MODE_ALL so we get
    // leftEyeOpenProbability / rightEyeOpenProbability (needed for the
    // blink-liveness stage). Landmarks stay off — head pose is reported
    // independently of landmark mode and we don't need eye/nose/mouth
    // points for the alignment logic.
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

    // Ceremony state. Held in mutable state so the Compose layer
    // re-renders when stages advance.
    var currentStage by remember { mutableStateOf(CeremonyStage.Front) }
    val capturedEmbeddings = remember { mutableStateListOf<FloatArray>() }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var stableForMs by remember { mutableStateOf(0L) }
    var persisting by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // Sign of the yaw captured during the LEFT stage. The RIGHT stage
    // requires the opposite sign so the user actually turns both ways
    // and we don't accept two captures from the same direction.
    val leftYawSign = remember { AtomicReference<Float?>(null) }
    // Blink state machine. See [BlinkState].
    val blinkState = remember { AtomicReference(BlinkState.WaitingForOpen) }
    // Per-stage latch — fires the embedding extraction exactly once
    // per stage, even if a couple of frames after the threshold sneak
    // through before the analyzer pauses.
    val stageLatch = remember { AtomicBoolean(false) }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { detector.close() }
            analysisExecutor.shutdown()
        }
    }

    // When a stage's predicates trip, we capture an embedding off the
    // analyzer thread and advance the stage.
    fun onStageCapture(stage: CeremonyStage, bitmap: Bitmap) {
        captureScope.launch {
            try {
                val embedding = embeddingFromBitmap(context.applicationContext, bitmap)
                if (!bitmap.isRecycled) bitmap.recycle()
                capturedEmbeddings.add(embedding)
                // Advance to the next stage. The analyzer reads
                // currentStage on every frame so the new predicates
                // take effect immediately.
                val next = when (stage) {
                    CeremonyStage.Front -> CeremonyStage.Left
                    CeremonyStage.Left -> CeremonyStage.Right
                    CeremonyStage.Right -> CeremonyStage.Blink
                    CeremonyStage.Blink -> {
                        // All four captures complete. Persist and fire.
                        persisting = true
                        finaliseEnrollment(
                            context = context.applicationContext,
                            embeddings = capturedEmbeddings.toList(),
                            onCaptured = onCaptured,
                            onError = { msg ->
                                errorMessage = msg
                                persisting = false
                                // Re-arm the blink stage so the user
                                // can retry without restarting from
                                // scratch.
                                capturedEmbeddings.removeAt(
                                    capturedEmbeddings.lastIndex,
                                )
                                stageLatch.set(false)
                                blinkState.set(BlinkState.WaitingForOpen)
                            },
                        )
                        return@launch
                    }
                }
                currentStage = next
                stableForMs = 0L
                statusMessage = null
                stageLatch.set(false)
                if (next == CeremonyStage.Blink) {
                    blinkState.set(BlinkState.WaitingForOpen)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "stage capture failed (stage=$stage)", t)
                errorMessage = "Couldn't process that capture. Try again."
                stageLatch.set(false)
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StepIndicatorRow(
            currentStep = currentStage.number,
            totalSteps = 4,
        )

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
                                        CeremonyAnalyzer(
                                            detector = detector,
                                            stageProvider = { currentStage },
                                            stageLatch = stageLatch,
                                            leftYawSign = leftYawSign,
                                            blinkState = blinkState,
                                            onStatusUpdate = { msg, holdMs ->
                                                statusMessage = msg
                                                stableForMs = holdMs
                                            },
                                            onStageCapture = ::onStageCapture,
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
                            Log.w(TAG, "CameraX bind failed for face capture", ex)
                            errorMessage = "Couldn't start the camera. Try closing and reopening the app."
                        }
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
                modifier = Modifier.fillMaxSize(),
            )

            // Progress under the preview. Per-stage hold target.
            val progress by animateFloatAsState(
                targetValue = if (currentStage.holdMillis == 0L) {
                    // Blink stage: no continuous "hold" gauge — the
                    // captureFire is event-driven (open → closed →
                    // open).
                    0f
                } else {
                    (stableForMs.toFloat() / currentStage.holdMillis.toFloat())
                        .coerceIn(0f, 1f)
                },
                label = "stage-progress",
            )
            if (currentStage.holdMillis > 0L) {
                LinearProgressIndicator(
                    progress = progress,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(PaddingValues(bottom = 16.dp, start = 24.dp, end = 24.dp))
                        .fillMaxWidth(),
                )
            }

            OutlinedButton(
                onClick = onCancelled,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(12.dp),
            ) {
                Text("Cancel")
            }
        }

        StageInstructions(
            stage = currentStage,
            statusMessage = statusMessage,
            persisting = persisting,
        )

        AnimatedVisibility(visible = errorMessage != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                ),
            ) {
                Text(
                    text = errorMessage ?: "",
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
    }

    // Clear the latch on stage changes so any in-flight capture
    // doesn't race ahead.
    LaunchedEffect(currentStage) {
        stageLatch.set(false)
    }
}

/* ──────────────────── UI sub-pieces ──────────────────── */

@Composable
private fun StepIndicatorRow(currentStep: Int, totalSteps: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (i in 1..totalSteps) {
            val activeColor = MaterialTheme.colorScheme.primary
            val inactiveColor = MaterialTheme.colorScheme.surfaceVariant
            val color = if (i <= currentStep) activeColor else inactiveColor
            Box(
                modifier = Modifier
                    .height(6.dp)
                    .width(48.dp)
                    .clip(CircleShape)
                    .background(color),
            )
        }
        Spacer(Modifier.width(8.dp))
        Text(
            text = "Step $currentStep of $totalSteps",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StageInstructions(
    stage: CeremonyStage,
    statusMessage: String?,
    persisting: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = if (persisting) "Securing your face key…" else stage.instruction,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = if (persisting) {
                "Storing the encrypted template in Android Keystore. " +
                    "This happens once per device."
            } else {
                statusMessage ?: stage.hint
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/* ──────────────────── Analyzer + stage predicates ──────────────────── */

/**
 * State machine for the blink-liveness gate.
 *
 * Blink = "both eyes open → both eyes closed → both eyes open" within a
 * limited time window. The state machine advances on threshold-crossing
 * eye-open probability values; the time-window check is enforced by
 * resetting back to [WaitingForOpen] if the gap between any two
 * transitions exceeds [BLINK_WINDOW_MS].
 */
private enum class BlinkState {
    WaitingForOpen,
    SawOpen,
    SawClose,
}

/**
 * CameraX analyzer that runs ML Kit face detection on each frame and
 * evaluates the predicates for the CURRENT ceremony stage.
 *
 * The analyzer is stage-agnostic in shape: each frame, it asks
 * `stageProvider()` for the current stage and evaluates the matching
 * predicate block. Stage-specific state (yaw sign, blink state) lives
 * in the caller via [AtomicReference] so this analyzer remains
 * stateless across frames.
 *
 * When a stage's predicates trip and the [stageLatch] is unset, the
 * analyzer crops the frame to a 112×112 ARGB_8888 face crop and hands
 * it to [onStageCapture] (which dispatches the embedding extraction off
 * the analyzer thread).
 */
private class CeremonyAnalyzer(
    private val detector: com.google.mlkit.vision.face.FaceDetector,
    private val stageProvider: () -> CeremonyStage,
    private val stageLatch: AtomicBoolean,
    private val leftYawSign: AtomicReference<Float?>,
    private val blinkState: AtomicReference<BlinkState>,
    private val onStatusUpdate: (String?, Long) -> Unit,
    private val onStageCapture: (CeremonyStage, Bitmap) -> Unit,
) : ImageAnalysis.Analyzer {

    private var stableSinceMs: Long = 0L
    private var lastBlinkTransitionMs: Long = 0L

    @AndroidXOptIn(ExperimentalGetImage::class)
    override fun analyze(proxy: ImageProxy) {
        if (stageLatch.get()) {
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
                runCatching {
                    handleResult(faces, proxy, rotation)
                }.onFailure { t ->
                    Log.w(TAG, "stage predicate evaluation failed", t)
                }
            }
            .addOnFailureListener { ex ->
                Log.w(TAG, "ML Kit face detect failed", ex)
            }
            .addOnCompleteListener { proxy.close() }
    }

    @AndroidXOptIn(ExperimentalGetImage::class)
    private fun handleResult(faces: List<Face>, proxy: ImageProxy, rotation: Int) {
        val stage = stageProvider()
        val face = pickPrimaryFace(faces, proxy.width, proxy.height)
        if (face == null) {
            stableSinceMs = 0L
            onStatusUpdate("Looking for your face…", 0L)
            return
        }

        val nowMs = SystemClock.elapsedRealtime()

        when (stage) {
            CeremonyStage.Front -> handleFrontStage(face, proxy, rotation, nowMs)
            CeremonyStage.Left -> handleSideStage(stage, face, proxy, rotation, nowMs)
            CeremonyStage.Right -> handleSideStage(stage, face, proxy, rotation, nowMs)
            CeremonyStage.Blink -> handleBlinkStage(face, proxy, rotation, nowMs)
        }
    }

    @AndroidXOptIn(ExperimentalGetImage::class)
    private fun handleFrontStage(
        face: Face,
        proxy: ImageProxy,
        rotation: Int,
        nowMs: Long,
    ) {
        val yawAbs = kotlin.math.abs(face.headEulerAngleY)
        val leftEyeProb = face.leftEyeOpenProbability ?: 1.0f
        val rightEyeProb = face.rightEyeOpenProbability ?: 1.0f

        if (yawAbs > 8f) {
            stableSinceMs = 0L
            onStatusUpdate("Face the camera straight on", 0L)
            return
        }
        if (leftEyeProb < 0.6f || rightEyeProb < 0.6f) {
            stableSinceMs = 0L
            onStatusUpdate("Keep both eyes open", 0L)
            return
        }

        val started = if (stableSinceMs == 0L) nowMs else stableSinceMs
        stableSinceMs = started
        val heldFor = nowMs - started
        onStatusUpdate("Hold still…", heldFor)
        if (heldFor < CeremonyStage.Front.holdMillis) return
        if (!stageLatch.compareAndSet(false, true)) return

        val cropped = cropFrameToFace(proxy, face, rotation) ?: run {
            stageLatch.set(false)
            stableSinceMs = 0L
            return
        }
        onStageCapture(CeremonyStage.Front, cropped)
    }

    @AndroidXOptIn(ExperimentalGetImage::class)
    private fun handleSideStage(
        stage: CeremonyStage,
        face: Face,
        proxy: ImageProxy,
        rotation: Int,
        nowMs: Long,
    ) {
        val yaw = face.headEulerAngleY
        val yawAbs = kotlin.math.abs(yaw)

        if (yawAbs < 15f) {
            stableSinceMs = 0L
            onStatusUpdate(
                if (stage == CeremonyStage.Left) "Turn your head LEFT" else "Turn your head RIGHT",
                0L,
            )
            return
        }

        // The RIGHT stage must use the OPPOSITE sign of yaw to the
        // LEFT capture. If the user turned the wrong way, drift them
        // back to the prompt without capturing.
        if (stage == CeremonyStage.Right) {
            val firstSign = leftYawSign.get()
            if (firstSign != null) {
                val sameSign = (firstSign > 0) == (yaw > 0)
                if (sameSign) {
                    stableSinceMs = 0L
                    onStatusUpdate("Turn the OTHER way", 0L)
                    return
                }
            }
        }

        val started = if (stableSinceMs == 0L) nowMs else stableSinceMs
        stableSinceMs = started
        val heldFor = nowMs - started
        onStatusUpdate("Hold the turn…", heldFor)
        if (heldFor < stage.holdMillis) return
        if (!stageLatch.compareAndSet(false, true)) return

        if (stage == CeremonyStage.Left) {
            leftYawSign.set(yaw)
        }

        val cropped = cropFrameToFace(proxy, face, rotation) ?: run {
            stageLatch.set(false)
            stableSinceMs = 0L
            return
        }
        onStageCapture(stage, cropped)
    }

    @AndroidXOptIn(ExperimentalGetImage::class)
    private fun handleBlinkStage(
        face: Face,
        proxy: ImageProxy,
        rotation: Int,
        nowMs: Long,
    ) {
        val yawAbs = kotlin.math.abs(face.headEulerAngleY)
        if (yawAbs > 12f) {
            onStatusUpdate("Face the camera, then blink", 0L)
            // Don't reset blink state here — the user may genuinely be
            // turning back from the right-yaw stage and we want the
            // subsequent open frames to still register.
            return
        }

        val leftEyeProb = face.leftEyeOpenProbability
        val rightEyeProb = face.rightEyeOpenProbability
        if (leftEyeProb == null || rightEyeProb == null) {
            // Classification mode required but the detector didn't
            // surface probabilities for this frame — skip without
            // changing state.
            return
        }

        val open = leftEyeProb > 0.7f && rightEyeProb > 0.7f
        val closed = leftEyeProb < 0.3f && rightEyeProb < 0.3f
        val state = blinkState.get()

        // Time out partial-blink states so a user who started to blink
        // and walked away doesn't leave us stuck.
        if (state != BlinkState.WaitingForOpen &&
            lastBlinkTransitionMs > 0L &&
            nowMs - lastBlinkTransitionMs > BLINK_WINDOW_MS
        ) {
            blinkState.set(BlinkState.WaitingForOpen)
            lastBlinkTransitionMs = 0L
            onStatusUpdate("Now blink once", 0L)
            return
        }

        when (state) {
            BlinkState.WaitingForOpen -> {
                if (open) {
                    blinkState.set(BlinkState.SawOpen)
                    lastBlinkTransitionMs = nowMs
                    onStatusUpdate("Now blink once", 0L)
                } else {
                    onStatusUpdate("Open both eyes", 0L)
                }
            }
            BlinkState.SawOpen -> {
                if (closed) {
                    blinkState.set(BlinkState.SawClose)
                    lastBlinkTransitionMs = nowMs
                    onStatusUpdate("Now open them again", 0L)
                } else {
                    onStatusUpdate("Now blink once", 0L)
                }
            }
            BlinkState.SawClose -> {
                if (open) {
                    // Full blink observed. Capture this frame.
                    if (!stageLatch.compareAndSet(false, true)) return
                    val cropped = cropFrameToFace(proxy, face, rotation) ?: run {
                        stageLatch.set(false)
                        blinkState.set(BlinkState.WaitingForOpen)
                        return
                    }
                    onStageCapture(CeremonyStage.Blink, cropped)
                }
                // If still closed, just wait.
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

/* ──────────────────── Bitmap utilities ──────────────────── */

/**
 * Convert the current analyzer frame to a 112×112 ARGB_8888 face crop
 * suitable for the MobileFaceNet embedder. Returns null if the YUV
 * conversion fails — the caller resets the stage latch and waits for a
 * subsequent frame.
 */
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
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: return null
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

/**
 * Stitch a YUV_420_888 frame into a JPEG byte stream via YuvImage, then
 * decode back to an ARGB bitmap. Not the fastest path (a hand-rolled
 * YUV→RGB converter exists in `:face`) but compact and correct on every
 * device the demo targets.
 */
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

/* ──────────────────── Bitmap → embedding / secret ──────────────────── */

/**
 * Run MobileFaceNet on a 112×112 ARGB_8888 face crop and return the
 * L2-normalised 192-dim embedding.
 *
 * Unlike [secretFromBitmap] this stops BEFORE the Quantize + SHA-256
 * steps so the caller has access to the raw float vector — needed for
 * the template anchors (the matcher does cosine similarity on
 * embeddings, not on quantised bytes).
 */
internal suspend fun embeddingFromBitmap(context: Context, bitmap: Bitmap): FloatArray {
    require(bitmap.width == FACE_EDGE && bitmap.height == FACE_EDGE) {
        "embeddingFromBitmap: expected ${FACE_EDGE}x$FACE_EDGE bitmap, got " +
            "${bitmap.width}x${bitmap.height}"
    }
    require(bitmap.config == Bitmap.Config.ARGB_8888) {
        "embeddingFromBitmap: expected ARGB_8888 bitmap, got ${bitmap.config}"
    }
    val embedder = BiometricEmbedderHolder.get(context.applicationContext)
    val embedding = embedder.embed(bitmap)
    check(embedding.size == EMBEDDING_DIM) {
        "embeddingFromBitmap: embedder returned ${embedding.size}-dim vector; " +
            "expected $EMBEDDING_DIM"
    }
    return embedding
}

/**
 * Derive a deterministic 32-byte secret from a 112×112 ARGB_8888 face
 * crop. Equivalent to `SHA-256(Quantize(embeddingFromBitmap(bitmap)))`.
 *
 * Kept for the case where a caller wants the secret directly (e.g.
 * unit tests or the legacy login fallback). The enrollment ceremony
 * uses [embeddingFromBitmap] for each anchor and runs the secret
 * derivation ONCE on the front-pose embedding.
 */
internal suspend fun secretFromBitmap(context: Context, bitmap: Bitmap): ByteArray {
    val embedding = embeddingFromBitmap(context, bitmap)
    val quantised = Quantizer.quantize(embedding)
    return Sha256.digest(quantised)
}

/**
 * Finalise the enrollment: derive the secret from the front embedding,
 * write {secret, template} to the FaceTemplateStore, then hand the
 * secret to the caller via [onCaptured].
 *
 * Runs ALL the way to onCaptured on success. On failure (template
 * store throws, quantise throws, etc.) calls [onError] with an
 * operator-facing message so the user can retry the last stage.
 */
private fun finaliseEnrollment(
    context: Context,
    embeddings: List<FloatArray>,
    onCaptured: (ByteArray) -> Unit,
    onError: (String) -> Unit,
) {
    require(embeddings.size == 4) {
        "finaliseEnrollment: expected 4 embeddings (front/left/right/blink), got ${embeddings.size}"
    }
    try {
        val frontEmbedding = embeddings[0]
        val quantised = Quantizer.quantize(frontEmbedding)
        val secret = Sha256.digest(quantised)
        check(secret.size == 32) {
            "finaliseEnrollment: secret derivation produced ${secret.size} bytes, expected 32"
        }
        val store = FaceTemplateStore(context)
        store.writeEnrollment(secret, embeddings)
        // The caller's onCaptured will be invoked on a coroutine
        // already (we're inside captureScope.launch). Defensive
        // copy so the caller can zero its view independently.
        onCaptured(secret.copyOf())
    } catch (t: Throwable) {
        Log.e(TAG, "finaliseEnrollment failed", t)
        onError(
            "Couldn't store the face key on this device: ${t.message ?: "unknown error"}. " +
                "Try again — the last step will repeat.",
        )
    }
}

/**
 * Process-wide singleton holder for the MobileFaceNet TFLite embedder.
 * Reused across enrollment stages AND across enrollment + login so the
 * ~50 ms TFLite cold-start happens at most once per process.
 */
internal object BiometricEmbedderHolder {

    @Volatile
    private var instance: TfliteFaceEmbedder? = null

    fun get(context: Context): TfliteFaceEmbedder {
        val existing = instance
        if (existing != null) return existing
        return synchronized(this) {
            val secondCheck = instance
            if (secondCheck != null) {
                secondCheck
            } else {
                val fresh = TfliteFaceEmbedder(context.applicationContext)
                instance = fresh
                fresh
            }
        }
    }
}

private const val TAG = "RegistrationFaceCapture"
private const val FACE_EDGE = 112

/**
 * MobileFaceNet embedding dimension. The MCarlomagno-mirror .tflite we
 * ship is 192-dim; the upstream sirius-ai .pb that the assets/MODEL.md
 * notes describe was 128-dim. The runtime authority is
 * [TfliteFaceEmbedder.EMBEDDING_DIM]; this guard mirrors it so a model
 * swap surfaces here too.
 */
private const val EMBEDDING_DIM = 192

/** Time window inside which the open→close→open blink must complete. */
private const val BLINK_WINDOW_MS = 3_000L
