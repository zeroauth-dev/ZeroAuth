package dev.zeroauth.android.ui.identity

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.ui.reg.BiometricSecretMode
import dev.zeroauth.android.ui.reg.DeriveDidAndCommitment
import dev.zeroauth.android.ui.reg.PerInstallStableSecret
import dev.zeroauth.android.ui.reg.RealBiometricSecretSource
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Investor-facing diagnostic surface. Shows the DID and the Poseidon
 * commitment derived from the on-device biometric secret, so the demo
 * line "the server has the commitment, the phone has the secret,
 * neither side can reconstruct the face" lands as a visible artefact
 * rather than a hand-wave.
 *
 * Read-only and offline. The secret itself is NEVER displayed — only
 * the one-way derivatives (commitment, DID), in line with CLAUDE.md's
 * "never log biometric-derived raw data" rule.
 *
 * Sections rendered top → bottom: DID card (with Copy), commitment
 * card (with Copy), source banner, four-step derivation pipeline,
 * reminder callout, back button.
 *
 * @param onBack invoked when the user taps the "Back to home" button.
 *               Callers wire this to `popBackStack` or `navigate`.
 * @param overrideDid Optional pre-supplied DID; pairs with
 *                    [overrideCommitment]. Both should be supplied or
 *                    both omitted — supplying one and re-deriving the
 *                    other would render an inconsistent pair.
 * @param overrideCommitment Optional pre-supplied commitment.
 * @param sourceLabel Override for the source-banner text. When null
 *                    the screen reads the active mode from a freshly
 *                    constructed [RealBiometricSecretSource] (cheap;
 *                    just consults [BuildConfig.DEMO_USE_STABLE_SECRET]).
 */
@Composable
fun IdentityDetailsScreen(
    onBack: () -> Unit,
    overrideDid: String? = null,
    overrideCommitment: String? = null,
    sourceLabel: String? = null,
) {
    val context = LocalContext.current
    val clipboard = remember(context) {
        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }
    // When the caller didn't supply a label, ask the secret source
    // which pipeline is active for this build and use its display
    // string. The RealBiometricSecretSource constructor is cheap —
    // it only consults BuildConfig.DEMO_USE_STABLE_SECRET — so doing
    // this on every composition is fine and removes a stale-label
    // hazard if a future build flips between modes.
    val resolvedSourceLabel = remember(sourceLabel, context) {
        sourceLabel ?: RealBiometricSecretSource(context.applicationContext)
            .activeMode
            .display
    }

    // Re-derive (did, commitment) from the persisted secret in
    // produceState's coroutine scope. Previews bypass this by passing
    // override values; the runtime path takes ~5 ms for Poseidon.
    val identity: Identity? by produceState<Identity?>(
        initialValue = if (overrideDid != null && overrideCommitment != null) {
            Identity(overrideDid, overrideCommitment)
        } else null,
        overrideDid,
        overrideCommitment,
    ) {
        if (overrideDid != null && overrideCommitment != null) {
            value = Identity(overrideDid, overrideCommitment)
            return@produceState
        }
        val source = PerInstallStableSecret(context.applicationContext)
        val secret = source.secret()
        val (did, commitment) = DeriveDidAndCommitment.from(secret)
        value = Identity(did, commitment)
    }

    val scroll = rememberScrollState()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .verticalScroll(scroll)
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "Your identity, in numbers",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = "This is the cryptographic identity ZeroAuth stores for you. " +
                    "Both values are derived from your face on this device. " +
                    "The face image and the 32-byte secret never leave the phone.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        when (val id = identity) {
            null -> Text(
                text = "Deriving…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            else -> {
                CryptoValueCard(
                    label = "DID",
                    truncated = truncate(id.did, head = 22, tail = 8),
                    explainer = "Decentralised identifier, derived from the commitment. " +
                        "The server uses this as the lookup key.",
                    onCopy = { copyToClipboard(context, clipboard, "DID", id.did) },
                )
                CryptoValueCard(
                    label = "Commitment (Poseidon)",
                    truncated = truncate("0x${id.commitment}", head = 12, tail = 8),
                    explainer = "32-byte BN128 field element. The server stores this " +
                        "but cannot invert it — Poseidon is one-way.",
                    onCopy = {
                        copyToClipboard(context, clipboard, "Commitment", id.commitment)
                    },
                )
            }
        }

        SourceBanner(sourceLabel = resolvedSourceLabel)
        PipelineSection()
        ReminderCard()

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedButton(
            onClick = onBack,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            contentPadding = PaddingValues(horizontal = 24.dp),
        ) {
            Text(
                text = "Back to home",
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}

/** Pair of derived values rendered on the screen. */
private data class Identity(val did: String, val commitment: String)

@Composable
private fun CryptoValueCard(
    label: String,
    truncated: String,
    explainer: String,
    onCopy: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = truncated,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = explainer,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onCopy) {
                    Text(
                        text = "Copy",
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}

@Composable
private fun SourceBanner(sourceLabel: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "Source",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = sourceLabel,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

@Composable
private fun PipelineSection() {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "How the secret is derived on this phone",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        // Dimensions mirror CLAUDE.md "Face-first identity surface".
        PipelineStep(
            stepNumber = 1,
            title = "Camera capture",
            detail = "112×112 face crop from the front-facing camera (CameraX + ML Kit).",
        )
        PipelineStep(
            stepNumber = 2,
            title = "Embedding (128-dim)",
            detail = "MobileFaceNet runs on-device, producing an L2-normalised float vector.",
        )
        PipelineStep(
            stepNumber = 3,
            title = "Quantise (256 bytes)",
            detail = "Float vector becomes a deterministic int16-BE bitstring. " +
                "Small expression jitter is absorbed by rounding.",
        )
        PipelineStep(
            stepNumber = 4,
            title = "SHA-256 (32 bytes)",
            detail = "Hashed to the 32-byte biometric secret. Input buffer is zeroed. " +
                "This secret is the only thing Poseidon ever sees.",
        )
    }
}

@Composable
private fun PipelineStep(
    stepNumber: Int,
    title: String,
    detail: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stepNumber.toString(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onPrimary,
                fontWeight = FontWeight.Bold,
            )
        }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onBackground,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ReminderCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
        ),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "Stored only on this phone",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "This phone is the ONLY place your secret exists. " +
                    "The server never sees it. If you wipe the app, the secret is gone — " +
                    "no remote backup, no recovery from ZeroAuth, no recovery from anyone.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Truncate to head + ellipsis + tail; passthrough for short inputs. */
private fun truncate(value: String, head: Int, tail: Int): String {
    if (value.length <= head + tail + 1) return value
    return value.take(head) + "…" + value.takeLast(tail)
}

/** Put a string on the clipboard as plain text and toast confirmation. */
private fun copyToClipboard(
    context: Context,
    clipboard: ClipboardManager,
    label: String,
    value: String,
) {
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
    Toast.makeText(context, "$label copied to clipboard", Toast.LENGTH_SHORT).show()
}

@Preview(name = "Identity — populated")
@Composable
private fun IdentityDetailsScreenPreview() {
    ZeroAuthTheme {
        IdentityDetailsScreen(
            onBack = {},
            overrideDid = "did:zeroauth:face:a1b2c3d4e5f60718293a4b5c6d7e8f90",
            overrideCommitment = "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
            sourceLabel = BiometricSecretMode.DEMO_STABLE_SECRET.display,
        )
    }
}

@Preview(name = "Identity — real face label")
@Composable
private fun IdentityDetailsScreenRealFacePreview() {
    ZeroAuthTheme {
        IdentityDetailsScreen(
            onBack = {},
            overrideDid = "did:zeroauth:face:abc123abc123abc123abc123",
            overrideCommitment = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
            sourceLabel = BiometricSecretMode.REAL_FACE_CAPTURE.display,
        )
    }
}
