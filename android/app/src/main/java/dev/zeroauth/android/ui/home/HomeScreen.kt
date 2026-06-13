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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FabPosition
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
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
import dev.zeroauth.android.sec.PassStore
import dev.zeroauth.android.sec.WifiAnchorChecker

private val OnNetworkGreen = Color(0xFF1D9E75)
private const val TYPE_CHECK_IN = "check_in"
private const val TYPE_CHECK_OUT = "check_out"

/**
 * Home hub — the returning user's UPI-style landing surface. A bottom bar
 * (Home · center Scan FAB · Me) frames a list of the companies the user has
 * joined ("passes"), each with its own check-in/out CTA. The center FAB
 * launches the join-a-company flow. Refreshes on every resume so the in/out
 * state stays current after a check-in.
 */
@Composable
fun HomeScreen(
    onCheckInOut: (type: String, companyId: String) -> Unit,
    onJoin: () -> Unit,
    onViewIdentity: () -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: HomeViewModel = viewModel(
        factory = HomeViewModel.Factory(
            attendanceApi = ApiFactory.createAttendanceApi(),
            wifiChecker = WifiAnchorChecker(LocalContext.current.applicationContext),
            stateStore = AttendanceStateStore(LocalContext.current.applicationContext),
            passStore = PassStore(LocalContext.current.applicationContext),
        ),
    ),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    val locationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ -> viewModel.refresh() }

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

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = { HomeBottomBar(onOpenSettings = onOpenSettings) },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onJoin,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
                shape = CircleShape,
            ) {
                Text("+", style = MaterialTheme.typography.headlineMedium)
            }
        },
        floatingActionButtonPosition = FabPosition.Center,
    ) { padding ->
        Box(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            when (val s = state) {
                HomeUiState.Loading -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary, strokeWidth = 3.dp)
                    }
                }
                HomeUiState.Empty -> EmptyHome(onJoin = onJoin, onViewIdentity = onViewIdentity)
                is HomeUiState.Error -> HomeErrorContent(message = s.message, onRetry = { viewModel.refresh() }, onViewIdentity = onViewIdentity)
                is HomeUiState.Loaded -> PassesContent(
                    passes = s.passes,
                    onCheckInOut = onCheckInOut,
                    onViewIdentity = onViewIdentity,
                )
            }
        }
    }
}

@Composable
private fun HomeBottomBar(onOpenSettings: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 28.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = {}) {
                Text("Home", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            }
            TextButton(onClick = onOpenSettings) {
                Text("Me", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BrandHeader(onViewIdentity: () -> Unit) {
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
}

@Composable
private fun PassesContent(
    passes: List<PassCard>,
    onCheckInOut: (String, String) -> Unit,
    onViewIdentity: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        BrandHeader(onViewIdentity = onViewIdentity)
        Spacer(Modifier.height(20.dp))
        Text("Your passes", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(passes, key = { it.companyId }) { pass ->
                PassCardView(pass = pass, onCheckInOut = onCheckInOut)
            }
        }
    }
}

@Composable
private fun PassCardView(pass: PassCard, onCheckInOut: (String, String) -> Unit) {
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
            Text(pass.companyName, style = MaterialTheme.typography.headlineSmall)
            if (pass.locationLabel.isNotBlank()) {
                Text(
                    pass.locationLabel,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(if (pass.onNetwork) OnNetworkGreen else MaterialTheme.colorScheme.onSurfaceVariant),
                )
                Text(
                    text = when {
                        pass.checkedIn -> "Checked in" + (pass.lastAt?.let { " · ${friendlyTime(it)}" } ?: "")
                        pass.onNetwork -> "You're here"
                        else -> "Not on the office network"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Button(
                onClick = { onCheckInOut(if (pass.checkedIn) TYPE_CHECK_OUT else TYPE_CHECK_IN, pass.companyId) },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text(
                    text = if (pass.checkedIn) "Check out" else "Check in",
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Composable
private fun EmptyHome(onJoin: () -> Unit, onViewIdentity: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        BrandHeader(onViewIdentity = onViewIdentity)
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("No passes yet", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Text(
                "Scan the invite QR your HR team shared to join your company, then check in with your face — on the office network.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Button(
            onClick = onJoin,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            contentPadding = PaddingValues(horizontal = 24.dp),
        ) {
            Text("Scan an invite", style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun HomeErrorContent(message: String, onRetry: () -> Unit, onViewIdentity: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        BrandHeader(onViewIdentity = onViewIdentity)
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
        ) { Text("Try again", style = MaterialTheme.typography.labelLarge) }
    }
}

private fun friendlyTime(iso: String): String {
    return runCatching {
        val t = iso.indexOf('T')
        if (t >= 0 && iso.length >= t + 6) iso.substring(t + 1, t + 6) else iso
    }.getOrDefault(iso)
}
