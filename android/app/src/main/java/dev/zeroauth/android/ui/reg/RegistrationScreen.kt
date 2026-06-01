package dev.zeroauth.android.ui.reg

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory

/**
 * Minimal screen that drives the three-QR registration ceremony
 * (ADR 0023). Paste-deeplink only for V1 — the camera scan path
 * mirrors `ui/scan/ScanScreen.kt`'s ML Kit + CameraX pipeline and
 * gets wired in alongside the real biometric capture in Phase 1
 * Sprint 4.
 *
 * The state shown matches what the operator sees on the dashboard
 * demo at /demo/registration, except this is from the phone's POV:
 *
 *   Idle                  → ready to scan/paste QR1
 *   Pairing               → POST /v1/registrations/pair-device in flight
 *   AwaitingEnrollScan    → ready to scan/paste QR2
 *   Committing            → POST /v1/registrations/submit-commitment
 *   AwaitingVerifyScan    → ready to scan/paste QR3
 *   Verifying             → POST /v1/registrations/complete
 *   Completed / Failed    → terminal
 */
@Composable
fun RegistrationScreen(
    onDone: () -> Unit,
    onViewIdentity: () -> Unit = {},
) {
    val context = LocalContext.current
    // `RealBiometricSecretSource` is the production wiring; it picks
    // [PerInstallStableSecret] in debug builds
    // (BuildConfig.DEMO_USE_STABLE_SECRET=true) and the real
    // FaceEmbedder pipeline in release builds. The ViewModel sees a
    // single BiometricSecretSource and never branches on the mode
    // itself — the dispatch is internal to RealBiometricSecretSource.
    // We construct it once with `remember` so the same instance is
    // re-used across recompositions and its `activeMode` can drive
    // the operator-facing banner below.
    val secret = remember(context.applicationContext) {
        RealBiometricSecretSource(context.applicationContext)
    }
    val vm: RegistrationViewModel = viewModel(
        factory = viewModelFactory {
            initializer {
                val appCtx = context.applicationContext
                RegistrationViewModel(
                    context = appCtx,
                    secretSource = secret,
                    // Real Groth16 prover wired via IsolatedMobileProver
                    // (ADR 0010 sandboxed :prover process). Replaces the
                    // StubProofGenerator default; the demo-grade stub
                    // can still be passed in tests.
                    proofGenerator = RealRegistrationProver(appCtx, secret),
                )
            }
        },
    )
    val state by vm.state.collectAsState()
    var pasted by rememberSaveable { mutableStateOf("") }
    var scannerOpen by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .systemBarsPadding()
            .padding(PaddingValues(20.dp)),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            text = "Three-QR signup ceremony",
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            text = "Scan each QR on the platform's signup page. The biometric stays on this phone; only the Poseidon commitment (step 2) and Groth16 proof (step 3) touch the server.",
            style = MaterialTheme.typography.bodyMedium,
        )

        // Operator-facing banner indicating which biometric-secret
        // pipeline this build is running. Investors + pilot operators
        // see at a glance whether the demo is on the per-install stable
        // secret (emulator-friendly) or the real CameraX + MobileFaceNet
        // pipeline. The banner is intentionally always visible — hiding
        // it in release builds would muddy the "what am I looking at"
        // story during a side-by-side comparison.
        BiometricSecretModeBanner(mode = secret.activeMode)

        StepBadge(state = state)

        if (scannerOpen) {
            RegistrationQrCamera(
                onResult = { scanned ->
                    scannerOpen = false
                    vm.onQrText(scanned)
                    pasted = ""
                },
                onCancel = { scannerOpen = false },
            )
        } else {
            OutlinedTextField(
                value = pasted,
                onValueChange = { pasted = it },
                label = { Text("Scanned QR (paste deeplink)") },
                placeholder = { Text("zeroauth://reg?step=…&session=…&code=ZA-XXXX-XXXX") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = false,
            )

            Button(
                onClick = {
                    vm.onQrText(pasted.trim())
                    pasted = ""
                },
                enabled = pasted.isNotBlank() && !state.isInFlight(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(text = "Submit step")
            }

            OutlinedButton(
                onClick = { scannerOpen = true },
                enabled = !state.isInFlight(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Scan with camera")
            }
        }

        Spacer(Modifier.height(8.dp))

        when (val s = state) {
            is RegistrationViewModel.State.Idle -> Text(
                text = "Waiting for QR1 (pair). The platform shows this first.",
                style = MaterialTheme.typography.bodySmall,
            )

            is RegistrationViewModel.State.Pairing -> InFlight("Pairing device…")
            is RegistrationViewModel.State.Committing -> InFlight("Submitting commitment…")
            is RegistrationViewModel.State.Verifying -> InFlight("Verifying proof…")

            is RegistrationViewModel.State.AwaitingEnrollScan -> Text(
                text = "Paired ✓ (session ${s.sessionId.take(8)}). Now scan QR2 (enroll).",
                style = MaterialTheme.typography.bodySmall,
            )
            is RegistrationViewModel.State.AwaitingVerifyScan -> Text(
                text = "Commitment submitted ✓ (session ${s.sessionId.take(8)}). Now scan QR3 (verify).",
                style = MaterialTheme.typography.bodySmall,
            )

            is RegistrationViewModel.State.Completed -> {
                Text(
                    text = "Account created ✓",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = "Session: ${s.sessionId}",
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                // Primary post-registration CTA: take the user to the
                // diagnostic identity view so they can see the (did,
                // commitment) pair their session just produced. This
                // is the load-bearing demo moment — the investor wants
                // to see the artefacts immediately after they exist,
                // not after a Splash round-trip.
                Button(
                    onClick = onViewIdentity,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("View my identity")
                }
                // Secondary: continue to splash. Outlined so it reads
                // as "I'm done with this screen" rather than the
                // primary action.
                OutlinedButton(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Done")
                }
            }

            is RegistrationViewModel.State.Failed -> {
                Text(
                    text = "Failed: ${s.code}",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error,
                )
                Text(
                    text = s.message,
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(onClick = vm::reset, modifier = Modifier.fillMaxWidth()) { Text("Start over") }
            }
        }
    }
}

/**
 * Banner that names the active [BiometricSecretMode] for the current
 * build. Surfaced to the operator + investor so they know whether the
 * `secret()` call is going to run the real face-capture pipeline or
 * fall back to the per-install stable secret.
 *
 * The Card colour reflects intent — the demo mode is rendered in the
 * surface-variant tone so it reads as a "this is a shortcut" rather
 * than an error, and the real-face mode in the primary tone so it
 * reads as the production posture.
 */
@Composable
private fun BiometricSecretModeBanner(mode: BiometricSecretMode) {
    val tone = when (mode) {
        BiometricSecretMode.DEMO_STABLE_SECRET ->
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        BiometricSecretMode.REAL_FACE_CAPTURE ->
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
            )
        BiometricSecretMode.UNKNOWN ->
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
            )
    }
    Card(
        colors = tone,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = mode.display,
                style = MaterialTheme.typography.titleSmall,
            )
            Text(
                text = mode.operatorNote,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun StepBadge(state: RegistrationViewModel.State) {
    val label = when (state) {
        is RegistrationViewModel.State.Idle -> "Step 1 of 3 — pair device"
        is RegistrationViewModel.State.Pairing -> "Step 1 of 3 — pairing…"
        is RegistrationViewModel.State.AwaitingEnrollScan -> "Step 2 of 3 — submit commitment"
        is RegistrationViewModel.State.Committing -> "Step 2 of 3 — committing…"
        is RegistrationViewModel.State.AwaitingVerifyScan -> "Step 3 of 3 — verify"
        is RegistrationViewModel.State.Verifying -> "Step 3 of 3 — verifying…"
        is RegistrationViewModel.State.Completed -> "Done"
        is RegistrationViewModel.State.Failed -> "Error"
    }
    Text(text = label, style = MaterialTheme.typography.labelLarge)
}

@Composable
private fun InFlight(label: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        CircularProgressIndicator()
        Text(text = label, style = MaterialTheme.typography.bodySmall)
    }
}

private fun RegistrationViewModel.State.isInFlight(): Boolean = when (this) {
    is RegistrationViewModel.State.Pairing,
    is RegistrationViewModel.State.Committing,
    is RegistrationViewModel.State.Verifying -> true
    else -> false
}
