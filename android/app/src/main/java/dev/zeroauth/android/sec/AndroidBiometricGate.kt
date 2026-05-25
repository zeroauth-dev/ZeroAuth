package dev.zeroauth.android.sec

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import timber.log.Timber
import javax.crypto.Cipher
import kotlin.coroutines.resume

/**
 * AndroidBiometricGate — concrete implementation of [BiometricGate]
 * backed by `androidx.biometric.BiometricPrompt`.
 *
 * The androidx Biometric API is fundamentally callback-driven and bound
 * to a [FragmentActivity] lifecycle. To present it as a suspend fun we
 * use [suspendCancellableCoroutine]: BiometricPrompt's
 * `AuthenticationCallback` resumes the continuation, cancellation
 * cancels the in-flight prompt.
 *
 * ## Cipher initialisation
 *
 * BiometricPrompt's "crypto" mode (Class-3 / BIOMETRIC_STRONG) requires
 * a `CryptoObject` constructed around a Cipher that is *already*
 * initialised — for ENCRYPT_MODE (no IV) at enrollment, or for
 * DECRYPT_MODE (with the stored IV) at unlock. The interface
 * [BiometricGate.authenticateForProof] takes only `(activity, email)`,
 * so this implementation calls back into the injected [KeystoreManager]
 * via `cipherForProof(email)` to obtain a ready-to-prompt cipher.
 *
 * The integration contract is therefore:
 *
 *     val gate    = AndroidBiometricGate(keystoreManager)
 *     val result  = gate.authenticateForProof(activity, email)
 *     when (result) {
 *       is BiometricResult.Success    -> keystoreManager.loadAccountForProof(email, result.cipher)
 *       BiometricResult.Cancelled     -> uiCancel()
 *       BiometricResult.NotAvailable  -> uiNotAvailable()
 *       BiometricResult.LockedOut     -> uiLockedOut()
 *       is BiometricResult.Error      -> uiError(result.code, result.message)
 *     }
 *
 * ## Title / subtitle
 *
 * The interface signature deliberately doesn't take title / subtitle —
 * the UI engineer's call sites supply them via resources at the
 * composition root. This file's [DEFAULT_TITLE] / [DEFAULT_SUBTITLE]
 * are fall-backs when neither resource nor override is supplied; they
 * are deliberately plain English so a Crashlytics report or a
 * screenshot never leaks the user-visible string set's structure to
 * the operator. The Compose layer overrides via the secondary
 * constructor that takes (title, subtitle) explicitly — landing in the
 * Compose integration sprint task.
 */
class AndroidBiometricGate(
    private val keystoreManager: KeystoreManager,
    private val title: String = DEFAULT_TITLE,
    private val subtitle: String = DEFAULT_SUBTITLE,
    private val negativeButtonText: String = DEFAULT_NEGATIVE,
) : BiometricGate {

    override suspend fun authenticateForProof(
        activity: FragmentActivity,
        email: String,
    ): BiometricResult {
        // Pre-flight check — surface NotAvailable before we even open
        // the cipher, so a missing-hardware device doesn't allocate a
        // Keystore key it can't use.
        availabilityCheck(activity)?.let { return it }

        val cipher = try {
            keystoreManager.cipherForProof(email)
        } catch (e: CredentialMissingException) {
            // The interface doesn't have a "missing credential" leaf;
            // map to Error with a documented code (-1 = phone-side).
            Timber.tag(TAG).w(e, "cipherForProof: no credential for the supplied email")
            return BiometricResult.Error(
                code = ERROR_CODE_MISSING_CREDENTIAL,
                message = "No enrolled credential for this device",
            )
        } catch (e: KeystoreLockedException) {
            Timber.tag(TAG).w(e, "cipherForProof: key is locked")
            return BiometricResult.LockedOut
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "cipherForProof: unexpected failure")
            return BiometricResult.Error(
                code = ERROR_CODE_CIPHER_INIT_FAILED,
                message = "Could not initialise the biometric cipher",
            )
        }

        return promptForCipher(activity, cipher)
    }

    /**
     * Lower-level entry point reused by the enrollment flow (the
     * Compose layer obtains an encrypt-mode Cipher from
     * [AndroidKeystoreManager.initEncryptCipherForEnrollment] and passes
     * it here). Exposed as a non-interface method because the
     * [BiometricGate] interface only models the proof-time unlock.
     */
    suspend fun authenticateWithCipher(
        activity: FragmentActivity,
        cipher: Cipher,
    ): BiometricResult {
        availabilityCheck(activity)?.let { return it }
        return promptForCipher(activity, cipher)
    }

    private suspend fun promptForCipher(
        activity: FragmentActivity,
        cipher: Cipher,
    ): BiometricResult = suspendCancellableCoroutine { cont ->
        val executor = ContextCompat.getMainExecutor(activity)

        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val unlocked = result.cryptoObject?.cipher
                    if (unlocked == null) {
                        if (cont.isActive) cont.resume(
                            BiometricResult.Error(
                                code = ERROR_CODE_NO_CRYPTO_OBJECT,
                                message = "Prompt returned no CryptoObject",
                            )
                        )
                        return
                    }
                    if (cont.isActive) cont.resume(BiometricResult.Success(unlocked))
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val mapped = when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON ->
                            BiometricResult.Cancelled
                        BiometricPrompt.ERROR_LOCKOUT,
                        BiometricPrompt.ERROR_LOCKOUT_PERMANENT ->
                            BiometricResult.LockedOut
                        BiometricPrompt.ERROR_HW_NOT_PRESENT,
                        BiometricPrompt.ERROR_HW_UNAVAILABLE,
                        BiometricPrompt.ERROR_NO_BIOMETRICS ->
                            BiometricResult.NotAvailable
                        else ->
                            BiometricResult.Error(code = errorCode, message = errString.toString())
                    }
                    if (cont.isActive) cont.resume(mapped)
                }

                override fun onAuthenticationFailed() {
                    // "Failed" is the unmatched-fingerprint case. The prompt
                    // stays up and the user can try again, so we deliberately
                    // do NOT resume the continuation here.
                    Timber.tag(TAG).d("BiometricPrompt: unmatched attempt")
                }
            },
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText(negativeButtonText)
            .setConfirmationRequired(false)
            .build()

        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))

        cont.invokeOnCancellation {
            try {
                prompt.cancelAuthentication()
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "cancelAuthentication threw")
            }
        }
    }

    /**
     * Returns null if BiometricPrompt is usable, or a leaf-state
     * [BiometricResult] mapping the BiometricManager error code to the
     * sealed-interface shape the UI cares about.
     */
    private fun availabilityCheck(context: Context): BiometricResult? {
        val mgr = BiometricManager.from(context)
        return when (mgr.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> null
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE,
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE,
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED,
            BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED ->
                BiometricResult.NotAvailable
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED ->
                BiometricResult.Error(
                    code = ERROR_CODE_SECURITY_UPDATE_REQUIRED,
                    message = "Biometric security update required",
                )
            else -> BiometricResult.Error(
                code = ERROR_CODE_STATUS_UNKNOWN,
                message = "Biometric status unknown",
            )
        }
    }

    companion object {
        private const val TAG = "AndroidBiometricGate"

        const val DEFAULT_TITLE: String = "Verify your identity"
        const val DEFAULT_SUBTITLE: String = "Use your fingerprint to sign in"
        const val DEFAULT_NEGATIVE: String = "Cancel"

        // Negative-space error codes (BiometricPrompt's are non-negative).
        const val ERROR_CODE_MISSING_CREDENTIAL: Int = -1
        const val ERROR_CODE_CIPHER_INIT_FAILED: Int = -2
        const val ERROR_CODE_NO_CRYPTO_OBJECT: Int = -3
        const val ERROR_CODE_SECURITY_UPDATE_REQUIRED: Int = -4
        const val ERROR_CODE_STATUS_UNKNOWN: Int = -5
    }
}
