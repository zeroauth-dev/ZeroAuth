package dev.zeroauth.android.sec

import android.content.Context
import android.content.SharedPreferences
import timber.log.Timber

/**
 * Tiny plain-SharedPreferences cache for the device's PUBLIC DID string.
 *
 * ## Why this exists
 *
 * The bank-2FA approval inbox ([dev.zeroauth.android.net.DemoPortalApi.pendingRequests])
 * polls the server with the DID every few seconds while the Home hub is
 * visible. Re-deriving the DID for every poll would mean a Keystore-
 * backed [FaceTemplateStore] decrypt + two Poseidon hashes per tick, so
 * we derive once and cache the resulting string.
 *
 * ## Why plain (not Encrypted) SharedPreferences is fine
 *
 * The DID is PUBLIC by construction — it is sent to the server on every
 * login, printed in the identity-details diagnostic screen, and stored
 * server-side against the bank account. Caching it in plain prefs leaks
 * nothing the enrolled identity hasn't already shared.
 *
 * NEVER extend this store to cache the 32-byte secret, the commitment
 * bytes, or any other derived private value — those stay inside the
 * Keystore-wrapped [FaceTemplateStore] / [UnlockedCredential] lifecycle.
 */
object DidStore {

    private const val TAG = "DidStore"
    private const val PREFS_FILE = "zeroauth_did_cache"
    private const val KEY_DID = "did"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    /** Cached public DID, or null if never derived on this install. */
    fun get(context: Context): String? =
        prefs(context).getString(KEY_DID, null)?.takeIf { it.isNotBlank() }

    /** Cache the public DID (e.g. straight after enrollment). */
    fun set(context: Context, did: String) {
        prefs(context).edit().putString(KEY_DID, did).apply()
    }

    /**
     * Return the cached DID, deriving + caching it from the persisted
     * face enrollment when unset. Returns null when the device has no
     * enrollment (nothing to derive from) or the derivation fails.
     *
     * The derivation mirrors the login proof path byte-for-byte:
     * [FaceTemplateStore.readSecret] → [FaceSecretCredential.fromSecret]
     * → `did`. The secret buffer and the credential's derived material
     * are zeroed before this returns — only the public DID string
     * survives.
     *
     * Runs Keystore + Poseidon work — call from a background dispatcher.
     */
    fun getOrDerive(context: Context): String? {
        get(context)?.let { return it }

        val store = FaceTemplateStore(context)
        if (!store.hasEnrollment()) return null
        val secret = store.readSecret() ?: return null
        return try {
            // `use` closes the credential, zeroing the Poseidon-derived
            // buffers; only the public DID string escapes the block.
            val did = FaceSecretCredential.fromSecret(secret).use { it.did }
            set(context, did)
            did
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "DID derivation failed")
            null
        } finally {
            // FaceSecretCredential copies what it needs — zero our copy.
            secret.fill(0)
        }
    }
}
