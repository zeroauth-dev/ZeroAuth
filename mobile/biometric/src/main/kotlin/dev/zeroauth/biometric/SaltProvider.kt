package dev.zeroauth.biometric

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.KeyGenerator
import javax.crypto.Mac

/**
 * Per-user enrollment salt.
 *
 * The salt is a 32-byte random value generated **once at enrollment**
 * and reused for every subsequent verification on the same device. The
 * commitment is `Poseidon(biometricSecret, salt)`; reproducibility
 * across captures requires the salt to be stable.
 *
 * The salt is stored in the Android Keystore (StrongBox-backed where
 * available) so it never leaves hardware. We don't actually need
 * StrongBox to *encrypt* anything — we just need the salt's storage
 * to be tamper-evident and erased on factory reset. The KeyStore is
 * the right primitive because it (a) survives app uninstalls only as
 * long as the keystore key survives, and (b) is bound to the
 * device's hardware-backed credential gate.
 *
 * **Why HMAC and not raw storage**: the Keystore exposes
 * symmetric AES-256 / HMAC-SHA-256 keys but does NOT expose a "store
 * 32 random bytes" API. We work around this by storing an HMAC key in
 * the Keystore and deriving the salt as `HMAC(stored_key, "ZeroAuth-Salt-v1")`.
 * The derivation is deterministic across calls, so the salt is stable;
 * the key is hardware-protected, so an attacker with logical access to
 * the device cannot read the key material to forge salts on another
 * device. This is the same "KDF-from-Keystore-key" pattern used by
 * Google's Tink Android library for `DeterministicAead`.
 */
interface SaltProvider {
    /**
     * Return the 32-byte salt for this device, generating it on first
     * call. Subsequent calls on the same device return the same bytes.
     *
     * Suspend because the Keystore + StrongBox call can block on the
     * hardware HAL for ~10 ms on first generation; reading an existing
     * salt is microseconds but stays in the suspend shape for caller
     * uniformity.
     *
     * @return Exactly 32 bytes. Never null, never empty.
     */
    suspend fun salt(): ByteArray
}

/**
 * Android Keystore-backed [SaltProvider].
 *
 * Lifecycle:
 *
 * 1. First call to [salt] generates an HMAC-SHA-256 key in the Keystore
 *    under [keyAlias], preferring StrongBox if available.
 * 2. The salt is derived by HMAC over a fixed domain-separation
 *    string. The HMAC key never leaves the Keystore; the salt is
 *    derived inside the secure element and only the 32-byte output
 *    crosses the JNI boundary.
 * 3. Every subsequent call re-derives the same salt (the HMAC key is
 *    stable; the domain-separation string is constant).
 *
 * The salt is NOT user-authenticated (no BiometricPrompt gate). The
 * upstream FaceCapture surface is the one that gates on liveness +
 * face match; the salt just needs to be device-stable.
 *
 * @param context Application context; used only for Keystore access.
 * @param keyAlias Alias under which the HMAC key is stored. Defaults
 *                 to "dev.zeroauth.biometric.salt-v1". The "v1" suffix
 *                 is a forward-compat handle — bumping the algorithm
 *                 (e.g. to AES-256-GCM-SIV-based salt derivation)
 *                 means bumping the suffix and re-enrolling the user.
 */
class KeystoreSaltProvider(
    @Suppress("unused")
    private val context: Context,
    private val keyAlias: String = DEFAULT_KEY_ALIAS,
) : SaltProvider {

    override suspend fun salt(): ByteArray {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        if (!keyStore.containsAlias(keyAlias)) {
            generateHmacKey()
            // Reload alias view. KeyStore.getInstance is per-thread; the
            // generate path may or may not refresh the local view on
            // every Android version.
            keyStore.load(null)
        }
        val key = keyStore.getKey(keyAlias, null)
            ?: error(
                "KeystoreSaltProvider: HMAC key under '$keyAlias' " +
                    "vanished between containsAlias and getKey — " +
                    "possible Keystore corruption (factory reset?)",
            )
        val mac = Mac.getInstance(HMAC_ALG).apply { init(key) }
        return mac.doFinal(DOMAIN_SEP.toByteArray(Charsets.UTF_8))
    }

    /** Generate the HMAC-SHA-256 key under [keyAlias]. */
    private fun generateHmacKey() {
        val builder = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
        )
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setKeySize(KEY_SIZE_BITS)

        // StrongBox first; fall back to TEE on devices that lack it.
        // The fallback is silent on purpose — the salt-derivation path
        // doesn't *need* StrongBox; it just prefers it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                builder.setIsStrongBoxBacked(true)
                createKey(builder.build())
                return
            } catch (e: StrongBoxUnavailableException) {
                // Fall through to TEE.
            }
        }
        builder.setIsStrongBoxBacked(false)
        createKey(builder.build())
    }

    private fun createKey(spec: KeyGenParameterSpec) {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, ANDROID_KEYSTORE)
        gen.init(spec)
        gen.generateKey()
    }

    companion object {
        /** AndroidKeyStore provider name. */
        const val ANDROID_KEYSTORE: String = "AndroidKeyStore"

        /** HMAC algorithm name for [Mac.getInstance]. */
        const val HMAC_ALG: String = "HmacSHA256"

        /** Key size in bits. 256 bits matches the HMAC-SHA-256 block. */
        const val KEY_SIZE_BITS: Int = 256

        /**
         * Domain-separation string for the salt derivation. The "v1"
         * suffix tracks the salt-derivation protocol version; bumping
         * the version means bumping both the alias and this string.
         */
        const val DOMAIN_SEP: String = "ZeroAuth-Salt-v1"

        /** Default Keystore alias for the salt-derivation HMAC key. */
        const val DEFAULT_KEY_ALIAS: String = "dev.zeroauth.biometric.salt-v1"
    }
}
