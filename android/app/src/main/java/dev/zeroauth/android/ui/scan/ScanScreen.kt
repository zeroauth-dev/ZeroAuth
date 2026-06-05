package dev.zeroauth.android.ui.scan

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
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
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import dev.zeroauth.android.Composition
import dev.zeroauth.android.LocalBiometricGate
import dev.zeroauth.android.LocalKeystoreManager
import dev.zeroauth.android.R
import dev.zeroauth.android.ui.reg.CelebrationCard
import dev.zeroauth.android.ui.reg.LoginStep
import dev.zeroauth.android.ui.reg.ProofProgressCard
import dev.zeroauth.android.ui.face.FaceMatchVerification
import dev.zeroauth.android.ui.reg.StepIndicator
import dev.zeroauth.android.ui.reg.SuccessCard
import dev.zeroauth.android.ui.reg.friendlyErrorFor
import java.util.concurrent.Executors
import timber.log.Timber

/**
 * QR scanner + proof-generation screen — the heart of the W3 wrapper.
 *
 * Visual flow (driven by `ScanViewModel.state`):
 *
 *   Idle / Scanning
 *      └─ permission missing? show empty state
 *      └─ otherwise: camera preview + dashed aiming square + caption
 *           "Point at the QR on your laptop"
 *
 *   ChallengeParsed
 *      Overlay card "Sign in to {tenantLabel} on this device?"
 *      [Approve] (large primary) [Cancel] (ghost)
 *
 *   AwaitingBiometric
 *      Scrim + spinner. The system BiometricPrompt overlays the
 *      activity on top — we just dim our own surface so the OS
 *      sheet has visual focus.
 *
 *   Proving(progress)
 *      Determinate LinearProgressIndicator + "Generating zero-
 *      knowledge proof… ~5 s". The user is asked not to switch
 *      apps (Compose Lifecycle would cancel viewModelScope).
 *
 *   ProofReady(qrText)
 *      Big white card with the phone's QR (320×320 dp + a 4-cell
 *      quiet zone), caption, [Done] CTA. Tapping [Done] routes back
 *      to splash via the nav graph's `onQrDecoded(qrText)` callback.
 *
 *   PermissionMissing
 *      Empty state with an "Open settings" button so the user can
 *      flip the permission from system settings if they tapped
 *      "Don't ask again".
 *
 *   Error(code, message)
 *      Red-accented card with the stable code (operator-readable),
 *      the human message, and a [Try again] button.
 */
@Composable
fun ScanScreen(
    onQrDecoded: (String) -> Unit,
    viewModel: ScanViewModel = viewModel(
        factory = ScanViewModel.Factory(
            // Production Keystore + Biometric — wired by MainActivity into
            // the Compose tree via CompositionLocalProvider. The
            // AndroidKeystoreManager backs encrypted-blob accounts AND
            // (for the W3 demo + autonomous-test flow) falls back to the
            // registration ceremony's `zeroauth_reg_secret` SharedPreferences
            // when no Keystore blob exists for the account. The
            // AndroidBiometricGate gates that unlock with a Class-3
            // BiometricPrompt.
            //
            // Unit tests (ScanViewModelTest) construct ScanViewModel
            // directly with Fake* implementations — this @Composable
            // factory is bypassed in that path.
            keystoreManager = LocalKeystoreManager.current,
            biometricGate   = LocalBiometricGate.current,
            // Production prover: builds an IsolatedMobileProver bound to
            // the `:prover` Service per ADR-0010 so the WebView snarkjs
            // runtime lives in an isolated OS process. The Service
            // binding is lazy — no IPC cost until the first generate().
            // Application Context is mandatory so Service binding
            // survives configuration changes.
            mobileProver    = Composition.productionMobileProver(
                LocalContext.current.applicationContext,
            ),
        ),
    ),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    // Resolve the activity for BiometricPrompt. Compose's LocalContext
    // returns the activity in the common case; we cast defensively.
    val activity = remember(context) {
        var ctx = context
        while (ctx is android.content.ContextWrapper && ctx !is FragmentActivity) {
            ctx = (ctx as android.content.ContextWrapper).baseContext
        }
        ctx as? FragmentActivity
    }

    // ─── Camera permission plumbing ──────────────────────────────

    val hasInitialPermission = remember {
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
    }

    LaunchedEffect(hasInitialPermission) {
        if (hasInitialPermission) {
            viewModel.onPermissionGranted()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) viewModel.onPermissionGranted() else viewModel.onPermissionDenied()
    }

    LaunchedEffect(Unit) {
        if (!hasInitialPermission) {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (val s = state) {
            ScanState.Idle, ScanState.Scanning -> {
                CameraScanLayer(viewModel)
                ScannerOverlay(onPastedCode = viewModel::onQrDetected)
            }
            ScanState.PermissionMissing -> {
                PermissionMissingState(
                    onRequestPermission = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                    onOpenSettings = {
                        val intent = Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", context.packageName, null),
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(intent)
                    },
                )
            }
            is ScanState.ChallengeParsed -> {
                // Keep the camera preview as a backdrop so the visual
                // transition is smooth — the approval card overlays.
                CameraScanLayer(viewModel)
                ChallengeApprovalCard(
                    tenantLabel = s.tenantLabel,
                    onApprove = {
                        // The Compose context is sometimes a non-
                        // FragmentActivity wrapper; the BiometricGate
                        // requires a FragmentActivity. We surface a
                        // friendly error rather than crash.
                        val act = activity
                        if (act == null) {
                            Timber.tag(TAG).e("Host is not a FragmentActivity")
                            viewModel.retry()
                        } else {
                            // The email keys the per-user Keystore alias.
                            // In the W3 demo (and the autonomous-test path)
                            // the device has not been enrolled with a
                            // specific email — the AndroidKeystoreManager's
                            // SharedPreferences fallback triggers on any
                            // email when no blob exists. We pass a stable
                            // demo email so the alias derivation is
                            // deterministic for the (eventual) Keystore
                            // path.
                            viewModel.onBiometricApproved(act, DEMO_EMAIL)
                        }
                    },
                    onCancel = { viewModel.onChallengeCancelled() },
                )
            }
            is ScanState.AwaitingFaceCapture -> {
                // Compose host renders the face-match verification surface.
                // It captures a fresh face, runs the blink-liveness gate,
                // matches against the stored template, and — on accept —
                // releases the stored 32-byte secret. The ViewModel then
                // derives an UnlockedCredential and hands it to the WebView
                // snarkjs prover. The face bitmap, the fresh embedding, and
                // the stored template NEVER leave the composable — see
                // FaceMatchVerification's bitmap-flow contract.
                FaceCaptureLayer(
                    onCaptured = { secret ->
                        viewModel.onFaceCaptureSucceeded(secret)
                        // Zero the local copy — the ViewModel has its own
                        // copy stashed inside FaceSecretCredential.
                        secret.fill(0)
                    },
                    onCancelled = { viewModel.onFaceCaptureCancelled() },
                )
            }
            @Suppress("DEPRECATION")
            ScanState.AwaitingBiometric -> {
                // Legacy biometric-prompt waiting state. The proof flow
                // no longer emits this — kept here so the sealed-interface
                // `when` stays exhaustive without forcing every call site
                // to opt out of the deprecation.
                BiometricWaitingScrim()
            }
            is ScanState.Proving -> {
                ProvingCard(progress = s.progress)
            }
            is ScanState.ProofReady -> {
                ProofReadyCard(
                    qrText = s.qrText,
                    onAuthorize = { viewModel.authorizeOnPhone() },
                    onScanFallback = {
                        // Legacy webcam scan-back path: mark the proof as
                        // "shown to webcam" and feed it to the autonomous
                        // decode hook for desktops that DO have a camera.
                        viewModel.onProofShownToWebcam()
                        onQrDecoded(s.qrText)
                    },
                )
            }
            is ScanState.Authorizing -> {
                AuthorizingCard()
            }
            is ScanState.Authorized -> {
                AuthorizedCard(onDone = { viewModel.onProofShownToWebcam() })
            }
            is ScanState.Error -> {
                ErrorCard(
                    code = s.code,
                    message = s.message,
                    onRetry = { viewModel.retry() },
                )
            }
        }
    }
}

// ─── Camera layer ────────────────────────────────────────────────

@Composable
private fun CameraScanLayer(viewModel: ScanViewModel) {
    val context        = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
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
        modifier = Modifier.fillMaxSize(),
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

                        val analyzer = QrPayloadAnalyzer(
                            scanner = scanner,
                            onPayload = { payload ->
                                previewView.post { viewModel.onQrDetected(payload) }
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
                        Timber.tag(TAG).e(t, "Camera bind failed")
                    }
                },
                ContextCompat.getMainExecutor(ctx),
            )
            previewView
        },
    )
}

// ─── Scanner overlay (aiming square + caption + paste-fallback) ──

@Composable
private fun ScannerOverlay(onPastedCode: (String) -> Unit) {
    var showPaste by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        // Caption + paste fallback live in the bottom strip.
        Column(
            modifier = Modifier
                .fillMaxSize()
                .systemBarsPadding()
                .padding(bottom = 48.dp, start = 24.dp, end = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.Bottom),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text  = stringResource(R.string.scan_caption),
                style = MaterialTheme.typography.titleLarge,
                color = androidx.compose.ui.graphics.Color.White,
                textAlign = TextAlign.Center,
            )
            TextButton(onClick = { showPaste = true }) {
                Text(
                    text  = stringResource(R.string.scan_paste_fallback),
                    color = androidx.compose.ui.graphics.Color.White,
                )
            }
        }
    }

    if (showPaste) {
        PasteCodeDialog(
            onDismiss = { showPaste = false },
            onSubmit = { typed ->
                showPaste = false
                // Route through the same parse path as a real scan
                // so QrParseException codes surface in the UI exactly
                // the same way.
                onPastedCode(typed)
            },
        )
    }
}

@Composable
private fun PasteCodeDialog(
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
) {
    var typed by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Paste the code") },
        text = {
            BasicTextField(
                value = typed,
                onValueChange = { typed = it },
                singleLine = false,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    fontFamily = FontFamily.Monospace,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                    .padding(12.dp),
            )
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(typed.trim()) }) { Text("Submit") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// ─── ChallengeParsed approval card ───────────────────────────────

@Composable
private fun ChallengeApprovalCard(
    tenantLabel: String?,
    onApprove: () -> Unit,
    onCancel: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f)),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .systemBarsPadding()
                .padding(horizontal = 16.dp, vertical = 24.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor   = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    text = if (tenantLabel.isNullOrBlank()) {
                        stringResource(R.string.approve_title_fallback)
                    } else {
                        stringResource(R.string.approve_title, tenantLabel)
                    },
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text  = stringResource(R.string.approve_subtitle, tenantLabel ?: "this desktop"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick  = onApprove,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                ) {
                    Text(
                        text = stringResource(R.string.approve_cta),
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                OutlinedButton(
                    onClick = onCancel,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text(stringResource(R.string.approve_cancel))
                }
            }
        }
    }
}

// ─── AwaitingFaceCapture ─────────────────────────────────────────

/**
 * On-device face-match surface for the login (proof-pairing) flow.
 *
 * Renders [FaceMatchVerification]: a single front-facing capture with
 * a blink-liveness gate, which matches the fresh capture against the
 * enrollment template persisted in [dev.zeroauth.android.sec.FaceTemplateStore]
 * via cosine similarity and — on a successful match — releases the
 * stored 32-byte secret to the caller via [onCaptured].
 *
 * Why match (not re-derive): the legacy login path ran the same
 * `face → MobileFaceNet → Quantize → SHA-256` pipeline the enrollment
 * uses, hoping the bytes would land identically. MobileFaceNet's
 * within-class drift (~1e-2 per component) exceeds the Quantizer's
 * int16 tolerance (~5e-4), so the same face on the same phone
 * produced different secrets across captures, which broke the server-
 * side DID lookup. Matching against a persisted multi-pose template
 * sidesteps the drift entirely — the secret is read from device-
 * encrypted storage, not re-derived from a fresh embedding.
 *
 * ZK property is unchanged: the captured Bitmap, the fresh embedding,
 * and the stored template never cross the composable boundary; only
 * the released secret transits the proof flow on-device, and only the
 * resulting Groth16 proof + DID + commitment cross the wire.
 *
 * Layered as a function so the `ScanScreen` `when` block stays terse
 * and the composable can grow (analytics hooks, retry affordances) in
 * follow-up commits without bloating the state-dispatch branch.
 */
@Composable
private fun FaceCaptureLayer(
    onCaptured: (ByteArray) -> Unit,
    onCancelled: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text  = stringResource(R.string.face_capture_title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
            )
            Text(
                text  = stringResource(R.string.face_capture_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            // Delegate to the face-match pipeline. The match-against-
            // template logic guarantees same-DID-every-time when the
            // user actually matches the enrolled face; mismatched
            // captures surface a "Try again" CTA inside the
            // composable.
            FaceMatchVerification(
                onCaptured = onCaptured,
                onCancelled = onCancelled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// ─── AwaitingBiometric (legacy) ──────────────────────────────────

@Composable
private fun BiometricWaitingScrim() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.7f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 3.dp,
            )
            Text(
                text  = stringResource(R.string.biometric_waiting),
                color = androidx.compose.ui.graphics.Color.White,
                style = MaterialTheme.typography.titleMedium,
            )
        }
    }
}

// ─── Proving ─────────────────────────────────────────────────────

@Composable
private fun ProvingCard(progress: Float) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text(
                text  = stringResource(R.string.proving_title),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
            )
            LinearProgressIndicator(
                progress = { progress.coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text  = stringResource(R.string.proving_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ─── ProofReady ──────────────────────────────────────────────────

@Composable
private fun ProofReadyCard(
    qrText: String,
    onAuthorize: () -> Unit,
    onScanFallback: () -> Unit,
) {
    // The QR is only built if the user expands the fallback — most
    // desktops have no camera, so the phone-push button is the primary
    // path and we avoid rendering a 320 dp bitmap nobody looks at.
    var showQrFallback by remember { mutableStateOf(false) }
    val bitmap = remember(qrText, showQrFallback) {
        if (showQrFallback) generateQrBitmap(qrText) else null
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 24.dp, vertical = 32.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(top = 24.dp),
            ) {
                // A big check-style glyph — the proof is done, this is
                // the "confirm" beat.
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .background(
                            MaterialTheme.colorScheme.primaryContainer,
                            shape = RoundedCornerShape(36.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "🔐",
                        style = MaterialTheme.typography.headlineMedium,
                    )
                }
                Text(
                    text = "Proof ready",
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                )
                Text(
                    text = "Your phone built a zero-knowledge proof of your identity. " +
                        "Tap below to send it to the bank and finish signing in on your laptop.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Button(
                    onClick = onAuthorize,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                ) {
                    Text(
                        text = "Authorize sign-in",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }

                // Collapsible legacy fallback for desktops that DO have a
                // camera. Hidden by default — the phone-push button above
                // is the primary path.
                if (!showQrFallback) {
                    TextButton(onClick = { showQrFallback = true }) {
                        Text(
                            text = "No internet on phone? Show QR for the laptop camera",
                            style = MaterialTheme.typography.labelMedium,
                            textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    Card(
                        modifier = Modifier
                            .size(280.dp)
                            .padding(top = 8.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = CardDefaults.cardColors(
                            containerColor = androidx.compose.ui.graphics.Color.White,
                        ),
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            if (bitmap != null) {
                                Image(
                                    bitmap = bitmap.asImageBitmap(),
                                    contentDescription = "Proof QR — show to the desktop webcam",
                                    modifier = Modifier.fillMaxSize(),
                                )
                            } else {
                                Text(
                                    text = "QR render failed",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = androidx.compose.ui.graphics.Color.Black,
                                )
                            }
                        }
                    }
                    TextButton(onClick = onScanFallback) {
                        Text(
                            text = "I've shown it to the laptop",
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Phone-push: the proof is being POSTed to the bank. Transient spinner
 * between [ScanState.ProofReady] and [ScanState.Authorized].
 */
@Composable
private fun AuthorizingCard() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 3.dp,
            )
            Text(
                text = "Sending proof to the bank…",
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Text(
                text = "Keep this screen open. Your laptop will sign in automatically.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Phone-push success: the server verified the proof and the desktop is
 * (or is about to be) signed in. The phone shows a terminal success
 * affordance with a Done CTA that resets the scanner for a future
 * sign-in.
 */
@Composable
private fun AuthorizedCard(onDone: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp, vertical = 32.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(88.dp)
                        .background(
                            MaterialTheme.colorScheme.primaryContainer,
                            shape = RoundedCornerShape(44.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(text = "✓", style = MaterialTheme.typography.displaySmall)
                }
                Spacer(Modifier.height(20.dp))
                Text(
                    text = "Signed in on your laptop",
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "Your laptop is now inside the bank. Your face never left this phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            Button(
                onClick = onDone,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text(text = "Done", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

/**
 * Render the phone-QR via ZXing's QRCodeWriter. The QR contains ~990
 * bytes of base64url payload on a W2 fixture, which fits comfortably
 * inside a Version-20 QR at error-correction L. We pick L (rather
 * than M / Q / H) because the desktop's webcam is held a few inches
 * away — error correction isn't the bottleneck, density is. Larger
 * QRs scan more reliably when the camera can see every cell.
 *
 * Returns null on render failure; callers fall back to a "QR render
 * failed" text inside the card.
 */
private fun generateQrBitmap(text: String, sizePx: Int = 640): Bitmap? {
    return try {
        val hints = mapOf(
            EncodeHintType.MARGIN to 1,
            EncodeHintType.CHARACTER_SET to "UTF-8",
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.L,
        )
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val pixels = IntArray(sizePx * sizePx)
        for (y in 0 until sizePx) {
            val row = y * sizePx
            for (x in 0 until sizePx) {
                pixels[row + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
            }
        }
        Bitmap.createBitmap(pixels, sizePx, sizePx, Bitmap.Config.ARGB_8888)
    } catch (t: Throwable) {
        Timber.tag(TAG).e(t, "QR encode failed")
        null
    }
}

// ─── PermissionMissing ───────────────────────────────────────────

@Composable
private fun PermissionMissingState(
    onRequestPermission: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
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
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Button(
                onClick = onRequestPermission,
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
            OutlinedButton(
                onClick = onOpenSettings,
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                Text(stringResource(R.string.scan_permission_open_settings))
            }
        }
    }
}

// ─── Error ───────────────────────────────────────────────────────

@Composable
private fun ErrorCard(code: String, message: String, onRetry: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor   = MaterialTheme.colorScheme.onErrorContainer,
            ),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text  = stringResource(R.string.error_title),
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text  = message,
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    text  = code,
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontFamily = FontFamily.Monospace,
                    ),
                    color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.7f),
                )
                Button(
                    onClick = onRetry,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text(stringResource(R.string.error_retry))
                }
            }
        }
    }
}

// ─── Analyzer (extracted from the legacy ScanScreen) ─────────────

/**
 * Pulls QR_CODE values out of each frame, filters for the ADR-0009
 * challenge-QR prefix, and emits the first match. Subsequent matches
 * for the same payload are dropped; the ViewModel also ignores
 * onQrDetected when it isn't in Scanning state, so duplicates are
 * harmless.
 */
private class QrPayloadAnalyzer(
    private val scanner: BarcodeScanner,
    private val onPayload: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    @Volatile
    private var lastEmittedPayload: String? = null

    @androidx.camera.core.ExperimentalGetImage
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image ?: run {
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
                    if (raw.startsWith(CHALLENGE_PREFIX) && raw != lastEmittedPayload) {
                        lastEmittedPayload = raw
                        onPayload(raw)
                        break
                    }
                }
            }
            .addOnFailureListener { t ->
                Timber.tag(TAG).w(t, "ML Kit scan failed")
            }
            .addOnCompleteListener { imageProxy.close() }
    }

    companion object {
        private const val CHALLENGE_PREFIX = "za:pair:1:"
    }
}

private const val TAG: String = "ScanScreen"

/**
 * Stable demo account email passed to the BiometricGate + KeystoreManager
 * for the W3 sign-in flow. The AndroidKeystoreManager keys per-account
 * encrypted blobs by SHA-256(email); the autonomous-test + W3 demo path
 * doesn't have a real Keystore blob and falls back to the registration
 * ceremony's per-install secret, but we still pass a stable email so the
 * eventual Keystore-blob path is deterministic.
 */
private const val DEMO_EMAIL: String = "demo@zeroauth.dev"
