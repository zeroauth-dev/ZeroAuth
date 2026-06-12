package dev.zeroauth.android.sec

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import androidx.core.content.ContextCompat
import dev.zeroauth.android.net.CompanyWifiDto
import timber.log.Timber

/**
 * Reads the phone's current WiFi network and decides whether it matches a
 * company's presence anchor. The on-device check drives Home's "you're
 * here" affordance and blocks an obviously off-site check-in early; the
 * AUTHORITATIVE check is server-side in `/api/attendance/record`, which
 * re-validates the attested BSSID + signal against the configured anchor.
 *
 * No GPS, no continuous location — a single yes/no read of "am I on the
 * office router, strongly enough". The BSSID (router MAC) is the anchor;
 * the SSID label is informational only.
 */
open class WifiAnchorChecker(appContext: Context) {

    private val app = appContext.applicationContext

    data class WifiReading(
        val ssid: String?,
        val bssid: String?,
        /** Signal strength percent 0..100 (WifiManager.calculateSignalLevel). */
        val signalPercent: Int,
    )

    /** Fine-location is required to read the BSSID on API 29+. */
    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * The current connected-WiFi reading, or null when not on WiFi / no
     * permission / the OS redacts the BSSID. The BSSID is lower-cased to
     * match the server anchor's normalisation.
     */
    @Suppress("DEPRECATION")
    open fun currentReading(): WifiReading? {
        return try {
            val wifi = app.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
            val info = wifi.connectionInfo ?: return null
            val rawBssid = info.bssid
            // The OS returns "02:00:00:00:00:00" when location is off or
            // ungranted — treat that as "no usable reading".
            if (rawBssid == null || rawBssid == REDACTED_BSSID) return null
            val percent = WifiManager.calculateSignalLevel(info.rssi, 100)
            val ssid = info.ssid?.trim('"')?.takeIf { it.isNotBlank() && it != UNKNOWN_SSID }
            WifiReading(ssid = ssid, bssid = rawBssid.lowercase(), signalPercent = percent)
        } catch (t: Throwable) {
            Timber.tag(TAG).w(t, "WiFi reading failed")
            null
        }
    }

    /**
     * Local presence gate mirroring the server's verifyWifiAgainstAnchor:
     * the reading's BSSID must be one of the anchor BSSIDs AND the signal
     * must meet the minimum. Fails closed on a null reading or an
     * unconfigured anchor.
     */
    fun matches(reading: WifiReading?, anchor: CompanyWifiDto): Boolean {
        val bssid = reading?.bssid ?: return false
        if (anchor.bssids.isEmpty()) return false
        return anchor.bssids.any { it.equals(bssid, ignoreCase = true) } &&
            reading.signalPercent >= anchor.minSignalPercent
    }

    companion object {
        private const val TAG = "WifiAnchorChecker"
        private const val REDACTED_BSSID = "02:00:00:00:00:00"
        private const val UNKNOWN_SSID = "<unknown ssid>"
    }
}
