package dev.zeroauth.android.ui

import android.widget.Toast
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.R
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Enroll screen — biometric onboarding.
 *
 * Today this is a teaching surface: headline, explainer paragraph, single
 * "Set up" button. Tapping it toasts the stub message and routes forward
 * to Scan so the operator can drive the whole demo without the
 * Keystore + biometric prompt wiring.
 *
 * TODO(prover-glue): wire BiometricGate.enroll() here. The flow:
 *   1. BiometricManager.canAuthenticate(BIOMETRIC_STRONG) check
 *   2. BiometricPrompt.authenticate(crypto-bound cipher)
 *   3. on success: derive biometricSecret → Poseidon commitment →
 *      store the commitment+didHash in KeystoreManager
 *   4. POST /v1/identity/register equivalent (or surface the commitment
 *      to the operator as a QR for the desktop to register on the
 *      user's behalf — TBD with the security reviewer)
 */
@Composable
fun EnrollScreen(
    onEnrolled: () -> Unit,
) {
    val context = LocalContext.current
    var navigated by remember { mutableStateOf(false) }

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
                    text  = stringResource(R.string.enroll_title),
                    style = MaterialTheme.typography.headlineLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                Text(
                    text  = stringResource(R.string.enroll_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    if (navigated) return@Button
                    navigated = true
                    Toast.makeText(
                        context,
                        context.getString(R.string.enroll_stub_toast),
                        Toast.LENGTH_SHORT,
                    ).show()
                    onEnrolled()
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
                    text  = stringResource(R.string.enroll_cta),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Preview(name = "Enroll")
@Composable
private fun EnrollScreenPreview() {
    ZeroAuthTheme {
        EnrollScreen(onEnrolled = {})
    }
}
