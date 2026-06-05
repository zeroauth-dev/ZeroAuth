package dev.zeroauth.android.net

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Retrofit binding for the phone-push sign-in path.
 *
 * ## Why this exists
 *
 * The original proof-pairing login (ADR-0009 "Option B′") was
 * air-gapped: the phone generated the Groth16 proof, rendered it as a
 * `za:proof:1:...` QR, and the DESKTOP scanned that QR with its webcam
 * to submit the proof. That falls apart on the very common case where
 * the desktop/laptop has no working camera — which is exactly what bit
 * us during real-device testing ("scanning that through laptop camera
 * didn't work, no preview").
 *
 * The fix mirrors how WhatsApp Web / Discord / Steam QR-login actually
 * work in production: the PHONE pushes the authenticated result to the
 * server, and the desktop just polls (over SSE) until it sees the
 * session flip to `consumed`. No desktop camera in the loop.
 *
 * This binding lets the phone POST the exact same `za:proof:1:...`
 * string it would otherwise have shown as a QR, straight to the
 * demo-portal bridge endpoint. The server decodes the embedded CBOR +
 * Groth16 proof, runs the full `submitProof` crypto chain (Poseidon
 * nonce re-derive, commitment compare, Groth16 verify, atomic
 * consume), and flips the pairing row to `consumed`. The desktop's
 * open SSE stream then emits `session_bound` / `authenticated` and the
 * browser navigates to the dashboard.
 *
 * ## Auth model
 *
 * The `/api/demo-portal/submit-proof` endpoint is PUBLIC (no tenant API
 * key, no JWT). The server holds the `session_bind` token in an
 * in-memory cache keyed by session id (stashed at `/init-login` time);
 * the phone never sees it. So the phone presents ONLY `{session_id,
 * qr_payload}` — both of which it already has (the session id is in the
 * challenge QR it scanned; the qr_payload is the proof it just
 * generated). No secret crosses the wire that wasn't already going to
 * cross via the QR channel.
 *
 * ## Security note (ADR-0009 air-gap)
 *
 * This intentionally relaxes the ADR-0009 "phone never POSTs to the
 * backend" property for the DEMO-PORTAL surface only. The production
 * `/v1/proof-pairing` air-gap is untouched. The crypto verification
 * is identical either way — the proof is still a zero-knowledge proof,
 * still bound to the session nonce, so a phone can only complete a
 * session whose challenge QR it actually scanned. The co-presence
 * guarantee weakens slightly (the phone, not the desktop, closes the
 * loop) in exchange for working on camera-less desktops. Flagged for
 * security-reviewer.
 *
 * Endpoint contract (server side — src/routes/demo-portal.ts):
 *
 *   POST /api/demo-portal/submit-proof
 *     body:  { session_id, qr_payload }
 *     200:   { ok: true, redirect: "/dashboard", session: {...} }
 *     400:   { error: "invalid_request" | "pairing_nonce_mismatch" | "pairing_did_unknown", ... }
 *     401:   { error: "pairing_proof_invalid", ... }
 *     409:   { error: "pairing_session_already_bound", ... }
 *     410:   { error: "pairing_session_expired", ... }
 *     423:   { error: "pairing_session_locked", ... }
 *     503:   { error: "verifier_unavailable" | "demo_portal_not_provisioned", ... }
 *
 * On any non-2xx Retrofit raises `retrofit2.HttpException`; the caller
 * ([dev.zeroauth.android.ui.scan.ScanViewModel.authorizeOnPhone])
 * extracts the `error` code from the JSON body so the UI surfaces the
 * documented failure class rather than a generic 500.
 */
interface DemoPortalApi {

    @POST("api/demo-portal/submit-proof")
    suspend fun submitProof(@Body body: SubmitProofRequest): SubmitProofResponse
}

@Serializable
data class SubmitProofRequest(
    @SerialName("session_id") val sessionId: String,
    @SerialName("qr_payload") val qrPayload: String,
)

@Serializable
data class SubmitProofResponse(
    val ok: Boolean = false,
    val redirect: String? = null,
    val session: SubmitProofSession? = null,
)

@Serializable
data class SubmitProofSession(
    val userId: String? = null,
    val did: String? = null,
    val boundAt: String? = null,
)
