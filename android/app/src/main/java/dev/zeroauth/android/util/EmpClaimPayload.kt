package dev.zeroauth.android.util

import android.net.Uri

/**
 * Parser for the HR "join a company" invite deeplink. The attendance admin
 * portal provisions an employee and shows a QR encoding:
 *
 *   zeroauth://emp-claim?company=<companyId UUID>&code=<ZA-XXXX-XXXX>
 *
 * The phone scans it, parses, then opens an `/init` session and runs the
 * face-proof claim (see [dev.zeroauth.android.ui.join.JoinViewModel]). The
 * QR carries no session/nonce — the phone mints its own via `/init` so a
 * captured QR can't carry a stale session into the back-stack.
 *
 * Cousin to [RegQrPayload] (the `zeroauth://reg?…` signup ceremony) and
 * [QrPayload] (the `za:pair:1:…` proof-pairing sign-in). Failure modes are
 * surfaced as `Result.failure(EmpClaimParseException)` with stable string
 * codes the UI can route without re-mapping.
 */
object EmpClaimPayload {

    const val SCHEME: String = "zeroauth"
    const val HOST: String = "emp-claim"
    const val PARAM_COMPANY: String = "company"
    const val PARAM_CODE: String = "code"

    /**
     * Parse a scanned QR string. Returns success only when:
     *   - scheme matches `zeroauth`
     *   - host matches `emp-claim`
     *   - `company` is a UUID-shaped string
     *   - `code` matches the canonical `ZA-XXXX-XXXX` invite format
     *
     * Stable error codes inside the failure exception:
     *   - `emp_claim_parse_failed` — malformed URI / wrong scheme or host
     *   - `emp_claim_missing_field` — required field absent
     *   - `emp_claim_bad_company` — company isn't a UUID
     *   - `emp_claim_bad_code_shape` — code doesn't match ZA-XXXX-XXXX
     */
    fun parse(text: String): Result<EmpClaimInvite> {
        val uri = runCatching { Uri.parse(text) }.getOrNull()
            ?: return Result.failure(EmpClaimParseException("emp_claim_parse_failed", "Could not parse URI"))

        if (!SCHEME.equals(uri.scheme, ignoreCase = true)) {
            return Result.failure(
                EmpClaimParseException(
                    "emp_claim_parse_failed",
                    "Wrong scheme — expected $SCHEME:// got ${uri.scheme}://",
                ),
            )
        }
        if (!HOST.equals(uri.host, ignoreCase = true)) {
            return Result.failure(
                EmpClaimParseException(
                    "emp_claim_parse_failed",
                    "Not a join invite (host ${uri.host})",
                ),
            )
        }

        val company = uri.getQueryParameter(PARAM_COMPANY)?.takeIf { it.isNotBlank() }
            ?: return Result.failure(
                EmpClaimParseException("emp_claim_missing_field", "Missing ?$PARAM_COMPANY"),
            )
        if (!COMPANY_SHAPE.matches(company)) {
            return Result.failure(
                EmpClaimParseException("emp_claim_bad_company", "company is not a UUID: $company"),
            )
        }

        val code = uri.getQueryParameter(PARAM_CODE)?.takeIf { it.isNotBlank() }
            ?: return Result.failure(
                EmpClaimParseException("emp_claim_missing_field", "Missing ?$PARAM_CODE"),
            )
        if (!CODE_SHAPE.matches(code)) {
            return Result.failure(
                EmpClaimParseException("emp_claim_bad_code_shape", "Code does not match ZA-XXXX-XXXX: $code"),
            )
        }

        return Result.success(EmpClaimInvite(companyId = company, inviteCode = code))
    }

    /** RFC-4122 UUID shape (the server mints company ids as UUIDs). */
    private val COMPANY_SHAPE =
        Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    /**
     * ZA- prefix then 4 chars × 2 groups from the Crockford-base32 alphabet
     * the server mints invites from (no 0/1/I/L/O/U). Identical to the
     * registration code shape.
     */
    private val CODE_SHAPE = Regex("^ZA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$")
}

data class EmpClaimInvite(
    val companyId: String,
    val inviteCode: String,
)

class EmpClaimParseException(
    val code: String,
    message: String,
) : Exception(message)
