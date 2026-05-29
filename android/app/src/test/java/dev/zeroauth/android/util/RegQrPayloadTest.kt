package dev.zeroauth.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Unit tests for [RegQrPayload].
 *
 * Robolectric is the runner because the parser uses [android.net.Uri]
 * which is not implemented in the bare JVM. Config.sdk pinned at 34 to
 * match android/app/build.gradle.kts's compileSdk.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RegQrPayloadTest {

    private val sampleSession = "11111111-2222-3333-4444-555555555555"
    private val sampleCode = "ZA-AB23-CD45"
    private val sampleChallenge = "a".repeat(32)

    @Test
    fun `parses a valid pair QR`() {
        val text = "zeroauth://reg?step=pair&session=$sampleSession&code=$sampleCode"
        val result = RegQrPayload.parse(text)
        assertTrue("expected success, got ${result.exceptionOrNull()}", result.isSuccess)
        val challenge = result.getOrThrow()
        assertEquals(RegQrPayload.Step.Pair, challenge.step)
        assertEquals(sampleSession, challenge.sessionId)
        assertEquals(sampleCode, challenge.code)
        assertNull(challenge.challengeNonce)
    }

    @Test
    fun `parses a valid enroll QR`() {
        val text = "zeroauth://reg?step=enroll&session=$sampleSession&code=$sampleCode"
        val challenge = RegQrPayload.parse(text).getOrThrow()
        assertEquals(RegQrPayload.Step.Enroll, challenge.step)
    }

    @Test
    fun `parses a valid verify QR with challenge`() {
        val text =
            "zeroauth://reg?step=verify&session=$sampleSession&code=$sampleCode&challenge=$sampleChallenge"
        val challenge = RegQrPayload.parse(text).getOrThrow()
        assertEquals(RegQrPayload.Step.Verify, challenge.step)
        assertEquals(sampleChallenge, challenge.challengeNonce)
    }

    @Test
    fun `rejects wrong scheme`() {
        val text = "https://reg?step=pair&session=$sampleSession&code=$sampleCode"
        val result = RegQrPayload.parse(text)
        assertTrue(result.isFailure)
        val ex = result.exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_parse_failed", ex.code)
    }

    @Test
    fun `rejects wrong host`() {
        val text = "zeroauth://login?step=pair&session=$sampleSession&code=$sampleCode"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_parse_failed", ex.code)
    }

    @Test
    fun `rejects unknown step`() {
        val text = "zeroauth://reg?step=toaster&session=$sampleSession&code=$sampleCode"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_parse_failed", ex.code)
    }

    @Test
    fun `rejects missing session`() {
        val text = "zeroauth://reg?step=pair&code=$sampleCode"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_missing_field", ex.code)
    }

    @Test
    fun `rejects missing code`() {
        val text = "zeroauth://reg?step=pair&session=$sampleSession"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_missing_field", ex.code)
    }

    @Test
    fun `rejects malformed code`() {
        val text = "zeroauth://reg?step=pair&session=$sampleSession&code=AB-CD-EF"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_bad_code_shape", ex.code)
    }

    @Test
    fun `rejects verify without challenge`() {
        val text = "zeroauth://reg?step=verify&session=$sampleSession&code=$sampleCode"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_missing_field", ex.code)
    }

    @Test
    fun `rejects malformed challenge`() {
        val text = "zeroauth://reg?step=verify&session=$sampleSession&code=$sampleCode&challenge=not-hex"
        val ex = RegQrPayload.parse(text).exceptionOrNull() as RegQrParseException
        assertEquals("reg_qr_bad_challenge_shape", ex.code)
    }
}
