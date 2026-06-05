package dev.zeroauth.android.ui.reg

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory

/**
 * Three-QR registration ceremony Composable (ADR 0023).
 *
 * The screen drives the user through three numbered steps and never leaves
 * them guessing where they are in the flow. Every state transition is
 * accompanied by a visible affordance:
 *
 *   * the persistent [StepIndicator] at the top keeps the three-step
 *     mental model present;
 *   * post-step [SuccessCard]s confirm a step landed (with a "next-action"
 *     hint) and auto-dismiss into the next stage;
 *   * in-flight network calls render their own dedicated copy (e.g.
 *     "Submitting your identity commitment…") instead of a bare spinner;
 *   * the proof-generation phase upgrades to the full-bleed
 *     [ProofProgressCard] because it's the most time-expensive step on
 *     low-end devices;
 *   * terminal completion swaps to a celebratory [CelebrationCard] with a
 *     primary "Continue to dashboard" CTA;
 *   * failures render a [FriendlyErrorCard] with human-readable copy from
 *     [friendlyErrorFor], plus Retry / Start over CTAs — no raw error
 *     codes leak to the user.
 *
 * State machine ↔ ceremony step mapping (rendered by
 * [RegistrationViewModel]):
 *
 *   Idle                  → Step 1 (pair) — ready to scan/paste QR1
 *   Pairing               → Step 1 in-flight
 *   AwaitingFaceCapture   → Step 2 (capture) — inline face-capture composable
 *   AwaitingEnrollScan    → Step 2 — ready to scan/paste QR2
 *   Committing            → Step 2 in-flight
 *   AwaitingVerifyScan    → Step 3 (verify) — ready to scan/paste QR3
 *   Verifying             → Step 3 in-flight (proof generation + submit)
 *   Completed             → Terminal success
 *   Failed                → Terminal error
 */
@Composable
fun RegistrationScreen(
    onDone: () -> Unit,
    onViewIdentity: () -> Unit = {},
) {
    val context = LocalContext.current
    // The session-scoped face-capture secret source. The on-device
    // face-capture composable ([RegistrationFaceCapture]) is rendered
    // between QR1 (pair) and QR2 (commit); the resulting 32-byte secret
    // is stored here and re-used for both the submit-commitment step
    // and the verify-proof step.
    val secret = remember(context.applicationContext) {
        CapturedFaceSecret(context.applicationContext)
    }
    val vm: RegistrationViewModel = viewModel(
        factory = viewModelFactory {
            initializer {
                val appCtx = context.applicationContext
                RegistrationViewModel(
                    context = appCtx,
                    secretSource = secret,
                    proofGenerator = RealRegistrationProver(appCtx, secret),
                )
            }
        },
    )
    val state by vm.state.collectAsState()
    var pasted by rememberSaveable { mutableStateOf("") }
    var scannerOpen by rememberSaveable { mutableStateOf(false) }
    // Tracks whether a transient SuccessCard is currently being shown for
    // a step that landed cleanly. The card is keyed on the underlying
    // state so it shows once per transition; the user observes
    // [continueAfterStep1] / [continueAfterStep2] flips when the card
    // auto-dismisses and the screen reveals the next-step affordance.
    var continueAfterStep1 by remember { mutableStateOf(false) }
    var continueAfterStep2 by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // The terminal "you're signed up" surface owns the full screen
        // — render it standalone so the celebration card centres
        // vertically without the surrounding step indicator competing
        // for attention.
        when (val s = state) {
            is RegistrationViewModel.State.Completed -> {
                RegistrationDoneScreen(
                    onContinue = onDone,
                    onViewIdentity = onViewIdentity,
                )
            }
            else -> {
                RegistrationActiveScreen(
                    state = s,
                    pasted = pasted,
                    onPastedChange = { pasted = it },
                    scannerOpen = scannerOpen,
                    onScannerOpenChange = { scannerOpen = it },
                    continueAfterStep1 = continueAfterStep1,
                    continueAfterStep2 = continueAfterStep2,
                    onContinueAfterStep1Change = { continueAfterStep1 = it },
                    onContinueAfterStep2Change = { continueAfterStep2 = it },
                    onSubmit = {
                        vm.onQrText(pasted.trim())
                        pasted = ""
                    },
                    onScanned = { scanned ->
                        scannerOpen = false
                        vm.onQrText(scanned)
                        pasted = ""
                    },
                    onScanCancelled = { scannerOpen = false },
                    onFaceCaptured = { capturedSecret ->
                        vm.onFaceCaptured(capturedSecret)
                        capturedSecret.fill(0)
                    },
                    onFaceCancelled = { vm.onFaceCaptureCancelled() },
                    onRetry = vm::reset,
                )
            }
        }
    }
}

/**
 * Active ceremony screen — surfaces everything except the terminal
 * Completed celebration. Holds the step indicator, the affordance for
 * the current step (face-capture composable, QR scanner, paste field),
 * the in-flight progress copy, the post-step success card, and the
 * friendly error card.
 *
 * Extracted into its own composable so the [RegistrationScreen] top-level
 * can swap into a full-bleed [RegistrationDoneScreen] without weaving an
 * additional conditional into the layout.
 */
@Composable
private fun RegistrationActiveScreen(
    state: RegistrationViewModel.State,
    pasted: String,
    onPastedChange: (String) -> Unit,
    scannerOpen: Boolean,
    onScannerOpenChange: (Boolean) -> Unit,
    continueAfterStep1: Boolean,
    continueAfterStep2: Boolean,
    onContinueAfterStep1Change: (Boolean) -> Unit,
    onContinueAfterStep2Change: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onScanned: (String) -> Unit,
    onScanCancelled: () -> Unit,
    onFaceCaptured: (ByteArray) -> Unit,
    onFaceCancelled: () -> Unit,
    onRetry: () -> Unit,
) {
    val scroll = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .verticalScroll(scroll)
            .padding(PaddingValues(horizontal = 20.dp, vertical = 24.dp)),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        // Brand header — matches the splash/dashboard "white ZeroAuth"
        // wordmark. We use Text rather than a logo asset so the font
        // weight reads at any density.
        Text(
            text = "ZeroAuth",
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.Bold,
            ),
            color = MaterialTheme.colorScheme.onBackground,
        )

        // Headline + subtitle for the ceremony as a whole. Kept short so
        // the active-step copy below dominates the visual hierarchy.
        Text(
            text = stringRes("reg_screen_title"),
            style = MaterialTheme.typography.headlineSmall.copy(
                fontWeight = FontWeight.SemiBold,
            ),
        )
        Text(
            text = stringRes("reg_screen_subtitle"),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // Persistent step indicator — always visible while the ceremony
        // is in progress. Becomes a 3/3 check-mark row in the Completed
        // state, but we hand that off to RegistrationDoneScreen.
        StepIndicator(
            activeStep = activeStepFor(state),
            errorAtStep = errorStepFor(state),
        )

        Spacer(modifier = Modifier.height(4.dp))

        // The body switches between the face-capture composable, the
        // QR-scan camera, the paste field, in-flight progress cards, and
        // the friendly error card depending on the state.
        AnimatedContent(
            targetState = stateKey(state, scannerOpen),
            transitionSpec = {
                (fadeIn(animationSpec = tween(160)) +
                    expandVertically(animationSpec = tween(160))) togetherWith
                    (fadeOut(animationSpec = tween(120)) +
                        shrinkVertically(animationSpec = tween(120)))
            },
            label = "registration-body",
        ) { _ ->
            RegistrationStateBody(
                state = state,
                pasted = pasted,
                onPastedChange = onPastedChange,
                scannerOpen = scannerOpen,
                onScannerOpenChange = onScannerOpenChange,
                continueAfterStep1 = continueAfterStep1,
                continueAfterStep2 = continueAfterStep2,
                onContinueAfterStep1Change = onContinueAfterStep1Change,
                onContinueAfterStep2Change = onContinueAfterStep2Change,
                onSubmit = onSubmit,
                onScanned = onScanned,
                onScanCancelled = onScanCancelled,
                onFaceCaptured = onFaceCaptured,
                onFaceCancelled = onFaceCancelled,
                onRetry = onRetry,
            )
        }

        Spacer(modifier = Modifier.height(8.dp))
    }
}

/**
 * Renders the body of the active screen for the current
 * [RegistrationViewModel.State]. Split out from
 * [RegistrationActiveScreen] so the AnimatedContent transition spec
 * stays terse.
 */
@Composable
private fun RegistrationStateBody(
    state: RegistrationViewModel.State,
    pasted: String,
    onPastedChange: (String) -> Unit,
    scannerOpen: Boolean,
    onScannerOpenChange: (Boolean) -> Unit,
    continueAfterStep1: Boolean,
    continueAfterStep2: Boolean,
    onContinueAfterStep1Change: (Boolean) -> Unit,
    onContinueAfterStep2Change: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onScanned: (String) -> Unit,
    onScanCancelled: () -> Unit,
    onFaceCaptured: (ByteArray) -> Unit,
    onFaceCancelled: () -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        when (state) {
            is RegistrationViewModel.State.Idle -> {
                StepHeadline(
                    headline = stringRes("reg_step1_idle_headline"),
                    body = stringRes("reg_step1_idle_body"),
                )
                QrEntryBlock(
                    pasted = pasted,
                    onPastedChange = onPastedChange,
                    scannerOpen = scannerOpen,
                    onScannerOpenChange = onScannerOpenChange,
                    onSubmit = onSubmit,
                    onScanned = onScanned,
                    onScanCancelled = onScanCancelled,
                    isInFlight = false,
                    placeholder = "zeroauth://reg?step=pair&session=…&code=ZA-XXXX-XXXX",
                )
            }

            is RegistrationViewModel.State.Pairing -> {
                StepHeadline(
                    headline = stringRes("reg_step1_idle_headline"),
                    body = stringRes("reg_step1_pairing"),
                )
                ProofProgressCard(
                    headline = stringRes("reg_step1_pairing"),
                    body = "Hold on — pairing your phone with the laptop's session.",
                )
            }

            is RegistrationViewModel.State.AwaitingFaceCapture -> {
                // Step 1 just landed. Surface the "device paired" success
                // card briefly, then transition into the face-capture
                // composable. The card auto-dismisses; the local flag
                // continueAfterStep1 ensures the camera surface only
                // mounts once the card has faded out so the user reads
                // "Device paired" before the camera permission prompt
                // appears.
                if (!continueAfterStep1) {
                    SuccessCard(
                        title = stringRes("reg_step1_done_title"),
                        hint = stringRes("reg_step1_done_hint"),
                        autoDismissMillis = 1500L,
                        onDismissed = { onContinueAfterStep1Change(true) },
                    )
                } else {
                    StepHeadline(
                        headline = stringRes("reg_step2_face_headline"),
                        body = stringRes("reg_step2_face_body"),
                    )
                    RegistrationFaceCapture(
                        onCaptured = onFaceCaptured,
                        onCancelled = onFaceCancelled,
                    )
                }
            }

            is RegistrationViewModel.State.AwaitingEnrollScan -> {
                // Face just captured. Show the success card briefly, then
                // reveal the QR-2 affordance. Same staggered pattern as
                // step 1 → step 2 above; the card buys the user a beat
                // to read "Identity captured" before the QR prompt
                // appears.
                if (!continueAfterStep2) {
                    SuccessCard(
                        title = stringRes("reg_step2_face_done_title"),
                        hint = stringRes("reg_step2_face_done_hint"),
                        autoDismissMillis = 1500L,
                        onDismissed = { onContinueAfterStep2Change(true) },
                    )
                } else {
                    StepHeadline(
                        headline = stringRes("reg_step2_scan_headline"),
                        body = stringRes("reg_step2_scan_body"),
                    )
                    QrEntryBlock(
                        pasted = pasted,
                        onPastedChange = onPastedChange,
                        scannerOpen = scannerOpen,
                        onScannerOpenChange = onScannerOpenChange,
                        onSubmit = onSubmit,
                        onScanned = onScanned,
                        onScanCancelled = onScanCancelled,
                        isInFlight = false,
                        placeholder = "zeroauth://reg?step=enroll&session=…&code=ZA-XXXX-XXXX",
                    )
                }
            }

            is RegistrationViewModel.State.Committing -> {
                StepHeadline(
                    headline = stringRes("reg_step2_scan_headline"),
                    body = stringRes("reg_step2_committing"),
                )
                ProofProgressCard(
                    headline = stringRes("reg_step2_committing"),
                    body = "Your face never left this phone — we're just submitting the one-way commitment.",
                )
            }

            is RegistrationViewModel.State.AwaitingVerifyScan -> {
                // Step 2 just landed. The CapturedFaceSecret already has
                // the face secret so step 3 reuses it — no second face
                // capture. We show one final success card + the QR-3
                // prompt.
                SuccessCard(
                    title = stringRes("reg_step2_done_title"),
                    hint = stringRes("reg_step2_done_hint"),
                    autoDismissMillis = null,
                )
                StepHeadline(
                    headline = stringRes("reg_step3_scan_headline"),
                    body = stringRes("reg_step3_scan_body"),
                )
                QrEntryBlock(
                    pasted = pasted,
                    onPastedChange = onPastedChange,
                    scannerOpen = scannerOpen,
                    onScannerOpenChange = onScannerOpenChange,
                    onSubmit = onSubmit,
                    onScanned = onScanned,
                    onScanCancelled = onScanCancelled,
                    isInFlight = false,
                    placeholder = "zeroauth://reg?step=verify&session=…&code=ZA-XXXX-XXXX",
                )
            }

            is RegistrationViewModel.State.Verifying -> {
                StepHeadline(
                    headline = stringRes("reg_step3_proving_headline"),
                    body = stringRes("reg_step3_proving_body"),
                )
                ProofProgressCard(
                    headline = stringRes("reg_step3_proving_headline"),
                    body = stringRes("reg_step3_proving_body"),
                )
            }

            is RegistrationViewModel.State.Completed -> {
                // Handled by the RegistrationDoneScreen branch in
                // [RegistrationScreen]. This case is unreachable from
                // here in practice but kept exhaustive so the `when`
                // remains compile-safe.
                Spacer(modifier = Modifier.height(0.dp))
            }

            is RegistrationViewModel.State.Failed -> {
                FriendlyErrorCard(
                    code = state.code,
                    message = state.message,
                    onRetry = onRetry,
                )
            }
        }
    }
}

/**
 * Two-line header above each step's action area. Renders the step
 * headline (big, bold) and a supporting body line in the muted text
 * tone. Pads vertically so it reads as a distinct unit from the action
 * affordance below.
 */
@Composable
private fun StepHeadline(headline: String, body: String) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = headline,
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.SemiBold,
            ),
            color = MaterialTheme.colorScheme.onBackground,
        )
        Text(
            text = body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * QR entry block — the dual-affordance "scan with camera" / "paste a
 * deeplink" pair shown for every QR-input step (1, 2, 3). The buttons
 * disable while [isInFlight] is true so the user can't double-submit.
 */
@Composable
private fun QrEntryBlock(
    pasted: String,
    onPastedChange: (String) -> Unit,
    scannerOpen: Boolean,
    onScannerOpenChange: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onScanned: (String) -> Unit,
    onScanCancelled: () -> Unit,
    isInFlight: Boolean,
    placeholder: String,
) {
    if (scannerOpen) {
        RegistrationQrCamera(
            onResult = { scanned ->
                onScannerOpenChange(false)
                onScanned(scanned)
            },
            onCancel = {
                onScannerOpenChange(false)
                onScanCancelled()
            },
        )
    } else {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Button(
                onClick = { onScannerOpenChange(true) },
                enabled = !isInFlight,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
            ) {
                Text(stringRes("action_use_camera"))
            }
            // Paste-as-fallback — collapsed into a smaller card so the
            // primary affordance (camera) reads as the recommended path.
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                ),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = stringRes("action_paste_link"),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = pasted,
                        onValueChange = onPastedChange,
                        placeholder = { Text(placeholder, maxLines = 1) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = false,
                    )
                    OutlinedButton(
                        onClick = onSubmit,
                        enabled = pasted.isNotBlank() && !isInFlight,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        Text(stringRes("action_submit_step"))
                    }
                }
            }
        }
    }
}

/**
 * Friendly error surface — translates the [RegistrationViewModel.State.Failed]
 * code into a human sentence (via [friendlyErrorFor]) and offers a
 * primary [stringRes('action_start_over')] CTA. Mirrors the
 * [CelebrationCard] visual rhythm so the failure state still feels like
 * part of the same flow rather than a developer console dump.
 */
@Composable
private fun FriendlyErrorCard(
    code: String,
    message: String,
    onRetry: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Something went wrong",
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
            )
            Text(
                text = friendlyErrorFor(code, message),
                style = MaterialTheme.typography.bodyMedium,
            )
            Button(
                onClick = onRetry,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
            ) {
                Text(stringRes("action_start_over"))
            }
        }
    }
}

/**
 * Terminal "you're signed up" screen. Shown when
 * [RegistrationViewModel.State.Completed] is reached. The
 * [CelebrationCard] provides the visual moment; the two CTAs let the
 * user either dive into the diagnostic identity view or return to the
 * splash.
 */
@Composable
private fun RegistrationDoneScreen(
    onContinue: () -> Unit,
    onViewIdentity: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .padding(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "ZeroAuth",
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.Bold,
            ),
            color = MaterialTheme.colorScheme.onBackground,
        )

        // Completed state collapses the step indicator into the
        // 3-of-3-check-mark variant so the user sees the ceremony's
        // visual progression all the way to the end. The explicit cast
        // disambiguates from the LoginStep? overload (both accept null;
        // the compiler can't tell which here without the type tag).
        StepIndicator(activeStep = null as CeremonyStep?)

        // Pad-the-screen spacer so the celebration card sits in the
        // visual centre rather than crowding the top.
        Spacer(modifier = Modifier.height(8.dp))

        CelebrationCard(
            title = stringRes("reg_done_title"),
            body = stringRes("reg_done_body"),
        )

        Spacer(modifier = Modifier.height(8.dp))

        Button(
            onClick = onContinue,
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
        ) {
            Text(
                text = stringRes("reg_done_continue"),
                textAlign = TextAlign.Center,
            )
        }
        OutlinedButton(
            onClick = onViewIdentity,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp),
        ) {
            Text(
                text = stringRes("reg_done_view_identity"),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/* ────────────────── State → step mapping helpers ────────────────── */

/**
 * Map a [RegistrationViewModel.State] to the [CeremonyStep] the
 * [StepIndicator] should highlight as active. Returns null for the
 * terminal Completed state — the indicator interprets null as "all
 * steps done".
 */
private fun activeStepFor(state: RegistrationViewModel.State): CeremonyStep? = when (state) {
    is RegistrationViewModel.State.Idle,
    is RegistrationViewModel.State.Pairing -> CeremonyStep.PAIR_DEVICE
    is RegistrationViewModel.State.AwaitingFaceCapture,
    is RegistrationViewModel.State.AwaitingEnrollScan,
    is RegistrationViewModel.State.Committing -> CeremonyStep.CAPTURE_FACE
    is RegistrationViewModel.State.AwaitingVerifyScan,
    is RegistrationViewModel.State.Verifying -> CeremonyStep.VERIFY_PROOF
    is RegistrationViewModel.State.Completed -> null
    is RegistrationViewModel.State.Failed -> errorStepFor(state)
}

/**
 * If the state is [RegistrationViewModel.State.Failed], infer which step
 * the failure happened on from the stable error code so the dot in the
 * step indicator can render in error red.
 */
private fun errorStepFor(state: RegistrationViewModel.State): CeremonyStep? {
    val failed = state as? RegistrationViewModel.State.Failed ?: return null
    return when (failed.code) {
        "reg_qr_parse_failed",
        "pair_failed" -> CeremonyStep.PAIR_DEVICE
        "face_capture_cancelled",
        "face_capture_out_of_order",
        "face_capture_failed",
        "enroll_failed" -> CeremonyStep.CAPTURE_FACE
        "verify_failed",
        "prover_failed",
        "credential_derivation_failed" -> CeremonyStep.VERIFY_PROOF
        else -> null
    }
}

/**
 * Stable key for [AnimatedContent] so the transition between distinct
 * states fires once per logical step. Folds the scanner-open flag into
 * the key so opening the camera animates the body the same way other
 * state changes do.
 */
private fun stateKey(state: RegistrationViewModel.State, scannerOpen: Boolean): String = when (state) {
    is RegistrationViewModel.State.Idle -> "idle/$scannerOpen"
    is RegistrationViewModel.State.Pairing -> "pairing"
    is RegistrationViewModel.State.AwaitingFaceCapture -> "face/${state.sessionId}"
    is RegistrationViewModel.State.AwaitingEnrollScan -> "enroll/${state.sessionId}/$scannerOpen"
    is RegistrationViewModel.State.Committing -> "committing"
    is RegistrationViewModel.State.AwaitingVerifyScan -> "verify/${state.sessionId}/$scannerOpen"
    is RegistrationViewModel.State.Verifying -> "verifying"
    is RegistrationViewModel.State.Completed -> "completed"
    is RegistrationViewModel.State.Failed -> "failed/${state.code}"
}

/**
 * Convenience wrapper that resolves a string resource by name. Keeps the
 * Composable readable when many copy strings appear in a row — the
 * standard `stringResource(R.string.xxx)` form is verbose enough that
 * threading it through every line would crowd out the layout structure.
 *
 * Falls back to the raw identifier when the resource is missing so a
 * mistyped key is obvious during development rather than rendering
 * blank.
 */
@Composable
private fun stringRes(name: String): String {
    val context = LocalContext.current
    val pkg = context.packageName
    val id = remember(name, pkg) {
        context.resources.getIdentifier(name, "string", pkg)
    }
    return if (id != 0) {
        androidx.compose.ui.res.stringResource(id = id)
    } else {
        name
    }
}

