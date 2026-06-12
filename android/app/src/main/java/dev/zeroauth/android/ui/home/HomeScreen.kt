package dev.zeroauth.android.ui.home

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.zeroauth.android.R
import dev.zeroauth.android.net.ApiFactory
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.WifiAnchorChecker

private val OnNetworkGreen = Color(0xFF1D9E75)
private const val TYPE_CHECK_IN = "check_in"
private const val TYPE_CHECK_OUT = "check_out"

/**
 * Home hub — the one-stop surface a returning user lands on. Shows the
 * auto-detected company with a Check in/out CTA, plus a Scan action for
 * "continue with ZeroAuth" sign-in. Refreshes on every resume (including
 * nav-back from a check-in) so the in/out state stays current.
 */
@Composable
fun HomeScreen(
    onCheckInOut: (String) -> Unit,
    onScan: () -> Unit,
    onViewIdentity: () -> Unit,
    viewModel: HomeViewModel = viewModel(
        factory = HomeViewModel.Factory(
            attendanceApi = ApiFactory.createAttendanceApi(),
            wifiChecker = WifiAnchorChecker(LocalContext.current.applicationContext),
            stateStore = AttendanceStateStore(LocalContext.current.applicationContext),
        ),
    ),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val locationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ -> viewModel.refresh() }

    // Refresh on every resume — this destination's NavBackStackEntry
    // becomes RESUMED again on nav-back from the attendance ceremony, so
    // the in/out state updates without a manual pull.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                val granted = ContextCompat.checkSelfPermission(
                    context, Manifest.permission.ACCESS_FINE_LOCATION,
                ) == PackageManager.PERMISSION_GRANTED
                if (granted) viewModel.refresh() else locationLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 24.dp, vertical = 24.dp),
    ) {
        when (val s = state) {
            HomeUiState.Loading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 3.dp)
                }
            }
            is HomeUiState.Error -> {
                HomeErrorContent(message = s.message, onRetry = { viewModel.refresh() }, onViewIdentity = onViewIdentity)
            }
            is HomeUiState.Loaded -> {
                HomeContent(
                    s = s,
                    onCheckInOut = onCheckInOut,
                    onScan = onScan,
                    onViewIdentity = onViewIdentity,
                )
            }
        }
    }
}

@Composable
private fun HomeContent(
    s: HomeUiState.Loaded,
    onCheckInOut: (String) -> Unit,
    onScan: () -> Unit,
    onViewIdentity: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        // Header — brand mark + identity affordance.
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(
                painter = painterResource(R.drawable.zeroauth_mark),
                contentDescription = stringResource(R.string.brand_wordmark),
                modifier = Modifier.size(36.dp),
            )
            TextButton(onClick = onViewIdentity) {
                Text("My identity", style = MaterialTheme.typography.labelLarge)
            }
        }

        // Auto-detected company card with the primary check-in/out CTA.
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(s.companyName, style = MaterialTheme.typography.headlineSmall)
                Text(
                    s.locationLabel,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (s.onNetwork) OnNetworkGreen else MaterialTheme.colorScheme.onSurfaceVariant),
                    )
                    Text(
                        text = when {
                            s.checkedIn -> "Checked in" + (s.lastAt?.let { " · ${friendlyTime(it)}" } ?: "")
                            s.onNetwork -> "You're here"
                            else -> "Not on the office network"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(
                    onClick = { onCheckInOut(if (s.checkedIn) TYPE_CHECK_OUT else TYPE_CHECK_IN) },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    contentPadding = PaddingValues(horizontal = 24.dp),
                ) {
                    Text(
                        text = if (s.checkedIn) "Check out" else "Check in",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                if (!s.onNetwork && !s.checkedIn) {
                    Text(
                        "Move closer to the office WiFi to check in.",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        // Secondary actions — the "scan" hub action.
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(
                onClick = onScan,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                Text("Scan to sign in", style = MaterialTheme.typography.labelLarge)
            }
            Text(
                "One identity — attendance, and sign-in everywhere.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun HomeErrorContent(message: String, onRetry: () -> Unit, onViewIdentity: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onViewIdentity) { Text("My identity", style = MaterialTheme.typography.labelLarge) }
        }
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Can't reach attendance", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        Button(
            onClick = onRetry,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ),
        ) { Text("Try again", style = MaterialTheme.typography.labelLarge) }
    }
}

private fun friendlyTime(iso: String): String {
    return runCatching {
        val t = iso.indexOf('T')
        if (t >= 0 && iso.length >= t + 6) iso.substring(t + 1, t + 6) else iso
    }.getOrDefault(iso)
}
