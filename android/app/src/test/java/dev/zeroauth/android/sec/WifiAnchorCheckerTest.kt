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
 * Unit tests for [WifiAnchorChecker.matches] — the on-device presence hint.
 * It now matches on the SSID **label** (the public `/company` surface no
 * longer ships the anchor BSSIDs; security A-42), AND the signal floor. The
 * authoritative gate stays server-side. Robolectric supplies the Context the
 * constructor needs; `matches` reads no live WiFi, so this is deterministic.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class WifiAnchorCheckerTest {

    private val checker = WifiAnchorChecker(RuntimeEnvironment.getApplication())

    // The public surface sends ssidLabel + minSignalPercent only (bssids empty).
    private val anchor = CompanyWifiDto(
        ssidLabel = "AnchorCorp-Office",
        bssids = emptyList(),
        minSignalPercent = 85,
    )

    private fun reading(ssid: String?, signal: Int) =
        WifiAnchorChecker.WifiReading(ssid = ssid, bssid = "aa:bb:cc:dd:ee:ff", signalPercent = signal)

    @Test
    fun `matches when ssid is the anchor label and signal meets the floor`() {
        assertTrue(checker.matches(reading("AnchorCorp-Office", 90), anchor))
    }

    @Test
    fun `matches is case-insensitive on the ssid`() {
        assertTrue(checker.matches(reading("anchorcorp-office", 88), anchor))
    }

    @Test
    fun `rejects an ssid that is not the anchor label`() {
        assertFalse(checker.matches(reading("Cafe-WiFi", 99), anchor))
    }

    @Test
    fun `rejects a weak signal even on the right network`() {
        assertFalse(checker.matches(reading("AnchorCorp-Office", 50), anchor))
    }

    @Test
    fun `rejects a null reading`() {
        assertFalse(checker.matches(null, anchor))
    }

    @Test
    fun `rejects a reading with no ssid`() {
        assertFalse(checker.matches(reading(null, 99), anchor))
    }

    @Test
    fun `fails closed when the anchor has no ssid label`() {
        val blank = anchor.copy(ssidLabel = "")
        assertFalse(checker.matches(reading("AnchorCorp-Office", 99), blank))
    }
}
