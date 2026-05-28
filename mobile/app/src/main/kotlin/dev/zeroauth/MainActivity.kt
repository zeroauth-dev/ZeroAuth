package dev.zeroauth

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.ui.theme.ZeroAuthTheme

/**
 * Launcher Activity for the Pramaan banking app.
 *
 * At scaffold time (C-101) this Activity renders a single placeholder
 * Compose surface to make the toolchain self-prove: build, install, see
 * the marker string, uninstall. Subsequent feature commits replace the
 * placeholder with the real flow:
 *
 *  * C-143 — enrollment QR scan → CameraX face capture → BiometricPrompt
 *    finger capture → DID anchor (Scene 1 in the bank demo).
 *  * C-146 — kiosk QR scan → BiometricPrompt → prover → /v1/zkp/verify
 *    (Scene 2 in the bank demo).
 *
 * Keep the marker string `coming soon (scaffold C-101)` in place: it is
 * asserted on by [dev.zeroauth.SmokeInstrumentedTest] and used as the
 * "did the APK install?" canary in the device-fleet smoke runs.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ZeroAuthTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    ScaffoldPlaceholder()
                }
            }
        }
    }
}

/**
 * The placeholder Compose surface. Lifted into its own composable so the
 * `@Preview` tooling renders without standing up a full Activity.
 */
@Composable
internal fun ScaffoldPlaceholder() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "ZeroAuth — coming soon (scaffold C-101)",
            style = MaterialTheme.typography.titleLarge,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun ScaffoldPlaceholderPreview() {
    ZeroAuthTheme {
        ScaffoldPlaceholder()
    }
}
