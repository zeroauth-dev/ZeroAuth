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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.BuildConfig
import dev.zeroauth.android.sec.AttendanceStateStore
import dev.zeroauth.android.sec.PassStore

/**
 * Settings / "Me" surface. Read-only identity link, the list of joined
 * companies (with a local "Leave" — the server membership persists), the
 * app version, and a clear-local-data affordance. No new network calls;
 * passes + last-event are device-local caches (no did-keyed server read).
 */
@Composable
fun SettingsScreen(
    onViewIdentity: () -> Unit,
    onScanSignIn: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val passStore = remember { PassStore(context.applicationContext) }
    val stateStore = remember { AttendanceStateStore(context.applicationContext) }
    var passes by remember { mutableStateOf(passStore.list()) }

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

        // ── Companies ──
        SettingsCard(title = "Your companies") {
            if (passes.isEmpty()) {
                Text(
                    "You haven't joined any companies yet. Scan an invite from the Home screen.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                passes.forEachIndexed { index, pass ->
                    if (index > 0) Spacer(Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(pass.companyName, style = MaterialTheme.typography.titleSmall)
                            Text(
                                pass.employeeId,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = {
                            passStore.remove(pass.companyId)
                            passes = passStore.list()
                        }) {
                            Text("Leave", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            }
        }

        // ── About ──
        SettingsCard(title = "About") {
            SettingsRow(label = "App version", value = BuildConfig.VERSION_NAME)
            Spacer(Modifier.height(8.dp))
            SettingsRow(label = "Identity layer", value = "ZeroAuth · ZK face")
        }

        OutlinedButton(
            onClick = {
                // Local caches only — passes + the in/out hint. The server's
                // memberships + attendance_events stay authoritative.
                passStore.clear()
                stateStore.clearAll()
                passes = emptyList()
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) {
            Text("Clear local data", color = MaterialTheme.colorScheme.error)
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
