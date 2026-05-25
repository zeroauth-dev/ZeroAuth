package dev.zeroauth.android.sec

import android.content.Context
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.io.File
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher

/**
 * AndroidKeystoreManager — concrete implementation of [KeystoreManager]
 * backed by the Android Keystore (StrongBox-preferred, biometric-bound
 * AES-256/GCM).
 *
 * Threat-model anchor: docs/threat_model.md → A-18 ("Rooted/jailbroken
 * phone with extracted Keystore secret"). The full mitigation row hangs
 * off this class — every flag the [AndroidKeystoreVault] sets is required
 * for the row's claim to hold. Removing any one of those flags must be
 * accompanied by an ADR + a threat-model update.
 *
 * ## Responsibilities
 *
 *   1. **Enrollment** (NOT in the [KeystoreManager] interface — exposed
 *      directly on this class). Derives (biometricSecret, salt) →
 *      Poseidon commitment → DID → identityBinding, then stores the
 *      private values (biometricSecret, salt, didHash, did) encrypted
 *      under a biometric-bound AES-256/GCM Keystore key. Public values
 *      (commitment, didHash, did, identityBinding) are returned to the
 *      caller so it can ship them to the backend at enrollment time.
 *
 *   2. **Unlock-for-proof** ([loadAccountForProof]). Handed a Cipher
 *      already unlocked by BiometricPrompt, read the encrypted blob,
 *      decrypt it, return the private + public values needed by the
 *      WebView prover. The returned [UnlockedCredential] holds raw bytes
 *      that `close()` zeros — the caller MUST invoke close() the moment
 *      proof generation completes.
 *
 *   3. **Delete** ([deleteAccount]). Removes both the Keystore key and
 *      the encrypted blob for a given email. Powers the demo reset flow.
 *
 * ## On-disk layout
 *
 * Per account, `filesDir/accounts/{sha256(email).hex}.enc`:
 *
 *   ┌───────────────────┬────────────────────────────────────────────┐
 *   │ bytes [0..12)     │ 12-byte GCM IV (randomly generated at      │
 *   │                   │ encrypt time by the Keystore provider)     │
 *   ├───────────────────┼────────────────────────────────────────────┤
 *   │ bytes [12..n+16)  │ AES-GCM ciphertext (n bytes plaintext) +   │
 *   │                   │ 16-byte GCM tag (concatenated by JCE)      │
 *   └───────────────────┴────────────────────────────────────────────┘
 *
 * The plaintext is a kotlinx-serialization JSON of [PersistedAccount].
 * That payload contains the private signals (biometricSecret, salt) and
 * the public signals (didHash, did, commitment, identityBinding). The
 * public signals are duplicated in the encrypted blob so a single
 * BiometricPrompt unlock reconstitutes the full enrolled-account state
 * without a second source of truth that could drift.
 *
 * ## Secret-zeroing contract
 *
 * [UnlockedCredential] is an abstract class with String accessors per
 * the UI engineer's interface, but the concrete [PersistedUnlockedCredential]
 * below also holds the raw byte buffers (which back the decimal-string
 * accessors) so we can zero them on close(). Best-effort — documented
 * in [Crypto.zeroize].
 */
class AndroidKeystoreManager internal constructor(
    private val context: Context,
    private val vault: KeystoreVault,
    private val rng: SecureRandom = SecureRandom(),
    private val json: Json = defaultJson,
) : KeystoreManager {

    /** Public-API constructor — production callers go through this. */
    constructor(context: Context) : this(context, AndroidKeystoreVault())

    // ─── KeystoreManager interface ─────────────────────────────────────

    override fun hasCredential(email: String): Boolean {
        val file = blobFile(email)
        val alias = aliasFor(email)
        return file.exists() && vault.hasKey(alias)
    }

    override fun cipherForProof(email: String): Cipher {
        val file = blobFile(email)
        if (!file.exists()) throw CredentialMissingException("No enrolled account for $email")
        val iv = readIv(file)
        val alias = aliasFor(email)
        return try {
            vault.initDecryptCipher(alias, iv)
        } catch (t: Throwable) {
            throw KeystoreLockedException("cipherForProof failed for $email", t)
        }
    }

    override suspend fun loadAccountForProof(email: String, cipher: Cipher): UnlockedCredential {
        val file = blobFile(email)
        if (!file.exists()) throw CredentialMissingException("No enrolled account for $email")

        val (_, ciphertext) = readBlob(file)
        val plaintext = try {
            cipher.doFinal(ciphertext)
        } catch (t: Throwable) {
            throw KeystoreLockedException("loadAccountForProof: AEAD failed", t)
        }
        val persisted: PersistedAccount = json.decodeFromString(
            PersistedAccount.serializer(),
            plaintext.toString(Charsets.UTF_8),
        )
        plaintext.zeroize()

        require(persisted.schemaVersion == 1) {
            "loadAccountForProof: unsupported schema version ${persisted.schemaVersion}"
        }
        require(persisted.email == email) {
            "loadAccountForProof: blob email mismatch (Keystore alias collision?)"
        }

        // Decimal-string accessors are backed by mutable raw buffers so
        // close() can zero them. Build the buffers from the hex strings
        // and remember the BigIntegers for the decimal accessor.
        return PersistedUnlockedCredential(
            biometricSecretBytes = Crypto.unhex(persisted.biometricSecretHex),
            saltBytes = Crypto.unhex(persisted.saltHex),
            commitmentBytes = Crypto.unhex(persisted.commitmentHex),
            didHashBytes = Crypto.unhex(persisted.didHashHex),
            didString = persisted.did,
        )
    }

    // ─── Non-interface surface (enrollment + diagnostics + delete) ─────

    /** Diagnostic: does this device's Keystore advertise StrongBox? */
    fun isStrongBoxAvailable(): Boolean = vault.isStrongBoxAvailable()

    /**
     * Has *any* account been enrolled on this device? Used by the splash
     * screen to choose between Enroll and Scan as the first destination.
     */
    fun hasAnyCredential(): Boolean {
        val dir = accountsDir()
        if (!dir.exists()) return false
        return dir.listFiles()?.any { it.name.endsWith(".enc") } == true
    }

    /**
     * Prepare the Keystore key + an encrypt-mode Cipher ready to be
     * wrapped in `BiometricPrompt.CryptoObject(cipher)`. The caller drives
     * BiometricPrompt; on success the prompt hands the unlocked Cipher
     * back, which is then passed to [enrollNewAccount].
     */
    fun initEncryptCipherForEnrollment(email: String): Cipher {
        val alias = aliasFor(email)
        if (!vault.hasKey(alias)) {
            vault.createBiometricBoundKey(alias, allowStrongBoxFallback = true)
        }
        return vault.initEncryptCipher(alias)
    }

    /**
     * Enroll a new account for [email]. Caller is responsible for having
     * already obtained a Cipher unlocked by BiometricPrompt — that
     * cipher must have been initialised via [initEncryptCipherForEnrollment]
     * earlier in the flow, then unlocked via the prompt.
     *
     * The Cipher is consumed: after this call, do not reuse it.
     *
     * Public values (commitment, didHash, did, identityBinding) are
     * returned so the calling Compose screen can ship them to the
     * backend or render the enrollment QR for the desktop.
     */
    fun enrollNewAccount(
        email: String,
        unlockedEncryptCipher: Cipher,
    ): EnrolledAccount {
        require(email.isNotBlank()) { "enrollNewAccount: email required" }
        require(!hasCredential(email)) { "enrollNewAccount: account already exists for this email" }

        // ── Derive everything (Poseidon happens entirely in-process) ──
        val templateBytes = Crypto.randomTemplate(rng, bytes = 32)
        val biometricIdBuf = Crypto.biometricId(templateBytes)
        templateBytes.zeroize() // we don't need the template again

        val saltField = Crypto.randomSalt(rng)
        val biometricSecret = Crypto.deriveBiometricSecret(biometricIdBuf, saltField)
        val commitment = Crypto.computeCommitment(biometricSecret, saltField)
        val did = Crypto.deriveDid(email)
        val didHash = Crypto.computeDidHash(did)
        val identityBinding = Crypto.computeIdentityBinding(biometricSecret, didHash)
        biometricIdBuf.zeroize()

        val didHashBytes = Crypto.fieldToBytes32(didHash)

        val persisted = PersistedAccount(
            email = email,
            biometricSecretHex = bigToHex(biometricSecret),
            saltHex = bigToHex(saltField),
            didHashHex = Crypto.hex(didHashBytes),
            did = did,
            commitmentHex = bigToHex(commitment),
            identityBindingHex = bigToHex(identityBinding),
            schemaVersion = 1,
        )

        val alias = aliasFor(email)
        if (!vault.hasKey(alias)) {
            error(
                "Internal: enrollNewAccount called without prior initEncryptCipherForEnrollment(email)."
            )
        }

        val plaintext = json.encodeToString(PersistedAccount.serializer(), persisted).toByteArray(Charsets.UTF_8)
        val ciphertext = unlockedEncryptCipher.doFinal(plaintext)
        val iv = unlockedEncryptCipher.iv
            ?: error("Cipher returned a null IV — wrong transform or unfinalised cipher")

        writeBlob(blobFile(email), iv, ciphertext)
        plaintext.zeroize()

        Timber.tag(TAG).i(
            "enrolled new account alias=%s strongBox=%s commitment=%s",
            alias.take(16),
            isStrongBoxAvailable(),
            shortHex(commitment),
        )

        return EnrolledAccount(
            email = email,
            biometricSecretHex = persisted.biometricSecretHex,
            saltHex = persisted.saltHex,
            commitmentHex = persisted.commitmentHex,
            didHashHex = persisted.didHashHex,
            did = persisted.did,
            identityBindingHex = persisted.identityBindingHex,
        )
    }

    /**
     * Remove every trace of the account from this device. Used by the
     * demo reset button and as the cleanup leg of a re-enrollment flow.
     */
    fun deleteAccount(email: String) {
        val alias = aliasFor(email)
        vault.deleteKey(alias)
        val blob = blobFile(email)
        if (blob.exists() && !blob.delete()) {
            Timber.tag(TAG).w("deleteAccount: failed to delete blob for alias prefix=%s", alias.take(16))
        }
        Timber.tag(TAG).i("deleted account alias=%s", alias.take(16))
    }

    // ─── Internals ────────────────────────────────────────────────────

    private fun accountsDir(): File =
        File(context.filesDir, ACCOUNTS_SUBDIR).apply { if (!exists()) mkdirs() }

    private fun blobFile(email: String): File =
        File(accountsDir(), "${Crypto.hex(Crypto.sha256Utf8(email))}.enc")

    /**
     * Keystore alias namespace. The trailing component is SHA-256(email)
     * hex. The `_v1` schema-version prefix lets a future KeyGenParameterSpec
     * change run side-by-side during migration. SHA-256(email) keeps PII
     * out of the cross-process Keystore directory listing.
     */
    private fun aliasFor(email: String): String =
        "${KEY_ALIAS_PREFIX}${Crypto.hex(Crypto.sha256Utf8(email))}"

    private fun writeBlob(file: File, iv: ByteArray, ciphertextAndTag: ByteArray) {
        require(iv.size == VaultConstants.GCM_IV_LENGTH_BYTES) {
            "writeBlob: bad IV length ${iv.size}"
        }
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.outputStream().use { out ->
            out.write(iv)
            out.write(ciphertextAndTag)
        }
        if (!tmp.renameTo(file)) {
            // best-effort fallback for filesystems that disallow rename-over
            file.delete()
            check(tmp.renameTo(file)) { "writeBlob: failed to publish ${file.name}" }
        }
    }

    private fun readBlob(file: File): Pair<ByteArray, ByteArray> {
        val bytes = file.readBytes()
        require(bytes.size > VaultConstants.GCM_IV_LENGTH_BYTES) {
            "readBlob: blob shorter than IV"
        }
        val iv = bytes.copyOfRange(0, VaultConstants.GCM_IV_LENGTH_BYTES)
        val ct = bytes.copyOfRange(VaultConstants.GCM_IV_LENGTH_BYTES, bytes.size)
        return iv to ct
    }

    private fun readIv(file: File): ByteArray {
        file.inputStream().use { ins ->
            val iv = ByteArray(VaultConstants.GCM_IV_LENGTH_BYTES)
            val read = ins.read(iv)
            require(read == VaultConstants.GCM_IV_LENGTH_BYTES) {
                "readIv: short read on ${file.name}"
            }
            return iv
        }
    }

    private fun bigToHex(n: BigInteger): String = Crypto.hex(Crypto.fieldToBytes32(n))

    private fun shortHex(n: BigInteger): String = bigToHex(n).take(12) + "…"

    @Serializable
    internal data class PersistedAccount(
        @SerialName("email") val email: String,
        @SerialName("biometricSecretHex") val biometricSecretHex: String,
        @SerialName("saltHex") val saltHex: String,
        @SerialName("didHashHex") val didHashHex: String,
        @SerialName("did") val did: String,
        @SerialName("commitmentHex") val commitmentHex: String,
        @SerialName("identityBindingHex") val identityBindingHex: String,
        @SerialName("schemaVersion") val schemaVersion: Int = 1,
    )

    companion object {
        private const val TAG = "AndroidKeystoreManager"
        private const val ACCOUNTS_SUBDIR = "accounts"

        /**
         * Keystore alias prefix. The trailing component is SHA-256(email)
         * hex. Bumping the `_v1` schema version means rotating the
         * KeyGenParameterSpec — used as a forward-compat hatch.
         */
        const val KEY_ALIAS_PREFIX: String = "zeroauth_account_v1_"

        private val defaultJson = Json {
            ignoreUnknownKeys = false
            prettyPrint = false
            encodeDefaults = true
        }
    }
}

// ─── Public DTO returned at enrollment ─────────────────────────────────

/**
 * Public + private signals returned at enrollment time. Hex-encoded so
 * the caller can shove them straight into a Retrofit body or a QR.
 *
 * - [biometricSecretHex] and [saltHex] are private — they must never
 *   leave the device. They are returned here purely so the operator can
 *   sanity-check the values during early-demo wiring; the production
 *   flow will refactor this to *not* return them and force callers to
 *   go through [KeystoreManager.loadAccountForProof].
 */
data class EnrolledAccount(
    val email: String,
    val biometricSecretHex: String,
    val saltHex: String,
    val commitmentHex: String,
    val didHashHex: String,
    val did: String,
    val identityBindingHex: String,
)

/**
 * Concrete [UnlockedCredential] backed by mutable byte buffers so
 * [close] can zero the secret. The decimal-string accessors required
 * by the interface lazily convert from the underlying bytes.
 *
 * Field-element decimal conversion uses [BigInteger.toString] over the
 * unsigned interpretation of the buffer — same shape as `iot/src/crypto.ts`
 * produces for the prover, so snarkjs reads these straight in.
 */
internal class PersistedUnlockedCredential(
    private val biometricSecretBytes: ByteArray,
    private val saltBytes: ByteArray,
    private val commitmentBytes: ByteArray,
    private val didHashBytes: ByteArray,
    private val didString: String,
) : UnlockedCredential() {

    @Volatile private var closed: Boolean = false

    override val biometricSecret: String
        get() {
            check(!closed) { "UnlockedCredential is closed" }
            return BigInteger(1, biometricSecretBytes).toString()
        }

    override val salt: String
        get() {
            check(!closed) { "UnlockedCredential is closed" }
            return BigInteger(1, saltBytes).toString()
        }

    override val commitment: String
        get() {
            check(!closed) { "UnlockedCredential is closed" }
            return BigInteger(1, commitmentBytes).toString()
        }

    override val didHash: String
        get() {
            check(!closed) { "UnlockedCredential is closed" }
            return BigInteger(1, didHashBytes).toString()
        }

    override val did: String
        get() = didString // not secret, always readable

    /** Raw bytes view of biometricSecret. Tests use this to assert
     *  zeroing. Production callers should prefer the [biometricSecret]
     *  decimal accessor — the prover consumes that. */
    internal fun biometricSecretBytesView(): ByteArray = biometricSecretBytes

    /** Same as above for salt. */
    internal fun saltBytesView(): ByteArray = saltBytes

    /** Same as above for didHash. */
    internal fun didHashBytesView(): ByteArray = didHashBytes

    override fun close() {
        if (closed) return
        biometricSecretBytes.zeroize()
        saltBytes.zeroize()
        commitmentBytes.zeroize()
        didHashBytes.zeroize()
        closed = true
    }
}
