package dev.zeroauth.android.ui.join

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.zeroauth.android.Composition
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.sec.PassStore
import dev.zeroauth.android.ui.face.FaceMatchVerification
import dev.zeroauth.android.ui.reg.RegistrationQrCamera

/**
 * Join-a-company ceremony. Scan the HR invite QR → confirm the company →
 * face check → on-device proof bound to the /init nonce → claim. On success
 * the pass is cached locally and we hand control back to Home.
 *
 * The face surface is the same [FaceMatchVerification] sign-in + attendance
 * use, and the QR scanner is the registration camera — the captured face and
 * the invite never leave the device beyond the Groth16 proof + DID.
 */
@Composable
fun JoinScreen(
    onJoined: (companyId: String) -> Unit,
    onCancel: () -> Unit,
    viewModel: JoinViewModel = viewModel(
        factory = JoinViewModel.Factory(
            mobileProver = Composition.productionMobileProver(LocalContext.current.applicationContext),
            attendanceApi = ApiFactory.createAttendanceApi(),
            passStore = PassStore(LocalContext.current.applicationContext),
        ),
    ),
) {
    val state by viewModel.state.collectAsState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (val s = state) {
            JoinUiState.Scanning -> ScanLayer(
                onQrText = viewModel::onQrText,
                onCancel = onCancel,
            )
            JoinUiState.Resolving -> StatusCard(
                title = "Opening your invite…",
                subtitle = "Setting up a secure join session.",
            )
            is JoinUiState.Confirm -> ConfirmCard(
                companyName = s.companyName,
                locationLabel = s.locationLabel,
                onJoin = viewModel::onConfirm,
                onRescan = viewModel::rescan,
            )
            JoinUiState.AwaitingFaceCapture -> FaceCaptureLayer(
                onCaptured = { secret ->
                    viewModel.onFaceCaptureSucceeded(secret)
                    secret.fill(0)
                },
                onCancelled = viewModel::onFaceCaptureCancelled,
            )
            is JoinUiState.Proving -> ProvingCard(progress = s.progress)
            JoinUiState.Claiming -> StatusCard(
                title = "Joining…",
                subtitle = "Binding your identity to this company.",
            )
            is JoinUiState.Done -> DoneCard(
                companyName = s.companyName,
                fullName = s.fullName,
                employeeId = s.employeeId,
                onDone = { onJoined(s.companyId) },
            )
            is JoinUiState.Error -> ErrorCard(
                code = s.code,
                message = s.message,
                onRetry = viewModel::rescan,
                onCancel = onCancel,
            )
        }
    }
}

// ─── Scanning ────────────────────────────────────────────────────────

@Composable
private fun ScanLayer(onQrText: (String) -> Unit, onCancel: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 24.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Text("Join a company", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(
            "Scan the invite QR your HR team shared.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        RegistrationQrCamera(
            onResult = onQrText,
            onCancel = onCancel,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

// ─── Confirm ─────────────────────────────────────────────────────────

@Composable
private fun ConfirmCard(
    companyName: String,
    locationLabel: String,
    onJoin: () -> Unit,
    onRescan: () -> Unit,
) {
    BottomActionLayout(
        body = {
            Text("Join $companyName?", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                buildString {
                    if (locationLabel.isNotBlank()) append(locationLabel).append("\n\n")
                    append("We'll verify it's you with a quick face check, then add this company to your passes.")
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        },
        primaryText = "Join",
        onPrimary = onJoin,
        secondaryText = "Scan again",
        onSecondary = onRescan,
    )
}

// ─── Face capture ────────────────────────────────────────────────────

@Composable
private fun FaceCaptureLayer(onCaptured: (ByteArray) -> Unit, onCancelled: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Verify it's you", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                "Hold still while we match your face.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            FaceMatchVerification(
                onCaptured = onCaptured,
                onCancelled = onCancelled,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// ─── Proving ─────────────────────────────────────────────────────────

@Composable
private fun ProvingCard(progress: Float) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Text("Proving your identity…", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            LinearProgressIndicator(progress = { progress.coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
            Text(
                "Building a zero-knowledge proof — about 5 seconds. Keep this screen open.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

// ─── Done ────────────────────────────────────────────────────────────

@Composable
private fun DoneCard(companyName: String, fullName: String, employeeId: String, onDone: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 32.dp, vertical = 32.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(48.dp))
                Box(
                    modifier = Modifier
                        .size(88.dp)
                        .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(44.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("✓", style = MaterialTheme.typography.displaySmall)
                }
                Spacer(Modifier.height(20.dp))
                Text("You're in", style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                Spacer(Modifier.height(6.dp))
                Text(
                    text = "$companyName · ${fullName.ifBlank { employeeId }}",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
            Button(
                onClick = onDone,
                modifier = Modifier.fillMaxWidth().height(56.dp),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text("Done", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

// ─── Error ───────────────────────────────────────────────────────────

@Composable
private fun ErrorCard(code: String, message: String, onRetry: () -> Unit, onCancel: () -> Unit) {
    BottomActionLayout(
        body = {
            Text("Couldn't join", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Text(
                code,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        },
        primaryText = "Scan again",
        onPrimary = onRetry,
        secondaryText = "Cancel",
        onSecondary = onCancel,
    )
}

// ─── Shared layout helpers ───────────────────────────────────────────

@Composable
private fun StatusCard(title: String, subtitle: String) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 3.dp)
            Spacer(Modifier.height(8.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun BottomActionLayout(
    body: @Composable () -> Unit,
    primaryText: String,
    onPrimary: () -> Unit,
    secondaryText: String,
    onSecondary: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 32.dp, vertical = 32.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 64.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) { body() }
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Button(
                    onClick = onPrimary,
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                ) { Text(primaryText, style = MaterialTheme.typography.labelLarge) }
                OutlinedButton(
                    onClick = onSecondary,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) { Text(secondaryText) }
            }
        }
    }
}
