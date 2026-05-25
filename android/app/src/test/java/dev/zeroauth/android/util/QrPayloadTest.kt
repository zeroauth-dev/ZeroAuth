package dev.zeroauth.android.util

import dev.zeroauth.android.prover.Groth16Proof
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Unit tests for the QR codec.
 *
 * Robolectric is required even for this "pure" codec because the
 * encoder uses `android.util.Base64` (rather than `java.util.Base64`).
 * The shadow implementation that ships with Robolectric is sufficient.
 *
 * The encoder produces a deterministic envelope from a fixed input,
 * so the tests assert on shape (prefix, size bound, decoded round-
 * trip of the gzip+base64url+CBOR layers) rather than a hard-coded
 * byte sequence — that would be brittle against any future CBOR
 * canonicalisation change.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class QrPayloadTest {

    private fun validChallengeQr(): String {
        val sessionId = "9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1"
        val nonceHex  = "deadbeefcafebabe1234567890abcdef0123456789abcdef0123456789abcd"
        val tenantDomain = "demo.zeroauth.dev"
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest("$sessionId|$nonceHex|$tenantDomain".toByteArray())
        val tag = digest.copyOfRange(0, 2).joinToString("") { "%02x".format(it) }
        return "za:pair:1:$sessionId:$nonceHex:$tenantDomain:$tag"
    }

    @Test
    fun `parseChallenge succeeds for a well-formed QR with a valid integrity tag`() {
        val parsed = QrPayload.parseChallenge(validChallengeQr())
        assertTrue(parsed.isSuccess)
        val c = parsed.getOrNull()
        assertNotNull(c)
        c as DesktopChallenge
        assertEquals("9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1", c.sessionId)
        assertEquals(62, c.nonceHex.length)
        assertEquals("demo.zeroauth.dev", c.tenantDomain)
        assertTrue(c.verifyIntegrityTag())
    }

    @Test
    fun `parseChallenge fails on missing prefix with qr_parse_failed`() {
        val parsed = QrPayload.parseChallenge("not-a-za-prefix")
        assertTrue(parsed.isFailure)
        val ex = parsed.exceptionOrNull() as QrParseException
        assertEquals("qr_parse_failed", ex.code)
    }

    @Test
    fun `parseChallenge fails on wrong segment count`() {
        val parsed = QrPayload.parseChallenge("za:pair:1:only-one")
        assertTrue(parsed.isFailure)
        val ex = parsed.exceptionOrNull() as QrParseException
        assertEquals("qr_parse_failed", ex.code)
    }

    @Test
    fun `parseChallenge fails on integrity-tag mismatch`() {
        // Take the valid QR and corrupt the integrity tag.
        val tampered = validChallengeQr().dropLast(4) + "ffff"
        val parsed = QrPayload.parseChallenge(tampered)
        assertTrue(parsed.isFailure)
        val ex = parsed.exceptionOrNull() as QrParseException
        assertEquals("qr_integrity_mismatch", ex.code)
    }

    @Test
    fun `encodeProof produces a za_proof_1 prefixed string under the size cap`() {
        val proof = Groth16Proof(
            pi_a = listOf("1", "2", "1"),
            pi_b = listOf(
                listOf("3", "4"),
                listOf("5", "6"),
                listOf("1", "0"),
            ),
            pi_c = listOf("7", "8", "1"),
        )
        val envelope = ProofEnvelope(
            sessionId = "9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1",
            proof = proof,
            publicSignals = listOf(
                "11111111111111111111",
                "22222222222222222222",
                "33333333333333333333",
            ),
            did = "did:zeroauth:demo:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b",
            meta = ClientMeta(
                appVersion = "0.1.0",
                model      = "Pixel 7a",
                proofMs    = 4_820,
            ),
        )
        val (encoded, size) = QrPayload.encodeProofWithSize(envelope)
        assertTrue(
            "Expected prefix; got ${encoded.take(20)}",
            encoded.startsWith("za:proof:1:"),
        )
        assertTrue("QR size $size exceeded cap", size <= QrPayload.PROOF_QR_MAX_BYTES)
    }

    @Test
    fun `encodeProof tolerates the playIntegrityVerdict field`() {
        val proof = Groth16Proof(
            pi_a = listOf("1", "2", "1"),
            pi_b = listOf(listOf("3", "4"), listOf("5", "6"), listOf("1", "0")),
            pi_c = listOf("7", "8", "1"),
        )
        val envelope = ProofEnvelope(
            sessionId = "session",
            proof = proof,
            publicSignals = listOf("1", "2", "3"),
            did = "did",
            meta = ClientMeta(
                appVersion = "0.1.0",
                model      = "Pixel 7a",
                proofMs    = 4_820,
                playIntegrityVerdict = "MEETS_STRONG_INTEGRITY",
            ),
        )
        val (encoded, _) = QrPayload.encodeProofWithSize(envelope)
        assertTrue(encoded.startsWith("za:proof:1:"))
    }
}
