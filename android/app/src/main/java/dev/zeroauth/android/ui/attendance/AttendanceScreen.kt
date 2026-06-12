package dev.zeroauth.android.ui.attendance

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.zeroauth.android.Composition
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.WifiAnchorChecker
import dev.zeroauth.android.ui.face.FaceMatchVerification

/**
 * Attendance check-in / check-out ceremony screen.
 *
 * Drives [AttendanceViewModel.state]: requests fine-location (needed to
 * read the office BSSID), then runs Locating → Face → Proving → Done.
 * The face surface is the same [FaceMatchVerification] the sign-in flow
 * uses, so the captured face never leaves the device — only the Groth16
 * proof + the WiFi-presence reading reach the server.
 *
 * @param type "check_in" or "check_out"
 */
@Composable
fun AttendanceScreen(
    type: String,
    onDone: () -> Unit,
    onCancel: () -> Unit,
    viewModel: AttendanceViewModel = viewModel(
        factory = AttendanceViewModel.Factory(
            mobileProver = Composition.productionMobileProver(LocalContext.current.applicationContext),
            attendanceApi = ApiFactory.createAttendanceApi(),
            wifiChecker = WifiAnchorChecker(LocalContext.current.applicationContext),
            stateStore = AttendanceStateStore(LocalContext.current.applicationContext),
        ),
    ),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val started = remember { mutableStateOf(false) }

    fun startOnce() {
        if (!started.value) {
            started.value = true
            viewModel.start(type)
        }
    }

    val locationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ ->
        // Start regardless of the grant outcome — without the permission
        // the WiFi read returns null and the ceremony lands on OffNetwork,
        // which already explains the situation to the user.
        startOnce()
    }

    LaunchedEffect(Unit) {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) startOnce() else locationLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        when (val s = state) {
            AttendanceUiState.Idle, AttendanceUiState.Locating -> {
                StatusCard(
                    title = if (type == TYPE_CHECK_OUT) "Checking you out…" else "Checking you in…",
                    subtitle = "Confirming you're on the office network.",
                    showSpinner = true,
                )
            }
            is AttendanceUiState.OffNetwork -> {
                OffNetworkCard(
                    requiredLabel = s.requiredLabel,
                    detectedSsid = s.detectedSsid,
                    onRetry = { viewModel.start(type) },
                    onCancel = onCancel,
                )
            }
            is AttendanceUiState.AwaitingFaceCapture -> {
                FaceCaptureLayer(
                    onCaptured = { secret ->
                        viewModel.onFaceCaptureSucceeded(secret)
                        secret.fill(0)
                    },
                    onCancelled = { viewModel.onFaceCaptureCancelled() },
                )
            }
            is AttendanceUiState.Proving -> {
                ProvingCard(progress = s.progress)
            }
            is AttendanceUiState.Done -> {
                DoneCard(type = s.type, occurredAt = s.occurredAt, onDone = onDone)
            }
            is AttendanceUiState.Error -> {
                ErrorCard(code = s.code, message = s.message, onRetry = { viewModel.start(type) }, onCancel = onCancel)
            }
        }
    }
}

// ─── Status / locating ───────────────────────────────────────────────

@Composable
private fun StatusCard(title: String, subtitle: String, showSpinner: Boolean) {
    CenteredColumn {
        if (showSpinner) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 3.dp)
            Spacer(Modifier.height(8.dp))
        }
        Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Text(
            subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

// ─── Off-network ─────────────────────────────────────────────────────

@Composable
private fun OffNetworkCard(
    requiredLabel: String,
    detectedSsid: String?,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
) {
    BottomActionLayout(
        body = {
            Text("You're not at the office", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                buildString {
                    append("Attendance can only be marked on the ")
                    append(requiredLabel)
                    append(" network.")
                    if (!detectedSsid.isNullOrBlank()) {
                        append("\n\nYou're on \"")
                        append(detectedSsid)
                        append("\" right now.")
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        },
        primaryText = "Try again",
        onPrimary = onRetry,
        secondaryText = "Cancel",
        onSecondary = onCancel,
    )
}

// ─── Face capture (reuses the sign-in surface) ───────────────────────

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
            .systemBarsPadding()
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
private fun DoneCard(type: String, occurredAt: String, onDone: () -> Unit) {
    val isOut = type == TYPE_CHECK_OUT
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
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
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
                Text(
                    text = if (isOut) "Checked out" else "Checked in",
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    text = friendlyTime(occurredAt),
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
            Text("Couldn't mark attendance", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Text(
                code,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        },
        primaryText = "Try again",
        onPrimary = onRetry,
        secondaryText = "Cancel",
        onSecondary = onCancel,
    )
}

// ─── Shared layout helpers ───────────────────────────────────────────

@Composable
private fun CenteredColumn(content: @Composable () -> Unit) {
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
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) { content() }
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
            .systemBarsPadding()
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

/** Pull "HH:mm" out of an ISO-8601 timestamp; fall back to the raw value. */
private fun friendlyTime(iso: String): String {
    return runCatching {
        val t = iso.indexOf('T')
        if (t >= 0 && iso.length >= t + 6) iso.substring(t + 1, t + 6) else iso
    }.getOrDefault(iso)
}

private const val TYPE_CHECK_OUT = "check_out"
