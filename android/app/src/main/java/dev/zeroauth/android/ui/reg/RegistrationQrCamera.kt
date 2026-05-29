package dev.zeroauth.android.ui.reg

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * Camera-driven QR scanner specifically for ADR 0023 registration
 * deeplinks (`zeroauth://reg?...`). Lean focused alternative to the
 * full `ui/scan/ScanScreen.kt` pipeline — that one carries the W3
 * proof-pairing state machine and isn't trivially reusable.
 *
 * Three-state UI:
 *   - permission_pending : on first mount, asks for CAMERA
 *   - permission_denied  : shows the user-facing rationale + retry CTA
 *   - scanning           : live PreviewView, ML Kit barcode analyser
 *                          fires onResult on the first valid scan
 *
 * The composable does NOT itself parse the QR — it returns the raw
 * scanned text via [onResult] and lets the caller route through
 * [dev.zeroauth.android.util.RegQrPayload.parse]. This keeps the
 * scanner reusable for any QR format the registration flow grows
 * into.
 *
 * Threading model: the ImageAnalysis runs on a single-thread executor.
 * ML Kit's `barcodeScanner.process(image)` is async — we wait via
 * `addOnSuccessListener`. On the first non-empty result we call
 * `onResult` from the analyser thread, but the call site immediately
 * dispatches into a Compose-side state update on the main thread
 * (via `viewModel` semantics).
 */
@Composable
fun RegistrationQrCamera(
    onResult: (String) -> Unit,
    onCancel: () -> Unit,
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

    LaunchedEffect(Unit) {
        if (!hasPermission) launcher.launch(Manifest.permission.CAMERA)
    }

    if (!hasPermission) {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "Camera access is required to scan the QR codes the platform shows. Grant the permission to continue, or use the paste field instead.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
            Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) {
                Text("Grant camera permission")
            }
            OutlinedButton(onClick = onCancel) { Text("Use paste instead") }
        }
        return
    }

    Box(modifier = modifier.fillMaxWidth().height(360.dp).background(Color.Black)) {
        CameraScanLayer(onResult = onResult)
        // Cancel CTA in the bottom-right corner so the operator can
        // bail back to paste-mode without backing out of the screen.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.Bottom,
            horizontalAlignment = Alignment.End,
        ) {
            OutlinedButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@OptIn(ExperimentalGetImage::class)
@Composable
private fun CameraScanLayer(onResult: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }

    val scanner: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build(),
        )
    }

    DisposableEffect(scanner, executor) {
        onDispose {
            scanner.close()
            executor.shutdown()
        }
    }

    // Capture-once latch — the analyser fires for every frame the QR is
    // visible; we only want to call onResult once and then stop.
    val resultLatched = remember { mutableStateOf(false) }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                implementationMode = PreviewView.ImplementationMode.PERFORMANCE
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            val providerFuture = ProcessCameraProvider.getInstance(ctx)
            providerFuture.addListener({
                val cameraProvider = providerFuture.get()
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
                analysis.setAnalyzer(executor) { proxy ->
                    if (resultLatched.value) { proxy.close(); return@setAnalyzer }
                    analyseFrame(proxy, scanner) { text ->
                        if (!resultLatched.value) {
                            resultLatched.value = true
                            previewView.post { onResult(text) }
                        }
                    }
                }
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )
}

@ExperimentalGetImage
private fun analyseFrame(
    proxy: ImageProxy,
    scanner: BarcodeScanner,
    onText: (String) -> Unit,
) {
    val media = proxy.image
    if (media == null) {
        proxy.close()
        return
    }
    val image = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
    scanner.process(image)
        .addOnSuccessListener { barcodes ->
            // Pick the first QR with a non-empty raw value that looks
            // plausibly like a ZeroAuth registration deeplink. We don't
            // parse it here; the caller is responsible for routing.
            val text = barcodes.firstOrNull()?.rawValue
            if (!text.isNullOrBlank()) onText(text)
        }
        .addOnCompleteListener { proxy.close() }
}
