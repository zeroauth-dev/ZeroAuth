package dev.zeroauth.android.net

import dev.zeroauth.android.BuildConfig
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Path
import java.util.concurrent.TimeUnit

/**
 * Retrofit binding for the optional read-only metadata endpoint the
 * phone may hit between scanning the challenge QR and prompting for
 * biometric. EVERYTHING the phone strictly needs is already in the
 * challenge QR (sessionId, nonceHex, tenantDomain) — this call is a
 * stretch: it returns the human-readable "Sign in to Chrome on a
 * MacBook Pro" label IF the backend has populated it.
 *
 * Why a separate `/public` sub-path (NOT documented in api_contract.md
 * as of 2026-05-22 — the literal `* /public` would close this KDoc
 * block, so the path is written without the leading asterisk):
 *
 *   - The phone holds NO tenant API key. ADR-0009 § "Phone is
 *     air-gapped from the backend" explicitly says the phone never
 *     POSTs to api.zeroauth.dev; it does NOT preclude an unauthenticated
 *     read-only metadata GET.
 *   - The current `GET /v1/proof-pairing/sessions/:id` endpoint
 *     requires both `proof_pairing:create` scope AND the `session_bind`
 *     cookie. Neither is available on the phone.
 *
 * The W3 contract drift is real and worth flagging in the exit report:
 * `*/public` does NOT exist on the backend today. This Retrofit binding
 * is wired so the phone is ready when the backend opt-in lands, and
 * the ScanViewModel treats any 4xx from this call as "fine, fall back
 * to QR-only parsing." There is no path in the demo where this call
 * MUST succeed.
 *
 * The default base URL `https://api.zeroauth.dev` matches the live
 * deployment. The R8 release config (`isMinifyEnabled = true`) keeps
 * kotlinx.serialization's reflection working via the `@Keep` rule we
 * add to proguard-rules.pro when the prover lands.
 */
interface ZeroAuthApi {

    /**
     * Public, unauthenticated metadata read for a pairing session.
     *
     * Returns the minimum the phone needs to render "Sign in to
     * {initiatorLabel} on {tenantName}?". If [initiatorLabel] is
     * absent the phone falls back to "this desktop". If [tenantName]
     * is absent the phone falls back to the [tenantDomain] from the
     * QR payload.
     *
     * The Authorization header is reserved for a future opt-in where
     * the phone presents a per-session pairing JWT minted from the
     * challenge QR — out of scope for W3. Today the parameter is
     * accepted but ignored by the (non-existent) backend endpoint.
     */
    @GET("v1/proof-pairing/sessions/{id}/public")
    suspend fun getSession(
        @Header("Authorization") bearer: String = "",
        @Path("id") id: String,
    ): SessionResponse
}

@Serializable
data class SessionResponse(
    val session: PairingSession,
)

/**
 * Mirror of the backend `proof_pairing_sessions` row but ONLY the
 * fields safe to surface unauthenticated.
 *
 * NEVER add: tenant_id, api_key_id, session_bind_token_hash,
 * proof_hash, consumed_user_id, consumed_verification_id. Those leak
 * tenant data and cross the ADR-0009 enumeration-defence boundary.
 */
@Serializable
data class PairingSession(
    val id: String,
    /** 62-hex-char 31-byte nonce. */
    val nonce: String,
    /** "issued" / "consumed" / "expired" / "failed". */
    val state: String,
    /** ISO-8601 timestamp. */
    @SerialName("expiresAt") val expiresAt: String,
    /** Best-effort label from the desktop's User-Agent. Optional. */
    @SerialName("initiatorLabel") val initiatorLabel: String? = null,
    /** Human display name of the tenant. Optional. */
    @SerialName("tenantName") val tenantName: String? = null,
)

/**
 * Factory for [ZeroAuthApi]. Holds no state — the returned proxy is
 * lightweight to recreate, but in practice ZeroAuthApp will cache a
 * single instance once it lands in the W4 DI graph.
 *
 * The OkHttp client is configured conservatively:
 *
 *   - 10-second connect, 15-second read. The phone is typically on a
 *     phone-grade cellular link during a desktop sign-in demo; longer
 *     timeouts give us a chance against carrier-grade NAT hairpins.
 *   - HttpLoggingInterceptor only in debug. Release builds suppress
 *     bodies to make sure no session id ever lands in adb logcat on a
 *     production handset.
 *
 * No certificate pinning today — Caddy at api.zeroauth.dev rotates
 * Let's Encrypt certs and we don't yet have a pin update mechanism.
 * Tracked as a follow-up under the W4 security punch list.
 */
object ApiFactory {

    private val json: Json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
        explicitNulls = false
    }

    fun create(baseUrl: String = DEFAULT_BASE_URL): ZeroAuthApi {
        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .addInterceptor(logging)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(ZeroAuthApi::class.java)
    }

    /**
     * Public for unit tests so they can verify the production default
     * without grepping the source.
     */
    const val DEFAULT_BASE_URL: String = "https://api.zeroauth.dev/"
}
