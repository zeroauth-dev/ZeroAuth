package dev.zeroauth.android.util

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import java.security.MessageDigest
import java.util.UUID

/**
 * Builds the opaque, server-side-hashed device fingerprint string that
 * ADR 0023 step 1 requires. The server only stores SHA-256 of this —
 * the plaintext composition is device-type-specific (see ADR 0023
 * §"Device fingerprint" table) and the server never sees it.
 *
 * The contract from the server side:
 *   - opaque string, ≥ 16 chars, ≤ 4096 chars
 *   - stable per-(physical-device, app-install) — a second run from
 *     the same install should produce the same value
 *
 * The composition here:
 *   - `ANDROID_ID` — stable per (signing-key, user, factory-reset)
 *   - per-install UUID, persisted in SharedPreferences so a clear-data
 *     + reinstall produces a *new* fingerprint (this is on purpose —
 *     we want the row in the devices table to be tied to the install,
 *     not the bare hardware, so a re-installed app can re-enroll
 *     without collision)
 *   - the app's applicationId, so a sibling app on the same device
 *     (or a future flavor variant) produces a distinct fingerprint
 *
 * SHA-256-hex of the concatenation is what we ship. 64 hex chars is
 * comfortably above the 16-char floor and well below the 4096 ceiling.
 */
object DeviceFingerprint {

    private const val PREFS_NAME: String = "zeroauth_install"
    private const val KEY_INSTALL_UUID: String = "install_uuid"

    /**
     * Compose-and-hash. Result is 64 lower-case hex chars.
     *
     * Note `ANDROID_ID` requires READ_PHONE_STATE on API 28- (we're
     * minSdk 30 so no permission); on >= 8 it's always available
     * Settings-side. The @SuppressLint is for HardwareIds — we are
     * using it for its intended purpose (per-install identity, not
     * cross-app tracking) and the value never leaves this object's
     * SHA-256 wrapper.
     */
    @SuppressLint("HardwareIds")
    fun forCurrentInstall(context: Context): String {
        val androidId: String = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        ).orEmpty()

        val installUuid: String = readOrCreateInstallUuid(context)
        val appId: String = context.packageName

        val canonical = "android:$appId:$androidId:$installUuid"
        val sha256 = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8))
        return sha256.joinToString("") { "%02x".format(it) }
    }

    private fun readOrCreateInstallUuid(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_INSTALL_UUID, null)
        if (!existing.isNullOrBlank()) return existing
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_INSTALL_UUID, fresh).apply()
        return fresh
    }
}
