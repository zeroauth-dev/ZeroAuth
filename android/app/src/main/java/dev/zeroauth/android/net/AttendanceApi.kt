package dev.zeroauth.android.net

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

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

    /** WiFi-anchor config so the phone can auto-detect the company + gate. */
    @GET("api/attendance/company")
    suspend fun company(): CompanyResponse

    /** Open a pairing session; returns the nonce the prover binds to. */
    @POST("api/attendance/init")
    suspend fun init(@Body body: InitRequest = InitRequest()): InitResponse

    /** Verify the proof + WiFi gate and record the attendance event. */
    @POST("api/attendance/record")
    suspend fun record(@Body body: RecordRequest): RecordResponse
}

// ─── Request / response DTOs ───────────────────────────────────────────

@Serializable
data class InitRequest(
    /** Optional; the server does not require it to open a session. */
    val did: String? = null,
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
    /** Human-readable label only — never the security anchor. */
    val ssidLabel: String = "",
    /** Allowed router MACs (lower-cased). Empty = not configured. */
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
