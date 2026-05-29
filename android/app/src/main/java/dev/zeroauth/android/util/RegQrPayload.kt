package dev.zeroauth.android.util

import android.net.Uri

/**
 * Parser for the three-QR end-user signup ceremony deeplinks
 * (ADR 0023). The dashboard renders three QRs over the course of the
 * ceremony, each encoding a URI of the form:
 *
 *   zeroauth://reg?step=<pair|enroll|verify>
 *                &session=<uuid>
 *                &code=<ZA-XXXX-XXXX>
 *                [&challenge=<hex>]   (only on step=verify)
 *
 * The phone scans, parses, and routes to the corresponding step
 * handler in the RegistrationViewModel. Failure modes are surfaced as
 * `Result.failure(RegQrParseException)` with stable string codes so
 * the UI layer can route them to error toasts without re-mapping.
 *
 * Cousin to [QrPayload] in the same package — that one handles the
 * proof-pairing W3 QR format (`za:pair:1:...`). The registration flow
 * uses a different URI scheme because it's a different ceremony with
 * a different set of payloads, and the URI form is what
 * `zeroauth://reg?…` deeplinks resolve to anyway (Phase 2 universal-
 * links rollout will let the scanner accept https://…/reg/ links too;
 * the path-and-query shape will stay identical).
 */
object RegQrPayload {

    const val SCHEME: String = "zeroauth"
    const val HOST: String = "reg"
    const val PARAM_STEP: String = "step"
    const val PARAM_SESSION: String = "session"
    const val PARAM_CODE: String = "code"
    const val PARAM_CHALLENGE: String = "challenge"

    enum class Step(val wire: String) {
        Pair("pair"),
        Enroll("enroll"),
        Verify("verify"),
        ;

        companion object {
            fun fromWire(wire: String?): Step? = entries.firstOrNull { it.wire == wire }
        }
    }

    /**
     * Parse a scanned QR string. Returns success only when:
     *   - scheme matches `zeroauth`
     *   - host matches `reg`
     *   - `step` is one of pair/enroll/verify
     *   - `session` is a non-empty string (UUID shape is server-validated)
     *   - `code` matches the canonical `ZA-XXXX-XXXX` format the server issued
     *   - if step=verify, `challenge` is a 32-hex-char string
     *
     * Stable error codes inside the failure exception:
     *   - `reg_qr_parse_failed` — malformed URI, wrong scheme/host, bad step
     *   - `reg_qr_missing_field` — required field absent for this step
     *   - `reg_qr_bad_code_shape` — code doesn't match ZA-XXXX-XXXX
     *   - `reg_qr_bad_challenge_shape` — challenge isn't 32 hex chars
     */
    fun parse(text: String): Result<RegChallenge> {
        val uri = runCatching { Uri.parse(text) }.getOrNull()
            ?: return Result.failure(RegQrParseException("reg_qr_parse_failed", "Could not parse URI"))

        if (!SCHEME.equals(uri.scheme, ignoreCase = true)) {
            return Result.failure(
                RegQrParseException(
                    "reg_qr_parse_failed",
                    "Wrong scheme — expected $SCHEME:// got ${uri.scheme}://",
                ),
            )
        }
        if (!HOST.equals(uri.host, ignoreCase = true)) {
            return Result.failure(
                RegQrParseException(
                    "reg_qr_parse_failed",
                    "Wrong host — expected $HOST got ${uri.host}",
                ),
            )
        }

        val step = Step.fromWire(uri.getQueryParameter(PARAM_STEP))
            ?: return Result.failure(
                RegQrParseException(
                    "reg_qr_parse_failed",
                    "Missing or unknown ?$PARAM_STEP — expected pair/enroll/verify",
                ),
            )

        val sessionId = uri.getQueryParameter(PARAM_SESSION)?.takeIf { it.isNotBlank() }
            ?: return Result.failure(
                RegQrParseException("reg_qr_missing_field", "Missing ?$PARAM_SESSION"),
            )

        val code = uri.getQueryParameter(PARAM_CODE)?.takeIf { it.isNotBlank() }
            ?: return Result.failure(
                RegQrParseException("reg_qr_missing_field", "Missing ?$PARAM_CODE"),
            )
        if (!CODE_SHAPE.matches(code)) {
            return Result.failure(
                RegQrParseException(
                    "reg_qr_bad_code_shape",
                    "Code does not match ZA-XXXX-XXXX shape: $code",
                ),
            )
        }

        val challenge: String? = if (step == Step.Verify) {
            val c = uri.getQueryParameter(PARAM_CHALLENGE)?.takeIf { it.isNotBlank() }
                ?: return Result.failure(
                    RegQrParseException(
                        "reg_qr_missing_field",
                        "step=verify requires ?$PARAM_CHALLENGE",
                    ),
                )
            if (!CHALLENGE_SHAPE.matches(c)) {
                return Result.failure(
                    RegQrParseException(
                        "reg_qr_bad_challenge_shape",
                        "Challenge must be 32 hex chars; got ${c.length}",
                    ),
                )
            }
            c
        } else {
            null
        }

        return Result.success(
            RegChallenge(
                step = step,
                sessionId = sessionId,
                code = code,
                challengeNonce = challenge,
            ),
        )
    }

    /**
     * ZA- prefix, then 4 chars × 2 groups from the 30-symbol
     * Crockford-base32 alphabet the server uses (no 0/1/I/L/O/U).
     */
    private val CODE_SHAPE = Regex("^ZA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$")

    /** 128-bit hex nonce. */
    private val CHALLENGE_SHAPE = Regex("^[0-9a-fA-F]{32}$")
}

data class RegChallenge(
    val step: RegQrPayload.Step,
    val sessionId: String,
    val code: String,
    val challengeNonce: String?,
)

class RegQrParseException(
    val code: String,
    message: String,
) : Exception(message)
