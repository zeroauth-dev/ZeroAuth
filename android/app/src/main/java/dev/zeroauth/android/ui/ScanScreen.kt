package dev.zeroauth.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import dev.zeroauth.android.R
import java.util.concurrent.Executors
import timber.log.Timber

// Timber is wired in every variant (see app/build.gradle.kts). In release
// it's effectively a no-op because no tree is planted in ZeroAuthApp.

/**
 * QR scanner screen.
 *
 * Wires:
 *   - Runtime CAMERA permission (empty-state CTA when denied)
 *   - CameraX Preview + ImageAnalysis use cases bound to the lifecycle
 *   - ML Kit barcode scanner (QR_CODE only)
 *   - Aiming-frame overlay (Canvas dashed square)
 *
 * The analyzer dedupes by raw payload — ML Kit can fire the same QR
 * 10+ times/second while held steady; we want to navigate on the first
 * valid hit and stop. A `@Volatile` flag inside the analyzer guards
 * against a race between the analyzer thread and the main-thread
 * navigation callback.
 *
 * Payload validation is intentionally minimal here. We check the prefix
 * "za:pair:1:" (ADR-0009's challenge-QR schema) and pass the rest of
 * the string to Done. Full parsing (sessionId + nonceHex + tenantDomain
 * + integrityTag split + integrity-tag verification) lands in the
 * prover-glue sprint task because that's the step that immediately
 * precedes the proof generation.
 */
@Composable
fun ScanScreen(
    onQrDecoded: (String) -> Unit,
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        if (hasCameraPermission) {
            CameraScannerCore(
                onQrDecoded = onQrDecoded,
                modifier    = Modifier.fillMaxSize(),
            )
            ScannerOverlay(modifier = Modifier.fillMaxSize())
        } else {
            CameraPermissionEmptyState(
                onAllowClicked = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                modifier       = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Bottom caption + dashed aiming frame. */
@Composable
private fun ScannerOverlay(modifier: Modifier = Modifier) {
    Box(modifier = modifier) {
        // Dashed aiming square — 70 % of screen width, centred.
        Canvas(modifier = Modifier.fillMaxSize()) {
            val side = size.minDimension * 0.7f
            val left = (size.width - side) / 2f
            val top  = (size.height - side) / 2f - size.height * 0.05f
            drawRect(
                color = ComposeColor.White.copy(alpha = 0.85f),
                topLeft = Offset(left, top),
                size = ComposeSize(side, side),
                style = Stroke(
                    width = 3f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(20f, 14f), 0f),
                ),
            )
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(bottom = 64.dp, start = 32.dp, end = 32.dp),
            contentAlignment = Alignment.BottomCenter,
        ) {
            Text(
                text  = stringResource(R.string.scan_caption),
                style = MaterialTheme.typography.titleLarge,
                color = ComposeColor.White,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** Friendly "Allow camera" empty state shown when the runtime perm is denied. */
@Composable
private fun CameraPermissionEmptyState(
    onAllowClicked: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .systemBarsPadding()
            .padding(horizontal = 32.dp, vertical = 48.dp),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = Alignment.Start,
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(top = 32.dp),
        ) {
            Text(
                text  = stringResource(R.string.scan_permission_title),
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text  = stringResource(R.string.scan_permission_body),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            onClick = onAllowClicked,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor   = MaterialTheme.colorScheme.onPrimary,
            ),
            contentPadding = PaddingValues(horizontal = 24.dp),
        ) {
            Text(
                text  = stringResource(R.string.scan_permission_cta),
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

/**
 * The actual CameraX + ML Kit plumbing. Kept as a private composable so
 * ScanScreen above stays a thin permissions-vs-scanner switch.
 */
@Composable
private fun CameraScannerCore(
    onQrDecoded: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context        = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    @Suppress("unused") // Held for parity with the upcoming proof-emit path
    val coroutineScope = rememberCoroutineScope()

    // One executor for ML Kit + ImageAnalysis. We shut it down in
    // DisposableEffect's onDispose so we don't leak threads on
    // configuration change. Single-thread is fine — ML Kit's scanner
    // is internally async and we serialize on the analyzer callback.
    val analyzerExecutor = remember { Executors.newSingleThreadExecutor() }

    val scanner: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
        )
    }

    DisposableEffect(scanner, analyzerExecutor) {
        onDispose {
            scanner.close()
            analyzerExecutor.shutdown()
        }
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                implementationMode = PreviewView.ImplementationMode.PERFORMANCE
                scaleType          = PreviewView.ScaleType.FILL_CENTER
            }

            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener(
                {
                    try {
                        val cameraProvider = providerFuture.get()

                        val preview = Preview.Builder().build().also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }

                        val resolutionSelector = ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    Size(1280, 720),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                                )
                            )
                            .build()

                        val analysis = ImageAnalysis.Builder()
                            .setResolutionSelector(resolutionSelector)
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()

                        // Single-shot analyzer: once a valid payload is
                        // emitted we ignore subsequent frames so we
                        // don't navigate twice.
                        val analyzer = QrPayloadAnalyzer(
                            scanner = scanner,
                            onValidPayload = { payload ->
                                // Hop to the main thread for the nav
                                // callback — Compose state writes belong
                                // there and the analyzer runs on the
                                // single-thread executor.
                                previewView.post { onQrDecoded(payload) }
                            },
                        )
                        analysis.setAnalyzer(analyzerExecutor, analyzer)

                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            analysis,
                        )
                    } catch (t: Throwable) {
                        Timber.tag("ScanScreen").e(t, "Camera bind failed")
                    }
                },
                ContextCompat.getMainExecutor(ctx),
            )

            previewView
        },
    )
}

/**
 * Analyzer that pulls QR_CODE values out of each frame, filters for the
 * ADR-0009 challenge-QR prefix, and emits the first match exactly once.
 */
private class QrPayloadAnalyzer(
    private val scanner: BarcodeScanner,
    private val onValidPayload: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    @Volatile
    private var emitted = false

    @androidx.camera.core.ExperimentalGetImage
    override fun analyze(imageProxy: ImageProxy) {
        if (emitted) {
            imageProxy.close()
            return
        }
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val input = InputImage.fromMediaImage(
            mediaImage,
            imageProxy.imageInfo.rotationDegrees,
        )
        scanner.process(input)
            .addOnSuccessListener { barcodes ->
                for (barcode in barcodes) {
                    val raw = barcode.rawValue ?: continue
                    if (raw.startsWith(CHALLENGE_PREFIX)) {
                        // First-write-wins so a concurrent late callback
                        // can't trigger a second navigation.
                        if (!emitted) {
                            emitted = true
                            onValidPayload(raw)
                        }
                        break
                    }
                }
            }
            .addOnFailureListener { t ->
                Timber.tag("ScanScreen").w(t, "ML Kit scan failed")
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }

    companion object {
        private const val CHALLENGE_PREFIX = "za:pair:1:"
    }
}
