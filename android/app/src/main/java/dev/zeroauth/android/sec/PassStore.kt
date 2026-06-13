package dev.zeroauth.android.sec

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * Local cache of the companies ("passes") this device has joined. There is
 * intentionally no server-side did-keyed "my memberships" read — that would
 * be a public presence/identity oracle — so the phone remembers its claimed
 * passes locally. The server's `attendance_memberships` table stays the
 * authoritative record; reinstalling the app clears this cache, and a
 * re-claim (with a fresh invite) restores the pass.
 */
class PassStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Serializable
    data class Pass(
        val companyId: String,
        val companyName: String,
        val locationLabel: String,
        val employeeId: String,
        val membershipId: String,
        val joinedAt: String,
    )

    fun list(): List<Pass> {
        val raw = prefs.getString(KEY_PASSES, null) ?: return emptyList()
        return runCatching { JSON.decodeFromString(LIST, raw) }
            .onFailure { Timber.tag(TAG).w(it, "pass list decode failed") }
            .getOrDefault(emptyList())
    }

    fun get(companyId: String): Pass? = list().firstOrNull { it.companyId == companyId }

    /** Insert or replace the pass for a company (a re-claim overwrites). */
    fun upsert(pass: Pass) {
        write(list().filter { it.companyId != pass.companyId } + pass)
    }

    fun remove(companyId: String) {
        write(list().filter { it.companyId != companyId })
    }

    fun clear() {
        prefs.edit().remove(KEY_PASSES).apply()
    }

    private fun write(passes: List<Pass>) {
        prefs.edit().putString(KEY_PASSES, JSON.encodeToString(LIST, passes)).apply()
    }

    companion object {
        private const val TAG = "PassStore"
        private const val PREFS = "zeroauth_passes"
        private const val KEY_PASSES = "passes_json"
        private val JSON = Json { ignoreUnknownKeys = true }
        private val LIST = ListSerializer(Pass.serializer())
    }
}
