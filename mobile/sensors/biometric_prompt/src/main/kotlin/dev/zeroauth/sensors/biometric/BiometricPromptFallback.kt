package dev.zeroauth.sensors.biometric

/**
 * The Android BiometricPrompt fallback surface.
 *
 * Wraps `androidx.biometric.BiometricPrompt` with the constraints we
 * care about for Pramaan login (Scene 2 in
 * `docs/plan/bfsi-v1/02-bank-demo.md`):
 *
 *  * class-3 (strong) biometrics only — class-2 is rejected at this
 *    layer so the app can surface `step_up_unavailable` to the user
 *    on tier-2 devices.
 *  * StrongBox-bound CryptoObject (so the resulting hash is bound to
 *    a Keystore key whose private material lives in the secure
 *    element).
 *
 * The interface is intentionally narrow at C-101 (scaffold). It
 * widens with C-144 when the real BiometricPrompt invocation enters
 * the tree.
 *
 * ### Contract
 *
 * @return a hex-encoded SHA-256 digest of the on-device biometric
 *   descriptor returned by BiometricPrompt. As with the R307 path the
 *   raw template never crosses the module boundary; only the hash is
 *   exposed.
 *
 * ### Threading
 *
 * BiometricPrompt is intrinsically asynchronous — the user has to
 * physically present a finger or look at the camera. The real
 * implementation (C-144) exposes a `suspend` variant that bridges
 * BiometricPrompt's callbacks onto a coroutine. The synchronous
 * function below is the lowest-common-denominator surface; callers
 * that want the suspend form will pick it up post-C-144.
 *
 * ### Implementation map
 *
 * | Commit | What changes |
 * |--------|--------------|
 * | C-101  | This interface + DefaultBiometricPromptFallback throwing stub. |
 * | C-144  | Real BiometricPrompt + StrongBox-wrap + class-3 enforcement.   |
 */
interface BiometricPromptFallback {

    /**
     * Display the platform BiometricPrompt sheet and return a hex
     * SHA-256 of the on-device descriptor.
     */
    fun captureBiometricHash(): String
}

/**
 * Default [BiometricPromptFallback] implementation — a throwing stub.
 *
 * Any code path that calls [captureBiometricHash] today crashes loudly
 * with `NotImplementedError`. Real implementation lands with C-144.
 */
class DefaultBiometricPromptFallback : BiometricPromptFallback {

    override fun captureBiometricHash(): String {
        throw NotImplementedError("Real BiometricPrompt fallback lands in C-144")
    }
}
