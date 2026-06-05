package dev.zeroauth.android

import androidx.compose.runtime.compositionLocalOf
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.KeystoreManager

/**
 * CompositionLocals that hand the production sec instances down the
 * Compose tree without threading them through every intermediate
 * composable's parameter list.
 *
 * Provided once at the top of the tree inside
 * [dev.zeroauth.android.MainActivity.onCreate] via
 * [androidx.compose.runtime.CompositionLocalProvider]:
 *
 * ```kotlin
 * CompositionLocalProvider(
 *     LocalKeystoreManager provides keystoreManager,
 *     LocalBiometricGate    provides biometricGate,
 * ) {
 *     ZeroAuthTheme { ZeroAuthNavHost() }
 * }
 * ```
 *
 * Consumed by [dev.zeroauth.android.ui.scan.ScanScreen]'s default
 * [androidx.lifecycle.viewmodel.compose.viewModel] factory so the live
 * UI never reaches for `dev.zeroauth.android.util.Fake*` — those are
 * reserved for the Robolectric unit tests, which construct
 * [dev.zeroauth.android.ui.scan.ScanViewModel] directly and bypass the
 * Compose entry point entirely.
 *
 * The `error` defaults intentionally crash the test harness if a
 * composable that needs these reads them outside a provider — that's a
 * wiring bug worth surfacing loudly, not a silent fall-through to a
 * fake.
 */
val LocalKeystoreManager = compositionLocalOf<KeystoreManager> {
    error(
        "LocalKeystoreManager was read without a CompositionLocalProvider. " +
            "Wrap your composable tree in MainActivity.onCreate with " +
            "CompositionLocalProvider(LocalKeystoreManager provides ...).",
    )
}

val LocalBiometricGate = compositionLocalOf<BiometricGate> {
    error(
        "LocalBiometricGate was read without a CompositionLocalProvider. " +
            "Wrap your composable tree in MainActivity.onCreate with " +
            "CompositionLocalProvider(LocalBiometricGate provides ...).",
    )
}
