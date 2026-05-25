package dev.zeroauth.android.sec

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * In-memory [KeystoreVault] for JVM-level unit tests.
 *
 * Robolectric does not ship the AndroidKeyStore security provider, so
 * the real [AndroidKeystoreVault] cannot be exercised from `src/test`.
 * This fake mimics the same contract using plain JCE — `SunJCE`'s
 * `AES/GCM/NoPadding` is the same transform AndroidKeyStore uses, so
 * the Cipher behaviour (auto-generated IV on encrypt, AEAD verification
 * on decrypt) is identical from the manager's point of view.
 *
 * What this fake intentionally does NOT model:
 *   - Biometric enforcement. BiometricPrompt is mocked out in tests
 *     that exercise the unlock leg; the fake hands back the cipher
 *     directly so AndroidKeystoreManager's encrypt/decrypt logic gets
 *     exercised.
 *   - StrongBox unavailability paths. We unit-test the happy path here;
 *     the StrongBoxUnavailableException fallback is covered by inspection
 *     of the production code (and would need a device to exercise on
 *     the JVM).
 *   - Invalidation on biometric enrollment. Not testable in the JVM.
 *
 * The fake DOES model the alias-bound key behaviour so we can:
 *   - reject `enrollNewAccount` for an alias that already exists,
 *   - prove that `deleteAccount` removes the key (subsequent
 *     `initDecryptCipher` throws), and
 *   - prove that the same alias yields the same key (so re-load works).
 */
internal class FakeKeystoreVault(
    private val rng: SecureRandom = SecureRandom(),
    private val strongBoxAdvertised: Boolean = true,
) : KeystoreVault {

    private val keys: MutableMap<String, SecretKey> = mutableMapOf()

    /**
     * Tracks the IVs handed out so a test can assert IV uniqueness.
     * Production code uses the Keystore's randomised-encryption guarantee;
     * the fake mirrors the same property by drawing fresh bytes from a
     * SecureRandom on every encrypt-mode init.
     */
    val issuedIvs: MutableList<ByteArray> = mutableListOf()

    override fun isStrongBoxAvailable(): Boolean = strongBoxAdvertised

    override fun hasKey(alias: String): Boolean = keys.containsKey(alias)

    override fun createBiometricBoundKey(alias: String, allowStrongBoxFallback: Boolean): Boolean {
        check(!keys.containsKey(alias)) { "Fake keystore: alias already exists" }
        val kg = KeyGenerator.getInstance("AES")
        kg.init(256)
        keys[alias] = kg.generateKey()
        return strongBoxAdvertised
    }

    override fun initEncryptCipher(alias: String): Cipher {
        val key = keys[alias] ?: error("Fake keystore: alias not found")
        val cipher = Cipher.getInstance(VaultConstants.GCM_TRANSFORM)
        // SunJCE allows but does not auto-generate IVs the way Android
        // Keystore does. Generate one ourselves so the manager's
        // `cipher.iv` read produces a real value.
        val iv = ByteArray(VaultConstants.GCM_IV_LENGTH_BYTES)
        rng.nextBytes(iv)
        issuedIvs += iv
        cipher.init(
            Cipher.ENCRYPT_MODE,
            key,
            GCMParameterSpec(VaultConstants.GCM_TAG_LENGTH_BITS, iv),
        )
        return cipher
    }

    override fun initDecryptCipher(alias: String, iv: ByteArray): Cipher {
        val key = keys[alias] ?: error("Fake keystore: alias not found")
        val cipher = Cipher.getInstance(VaultConstants.GCM_TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(VaultConstants.GCM_TAG_LENGTH_BITS, iv),
        )
        return cipher
    }

    override fun deleteKey(alias: String) {
        keys.remove(alias)
    }
}
