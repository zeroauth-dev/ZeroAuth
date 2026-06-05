package dev.zeroauth.android

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.fragment.app.FragmentActivity
import dev.zeroauth.android.nav.ZeroAuthNavHost
import dev.zeroauth.android.prover.IsolatedMobileProver
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.KeystoreManager
import dev.zeroauth.android.ui.theme.ZeroAuthTheme

/**
 * Single-activity host. Compose owns every pixel inside; the only thing
 * MainActivity itself does is configure edge-to-edge + apply the theme.
 *
 * The activity is declared with android:configChanges so Compose's own
 * config-change handling kicks in instead of activity recreation — this
 * matters once the CameraX preview is bound, because recreating the
 * activity tears down the camera session and re-binding can take ~600 ms
 * on mid-range hardware.
 *
 * Extends [androidx.fragment.app.FragmentActivity] (not [androidx.activity.ComponentActivity])
 * because `androidx.biometric.BiometricPrompt` requires a FragmentActivity
 * to host its bottom-sheet fragment. FragmentActivity is a subclass of
 * ComponentActivity so the existing Compose / enableEdgeToEdge wiring
 * keeps working.
 *
 * Holds the process-wide [IsolatedMobileProver] handle so its
 * `:prover` Service binding spans every ScanScreen entry/exit. The
 * binding is lazily established on the first `generate()` call inside
 * the ViewModel (zero cost if the user never enters Scan) and is
 * explicitly released in [onDestroy] so Android can reap the
 * `:prover` process.
 */
class MainActivity : FragmentActivity() {

    /**
     * Production prover handle. Constructed eagerly in [onCreate] so
     * the [IsolatedMobileProver.release] call in [onDestroy] always
     * has something to release; `bindService` is deferred until the
     * first generate() call inside the Service-binding logic.
     */
    private lateinit var prover: IsolatedMobileProver

    /**
     * Production [KeystoreManager] — fronts the Android Keystore for
     * per-account encrypted blobs and (as a fallback for the W3 demo +
     * autonomous-test flow) the registration ceremony's
     * `zeroauth_reg_secret` SharedPreferences slot. Threaded through
     * the Compose tree via [LocalKeystoreManager].
     */
    private lateinit var keystoreManager: KeystoreManager

    /**
     * Production [BiometricGate] — wraps `androidx.biometric.BiometricPrompt`
     * for Class-3 (BIOMETRIC_STRONG) authentication. Receives this
     * activity at prompt time, so no per-activity wiring is required.
     * Threaded through the Compose tree via [LocalBiometricGate].
     */
    private lateinit var biometricGate: BiometricGate

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        prover = Composition.productionMobileProver(applicationContext)
        keystoreManager = Composition.productionKeystoreManager(applicationContext)
        biometricGate = Composition.productionBiometricGate(keystoreManager)
        setContent {
            CompositionLocalProvider(
                LocalKeystoreManager provides keystoreManager,
                LocalBiometricGate provides biometricGate,
            ) {
                ZeroAuthTheme {
                    ZeroAuthNavHost()
                }
            }
        }
    }

    override fun onDestroy() {
        // Release the IsolatedMobileProver binding so the :prover
        // process exits with us. Without this Android keeps the
        // process around until memory pressure forces a reap,
        // which (a) wastes RAM and (b) violates the "fresh sandbox
        // per session" property ADR-0010 trades on.
        if (this::prover.isInitialized) {
            prover.release()
        }
        super.onDestroy()
    }
}
