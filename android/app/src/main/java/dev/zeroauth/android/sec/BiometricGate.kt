package dev.zeroauth.android.sec

import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher

/**
 * BiometricGate — interface owned by THIS file (UI engineer).
 *
 * The concrete implementation is provided by the sibling sec-agent. The
 * agent's contract: produce a class implementing this interface that
 * uses `androidx.biometric.BiometricPrompt` with the Class-3 strong
 * authenticator, requesting the Keystore-bound Cipher returned by
 * `KeystoreManager.cipherForProof(email)`.
 *
 * Why suspend: the underlying API uses a callback. The implementation
 * wraps the callback in `suspendCancellableCoroutine` so the ViewModel
 * can `await` without thread juggling.
 *
 * Failure modes are explicit in [BiometricResult] so the ViewModel can
 * map them to the stable string error codes documented in
 * docs/error_codes.md "Proof pairing" — though all of these are phone-
 * side and never reach the backend.
 */
interface BiometricGate {

    /**
     * Show the system biometric prompt and (on success) return the
     * Keystore-bound Cipher the user authorised. The Cipher is then
     * passed to `KeystoreManager.loadAccountForProof`.
     *
     * The implementation MUST request `BIOMETRIC_STRONG` (Class 3) —
     * Class 2 (face-only on most devices) does not satisfy the
     * `setUserAuthenticationRequired(true)` Keystore key constraint
     * on minSdk 30.
     *
     * @param activity Required by androidx.biometric for the
     *                 PromptInfo binding. Pass the host FragmentActivity.
     * @param email    Lookup key for the per-user Keystore key alias.
     */
    suspend fun authenticateForProof(
        activity: FragmentActivity,
        email: String,
    ): BiometricResult
}

/**
 * Result of a biometric prompt. `Success` carries the authorised
 * Cipher so the caller can immediately hand it to KeystoreManager.
 * Everything else is a terminal phone-side failure — the ViewModel
 * surfaces these to the UI as Error states and does NOT POST anything
 * to the backend (the phone is network-isolated per ADR-0009 anyway).
 */
sealed interface BiometricResult {
    data class Success(val cipher: Cipher) : BiometricResult
    /** User dismissed the prompt explicitly (back button, cancel). */
    object Cancelled : BiometricResult
    /** Device has no enrolled biometric / hardware unavailable. */
    object NotAvailable : BiometricResult
    /** Too many failed attempts — system imposes a cooldown. */
    object LockedOut : BiometricResult
    /** Catch-all for unexpected errors (errorCode + human message). */
    data class Error(val code: Int, val message: String) : BiometricResult
}
