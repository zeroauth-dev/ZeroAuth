package dev.zeroauth.android.ui

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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.R
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Done screen — confirms the QR decoded cleanly and shows the parsed
 * session id + nonce preview. Final step of the W3 scaffold flow.
 *
 * The placeholder card stands in for the WebView prover panel that
 * lands in the next iteration. Tapping Done routes back to Splash and
 * clears the back stack.
 */
@Composable
fun DoneScreen(
    payload: String?,
    onDone: () -> Unit,
) {
    val parsed = remember(payload) { payload?.let { parseChallengeQr(it) } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .systemBarsPadding()
            .padding(horizontal = 32.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(vertical = 48.dp),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.Start,
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.padding(top = 32.dp),
            ) {
                Text(
                    text  = stringResource(R.string.done_title),
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text  = stringResource(R.string.done_subtitle),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                // Session id + nonce preview. Helpful for the operator to
                // visually confirm the decode worked before the prover
                // wiring lands. Falls back to a "no payload" line if
                // navigation forgot to attach the argument.
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 16.dp),
                ) {
                    LabeledMono(
                        label = stringResource(R.string.done_session_label),
                        value = parsed?.sessionId ?: "—",
                    )
                    LabeledMono(
                        label = stringResource(R.string.done_nonce_label),
                        value = parsed?.let { formatNoncePreview(it.nonceHex) } ?: "—",
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // The grey placeholder card. Replaces with the prover
                // WebView in the next iteration.
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor   = MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                    ) {
                        Text(
                            text  = stringResource(R.string.done_proof_placeholder),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Button(
                onClick  = onDone,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor   = MaterialTheme.colorScheme.onPrimary,
                ),
                contentPadding = PaddingValues(horizontal = 24.dp),
            ) {
                Text(
                    text  = stringResource(R.string.done_cta),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/** Two-line label + monospaced value cell used for the session / nonce preview. */
@Composable
private fun LabeledMono(
    label: String,
    value: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text  = label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text       = value,
            style      = MaterialTheme.typography.bodyMedium,
            color      = MaterialTheme.colorScheme.onBackground,
            fontFamily = FontFamily.Monospace,
        )
    }
}

/**
 * Parsed view of the ADR-0009 challenge QR. Intentionally light — the
 * full validation (integrityTag check, expiry math, tenantDomain
 * resolution) lives next to the proof submission code, not here.
 */
private data class ChallengeQr(
    val sessionId: String,
    val nonceHex: String,
    val tenantDomain: String,
    val integrityTag: String,
)

/** Returns null on any structural problem so callers can render a "—". */
private fun parseChallengeQr(raw: String): ChallengeQr? {
    // Expected: za:pair:1:<sessionId>:<nonceHex>:<tenantDomain>:<integrityTag>
    if (!raw.startsWith("za:pair:1:")) return null
    val rest = raw.removePrefix("za:pair:1:")
    val parts = rest.split(':')
    if (parts.size != 4) return null
    return ChallengeQr(
        sessionId    = parts[0],
        nonceHex     = parts[1],
        tenantDomain = parts[2],
        integrityTag = parts[3],
    )
}

/** First 8 hex chars + ellipsis. Mirrors the dashboard's session-preview style. */
private fun formatNoncePreview(nonceHex: String): String =
    if (nonceHex.length <= 8) nonceHex else nonceHex.take(8) + "…"

@Preview(name = "Done — with payload")
@Composable
private fun DoneScreenPreview() {
    ZeroAuthTheme {
        DoneScreen(
            payload = "za:pair:1:9f8e2a4b-3c1d-4e5f-8a6b-7c2d1e9f4a3b:" +
                "deadbeefcafebabe1234567890abcdeffedcba98765432101122334455667788aa9988:" +
                "demo.zeroauth.dev:7c4a",
            onDone  = {},
        )
    }
}

@Preview(name = "Done — empty")
@Composable
private fun DoneScreenEmptyPreview() {
    ZeroAuthTheme {
        DoneScreen(payload = null, onDone = {})
    }
}
