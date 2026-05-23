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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.R
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Splash + first-launch router.
 *
 * Today this just shows the wordmark, the tagline, and a single CTA. On
 * tap we route to Enroll (first launch) or Scan (returning user). The
 * "is the user already enrolled?" check is stubbed — the real check
 * lives in KeystoreManager.hasCredential() which lands in the
 * prover-glue sprint task.
 *
 * The current behaviour is "always treat as first launch" so the
 * demo always exercises the Enroll → Scan flow end-to-end. Once the
 * Keystore wiring exists, replace the placeholder with a derived state
 * read off the manager.
 */
@Composable
fun SplashScreen(
    onEnrollNeeded: () -> Unit,
    onAlreadyEnrolled: () -> Unit,
) {
    // TODO(prover-glue): replace with a real read off KeystoreManager.
    // Today this is always false so the demo always shows the Enroll
    // flow. The "true" path is wired so the Splash routing logic is
    // already correct.
    val isEnrolled = remember { mutableStateOf(false) }
    var navigated by remember { mutableStateOf(false) }

    LaunchedEffect(isEnrolled.value) {
        // No auto-skip today; the user always taps the CTA. Left as a
        // hook so the prover-glue sprint task can decide whether the
        // splash auto-routes after a 600 ms beat or stays interactive.
    }

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
                .padding(vertical = 64.dp),
            verticalArrangement = Arrangement.SpaceBetween,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Top spacer — keeps the wordmark visually anchored ~38 %
            // down the screen on mid-density displays.
            Spacer(modifier = Modifier.height(120.dp))

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(
                    text  = stringResource(R.string.brand_wordmark),
                    style = MaterialTheme.typography.displayLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text  = stringResource(R.string.splash_tagline),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }

            Button(
                onClick = {
                    if (navigated) return@Button
                    navigated = true
                    if (isEnrolled.value) onAlreadyEnrolled() else onEnrollNeeded()
                },
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
                    text  = stringResource(R.string.splash_cta),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Preview(name = "Splash")
@Composable
private fun SplashScreenPreview() {
    ZeroAuthTheme {
        SplashScreen(onEnrollNeeded = {}, onAlreadyEnrolled = {})
    }
}
