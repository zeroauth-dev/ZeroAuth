package dev.zeroauth.android.util

import android.util.Base64
import dev.zeroauth.android.prover.Groth16Proof
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.zip.GZIPOutputStream

/**
 * QR payload codec — both ends of the air-gap. Two payload shapes
 * (ADR-0009 § "QR payload (both directions)"):
 *
 *  Desktop → phone (we READ this):
 *    `za:pair:1:<sessionId>:<nonceHex>:<tenantDomain>:<integrityTag>`
 *    integrityTag = first 4 hex chars of sha256(sessionId|nonceHex|tenantDomain)
 *    Target size: ≤ 200 B. Operator-typeable as a paste fallback.
 *
 *  Phone → desktop (we WRITE this):
 *    `za:proof:1:<base64url(gzip(cbor({s,p,ps,d,m})))>`
 *    Target size: ≤ 1500 B; warn at ≥ 1300 B. Empirical W2 fixture:
 *    ~990 B.
 *
 * CBOR — we do NOT pull in a general CBOR library for the demo
 * (rationale below). Instead we emit a hand-rolled CBOR encoder for
 * the FIVE-field map shape we control. This keeps the dependency
 * surface small (every Android dep is an ADR) and the size auditable.
 *
 * Why hand-rolled CBOR is safe here:
 *   - the shape is fixed (5 known keys, no recursion outside fixed
 *     arrays)
 *   - we never decode CBOR on the phone — the desktop decodes ours
 *     after relaying to the backend
 *   - the dashboard's own QR-payload comment block in
 *     dashboard/src/routes/demo/QrProofLogin.tsx explicitly says
 *     "until we add a CBOR codec to the dashboard, ship the raw scan
 *     as a metadata field and let the backend decode" — so the demo
 *     can ship even if a CBOR mismatch lands; the dashboard sends our
 *     payload verbatim to the backend.
 *
 * The CBOR is structurally minimal:
 *   - All map keys are short ASCII text strings (1-2 chars) so they
 *     fit in CBOR's "text string ≤ 23 bytes" inline-length form.
 *   - All values are text strings except `m` which is a 5-key inner
 *     map.
 *
 * Size accounting on the W2 fixture proofs:
 *   - 24 field-element decimal strings (≤ 78 chars each), gzipped
 *   - structural overhead ~80 bytes
 *   - base64url overhead +33 %
 *   - empirical ~990 B end-to-end matches ADR-0009's estimate.
 */
object QrPayload {

    /** Prefix for the desktop-issued challenge QR. */
    const val CHALLENGE_PREFIX: String = "za:pair:1:"

    /** Prefix for the phone-issued proof QR. */
    const val PROOF_PREFIX: String = "za:proof:1:"

    /** Soft limit: warn if the proof QR exceeds this. */
    const val PROOF_QR_WARN_BYTES: Int = 1_300

    /** Hard limit: ADR-0009 contract. CI test asserts this. */
    const val PROOF_QR_MAX_BYTES: Int = 1_500

    // ─── Decoding the desktop challenge ───────────────────────────

    /**
     * Parse a challenge-QR string into [DesktopChallenge]. Returns a
     * `Result.failure` (NOT throwing) on every structural problem so
     * the caller can render a friendly "invalid QR" toast without a
     * try/catch.
     *
     * Stable error codes inside the Result.failure exceptions:
     *   - `qr_parse_failed`: malformed prefix / wrong segment count
     *   - `qr_integrity_mismatch`: integrity tag did not verify
     */
    fun parseChallenge(text: String): Result<DesktopChallenge> {
        if (!text.startsWith(CHALLENGE_PREFIX)) {
            return Result.failure(
                QrParseException("qr_parse_failed", "Missing $CHALLENGE_PREFIX prefix")
            )
        }
        val rest = text.removePrefix(CHALLENGE_PREFIX)
        val parts = rest.split(':')
        if (parts.size != 4) {
            return Result.failure(
                QrParseException(
                    "qr_parse_failed",
                    "Expected 4 colon-separated segments, got ${parts.size}",
                )
            )
        }
        val challenge = DesktopChallenge(
            sessionId    = parts[0],
            nonceHex     = parts[1],
            tenantDomain = parts[2],
            integrityTag = parts[3],
        )
        // Light structural sanity — full crypto-strength validation
        // happens on the backend after the proof is submitted, but a
        // typo in the operator's paste-fallback is cheap to catch here.
        if (challenge.nonceHex.length != 62) {
            return Result.failure(
                QrParseException(
                    "qr_parse_failed",
                    "Nonce must be 62 hex chars (31 bytes); got ${challenge.nonceHex.length}",
                )
            )
        }
        if (challenge.integrityTag.length != 4) {
            return Result.failure(
                QrParseException(
                    "qr_parse_failed",
                    "Integrity tag must be 4 hex chars; got ${challenge.integrityTag.length}",
                )
            )
        }
        if (!challenge.verifyIntegrityTag()) {
            return Result.failure(
                QrParseException(
                    "qr_integrity_mismatch",
                    "Integrity tag does not match — check for a typo in the pasted code.",
                )
            )
        }
        return Result.success(challenge)
    }

    // ─── Encoding the phone proof ─────────────────────────────────

    /**
     * Encode a [ProofEnvelope] into the phone→desktop QR string.
     *
     * Returns the full `za:proof:1:...` string ready to render as a
     * QR. The string is base64url with NO padding, URL-safe — matching
     * what the desktop's existing PROOF_QR_PREFIX check expects.
     *
     * Throws an [IllegalArgumentException] only if the payload exceeds
     * [PROOF_QR_MAX_BYTES] AFTER encoding — this is a contract
     * violation (the W2 fixture is ~990 B, far below the limit) and
     * should surface in CI rather than silently shipping a too-large
     * QR the desktop can't reliably scan.
     */
    fun encodeProof(payload: ProofEnvelope): String {
        val cbor = encodeCborMap5(payload)
        val gzipped = gzip(cbor)
        val base64 = Base64.encodeToString(
            gzipped,
            Base64.NO_PADDING or Base64.NO_WRAP or Base64.URL_SAFE,
        )
        val full = PROOF_PREFIX + base64
        require(full.length <= PROOF_QR_MAX_BYTES) {
            "Proof QR exceeded $PROOF_QR_MAX_BYTES bytes (got ${full.length})"
        }
        return full
    }

    /**
     * Same as [encodeProof] but returns the byte length alongside the
     * encoded string so the caller can warn at ≥ [PROOF_QR_WARN_BYTES]
     * without re-measuring.
     */
    fun encodeProofWithSize(payload: ProofEnvelope): Pair<String, Int> {
        val encoded = encodeProof(payload)
        return encoded to encoded.length
    }

    // ─── CBOR encoder (minimal, 5-field map shape) ────────────────

    /**
     * Emit `{ "s": sessionId, "p": proof, "ps": publicSignals, "d":
     * did, "m": clientMeta }` as CBOR.
     *
     * The keys are short on purpose — every byte counts in a QR.
     */
    @Suppress("MagicNumber")
    private fun encodeCborMap5(payload: ProofEnvelope): ByteArray {
        val out = ByteArrayOutputStream(800)
        // Map of 5 pairs — CBOR major type 5, length 5 => 0xA5
        out.write(0xA5)
        writeTextString(out, "s")
        writeTextString(out, payload.sessionId)
        writeTextString(out, "p")
        writeProof(out, payload.proof)
        writeTextString(out, "ps")
        writeTextStringArray(out, payload.publicSignals)
        writeTextString(out, "d")
        writeTextString(out, payload.did)
        writeTextString(out, "m")
        writeClientMeta(out, payload.meta)
        return out.toByteArray()
    }

    @Suppress("MagicNumber")
    private fun writeProof(out: ByteArrayOutputStream, proof: Groth16Proof) {
        // Map of 5 pairs (pi_a, pi_b, pi_c, protocol, curve) => 0xA5
        out.write(0xA5)
        writeTextString(out, "pi_a")
        writeTextStringArray(out, proof.pi_a)
        writeTextString(out, "pi_b")
        // pi_b is a 3×2 array of decimal strings
        writeArrayHeader(out, proof.pi_b.size)
        proof.pi_b.forEach { row -> writeTextStringArray(out, row) }
        writeTextString(out, "pi_c")
        writeTextStringArray(out, proof.pi_c)
        writeTextString(out, "protocol")
        writeTextString(out, proof.protocol)
        writeTextString(out, "curve")
        writeTextString(out, proof.curve)
    }

    @Suppress("MagicNumber")
    private fun writeClientMeta(out: ByteArrayOutputStream, meta: ClientMeta) {
        // 4 or 5 pairs depending on optional playIntegrityVerdict
        val pairs = if (meta.playIntegrityVerdict == null) 4 else 5
        // Map header — short form fits up to 23 pairs in one byte (0xA0 + n)
        out.write(0xA0 or pairs)
        writeTextString(out, "av")
        writeTextString(out, meta.appVersion)
        writeTextString(out, "pl")
        writeTextString(out, meta.platform)
        writeTextString(out, "md")
        writeTextString(out, meta.model)
        writeTextString(out, "ms")
        // proofMs is a non-negative integer; encode as unsigned int
        writeUnsignedInt(out, meta.proofMs)
        if (meta.playIntegrityVerdict != null) {
            writeTextString(out, "pi")
            writeTextString(out, meta.playIntegrityVerdict)
        }
    }

    @Suppress("MagicNumber")
    private fun writeTextString(out: ByteArrayOutputStream, value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        writeMajorAndLength(out, MAJOR_TEXT_STRING, bytes.size)
        out.write(bytes)
    }

    private fun writeTextStringArray(out: ByteArrayOutputStream, values: List<String>) {
        writeArrayHeader(out, values.size)
        values.forEach { writeTextString(out, it) }
    }

    @Suppress("MagicNumber")
    private fun writeArrayHeader(out: ByteArrayOutputStream, length: Int) {
        writeMajorAndLength(out, MAJOR_ARRAY, length)
    }

    @Suppress("MagicNumber")
    private fun writeUnsignedInt(out: ByteArrayOutputStream, value: Long) {
        require(value >= 0) { "CBOR unsigned int requires non-negative value, got $value" }
        writeMajorAndLength(out, MAJOR_UNSIGNED_INT, value)
    }

    /**
     * Emit `(major << 5) | length` in CBOR canonical short form. We
     * deliberately don't handle indefinite-length encodings — every
     * value we emit has a known length.
     */
    @Suppress("MagicNumber")
    private fun writeMajorAndLength(
        out: ByteArrayOutputStream,
        major: Int,
        length: Int,
    ) {
        writeMajorAndLength(out, major, length.toLong())
    }

    @Suppress("MagicNumber")
    private fun writeMajorAndLength(
        out: ByteArrayOutputStream,
        major: Int,
        length: Long,
    ) {
        val majorShift = major shl 5
        when {
            length < 24L -> out.write(majorShift or length.toInt())
            length < 256L -> {
                out.write(majorShift or 24)
                out.write(length.toInt() and 0xFF)
            }
            length < 65_536L -> {
                out.write(majorShift or 25)
                out.write(((length shr 8) and 0xFF).toInt())
                out.write((length and 0xFF).toInt())
            }
            length < 4_294_967_296L -> {
                out.write(majorShift or 26)
                out.write(((length shr 24) and 0xFF).toInt())
                out.write(((length shr 16) and 0xFF).toInt())
                out.write(((length shr 8) and 0xFF).toInt())
                out.write((length and 0xFF).toInt())
            }
            else -> {
                out.write(majorShift or 27)
                for (shift in 56 downTo 0 step 8) {
                    out.write(((length shr shift) and 0xFF).toInt())
                }
            }
        }
    }

    // ─── gzip ─────────────────────────────────────────────────────

    private fun gzip(bytes: ByteArray): ByteArray {
        val buf = ByteArrayOutputStream(bytes.size / 2 + 32)
        GZIPOutputStream(buf).use { it.write(bytes) }
        return buf.toByteArray()
    }

    // CBOR major types
    private const val MAJOR_UNSIGNED_INT: Int = 0
    private const val MAJOR_TEXT_STRING: Int = 3
    private const val MAJOR_ARRAY: Int = 4
    @Suppress("unused") // kept for future encoder reuse
    private const val MAJOR_MAP: Int = 5
}

// ─── Value types ──────────────────────────────────────────────────

/**
 * The parsed desktop challenge QR. Cheap to carry around; the
 * Compose layer holds one of these between `ChallengeParsed` and
 * `ProofReady`.
 */
data class DesktopChallenge(
    val sessionId: String,
    val nonceHex: String,
    val tenantDomain: String,
    val integrityTag: String,
) {
    /**
     * Recompute `sha256(sessionId|nonceHex|tenantDomain)`, take the
     * first 4 hex chars, and compare against the supplied tag.
     *
     * NOT security-bearing — see ADR-0009 § "Consequences / Neutral":
     * "carries a 4-char integrity tag (not security-bearing) so the
     * operator can spot a hand-typed typo during the documented
     * paste-fallback recovery path."
     */
    fun verifyIntegrityTag(): Boolean {
        val canonical = "$sessionId|$nonceHex|$tenantDomain"
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(Charsets.UTF_8))
        val computed = digest.copyOfRange(0, 2)
            .joinToString("") { "%02x".format(it) }
        return computed.equals(integrityTag, ignoreCase = true)
    }
}

/** Outer envelope serialised into the phone→desktop QR. */
data class ProofEnvelope(
    val sessionId: String,
    val proof: Groth16Proof,
    val publicSignals: List<String>,
    val did: String,
    val meta: ClientMeta,
)

/**
 * Observability metadata the phone ships with the proof. The backend
 * persists this on the proof_pairing_sessions row for tenant
 * dashboards. `playIntegrityVerdict` is reserved per ADR-0009 §
 * "Non-goals" — server-side enforcement lands in W4 but the field is
 * already on the wire.
 */
data class ClientMeta(
    val appVersion: String,
    val platform: String = "android",
    val model: String,
    val proofMs: Long,
    val playIntegrityVerdict: String? = null,
)

class QrParseException(
    val code: String,
    message: String,
) : Exception(message)
