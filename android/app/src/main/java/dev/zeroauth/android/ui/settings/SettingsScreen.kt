package dev.zeroauth.android.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.BuildConfig

/**
 * Settings / "Me" surface for the authenticator: the read-only identity
 * link, a web sign-in entry, and app info. No network calls.
 */
@Composable
fun SettingsScreen(
    onViewIdentity: () -> Unit,
    onScanSignIn: () -> Unit,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Settings", style = MaterialTheme.typography.headlineMedium)
            TextButton(onClick = onBack) { Text("Done", style = MaterialTheme.typography.labelLarge) }
        }

        // ── Identity ──
        SettingsCard(title = "Identity") {
            Text(
                "Your face-derived identity stays on this device. Only zero-knowledge proofs ever leave it.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedButton(onClick = onViewIdentity, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Text("View my identity")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onScanSignIn, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Text("Sign in on the web")
            }
        }

        // ── About ──
        SettingsCard(title = "About") {
            SettingsRow(label = "App version", value = BuildConfig.VERSION_NAME)
            Spacer(Modifier.height(8.dp))
            SettingsRow(label = "Identity layer", value = "ZeroAuth · ZK face")
        }
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.onSurface,
            ),
        ) {
            Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) { content() }
        }
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}
