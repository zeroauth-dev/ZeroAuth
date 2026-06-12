package dev.zeroauth.android.sec

import dev.zeroauth.android.net.CompanyWifiDto
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Unit tests for [WifiAnchorChecker.matches] — the on-device presence
 * gate that mirrors the server's `verifyWifiAgainstAnchor`. Robolectric
 * supplies the Context the constructor needs; `matches` itself reads no
 * WiFi state, so the assertions are deterministic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class WifiAnchorCheckerTest {

    private val checker = WifiAnchorChecker(RuntimeEnvironment.getApplication())

    private val anchor = CompanyWifiDto(
        ssidLabel = "AnchorCorp-Office",
        bssids = listOf("aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"),
        minSignalPercent = 85,
    )

    private fun reading(bssid: String?, signal: Int) =
        WifiAnchorChecker.WifiReading(ssid = "Office", bssid = bssid, signalPercent = signal)

    @Test
    fun `matches when bssid is an anchor and signal meets the floor`() {
        assertTrue(checker.matches(reading("aa:bb:cc:dd:ee:ff", 90), anchor))
    }

    @Test
    fun `matches is case-insensitive on the bssid`() {
        assertTrue(checker.matches(reading("AA:BB:CC:DD:EE:FF", 88), anchor))
    }

    @Test
    fun `rejects a bssid not in the anchor set`() {
        assertFalse(checker.matches(reading("99:99:99:99:99:99", 99), anchor))
    }

    @Test
    fun `rejects a weak signal even on the right network`() {
        assertFalse(checker.matches(reading("aa:bb:cc:dd:ee:ff", 50), anchor))
    }

    @Test
    fun `rejects a null reading`() {
        assertFalse(checker.matches(null, anchor))
    }

    @Test
    fun `fails closed when the anchor has no bssids configured`() {
        val empty = anchor.copy(bssids = emptyList())
        assertFalse(checker.matches(reading("aa:bb:cc:dd:ee:ff", 99), empty))
    }
}
