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
 * the `/public` sub-path does NOT exist on the backend today. This
 * Retrofit binding is wired so the phone is ready when the backend
 * opt-in lands, and
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

    fun create(baseUrl: String = DEFAULT_BASE_URL): ZeroAuthApi =
        retrofit(baseUrl).create(ZeroAuthApi::class.java)

    /**
     * ADR 0023 three-QR signup ceremony — the phone-side endpoints
     * the registration scan flow hits. Same OkHttp + Retrofit stack
     * as [create]; pulled out into a separate factory so callers that
     * only need registration can avoid the ZeroAuthApi initialisation
     * cost on first use.
     */
    fun createRegistrationApi(baseUrl: String = DEFAULT_BASE_URL): RegistrationApi =
        retrofit(baseUrl).create(RegistrationApi::class.java)

    /**
     * Phone-push sign-in — the demo-portal bridge endpoint the
     * proof-pairing login POSTs its proof to (replacing the desktop
     * webcam scan-back). Same OkHttp + Retrofit stack as [create]; see
     * [DemoPortalApi] for the contract + the ADR-0009 air-gap note.
     */
    fun createDemoPortalApi(baseUrl: String = DEFAULT_BASE_URL): DemoPortalApi =
        retrofit(baseUrl).create(DemoPortalApi::class.java)

    /**
     * Face-first office attendance — the public `/api/attendance`
     * bridge the check-in/out ceremony hits. Same OkHttp + Retrofit stack
     * as [create]; the phone holds no tenant key, so the bridge attaches
     * the company tenant server-side (mirrors [createDemoPortalApi]).
     */
    fun createAttendanceApi(baseUrl: String = DEFAULT_BASE_URL): AttendanceApi =
        retrofit(baseUrl).create(AttendanceApi::class.java)

    private fun retrofit(baseUrl: String): Retrofit {
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
    }

    /**
     * The API host every Retrofit factory targets by default. Resolved at
     * build time from `BuildConfig.ZEROAUTH_BASE_URL`, which is wired in
     * `app/build.gradle.kts` per build type and overridable with the
     * `-PZEROAUTH_BASE_URL=…` Gradle property:
     *
     *   - **debug** (default `http://localhost:3030/`): targets the dev
     *     box over the USB `adb reverse tcp:3030 tcp:3030` tunnel — works
     *     identically on a real phone and the emulator, survives the Mac's
     *     IP changing, no Wi-Fi/LAN/firewall in the way. The debug
     *     `network_security_config.xml` whitelists `localhost` + `127.0.0.1`
     *     for cleartext; HTTPS to any host is allowed regardless.
     *   - **release** (default `https://api.zeroauth.dev/`): the production
     *     host.
     *   - **override**: pass `-PZEROAUTH_BASE_URL=https://api.zeroauth.dev/`
     *     to a *debug* build to produce an auto-signed, installable APK
     *     that talks to the LIVE server without the release keystore — the
     *     "hosted bank demo" sideload build.
     *
     * Operator runbook (local dev only):
     *   adb reverse tcp:3030 tcp:3030     # once per device reboot
     */
    val DEFAULT_BASE_URL: String = BuildConfig.ZEROAUTH_BASE_URL
}
