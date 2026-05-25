package dev.zeroauth.android.sec

import javax.crypto.Cipher

/**
 * KeystoreManager — interface owned by THIS file (UI engineer).
 *
 * The concrete implementation is provided by the sibling sec-agent in
 * the W3 sprint. The agent's contract: produce a class implementing
 * this interface that uses the Android Keystore (StrongBox-preferred,
 * `KeyProperties.PURPOSE_DECRYPT`, `setUserAuthenticationRequired(true)`,
 * Class-3 biometric strong) to wrap the at-rest credential material.
 *
 * Why the interface lives in the UI module rather than the sec module:
 * the ViewModel and Compose layer must compile WITHOUT the real
 * Keystore being present (Robolectric unit tests, fake-prover demo
 * builds), and the interface is the seam. The sec module imports this
 * interface; the UI module never imports any class from `androidx.security`
 * or `android.security.keystore` directly.
 *
 * Lifecycle:
 *   1. `hasCredential(email)` — sync, called from Splash routing. No
 *      biometric prompt; reads from EncryptedSharedPreferences (or the
 *      sec-agent's chosen at-rest store).
 *   2. `loadAccountForProof(email, cipher)` — called AFTER the
 *      `BiometricGate` returns a cipher that's bound to the per-user
 *      Keystore key. The cipher decrypts the per-user blob in one
 *      shot, the blob is parsed into UnlockedCredential, and the
 *      returned handle holds the secrets in a `CharArray`/`ByteArray`
 *      pair that `close()` overwrites with zeroes.
 *
 * UnlockedCredential is intentionally NOT a Kotlin data class — we do
 * NOT want auto-generated `toString` printing biometricSecret in a
 * Timber log line by accident. We also override `equals` to a reference
 * comparison so the value never participates in `==` against a
 * captured-by-test holder. The fields are mutable references to byte
 * buffers so `close()` can zero them.
 */
interface KeystoreManager {

    /** Returns true if a credential blob exists at rest for this email. */
    fun hasCredential(email: String): Boolean

    /**
     * Decrypt the per-user credential blob using a Keystore-bound cipher
     * that has already been authorized by a Class-3 biometric prompt.
     *
     * Throws [KeystoreLockedException] if the key is no longer usable
     * (user added a new biometric, OS re-locked the Keystore, etc).
     * Throws [CredentialMissingException] if no blob exists for [email].
     */
    suspend fun loadAccountForProof(
        email: String,
        cipher: Cipher,
    ): UnlockedCredential

    /**
     * Return the Keystore-bound `Cipher` that the `BiometricGate` should
     * authenticate. Pre-initialised with PURPOSE_DECRYPT + the per-user
     * IV that lives alongside the credential blob.
     *
     * In the fake implementation this returns a no-op cipher; in the
     * real implementation it returns a cipher created from
     * `KeyStore.getInstance("AndroidKeyStore")`.
     */
    fun cipherForProof(email: String): Cipher
}

/**
 * Opaque handle to the decrypted biometric material. Held briefly by
 * ScanViewModel between biometric approval and proof generation; closed
 * immediately after the prover returns.
 *
 * Implements [AutoCloseable] so call sites can use try/finally without
 * a Kotlin `use` extension chain.
 */
abstract class UnlockedCredential : AutoCloseable {

    /**
     * Field element representation of the biometric secret. The prover
     * consumes this as a decimal string into snarkjs. After the call
     * returns the impl zeroes the backing buffer via [close].
     */
    abstract val biometricSecret: String

    /** Companion salt (also a field element). */
    abstract val salt: String

    /** Poseidon(biometricSecret, salt) — re-derived by the impl so the prover doesn't recompute. */
    abstract val commitment: String

    /** Hash of the on-chain DID. Folded into the session nonce by the prover. */
    abstract val didHash: String

    /** Human-form DID string `did:zeroauth:demo:<32 hex>` */
    abstract val did: String

    /** Zero all in-memory copies and invalidate the handle. */
    abstract override fun close()

    /**
     * Defence against accidental Timber logging. NEVER return the
     * secret material in any string form — only a stable placeholder.
     */
    final override fun toString(): String = "UnlockedCredential(did=$did, …)"
}

class KeystoreLockedException(message: String, cause: Throwable? = null) :
    Exception(message, cause)

class CredentialMissingException(message: String, cause: Throwable? = null) :
    Exception(message, cause)
