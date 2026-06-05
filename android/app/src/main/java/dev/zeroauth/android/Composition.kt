package dev.zeroauth.android

import android.content.Context
import dev.zeroauth.android.prover.IsolatedMobileProver
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.sec.AndroidBiometricGate
import dev.zeroauth.android.sec.AndroidKeystoreManager
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.KeystoreManager

/**
 * Composition root for the production wiring of the prover + sec layers.
 *
 * Exposes factory functions for the three injected dependencies
 * [dev.zeroauth.android.ui.scan.ScanViewModel] takes — [MobileProver],
 * [KeystoreManager], [BiometricGate]. The Compose layer threads these
 * in via [LocalKeystoreManager] / [LocalBiometricGate] / direct
 * argument so the live UI never touches a `Fake*` from
 * `dev.zeroauth.android.util.FakeProverAndSec`.
 *
 * Why factory functions, not a singleton object: ZeroAuthApp can hand
 * a [Context] in once at process start, but a process-wide singleton
 * would tie us to `ZeroAuthApp` initialisation order — and the Service
 * binding inside [IsolatedMobileProver] requires the *application*
 * Context, not the activity Context. Letting callers thread the
 * context in keeps the dependency direction explicit.
 *
 * Production code uses [productionMobileProver] / [productionKeystoreManager]
 * / [productionBiometricGate]. Test code (Robolectric, Compose previews,
 * unit tests that instantiate ScanViewModel directly) uses the fakes in
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

    /**
     * Build the production [KeystoreManager] — [AndroidKeystoreManager]
     * over the real [dev.zeroauth.android.sec.AndroidKeystoreVault]. The
     * returned instance is stateless beyond a SecureRandom + a JSON
     * parser; safe to share across the whole process.
     *
     * Reads/writes per-account encrypted blobs under `filesDir/accounts/`
     * and (as a fallback for the W3 demo + autonomous-test flow) falls
     * back to the registration ceremony's `zeroauth_reg_secret`
     * SharedPreferences when no Keystore blob exists for the account.
     * See [AndroidKeystoreManager.buildRegistrationFallbackCredential]
     * for the derivation; matches `tests/helpers/ceremony-client.ts`
     * byte-for-byte so a proof generated under this fallback verifies
     * against `tenant_users.metadata.{commitment, did_hash}` seeded by
     * the registration ceremony.
     */
    fun productionKeystoreManager(context: Context): KeystoreManager =
        AndroidKeystoreManager(context.applicationContext)

    /**
     * Build the production [BiometricGate] — [AndroidBiometricGate]
     * wired against the provided [keystoreManager]. The gate is
     * stateless; the per-prompt [androidx.fragment.app.FragmentActivity]
     * is supplied at `authenticateForProof` call time inside
     * [dev.zeroauth.android.ui.scan.ScanViewModel.runProofFlow].
     */
    fun productionBiometricGate(keystoreManager: KeystoreManager): BiometricGate =
        AndroidBiometricGate(keystoreManager = keystoreManager)
}
