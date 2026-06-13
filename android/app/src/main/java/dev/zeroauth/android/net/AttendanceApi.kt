package dev.zeroauth.android.net

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Retrofit binding for the face-first office-attendance bridge
 * (`/api/attendance`). The employee marks attendance from their own
 * phone; the phone holds NO tenant API key, so — exactly like
 * [DemoPortalApi] — this is a public same-process bridge that reuses the
 * production proof-pairing verifier server-side.
 *
 * The ceremony mirrors sign-in: GET the company anchor → POST /init for a
 * fresh nonce → run the on-device face match + snarkjs prover bound to
 * that nonce → POST /record with the structured proof + the WiFi reading.
 * The server re-verifies the proof and strictly re-checks the WiFi anchor
 * before writing an attendance event.
 *
 * There is intentionally no did-keyed status read (it would be a public
 * presence-enumeration oracle): the phone tracks its own check-in state
 * locally via [dev.zeroauth.android.sec.AttendanceStateStore].
 */
interface AttendanceApi {

    /**
     * WiFi-anchor config so the phone can auto-detect the company + gate.
     * An optional `companyId` scopes to a real HR-provisioned company; with
     * none, the seeded demo company is served (slice-1 back-compat).
     */
    @GET("api/attendance/company")
    suspend fun company(@Query("companyId") companyId: String? = null): CompanyResponse

    /** Open a pairing session; returns the nonce the prover binds to. */
    @POST("api/attendance/init")
    suspend fun init(@Body body: InitRequest = InitRequest()): InitResponse

    /** Verify the proof + WiFi gate and record the attendance event. */
    @POST("api/attendance/record")
    suspend fun record(@Body body: RecordRequest): RecordResponse

    /**
     * Bind an HR-provisioned membership to this device's identity. The phone
     * proves FRESH control of its (did, commitment) against the `/init`
     * nonce, then presents the single-use invite code. Identity-only — no
     * WiFi/presence (that's enforced at check-in, not at join).
     */
    @POST("api/attendance/claim")
    suspend fun claim(@Body body: ClaimRequest): ClaimResponse
}

// ─── Request / response DTOs ───────────────────────────────────────────

@Serializable
data class InitRequest(
    /** Optional; the server does not require it to open a session. */
    val did: String? = null,
    /** Scopes the session to a real company; null = the demo company. */
    val companyId: String? = null,
)

@Serializable
data class InitResponse(
    val sessionId: String,
    /** 62-hex-char 31-byte nonce the prover folds into the proof. */
    val nonce: String,
    val expiresAt: String? = null,
    val company: CompanyDto? = null,
)

@Serializable
data class CompanyResponse(
    val company: CompanyDto,
)

@Serializable
data class CompanyDto(
    val name: String,
    val location: String,
    val wifi: CompanyWifiDto,
)

@Serializable
data class CompanyWifiDto(
    /**
     * Human-readable SSID label — the local presence hint matches on this
     * (the BSSID is no longer sent on the public surface; security A-42).
     */
    val ssidLabel: String = "",
    /**
     * Anchor router MACs. The public surface no longer ships these (the
     * server keeps the MAC private and verdicts the phone-reported BSSID),
     * so this is always empty from `/company` now — kept for back-compat.
     */
    val bssids: List<String> = emptyList(),
    /** Minimum signal strength percent 0..100 (the office "85%"). */
    val minSignalPercent: Int = 85,
)

@Serializable
data class RecordRequest(
    val sessionId: String,
    /** "check_in" | "check_out". */
    val type: String,
    val did: String,
    val proof: ProofDto,
    val publicSignals: List<String>,
    val wifi: WifiDto,
    /** Scopes the check-in to a real company; null = the demo company. */
    val companyId: String? = null,
    val clientMeta: ClientMetaDto? = null,
)

/**
 * snarkjs-shaped Groth16 proof, @Serializable mirror of the prover's
 * [dev.zeroauth.android.prover.Groth16Proof]. Strings are decimal field
 * elements. The bridge forwards this straight into the proof-pairing
 * verifier.
 */
@Serializable
data class ProofDto(
    val pi_a: List<String>,
    val pi_b: List<List<String>>,
    val pi_c: List<String>,
    val protocol: String = "groth16",
    val curve: String = "bn128",
)

@Serializable
data class WifiDto(
    /** Connected router MAC. */
    val bssid: String? = null,
    /** Signal strength percent 0..100. */
    val signal: Int? = null,
)

@Serializable
data class ClientMetaDto(
    val appVersion: String? = null,
    val platform: String? = null,
    val model: String? = null,
    val proofMs: Long? = null,
    val playIntegrityVerdict: String? = null,
)

@Serializable
data class RecordResponse(
    val ok: Boolean = false,
    val type: String? = null,
    val result: String? = null,
    val occurredAt: String? = null,
)

/**
 * Body for `POST /api/attendance/claim`. Field order matches the backend's
 * validation. `commitment` must equal `publicSignals[0]`; `publicSignals`
 * has exactly 3 elements with `[1] = Poseidon(Poseidon(commitment), nonce)`
 * bound to the `/init` session. No wifi/clientMeta — claim is identity-only.
 */
@Serializable
data class ClaimRequest(
    val companyId: String,
    val inviteCode: String,
    val sessionId: String,
    val did: String,
    val commitment: String,
    val proof: ProofDto,
    val publicSignals: List<String>,
)

@Serializable
data class ClaimResponse(
    val ok: Boolean = false,
    val companyId: String? = null,
    val employee: ClaimEmployeeDto? = null,
)

@Serializable
data class ClaimEmployeeDto(
    /** The membership row id (NOT the tenant_user id). */
    val id: String,
    val employeeId: String,
    val fullName: String,
)
