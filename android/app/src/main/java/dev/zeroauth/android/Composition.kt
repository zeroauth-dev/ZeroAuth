package dev.zeroauth.android

import android.content.Context
import dev.zeroauth.android.prover.IsolatedMobileProver
import dev.zeroauth.android.prover.MobileProver

/**
 * Composition root for the production wiring of the prover layer.
 *
 * Currently exposes only the [productionMobileProver] factory. The
 * Keystore + Biometric wiring lives behind the corresponding sec
 * agent's contracts and lands in a later iteration; the parallel-agent
 * comment block in [dev.zeroauth.android.ui.scan.ScanScreen] documents
 * the seam where Composition.kt slots in.
 *
 * Why factory functions, not a singleton object: ZeroAuthApp can hand
 * a [Context] in once at process start, but a process-wide singleton
 * would tie us to `ZeroAuthApp` initialisation order — and the Service
 * binding inside [IsolatedMobileProver] requires the *application*
 * Context, not the activity Context. Letting callers thread the
 * context in keeps the dependency direction explicit.
 *
 * Production code uses [productionMobileProver] for proof generation.
 * Test code (Robolectric, Compose previews, demo builds) uses
 * `dev.zeroauth.android.util.FakeMobileProver` — see
 * `util/FakeProverAndSec.kt`.
 */
object Composition {

    /**
     * Build the production [MobileProver] — an [IsolatedMobileProver]
     * that ships proof generation to the `:prover` OS process per
     * ADR-0010. Safe to invoke from any thread; the returned object
     * binds the Service lazily on the first `generate()` call.
     *
     * Callers MUST invoke [IsolatedMobileProver.release] in their
     * lifecycle teardown (e.g. MainActivity.onDestroy) so the
     * `:prover` process can exit cleanly. Without that call, Android
     * will reclaim the process eventually but only when the system is
     * under memory pressure — better hygiene to drop it explicitly.
     */
    fun productionMobileProver(context: Context): IsolatedMobileProver =
        IsolatedMobileProver(context.applicationContext)
}
