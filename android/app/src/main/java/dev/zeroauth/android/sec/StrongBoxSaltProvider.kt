package dev.zeroauth.android.sec

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.StrongBoxUnavailableException
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.security.SecureRandom

/**
 * SaltProvider — stable 32-byte per-install salt for the local user.
 *
 * Surface kept deliberately minimal: callers ask for [saltBytes] and treat
 * the result as opaque. The bytes are folded into the on-device commitment
 * construction (Poseidon's second input) so the device-bound secret
 * material cannot be replayed against any other install — even on the
 * same handset after a wipe + reinstall.
 *
 * The interface lives in this file (rather than alongside [KeystoreManager])
 * because the salt has a different lifecycle from the per-account
 * Keystore key: one salt per *install*, regardless of how many accounts
 * an operator enrols during a demo. Hoisting it as its own seam keeps
 * the test wave able to fake the salt without faking the entire
 * KeystoreManager.
 *
 * Threat-model anchor: docs/threat_model.md → A-18
 * ("Rooted/jailbroken phone with extracted Keystore secret"). Per ADR-0018
 * the salt is wrapped under a StrongBox-backed master key when available;
 * if the device's keymaster refuses StrongBox we fall through to the
 * standard AES-256/GCM TEE-backed key that
 * [androidx.security.crypto.MasterKey] minted in software-isolated TEE.
 *
 * Lifecycle:
 *   1. First call to [saltBytes] in this install: open (or create) the
 *      EncryptedSharedPreferences file; if no salt exists, generate 32
 *      bytes from [SecureRandom] and persist atomically.
 *   2. Subsequent calls (same install): read the stored bytes, return a
 *      defensive copy so the caller's [ByteArray.fill] won't poison the
 *      cached buffer.
 *   3. Logout: [clear] wipes the cached buffer and removes the
 *      EncryptedSharedPreferences entry so the next login generates a
 *      fresh salt. The Keystore master key itself is preserved (deleting
 *      it triggers a costly StrongBox re-mint) — only the wrapped salt
 *      value is cleared.
 */
interface SaltProvider {
    /**
     * Returns the 32-byte install-scoped salt. The byte array is a
     * defensive copy — caller may zero it after use without affecting
     * subsequent calls. First call generates + persists; later calls
     * read from EncryptedSharedPreferences.
     */
    suspend fun saltBytes(): ByteArray

    /**
     * Drop the in-memory cache and remove the persisted salt entry.
     * Called from logout flows. Best-effort — IO failures are logged
     * and swallowed so a flaky filesystem can't trap the user in a
     * half-logged-out state.
     */
    suspend fun clear()
}

/**
 * Production [SaltProvider] backed by Android Keystore (StrongBox-preferred)
 * wrapping an EncryptedSharedPreferences blob.
 *
 * The [androidx.security.crypto.MasterKey.Builder] API attempts to mint
 * its AES-256/GCM key in StrongBox when [MasterKey.Builder.setRequestStrongBoxBacked]
 * is set and the device advertises [PackageManager.FEATURE_STRONGBOX_KEYSTORE].
 * When the keymaster refuses (some Pixel and Samsung devices ship without
 * a StrongBox HSM despite running Android 11+), we catch
 * [StrongBoxUnavailableException] and fall through to a TEE-only key.
 *
 * The StrongBox attempt is logged once per process at INFO level so the
 * operator can confirm in `adb logcat` which backing store the demo
 * device actually used. No biometric-derived bytes appear in the log;
 * only the boolean "strongBox accepted" outcome.
 */
class StrongBoxSaltProvider(
    private val context: Context,
    private val rng: SecureRandom = SecureRandom(),
) : SaltProvider {

    /**
     * Single-flight gate: the first caller mints + persists; concurrent
     * callers await the same buffer rather than racing two writes into
     * the prefs file. Released only after the disk-commit returns.
     */
    private val mutex = Mutex()

    /**
     * In-process cache so the hot path (Scan screen, every verification)
     * doesn't touch the encrypted prefs file. Volatile because the
     * cache is published from inside [mutex] but read on the hot path
     * without re-entering the mutex when non-null.
     */
    @Volatile private var cached: ByteArray? = null

    override suspend fun saltBytes(): ByteArray {
        cached?.let { return it.copyOf() }

        return withContext(Dispatchers.IO) {
            mutex.withLock {
                // re-check inside the lock — another coroutine may have
                // populated the cache while we were awaiting the mutex.
                cached?.let { return@withLock it.copyOf() }

                val prefs = openPrefs()
                val existingHex = prefs.getString(KEY_SALT_HEX, null)
                val salt = if (existingHex != null) {
                    try {
                        Crypto.unhex(existingHex).also {
                            require(it.size == SALT_BYTES) {
                                "stored salt has unexpected length ${it.size}"
                            }
                        }
                    } catch (t: Throwable) {
                        // Corrupted entry — regenerate. We log without
                        // including the hex itself so a heap dump grep
                        // for the salt won't find it in Timber's ring.
                        Timber.tag(TAG).w(t, "stored salt unreadable; regenerating")
                        mintAndPersist(prefs)
                    }
                } else {
                    mintAndPersist(prefs)
                }
                cached = salt
                salt.copyOf()
            }
        }
    }

    override suspend fun clear() {
        withContext(Dispatchers.IO) {
            mutex.withLock {
                cached?.zeroize()
                cached = null
                try {
                    val prefs = openPrefs()
                    prefs.edit().remove(KEY_SALT_HEX).apply()
                } catch (t: Throwable) {
                    // Logout must never block the user from logging out.
                    Timber.tag(TAG).w(t, "clear: failed to remove salt entry")
                }
            }
        }
    }

    /**
     * Mint a fresh 32-byte salt, persist it inside the still-held mutex,
     * and return the bytes. Caller has already verified no entry exists
     * (or that the existing entry was corrupt).
     */
    private fun mintAndPersist(prefs: SharedPreferences): ByteArray {
        val buf = ByteArray(SALT_BYTES)
        rng.nextBytes(buf)
        val hex = Crypto.hex(buf)
        // commit() (not apply()) so the bytes hit disk before we return —
        // a crash between mint and commit would otherwise leave the
        // in-process cache holding a salt that future installs cannot
        // re-derive. The latency is paid once per install.
        val ok = prefs.edit().putString(KEY_SALT_HEX, hex).commit()
        if (!ok) {
            // SharedPreferences.commit() returning false is rare but
            // possible (disk-full, permission flip). Surface as an
            // exception so the caller can present an Enroll-failed UI
            // rather than silently caching a non-persisted salt.
            error("StrongBoxSaltProvider: failed to persist new salt")
        }
        return buf
    }

    /**
     * Open the EncryptedSharedPreferences file, requesting a StrongBox-
     * backed master key on first run and falling through to TEE on
     * [StrongBoxUnavailableException]. The MasterKey API caches the key
     * after the first mint; subsequent calls in the same process are
     * cheap.
     */
    private fun openPrefs(): SharedPreferences {
        val masterKey = buildMasterKey()
        return EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Build (or fetch from Keystore) the AES-256/GCM master key that
     * wraps the EncryptedSharedPreferences entries. Tries StrongBox first
     * on supported hardware, falls back to TEE if the keymaster refuses
     * the StrongBox attribute.
     */
    private fun buildMasterKey(): MasterKey {
        val attemptStrongBox = canAttemptStrongBox()

        return try {
            val builder = MasterKey.Builder(context, MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            if (attemptStrongBox) {
                builder.setRequestStrongBoxBacked(true)
            }
            builder.build().also {
                logBackingOnce(strongBoxRequested = attemptStrongBox, fellBack = false)
            }
        } catch (e: StrongBoxUnavailableException) {
            // Hardware advertises FEATURE_STRONGBOX_KEYSTORE but the
            // keymaster refused this particular key attribute set.
            // Retry without the StrongBox request.
            Timber.tag(TAG).w(
                e,
                "StrongBox unavailable for SaltProvider master key; falling back to TEE",
            )
            MasterKey.Builder(context, MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build().also {
                    logBackingOnce(strongBoxRequested = true, fellBack = true)
                }
        }
    }

    /**
     * StrongBox API surface is documented as P+ (SDK 28). Our minSdk is
     * 30, so the SDK check is a belt-and-braces guard; the meaningful
     * gate is the system feature flag.
     */
    private fun canAttemptStrongBox(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
        return context.packageManager.hasSystemFeature(
            PackageManager.FEATURE_STRONGBOX_KEYSTORE,
        )
    }

    @Volatile private var loggedBacking: Boolean = false

    private fun logBackingOnce(strongBoxRequested: Boolean, fellBack: Boolean) {
        if (loggedBacking) return
        loggedBacking = true
        Timber.tag(TAG).i(
            "salt-provider master key strongBoxRequested=%s fellBackToTee=%s",
            strongBoxRequested,
            fellBack,
        )
    }

    companion object {
        private const val TAG = "StrongBoxSaltProvider"

        /** Per-install salt length. Pinned at 32 B — see [SaltProvider]. */
        const val SALT_BYTES: Int = 32

        /** EncryptedSharedPreferences file name. Demo-prefixed so a
         *  future production rename can run side-by-side. */
        const val PREFS_FILE: String = "zeroauth_salt_v1"

        /** Keystore alias for the master key wrapping the prefs. Bumping
         *  `_v1` rotates the wrapping key without touching the salt. */
        const val MASTER_KEY_ALIAS: String = "zeroauth_salt_master_v1"

        /** Pref key for the hex-encoded salt entry. */
        const val KEY_SALT_HEX: String = "salt_hex"
    }
}
