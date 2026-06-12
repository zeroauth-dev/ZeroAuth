package dev.zeroauth.android.ui

import android.content.Context
import androidx.compose.foundation.Image
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import dev.zeroauth.android.R
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Splash + first-launch router.
 *
 * Shows the wordmark, the tagline, and two CTAs:
 *
 *  1. **Sign in (scan QR)** — primary, full-width white button. Routes
 *     straight into the W3 [dev.zeroauth.android.ui.scan.ScanScreen] so
 *     the user can pair their phone with a desktop session. Sign-in is
 *     the day-to-day action and dominates the surface accordingly.
 *
 *  2. **Create a new account (3-QR signup)** — secondary text link sized
 *     down a tier below. Registration is one-time (ADR 0023 three-QR
 *     end-user signup ceremony), so it's intentionally demoted to a link
 *     rather than a button of equal weight.
 *
 * The legacy "Get started → Enroll" flow is retained as an optional
 * callback so historical entry points (e.g. internal QA harnesses, the
 * deep-link path) can still trigger it. Production navigation no longer
 * routes through Enroll from the splash — the user lands on Scan
 * directly, and Enroll/biometric setup happens inside the registration
 * ceremony.
 */
@Composable
fun SplashScreen(
    onSignIn: () -> Unit,
    onCreateAccount: () -> Unit = {},
    onEnrollNeeded: () -> Unit = {},
    onAlreadyEnrolled: () -> Unit = {},
    onViewIdentity: () -> Unit = {},
) {
    // `navigated` guards against a double-tap racing two navigation
    // dispatches before Nav Compose has had a chance to pop the splash
    // destination. Without this, a hurried user on a slow device can
    // produce a duplicated back-stack entry.
    var navigated by remember { mutableStateOf(false) }

    // Suppress unused-parameter warnings for the legacy callbacks that
    // are retained for backwards compatibility with QA / deep-link
    // entry points. They are intentionally not wired to UI today.
    @Suppress("UNUSED_EXPRESSION")
    onEnrollNeeded
    @Suppress("UNUSED_EXPRESSION")
    onAlreadyEnrolled

    // Show the "View my identity" affordance only if a registration
    // ceremony has already persisted a secret to SharedPreferences —
    // otherwise the screen would render a freshly-minted commitment
    // for a SecureRandom blob that the server doesn't know about, and
    // an investor scanning the on-screen DID against the dashboard
    // would see a "user not found" 404. The presence check is a
    // synchronous SharedPreferences lookup (no Poseidon work) so it's
    // safe to run on the composition thread.
    val context = LocalContext.current
    val hasIdentity = remember(context) { hasRegisteredIdentity(context) }

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
                // The ZeroAuth fingerprint mark — inverted to white
                // (drawable/zeroauth_mark.xml) so it reads on the dark
                // splash background.
                Image(
                    painter = painterResource(R.drawable.zeroauth_mark),
                    contentDescription = null,
                    modifier = Modifier.size(104.dp),
                )
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

            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (hasIdentity) {
                    // This device already holds a ZeroAuth identity. The
                    // only day-to-day action is sign-in, so it's primary —
                    // and "Create account" is intentionally gone (you
                    // already have one). This is the fix for the
                    // "still shows Create Account after I registered" bug.
                    Button(
                        onClick = {
                            if (navigated) return@Button
                            navigated = true
                            onSignIn()
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
                    OutlinedButton(
                        onClick = {
                            if (navigated) return@OutlinedButton
                            navigated = true
                            onViewIdentity()
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        contentPadding = PaddingValues(horizontal = 24.dp),
                    ) {
                        Text(
                            text  = "View my identity",
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                } else {
                    // No identity on this device yet — the one thing to do
                    // is create one. Registration is the primary action;
                    // sign-in is demoted (it can't succeed without a local
                    // identity to prove).
                    Button(
                        onClick = {
                            if (navigated) return@Button
                            navigated = true
                            onCreateAccount()
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
                            text  = "Create your ZeroAuth identity",
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                    TextButton(
                        onClick = {
                            if (navigated) return@TextButton
                            navigated = true
                            onSignIn()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text  = "I already have an identity — sign in",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Synchronous probe for "has the user run the registration ceremony at
 * least once on this device". Reads the same SharedPreferences key
 * that [dev.zeroauth.android.ui.reg.PerInstallStableSecret] writes to
 * (kept in sync via a hard-coded string literal because the prefs
 * names are private to the secret class — extracting them into a
 * shared constant pulls the identity-UI module into the prefs
 * encapsulation, which we don't want; the cost is this one-line
 * duplication that a unit test in PerInstallStableSecretTest can
 * trivially guard).
 *
 * Returns true iff the prefs file holds a 64-hex-char `secret_hex`
 * entry — anything shorter or missing is treated as "no identity yet"
 * so a partially-completed registration doesn't unlock the diagnostic
 * surface.
 */
internal fun hasRegisteredIdentity(context: Context): Boolean {
    // Authoritative: the multi-step face ceremony persists the
    // {secret, template} enrollment into the Keystore-backed
    // FaceTemplateStore. If that exists, the user has a usable on-device
    // identity and the splash routes them to sign-in, not registration.
    val enrolled = runCatching {
        dev.zeroauth.android.sec.FaceTemplateStore(context).hasEnrollment()
    }.getOrDefault(false)
    if (enrolled) return true
    // Legacy fallback: older builds wrote a 64-hex secret to this prefs
    // slot via the CapturedFaceSecret bridge. Kept so an identity created
    // by an older build still suppresses the create-account path.
    val prefs = context.applicationContext.getSharedPreferences(
        "zeroauth_reg_secret",
        Context.MODE_PRIVATE,
    )
    val secretHex = prefs.getString("secret_hex", null) ?: return false
    return secretHex.length == 64
}

@Preview(name = "Splash")
@Composable
private fun SplashScreenPreview() {
    ZeroAuthTheme {
        SplashScreen(onSignIn = {}, onCreateAccount = {}, onViewIdentity = {})
    }
}
