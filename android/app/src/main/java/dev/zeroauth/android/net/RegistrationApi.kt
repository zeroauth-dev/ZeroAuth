package dev.zeroauth.android.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Retrofit binding for the three-QR end-user signup ceremony
 * (server-side ADR 0023). The phone holds NO tenant API key — the
 * QR-supplied code is the bearer credential for each step. See
 * `util/RegQrPayload.kt` for the parser that turns a scanned QR
 * string into the right request body for each step.
 *
 * Endpoint contract (server side):
 *
 *   POST /v1/registrations/pair-device
 *     body:  { pair_code, fingerprint, attestation_kind? }
 *     200:   { session_id, device_id, next: {...} }
 *     404:   { error: "pair_failed" }    — uniform on any failure
 *
 *   POST /v1/registrations/submit-commitment
 *     body:  { enroll_code, did, commitment, attestation_kind? }
 *     200:   { session_id, next: { step, code, deeplink, challenge_nonce } }
 *     404:   { error: "enroll_failed" }
 *
 *   POST /v1/registrations/complete
 *     body:  { verify_code, challenge_nonce, proof, public_signals }
 *     200:   { session_id, tenant_user, device }
 *     404:   { error: "verify_failed" }
 *
 * The phone-side rate-limit on these endpoints is 20 req/min per IP.
 *
 * The `proof` field on /complete carries the snarkjs Groth16 envelope
 * `{ pi_a, pi_b, pi_c, protocol, curve }`. We reuse [Groth16Proof]
 * from the proof-pairing prover (defined in
 * `dev.zeroauth.android.prover.MobileProver`) so the same struct
 * serialises identically into both surfaces.
 */
interface RegistrationApi {

    @POST("v1/registrations/pair-device")
    suspend fun pairDevice(@Body body: PairDeviceRequest): PairDeviceResponse

    @POST("v1/registrations/submit-commitment")
    suspend fun submitCommitment(@Body body: SubmitCommitmentRequest): SubmitCommitmentResponse

    @POST("v1/registrations/complete")
    suspend fun complete(@Body body: CompleteRequest): CompleteResponse
}

// ─── Request shapes ───────────────────────────────────────────────

@Serializable
data class PairDeviceRequest(
    @SerialName("pair_code") val pairCode: String,
    /**
     * Opaque hardware identifier — server requires >= 16 chars and
     * stores only its SHA-256. Production phones supply a stable
     * composition of android_id + installation_uuid + Play Integrity
     * package signature. See [dev.zeroauth.android.util.DeviceFingerprint]
     * for the canonical builder.
     */
    val fingerprint: String,
    @SerialName("attestation_kind") val attestationKind: String? = null,
)

@Serializable
data class SubmitCommitmentRequest(
    @SerialName("enroll_code") val enrollCode: String,
    /** `did:zeroauth:<method>:<hex>` — server validates the shape. */
    val did: String,
    /** Hex Poseidon commitment, with or without the leading `0x`. */
    val commitment: String,
    @SerialName("attestation_kind") val attestationKind: String? = null,
)

@Serializable
data class CompleteRequest(
    @SerialName("verify_code") val verifyCode: String,
    @SerialName("challenge_nonce") val challengeNonce: String,
    /**
     * snarkjs Groth16 proof envelope `{ pi_a, pi_b, pi_c, ...}`. We
     * use [JsonElement] so the [dev.zeroauth.android.prover.Groth16Proof]
     * struct from the prover module can be serialised inline without
     * a Retrofit-side adapter — the call site does the conversion.
     */
    val proof: JsonElement,
    @SerialName("public_signals") val publicSignals: List<String>,
)

// ─── Response shapes ──────────────────────────────────────────────

@Serializable
data class NextStep(
    val step: String,
    val code: String,
    @SerialName("expires_at") val expiresAt: String,
    val deeplink: String,
    @SerialName("challenge_nonce") val challengeNonce: String? = null,
)

@Serializable
data class PairDeviceResponse(
    @SerialName("session_id") val sessionId: String,
    @SerialName("device_id") val deviceId: String? = null,
    val next: NextStep,
)

@Serializable
data class SubmitCommitmentResponse(
    @SerialName("session_id") val sessionId: String,
    val next: NextStep,
)

@Serializable
data class CompleteResponse(
    @SerialName("session_id") val sessionId: String,
    @SerialName("tenant_user") val tenantUser: JsonElement? = null,
    val device: JsonElement? = null,
)
