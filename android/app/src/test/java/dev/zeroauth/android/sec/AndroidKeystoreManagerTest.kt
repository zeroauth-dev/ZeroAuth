package dev.zeroauth.android.sec

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.math.BigInteger
import java.security.SecureRandom

/**
 * Robolectric-driven tests for [AndroidKeystoreManager].
 *
 * Why Robolectric and not androidTest? The androidTest sourceset needs a
 * device or emulator and runs over ADB — too slow for CI's fast-feedback
 * lane. Robolectric provides a JVM-level Android runtime (Context,
 * filesDir, SharedPreferences, manifest resolution) which is what
 * AndroidKeystoreManager needs from Android. The Keystore-itself is
 * abstracted behind [KeystoreVault]; this test injects a [FakeKeystoreVault]
 * under vanilla JCE.
 *
 * Coverage map (the W3 Android task brief's enumerated test cases):
 *
 *   1. enrollNewAccount produces a 32-byte biometricSecret with non-zero
 *      entropy → [enroll produces non-zero biometric secret].
 *   2. commitment matches a hand-computed expected value for a fixed
 *      seed → [enroll matches the JS reference vector for a fixed seed].
 *   3. didHash is deterministic given the same email → [didHash is
 *      deterministic across two enrollments for the same email].
 *   4. identityBinding matches expected → covered by case 2.
 *   5. loadAccountForProof returns the same values that were enrolled →
 *      [loadAccountForProof round-trips the enrolled values].
 *   6. deleteAccount removes both the Keystore alias and the encrypted
 *      file → [deleteAccount removes the file and the vault entry].
 *
 * Plus a handful of negative tests around `hasCredential`, "no double
 * enrollment", AEAD tampering detection, and the close-zeroize contract.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE) // minSdk per app/build.gradle.kts
class AndroidKeystoreManagerTest {

    private lateinit var context: Context
    private lateinit var vault: FakeKeystoreVault
    private lateinit var manager: AndroidKeystoreManager

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        vault = FakeKeystoreVault(strongBoxAdvertised = true)
        manager = AndroidKeystoreManager(context = context, vault = vault)

        // Start each test from a clean accounts/ directory in case a prior
        // run left a blob behind. filesDir is per-package so this is safe.
        val accountsDir = File(context.filesDir, "accounts")
        if (accountsDir.exists()) accountsDir.deleteRecursively()
    }

    // ─── Test 1: entropy ──────────────────────────────────────────────

    @Test
    fun `enroll produces non-zero biometric secret`() {
        val (enrolled, _) = enrollWithRng(SecureRandom(), email = "entropy@example.com")
        val secretBytes = Crypto.unhex(enrolled.biometricSecretHex)
        assertEquals("biometricSecret should be 32 bytes wide on-disk", 32, secretBytes.size)
        // "non-zero entropy" = not the all-zero buffer
        assertNotEquals(
            "biometricSecret was the all-zero buffer — broken RNG?",
            "0".repeat(64),
            enrolled.biometricSecretHex,
        )
        // and not the all-FF buffer either (extremely unlikely)
        assertNotEquals("f".repeat(64), enrolled.biometricSecretHex)
    }

    // ─── Test 2: fixed-seed vector ───────────────────────────────────

    @Test
    fun `enroll matches the JS reference vector for a fixed seed`() {
        // The AndroidKeystoreManager draws RNG bytes in this order:
        //
        //   1. templateBytes  (32 bytes)
        //   2. saltBytes      (31 bytes — Crypto.randomSalt)
        //
        // We feed a deterministic byte stream so the test output is
        // bit-identical to the reference computed against poseidon-lite
        // in Node.
        val templateBytes = ByteArray(32) { 0xA5.toByte() }
        val saltBytes = ByteArray(31) { 0x37.toByte() }
        val rng = DeterministicRandom(templateBytes + saltBytes)

        val (enrolled, _) = enrollWithRng(rng, email = "alice@example.com")

        assertEquals(
            "biometricSecret matches the JS reference",
            BigInteger("6405579907212316714897842816490128930786366999228155622918692972129980700358"),
            BigInteger(enrolled.biometricSecretHex, 16),
        )
        assertEquals(
            "salt matches the JS reference",
            BigInteger("97557673223841770041305211021412912560199895168661627177851824761568966455"),
            BigInteger(enrolled.saltHex, 16),
        )
        assertEquals(
            "commitment matches the JS reference",
            BigInteger("16005490450669419328699052769212535602491164962610679750900029560876407820514"),
            BigInteger(enrolled.commitmentHex, 16),
        )
        assertEquals(
            "didHash matches the JS reference",
            BigInteger("18256743931390139689177294504144338520097295936229384668795496684829061682128"),
            BigInteger(enrolled.didHashHex, 16),
        )
        assertEquals(
            "identityBinding matches the JS reference",
            BigInteger("1485953772324354175468981079584675128924338606475244734759363269329316474230"),
            BigInteger(enrolled.identityBindingHex, 16),
        )
        assertEquals(
            "DID derives correctly from the email",
            "did:zeroauth:demo:ff8d9819fc0e12bf0d24892e45987e24",
            enrolled.did,
        )
    }

    // ─── Test 3: didHash determinism ─────────────────────────────────

    @Test
    fun `didHash is deterministic across two enrollments for the same email`() {
        val email = "deterministic@example.com"

        val first = enrollFresh(email).first
        manager.deleteAccount(email)
        val second = enrollFresh(email).first

        assertEquals(
            "didHash depends only on the email and must be stable across re-enrollments",
            first.didHashHex,
            second.didHashHex,
        )
        assertEquals(
            "did itself is stable across re-enrollments",
            first.did,
            second.did,
        )
        // And these MUST differ because the salt + template were drawn fresh:
        assertNotEquals(
            "biometricSecret should differ between two enrollments (entropy from RNG)",
            first.biometricSecretHex,
            second.biometricSecretHex,
        )
        assertNotEquals(first.commitmentHex, second.commitmentHex)
    }

    // ─── Test 4: load round-trip ─────────────────────────────────────

    @Test
    fun `loadAccountForProof round-trips the enrolled values`() = runTest {
        val email = "roundtrip@example.com"
        val (enrolled, _) = enrollFresh(email)

        // Re-init for decrypt — production path is:
        //   manager.cipherForProof(email)  →  BiometricPrompt  →
        //   manager.loadAccountForProof(email, unlockedCipher)
        val decryptCipher = manager.cipherForProof(email)

        val unlocked = manager.loadAccountForProof(email, decryptCipher)
        try {
            assertEquals(enrolled.did, unlocked.did)
            // The interface exposes decimal-string accessors; convert
            // back via hex to compare:
            assertEquals(
                BigInteger(enrolled.biometricSecretHex, 16),
                BigInteger(unlocked.biometricSecret),
            )
            assertEquals(
                BigInteger(enrolled.saltHex, 16),
                BigInteger(unlocked.salt),
            )
            assertEquals(
                BigInteger(enrolled.commitmentHex, 16),
                BigInteger(unlocked.commitment),
            )
            assertEquals(
                BigInteger(enrolled.didHashHex, 16),
                BigInteger(unlocked.didHash),
            )

            // toString() must not leak the secret material.
            val ts = unlocked.toString()
            assertTrue("toString must include did", ts.contains(enrolled.did))
            assertFalse(
                "toString must NOT include the biometricSecret decimal",
                ts.contains(unlocked.biometricSecret),
            )
        } finally {
            // The concrete impl exposes internal byte-view getters for
            // the test to assert zeroing. Capture the secret bytes pre-close
            // then verify they're zeroed post-close.
            val concrete = unlocked as PersistedUnlockedCredential
            val secretBefore = concrete.biometricSecretBytesView().copyOf()
            concrete.close()
            assertArrayEquals(
                "biometricSecret buffer must be zeroed after close",
                ByteArray(secretBefore.size),
                concrete.biometricSecretBytesView(),
            )
            assertNotEquals(
                "the close() actually changed the buffer (sanity)",
                secretBefore.toList(),
                concrete.biometricSecretBytesView().toList(),
            )
        }

        // Caller can also `use { … }` — second close is idempotent.
        unlocked.close()
    }

    // ─── Test 5: delete ──────────────────────────────────────────────

    @Test
    fun `deleteAccount removes the file and the vault entry`() {
        val email = "delete@example.com"
        enrollFresh(email)

        val blob = blobFor(email)
        assertTrue("blob must exist before delete", blob.exists())
        assertTrue(
            "vault key must exist before delete",
            vault.hasKey(aliasFor(email)),
        )

        manager.deleteAccount(email)

        assertFalse("blob must be gone after delete", blob.exists())
        assertFalse(
            "vault key must be gone after delete",
            vault.hasKey(aliasFor(email)),
        )
        assertFalse("hasCredential returns false after delete", manager.hasCredential(email))
    }

    // ─── Auxiliary tests ─────────────────────────────────────────────

    @Test
    fun `hasCredential false before enrollment, true after`() {
        val email = "exists@example.com"
        assertFalse(manager.hasCredential(email))
        enrollFresh(email)
        assertTrue(manager.hasCredential(email))
        assertTrue("hasAnyCredential agrees", manager.hasAnyCredential())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `enrolling twice for the same email is rejected`() {
        val email = "twice@example.com"
        enrollFresh(email)
        enrollFresh(email)
    }

    @Test
    fun `wrong cipher cannot decrypt the blob`() = runTest {
        // Enroll account A
        val emailA = "alice2@example.com"
        enrollFresh(emailA)
        // Enroll account B
        val emailB = "bob@example.com"
        enrollFresh(emailB)

        // Try to decrypt A's blob with B's cipher → must fail at AEAD.
        val wrongCipher = manager.cipherForProof(emailB)
        var threw = false
        try {
            manager.loadAccountForProof(emailA, wrongCipher)
        } catch (e: Throwable) {
            threw = true
        }
        assertTrue("cross-account decryption must fail", threw)
    }

    @Test
    fun `loadAccountForProof refuses a tampered blob`() = runTest {
        val email = "tamper@example.com"
        enrollFresh(email)
        val blob = blobFor(email)
        val bytes = blob.readBytes()
        // Flip a bit in the middle of the ciphertext (past the IV).
        bytes[bytes.size / 2] = (bytes[bytes.size / 2].toInt() xor 0x01).toByte()
        blob.writeBytes(bytes)

        val cipher = manager.cipherForProof(email)
        var threw = false
        try {
            manager.loadAccountForProof(email, cipher)
        } catch (e: Throwable) {
            threw = true
        }
        assertTrue("AEAD must reject a tampered blob", threw)
    }

    @Test
    fun `cipherForProof throws CredentialMissing when no blob exists`() {
        var threw = false
        try {
            manager.cipherForProof("nobody@example.com")
        } catch (e: CredentialMissingException) {
            threw = true
        }
        assertTrue("expected CredentialMissingException", threw)
    }

    @Test
    fun `isStrongBoxAvailable reflects the vault`() {
        assertTrue(manager.isStrongBoxAvailable())

        val noStrongBoxVault = FakeKeystoreVault(strongBoxAdvertised = false)
        val noStrongBoxManager = AndroidKeystoreManager(context, noStrongBoxVault)
        assertFalse(noStrongBoxManager.isStrongBoxAvailable())
    }

    @Test
    fun `IVs differ between two enrollments (randomized encryption)`() {
        enrollFresh("ivtest1@example.com")
        enrollFresh("ivtest2@example.com")
        assertTrue("expected ≥ 2 IVs issued", vault.issuedIvs.size >= 2)
        val (a, b) = vault.issuedIvs.take(2)
        assertFalse(
            "two consecutive IVs must differ — setRandomizedEncryptionRequired contract",
            a.contentEquals(b),
        )
    }

    @Test
    fun `persisted blob is a JSON envelope under the IV`() = runTest {
        // Sanity that the on-disk layout matches the documented contract:
        // 12-byte IV ‖ AES-GCM ciphertext ‖ tag, plaintext = JSON.
        val email = "shape@example.com"
        val (enrolled, _) = enrollFresh(email)
        val blob = blobFor(email)
        val bytes = blob.readBytes()
        assertTrue("blob has at least IV + tag", bytes.size > 12 + 16)
        // Round-trip via the proper API to assert the JSON shape:
        val cipher = manager.cipherForProof(email)
        val unlocked = manager.loadAccountForProof(email, cipher)
        try {
            assertEquals(enrolled.did, unlocked.did)
        } finally {
            unlocked.close()
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    private fun enrollFresh(email: String): Pair<EnrolledAccount, javax.crypto.Cipher> =
        enrollWithRng(SecureRandom(), email)

    private fun enrollWithRng(rng: SecureRandom, email: String): Pair<EnrolledAccount, javax.crypto.Cipher> {
        // Build a manager with the requested RNG. We rebuild the manager
        // (with the same vault + context) so the fixed-seed test gets a
        // deterministic stream while the rest of the tests use system
        // SecureRandom.
        val mgr = AndroidKeystoreManager(
            context = context,
            vault = vault,
            rng = rng,
            json = Json { encodeDefaults = true },
        )
        val cipher = mgr.initEncryptCipherForEnrollment(email)
        val enrolled = mgr.enrollNewAccount(email, cipher)
        return enrolled to cipher
    }

    private fun aliasFor(email: String): String =
        "${AndroidKeystoreManager.KEY_ALIAS_PREFIX}${Crypto.hex(Crypto.sha256Utf8(email))}"

    private fun blobFor(email: String): File =
        File(File(context.filesDir, "accounts"), "${Crypto.hex(Crypto.sha256Utf8(email))}.enc")
}
