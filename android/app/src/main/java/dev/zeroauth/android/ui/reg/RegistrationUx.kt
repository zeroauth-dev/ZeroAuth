package dev.zeroauth.android.ui.reg

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Shared step-by-step UX primitives for the registration and login
 * ceremonies. Every composable here is intentionally state-driven (no
 * internal navigation) so the parent screens stay in charge of when each
 * step transitions; these widgets just paint the current step beautifully
 * and tell the user what to do next.
 *
 * Design intent (matches the dark-ink brand from [ZeroAuthTheme]):
 *
 *   * **StepIndicator** — three dots + a label at the top of the screen so
 *     the user always knows where they are in the ceremony. The active step
 *     is white, completed steps are muted white, future steps are outlined.
 *   * **SuccessCard** — a transient surface variant card that confirms a
 *     step landed cleanly and tells the user what to do next. Auto-hides
 *     after [autoDismissMillis] if a duration is supplied.
 *   * **ProofProgressCard** — full-bleed "we are doing crypto right now"
 *     surface with an indeterminate spinner + reassuring copy. Used when
 *     the WebView prover is generating a Groth16 proof.
 *   * **FriendlyErrorCard** — error surface that translates raw error
 *     codes into human-readable copy + offers Retry / Start over CTAs.
 *   * **CelebrationCard** — terminal success surface for completed
 *     registrations / proof-ready states. Mildly animated (pulsing tick
 *     ring) without being gauche.
 */

/** Phase the screen is currently rendering. Used by [StepIndicator] to
 *  paint the dot states (completed / active / pending). */
enum class CeremonyStep(val ordinal0: Int, val label: String) {
    PAIR_DEVICE(0, "Pair device"),
    CAPTURE_FACE(1, "Capture face"),
    VERIFY_PROOF(2, "Verify proof"),
    ;

    companion object {
        const val TOTAL = 3
    }
}

/** Phase of the login (proof-pairing) ceremony — sibling enum to
 *  [CeremonyStep] so the [GenericStepIndicator] can be re-used for the
 *  scan screen without coupling the registration ceremony's labels to it.
 *
 *  The login flow is the same three-step shape as registration but the
 *  user-facing labels differ ("Scan the laptop QR" vs. "Pair this phone"),
 *  so we keep two enums and one shared indicator instead of overloading
 *  CeremonyStep with conditional labels. */
enum class LoginStep(val ordinal0: Int, val label: String) {
    SCAN_QR(0, "Scan the laptop QR"),
    CAPTURE_FACE(1, "Capture your face"),
    SEND_PROOF(2, "Send the proof"),
    ;

    companion object {
        const val TOTAL = 3
    }
}

/**
 * Persistent three-dot step indicator. The active step's dot is filled in
 * `MaterialTheme.colorScheme.primary` and its label rendered bold; completed
 * steps show a check inside a muted-fill dot; pending steps are outlined.
 *
 * @param activeStep which step the parent screen is rendering right now.
 *                   `null` indicates "ceremony complete" so all three dots
 *                   render as completed.
 * @param errorAtStep optional override — when non-null and equal to the
 *                    active step, the dot is recoloured to the error tint so
 *                    the user immediately sees which step failed.
 */
@Composable
fun StepIndicator(
    activeStep: CeremonyStep?,
    modifier: Modifier = Modifier,
    errorAtStep: CeremonyStep? = null,
) {
    GenericStepIndicator(
        totalSteps = CeremonyStep.TOTAL,
        activeIndex = activeStep?.ordinal0,
        errorAtIndex = errorAtStep?.ordinal0,
        activeLabel = activeStep?.let { active ->
            "Step ${active.ordinal0 + 1} of ${CeremonyStep.TOTAL} — ${active.label}"
        } ?: "All steps complete",
        modifier = modifier,
    )
}

/**
 * Overload of [StepIndicator] for the login (proof-pairing) flow. Same
 * visual + behavioural contract — three dots, a humanised "Step N of M
 * — Label" line — but driven by the [LoginStep] enum so the login flow
 * doesn't have to import or repurpose registration-specific labels.
 */
@Composable
fun StepIndicator(
    activeStep: LoginStep?,
    modifier: Modifier = Modifier,
    errorAtStep: LoginStep? = null,
) {
    GenericStepIndicator(
        totalSteps = LoginStep.TOTAL,
        activeIndex = activeStep?.ordinal0,
        errorAtIndex = errorAtStep?.ordinal0,
        activeLabel = activeStep?.let { active ->
            "Step ${active.ordinal0 + 1} of ${LoginStep.TOTAL} — ${active.label}"
        } ?: "All steps complete",
        modifier = modifier,
    )
}

/**
 * Step-indicator engine reused by both ceremony overloads. Renders N
 * dots with [StepConnector] strips between them and a humanised "Step N
 * of M — Label" line below.
 *
 * Splitting the engine out of the per-enum wrappers makes it cheap to
 * add a fourth step (or a 2-step variant) later — the wrappers only need
 * to provide a label and an active index.
 *
 * @param totalSteps number of dots to render.
 * @param activeIndex zero-based index of the active step. `null` means
 *                    "all steps complete" — every dot renders as
 *                    completed.
 * @param errorAtIndex zero-based index of the step the failure landed
 *                     on; that dot renders as an exclamation in the
 *                     error tint.
 * @param activeLabel human-readable "Step N of M — Label" line.
 */
@Composable
private fun GenericStepIndicator(
    totalSteps: Int,
    activeIndex: Int?,
    errorAtIndex: Int?,
    activeLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (i in 0 until totalSteps) {
                val (state, dotColor) = stepStateForIndex(
                    index = i,
                    activeIndex = activeIndex,
                    errorAtIndex = errorAtIndex,
                )
                StepDot(state = state, color = dotColor)
                if (i < totalSteps - 1) {
                    StepConnector(
                        completed = activeIndex == null ||
                            i < activeIndex,
                    )
                }
            }
        }

        Text(
            text = activeLabel,
            style = MaterialTheme.typography.labelLarge.copy(
                fontWeight = FontWeight.SemiBold,
            ),
            color = if (errorAtIndex != null) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurface
            },
        )
    }
}

/**
 * Resolves the dot state + colour for a single index given the active
 * + error indices. Works on raw `Int` indices so the engine doesn't
 * have to know about the per-flow enum types.
 */
@Composable
private fun stepStateForIndex(
    index: Int,
    activeIndex: Int?,
    errorAtIndex: Int?,
): Pair<StepDotState, Color> {
    val isError = errorAtIndex != null && errorAtIndex == index
    return when {
        isError -> StepDotState.Error to MaterialTheme.colorScheme.error
        activeIndex == null -> StepDotState.Completed to MaterialTheme.colorScheme.primary
        index < activeIndex ->
            StepDotState.Completed to MaterialTheme.colorScheme.primary
        index == activeIndex -> StepDotState.Active to MaterialTheme.colorScheme.primary
        else -> StepDotState.Pending to MaterialTheme.colorScheme.outline
    }
}

/** Visual state of one step dot. */
private enum class StepDotState { Completed, Active, Pending, Error }

@Composable
private fun StepDot(state: StepDotState, color: Color) {
    val shape = CircleShape
    Box(
        modifier = Modifier
            .size(20.dp)
            .then(
                when (state) {
                    StepDotState.Completed -> Modifier.background(color, shape)
                    StepDotState.Active -> Modifier.background(color, shape)
                    StepDotState.Pending -> Modifier
                        .background(Color.Transparent, shape)
                        .border(1.5.dp, color, shape)
                    StepDotState.Error -> Modifier.background(color, shape)
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        when (state) {
            StepDotState.Completed ->
                Text(
                    text = "✓", // check mark
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            StepDotState.Active ->
                // Inner ink dot so the active step reads as a target.
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(MaterialTheme.colorScheme.onPrimary, shape),
                )
            StepDotState.Pending -> Unit
            StepDotState.Error ->
                Text(
                    text = "!",
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.Bold,
                    ),
                    color = MaterialTheme.colorScheme.onError,
                )
        }
    }
}

@Composable
private fun StepConnector(completed: Boolean) {
    // Fixed-width visual connector between dots. We use a constant width
    // (rather than RowScope.weight(1f) for fluid spacing) because the
    // surrounding Row already uses `Arrangement.spacedBy(12.dp)` which
    // distributes the remaining width organically — adding RowScope weight
    // here would over-constrain the layout and clip on small screens.
    Box(
        modifier = Modifier
            .width(32.dp)
            .height(2.dp)
            .background(
                color = if (completed) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.outline
                },
            ),
    )
}

/**
 * Transient success card surfaced after a step completes cleanly. The
 * card carries a check icon + a short success line + a "next-action" hint.
 * If [autoDismissMillis] is supplied the card auto-hides after that delay
 * and the parent observes [onDismissed] to advance the flow.
 *
 * Wired so callers can render the card with a `key()` keyed on a unique
 * transition ID — the AnimatedVisibility's fade+expand handles enter, and
 * the LaunchedEffect handles auto-dismiss.
 *
 * @param title short success headline, e.g. "Device paired".
 * @param hint "what to do next" hint, e.g. "Now scan QR 2 of 3".
 * @param autoDismissMillis null = stay until parent removes the composable;
 *                          otherwise auto-fades after the given delay.
 * @param onDismissed fired exactly once after auto-dismiss elapses.
 */
@Composable
fun SuccessCard(
    title: String,
    hint: String? = null,
    autoDismissMillis: Long? = 1500L,
    onDismissed: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var visible by remember(title, hint) { mutableStateOf(true) }
    LaunchedEffect(title, hint, autoDismissMillis) {
        if (autoDismissMillis != null) {
            delay(autoDismissMillis)
            visible = false
            // Give the fade-out animation a moment before firing the
            // callback so the caller can re-render without a flash of
            // empty space.
            delay(180L)
            onDismissed()
        }
    }
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(animationSpec = tween(220)) +
            expandVertically(animationSpec = tween(220)),
        exit = fadeOut(animationSpec = tween(180)) +
            shrinkVertically(animationSpec = tween(180)),
    ) {
        Card(
            modifier = modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .background(
                            color = MaterialTheme.colorScheme.primary,
                            shape = CircleShape,
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "✓",
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                        ),
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                }
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.SemiBold,
                        ),
                    )
                    if (!hint.isNullOrBlank()) {
                        Text(
                            text = hint,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/**
 * "We are doing zero-knowledge crypto right now" full-bleed card. Used
 * both by the registration ceremony (between face capture and the
 * verify-step POST) and by the login flow (the WebView prover stage).
 *
 * Hosts an indeterminate spinner with reassuring copy. The copy is
 * intentionally explicit about the time cost so the user doesn't bail
 * thinking the app froze; CLAUDE.md frames the proof as "~5 seconds" and
 * we echo that phrasing here.
 */
@Composable
fun ProofProgressCard(
    headline: String,
    body: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            CircularProgressIndicator(
                color = MaterialTheme.colorScheme.primary,
                strokeWidth = 3.dp,
            )
            Text(
                text = headline,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                textAlign = TextAlign.Center,
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Terminal celebration card surfaced when the user has completed all
 * three steps successfully. Mildly animated — a pulsing ring around the
 * check icon adds a moment of delight without crossing the line into
 * confetti-territory which would clash with the monochrome brand.
 */
@Composable
fun CelebrationCard(
    title: String,
    body: String,
    modifier: Modifier = Modifier,
) {
    val infinite = rememberInfiniteTransition(label = "celebration-pulse")
    val pulse by infinite.animateFloat(
        initialValue = 0.92f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1100, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "celebration-scale",
    )
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(96.dp)
                    .scale(pulse)
                    .background(
                        color = MaterialTheme.colorScheme.primary,
                        shape = CircleShape,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "✓",
                    style = MaterialTheme.typography.displaySmall.copy(
                        fontWeight = FontWeight.Bold,
                    ),
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                textAlign = TextAlign.Center,
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Translate a stable machine error code (the [RegistrationViewModel.State.Failed.code]
 * surface that gets emitted from network + parse paths) into a friendly
 * human sentence. Falls back to the raw message if no translation exists.
 *
 * Keeping the mapping local to this file makes it cheap to add a new code
 * during sprint without threading another resource ID through the build.
 */
fun friendlyErrorFor(code: String, fallbackMessage: String): String = when (code) {
    "reg_qr_parse_failed" ->
        "We couldn't read that QR. Refresh the page on your laptop and scan it again."
    "pair_failed" ->
        "We couldn't pair this phone with the laptop. Check your internet and try again."
    "enroll_failed" ->
        "We couldn't save your identity. Please try the second QR again."
    "verify_failed" ->
        "We couldn't verify your proof. Please try the third QR again."
    "face_capture_cancelled" ->
        "Face capture was cancelled. Tap retry to look at the camera again."
    "face_capture_out_of_order" ->
        "Something got out of sync. Tap Start over to begin the signup again."
    "face_capture_failed" ->
        "We couldn't capture your face. Please make sure the camera has a clear view and try again."
    "credential_derivation_failed" ->
        "We couldn't build your proof witness from the captured face. Please try again."
    "qr_encode_failed" ->
        "We generated a proof but couldn't render the QR. Please try again."
    "qr_parse_failed" ->
        "That QR doesn't look like a ZeroAuth login code. Refresh your laptop and try again."
    "prover_failed" ->
        "Proof generation failed on this device. Please try again — it sometimes takes two tries."
    else -> fallbackMessage.ifBlank {
        "Something went wrong (code: $code). Please try again."
    }
}
