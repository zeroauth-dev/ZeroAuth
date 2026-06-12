package dev.zeroauth.android.sec

import android.content.Context

/**
 * Local record of the phone's own last attendance action, so Home can
 * render "Checked in 9:02" vs "Not checked in" WITHOUT a server status
 * read — a did-keyed status endpoint would be a public presence oracle
 * (see the attendance bridge rationale). The server's `attendance_events`
 * table remains the authoritative, auditable record; this is a
 * convenience cache the owner can clear by reinstalling.
 */
class AttendanceStateStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class LastEvent(val type: String, val occurredAt: String)

    fun record(type: String, occurredAt: String) {
        prefs.edit()
            .putString(KEY_TYPE, type)
            .putString(KEY_AT, occurredAt)
            .apply()
    }

    fun last(): LastEvent? {
        val type = prefs.getString(KEY_TYPE, null) ?: return null
        val at = prefs.getString(KEY_AT, null) ?: return null
        return LastEvent(type, at)
    }

    /** True when the last recorded action was a check-in (currently "in"). */
    fun isCheckedIn(): Boolean = last()?.type == "check_in"

    companion object {
        private const val PREFS = "zeroauth_attendance_state"
        private const val KEY_TYPE = "last_event_type"
        private const val KEY_AT = "last_event_at"
    }
}
