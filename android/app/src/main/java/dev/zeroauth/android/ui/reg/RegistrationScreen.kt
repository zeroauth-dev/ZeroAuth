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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
) {
    val context = LocalContext.current
    val vm: RegistrationViewModel = viewModel(
        factory = androidx.lifecycle.viewmodel.viewModelFactory {
            initializer { RegistrationViewModel(context.applicationContext) }
        },
    )
    val state by vm.state.collectAsState()
    var pasted by rememberSaveable { mutableStateOf("") }

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

        StepBadge(state = state)

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
                Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Done") }
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
