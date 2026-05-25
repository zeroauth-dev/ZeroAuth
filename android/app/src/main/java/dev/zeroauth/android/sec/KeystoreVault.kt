package dev.zeroauth.android.sec

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import androidx.annotation.RequiresApi
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Thin abstraction over the Android Keystore so [AndroidKeystoreManager] can
 * stay testable on the JVM. Robolectric does not ship the AndroidKeyStore
 * security provider — any test that touches the real Cipher / KeyGenerator
 * for `AndroidKeyStore` fails with `NoSuchProviderException` long before
 * any business logic runs.
 *
 * The vault deliberately exposes a *narrow* surface: create a biometric-
 * bound key, encrypt a payload, hand back a decryption cipher that the
 * BiometricPrompt will unlock, decrypt a payload, drop a key. The
 * production [AndroidKeystoreVault] implements this against the real
 * Keystore + StrongBox; [FakeKeystoreVault] (in src/test) mimics
 * the contract for unit tests.
 */
internal interface KeystoreVault {

    /**
     * Does this device's hardware-backed StrongBox keymaster honour our
     * key-gen flags? Used purely for diagnostics — production code falls
     * back automatically.
     */
    fun isStrongBoxAvailable(): Boolean

    /** Does a Keystore entry exist for [alias]? */
    fun hasKey(alias: String): Boolean

    /**
     * Create a fresh AES-256 GCM key in the Keystore under [alias]. The
     * key MUST be biometric-bound (BIOMETRIC_STRONG / Class-3), require
     * the device to be unlocked, and be invalidated by biometric
     * enrollment changes. StrongBox is requested when available, with a
     * graceful fallback to software-isolated TEE.
     *
     * Returns true if StrongBox accepted the key, false if we fell back.
     * The boolean is used only by audit logging; callers do not branch on it.
     */
    fun createBiometricBoundKey(alias: String, allowStrongBoxFallback: Boolean = true): Boolean

    /**
     * Returns a Cipher initialised for ENCRYPT_MODE under the key at [alias]
     * with a freshly-randomised IV. The caller wraps this cipher in a
     * `BiometricPrompt.CryptoObject` so BiometricPrompt unlocks it on
     * successful authentication. The unlocked cipher then performs the
     * actual encryption.
     */
    fun initEncryptCipher(alias: String): Cipher

    /**
     * Returns a Cipher initialised for DECRYPT_MODE under the key at [alias]
     * + the stored 12-byte GCM IV. Same wrap-in-CryptoObject + biometric
     * unlock pattern as [initEncryptCipher].
     */
    fun initDecryptCipher(alias: String, iv: ByteArray): Cipher

    /** Delete the Keystore entry at [alias]. No-op if absent. */
    fun deleteKey(alias: String)
}

/**
 * Production [KeystoreVault] implementation. Generates AES-256 GCM keys
 * in the AndroidKeyStore with the full set of hard-required flags from
 * threat-model row A-18 (CLAUDE.md → docs/threat_model.md):
 *
 *   - [KeyGenParameterSpec.Builder.setUserAuthenticationRequired] = true
 *   - [KeyGenParameterSpec.Builder.setUserAuthenticationParameters]
 *     (0 s timeout, BIOMETRIC_STRONG only — no fallback to PIN)
 *   - [KeyGenParameterSpec.Builder.setInvalidatedByBiometricEnrollment] = true
 *   - [KeyGenParameterSpec.Builder.setUnlockedDeviceRequired] = true
 *   - [KeyGenParameterSpec.Builder.setRandomizedEncryptionRequired] = true
 *   - [KeyGenParameterSpec.Builder.setIsStrongBoxBacked] = true (graceful
 *     fallback to false on [StrongBoxUnavailableException]).
 *
 * If any of these conditions is relaxed, A-18's "rooted phone extracts
 * secret" mitigation row no longer holds — surfaced as a TODO so any
 * future relaxation lands with a paired ADR.
 */
internal class AndroidKeystoreVault : KeystoreVault {

    /**
     * The Android Keystore is loaded lazily on first use; on real devices
     * this is cheap (~5 ms) and on the JVM (Robolectric) it throws
     * NoSuchProviderException, which is exactly why callers in tests
     * inject [FakeKeystoreVault] instead of this class.
     */
    private val keyStore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    override fun isStrongBoxAvailable(): Boolean {
        // StrongBox API surface lives on P+; on lower SDKs we return
        // false and the call sites fall back to TEE-only keys. minSdk is
        // 30 (Android 11) per app/build.gradle.kts, so this is a hot path.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
    }

    override fun hasKey(alias: String): Boolean = try {
        keyStore.containsAlias(alias)
    } catch (t: Throwable) {
        Timber.tag(TAG).w(t, "hasKey lookup failed for alias prefix=%s", alias.take(16))
        false
    }

    @RequiresApi(Build.VERSION_CODES.R) // minSdk = 30
    override fun createBiometricBoundKey(alias: String, allowStrongBoxFallback: Boolean): Boolean {
        if (hasKey(alias)) {
            Timber.tag(TAG).w("createBiometricBoundKey: alias already exists; refusing to clobber")
            error("Keystore alias already exists")
        }

        val purposes = KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT

        fun buildSpec(strongBox: Boolean): KeyGenParameterSpec = KeyGenParameterSpec.Builder(alias, purposes)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_SIZE_BITS)
            // CRITICAL: A-18 mitigation row. Removing any of the following
            // flags breaks the threat-model claim "biometric-bound, invalidated
            // on biometric enrollment, requires device unlock".
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true)
            .setUnlockedDeviceRequired(true)
            .setRandomizedEncryptionRequired(true)
            .setIsStrongBoxBacked(strongBox)
            .build()

        return try {
            generateKey(buildSpec(strongBox = isStrongBoxAvailable()))
            isStrongBoxAvailable()
        } catch (e: StrongBoxUnavailableException) {
            if (!allowStrongBoxFallback) throw e
            Timber.tag(TAG).w(
                e,
                "StrongBox unavailable on this device; falling back to TEE-only key for alias=%s",
                alias.take(16),
            )
            generateKey(buildSpec(strongBox = false))
            false
        }
    }

    private fun generateKey(spec: KeyGenParameterSpec) {
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        kg.init(spec)
        kg.generateKey()
    }

    override fun initEncryptCipher(alias: String): Cipher {
        val key = secretKey(alias)
        val cipher = Cipher.getInstance(GCM_TRANSFORM)
        // Pass no IV — the AndroidKeyStore provider generates a fresh
        // randomised IV on init(ENCRYPT_MODE, key) because we set
        // setRandomizedEncryptionRequired(true) at key-gen time. The IV
        // is retrievable via cipher.iv after the prompt completes.
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return cipher
    }

    override fun initDecryptCipher(alias: String, iv: ByteArray): Cipher {
        require(iv.size == GCM_IV_LENGTH_BYTES) {
            "initDecryptCipher: expected $GCM_IV_LENGTH_BYTES-byte IV, got ${iv.size}"
        }
        val key = secretKey(alias)
        val cipher = Cipher.getInstance(GCM_TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        return cipher
    }

    private fun secretKey(alias: String): SecretKey {
        val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry
            ?: error("Keystore alias not found: ${alias.take(16)}…")
        return entry.secretKey
    }

    override fun deleteKey(alias: String) {
        try {
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias)
            }
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "deleteKey failed for alias prefix=%s", alias.take(16))
        }
    }

    companion object {
        private const val TAG = "KeystoreVault"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val AES_KEY_SIZE_BITS = 256
        private const val GCM_TAG_LENGTH_BITS = 128
        const val GCM_IV_LENGTH_BYTES: Int = 12
        const val GCM_TRANSFORM: String = "AES/GCM/NoPadding"
    }
}

/**
 * Constants reused by alternate vault implementations (e.g. the in-memory
 * test vault under `src/test`). Kept here so the production transform
 * string and IV / tag length stay in one place.
 */
internal object VaultConstants {
    const val GCM_IV_LENGTH_BYTES: Int = AndroidKeystoreVault.GCM_IV_LENGTH_BYTES
    const val GCM_TAG_LENGTH_BITS: Int = 128
    const val GCM_TRANSFORM: String = AndroidKeystoreVault.GCM_TRANSFORM
}
