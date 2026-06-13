package dev.zeroauth.android.sec

import android.content.Context

/**
 * Local record of the phone's own last attendance action, so Home can
 * render "Checked in 9:02" vs "Not checked in" WITHOUT a server status
 * read — a did-keyed status endpoint would be a public presence oracle
 * (see the attendance bridge rationale). The server's `attendance_events`
 * table remains the authoritative, auditable record; this is a
 * convenience cache the owner can clear by reinstalling.
 *
 * State is keyed by `companyId` so a user with multiple passes tracks each
 * company's in/out independently. `companyId == null` is the slice-1 demo
 * company and keeps the original (unsuffixed) keys for back-compat.
 */
class AttendanceStateStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class LastEvent(val type: String, val occurredAt: String)

    fun record(type: String, occurredAt: String, companyId: String? = null) {
        prefs.edit()
            .putString(typeKey(companyId), type)
            .putString(atKey(companyId), occurredAt)
            .apply()
    }

    fun last(companyId: String? = null): LastEvent? {
        val type = prefs.getString(typeKey(companyId), null) ?: return null
        val at = prefs.getString(atKey(companyId), null) ?: return null
        return LastEvent(type, at)
    }

    /** True when the last recorded action for this company was a check-in. */
    fun isCheckedIn(companyId: String? = null): Boolean = last(companyId)?.type == "check_in"

    /** Wipe all cached in/out state (every company). */
    fun clearAll() {
        prefs.edit().clear().apply()
    }

    private fun typeKey(companyId: String?): String =
        if (companyId == null) KEY_TYPE else "${KEY_TYPE}_$companyId"

    private fun atKey(companyId: String?): String =
        if (companyId == null) KEY_AT else "${KEY_AT}_$companyId"

    companion object {
        private const val PREFS = "zeroauth_attendance_state"
        private const val KEY_TYPE = "last_event_type"
        private const val KEY_AT = "last_event_at"
    }
}
