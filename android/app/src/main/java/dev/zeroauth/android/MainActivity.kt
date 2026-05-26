package dev.zeroauth.android

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import dev.zeroauth.android.nav.ZeroAuthNavHost
import dev.zeroauth.android.prover.IsolatedMobileProver
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
     *
     * NB: while the live ScanScreen factory still wires
     * [dev.zeroauth.android.util.FakeMobileProver] for the W3 demo
     * (see the parallel-agent comment in ScanScreen.kt), this handle
     * stays around so the production path can be flipped on by
     * Composition.kt without re-touching MainActivity. The cost of
     * holding an unbound IsolatedMobileProver is one object reference
     * — see [IsolatedMobileProver.ensureBound] for the lazy bind.
     */
    private lateinit var prover: IsolatedMobileProver

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        prover = Composition.productionMobileProver(applicationContext)
        setContent {
            ZeroAuthTheme {
                ZeroAuthNavHost()
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
