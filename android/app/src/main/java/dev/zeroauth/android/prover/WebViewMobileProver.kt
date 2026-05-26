package dev.zeroauth.android.prover

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import java.math.BigInteger
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Reference [MobileProver] implementation that drives snarkjs inside
 * a hardened WebView. Follows ADR-0010's bundling + isolation guard
 * rails to the letter:
 *
 *   * Assets are loaded via [WebViewAssetLoader] from the synthetic
 *     origin `https://appassets.androidplatform.net/assets/prover/`.
 *     No network egress, no `file://`, no `content://`.
 *   * The WebView is created with every relevant boolean turned to
 *     `false` (see [ensureWebView]). `connect-src 'none'` in
 *     prover.html's CSP further locks out `fetch`/XHR/WebSocket exfil.
 *   * Self-verify of the proof runs inside the WebView before the
 *     bytes leave the sandbox. A `false` return surfaces as
 *     [ProverException] with code [ProverException.PROVER_FAILED].
 *
 * Threading model: WebView's lifecycle methods MUST be called on the
 * main looper. The public [generate] hops through a main-thread
 * [Handler] for every WebView interaction and suspends the caller on
 * `suspendCancellableCoroutine` while JS does its work. Background
 * crash detection runs through [WebViewClient.onRenderProcessGone].
 *
 * **Production code does NOT instantiate this class directly.** The
 * production app uses [IsolatedMobileProver], which runs an instance
 * of this class inside a bound [ProverService] hosted in
 * `android:process=":prover"` with `android:isolatedProcess="true"`.
 * That separation is what fulfils ADR-0010 §"WebView is process-
 * isolated and CSP-locked" and the threat-model rows A-17 + A-24 —
 * the WebView is sandboxed in its own UID with no access to Keystore,
 * SharedPreferences, or the app's private data dir.
 *
 * This class remains in tree for two reasons:
 *
 *   1. The [ProverService] uses it as its internal worker — the
 *      WebView wiring is the same on either side of the process
 *      boundary, so we share the implementation.
 *   2. Unit tests target the WebView contract directly without an
 *      IPC bridge (see WebViewMobileProverTest), and the in-process
 *      fallback is convenient for Robolectric paths where standing up
 *      a full `:prover` Service binding would be more ceremony than
 *      payoff. Robolectric's WebView shadow doesn't actually execute
 *      JS, so the test surface is input-validation and lifecycle, not
 *      end-to-end proof generation.
 */
class WebViewMobileProver(
    context: Context,
    private val assetLoader: WebViewAssetLoader = defaultAssetLoader(context),
) : MobileProver {

    // Use the application context so the WebView outlives any
    // Activity that calls into the prover.
    private val appContext = context.applicationContext

    // WebView lifecycle methods are main-looper-only by contract.
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Reentry guard: only one in-flight generate() at a time. Without
     * this a stray late callback from the WebView (e.g. a delayed
     * progress event after the continuation resolved) would crash with
     * "Already resumed". MobileProver is a thin singleton; callers
     * must serialize.
     */
    private val pending = AtomicBoolean(false)

    /** Strict-but-tolerant JSON parser. */
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /**
     * Lazy single-instance WebView. Created on the first [generate];
     * subsequent calls reuse it so the asset cache survives.
     */
    @Volatile
    private var webView: WebView? = null

    /**
     * Captures the in-flight continuation + its progress callback so
     * the [Bridge.onMessage] callback can route events to the right
     * suspended call. Accessed only on the main thread.
     */
    private data class InFlight(
        val cont: CancellableContinuation<GenerateOutput>,
        val onProgress: (Float) -> Unit,
        val did: String,
        var ready: Boolean,
    )

    @Volatile
    private var inFlight: InFlight? = null

    @Volatile
    private var queuedPayload: String? = null

    override suspend fun generate(
        input: GenerateInput,
        onProgress: (Float) -> Unit,
    ): GenerateOutput {
        // EVERYTHING — including validation and witness derivation —
        // runs inside try/finally so the caller's UnlockedCredential
        // isn't held longer than necessary. The credential is owned by
        // the caller per the interface doc; we do NOT close() it here.
        val payload = try {
            buildPayload(input)
        } catch (e: ProverException) {
            throw e
        } catch (e: Throwable) {
            // BadInput-class problems should never escape as anything
            // other than ProverException(WITNESS_INVALID).
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "witness derivation failed: ${e.message}",
                cause = e,
            )
        }

        try {
            return withTimeout(PROVE_TIMEOUT_MS) {
                if (!pending.compareAndSet(false, true)) {
                    throw ProverException(
                        code = ProverException.PROVER_FAILED,
                        message = "MobileProver is busy with another proof",
                    )
                }
                try {
                    suspendCancellableCoroutine { cont ->
                        mainHandler.post {
                            try {
                                ensureWebView()
                                inFlight = InFlight(
                                    cont = cont,
                                    onProgress = onProgress,
                                    did = input.unlocked.did,
                                    ready = false,
                                )
                                queuedPayload = payload
                                // Re-load on every call so a stale
                                // WebView state from a prior call
                                // cannot carry over.
                                webView?.loadUrl(PROVER_URL)
                            } catch (t: Throwable) {
                                pending.set(false)
                                inFlight = null
                                queuedPayload = null
                                cont.resumeWithException(
                                    ProverException(
                                        code = ProverException.PROVER_FAILED,
                                        message = "failed to load prover.html: ${t.message}",
                                        cause = t,
                                    )
                                )
                            }
                        }
                        cont.invokeOnCancellation {
                            mainHandler.post {
                                inFlight = null
                                queuedPayload = null
                            }
                        }
                    }
                } finally {
                    pending.set(false)
                }
            }
        } catch (t: TimeoutCancellationException) {
            inFlight = null
            queuedPayload = null
            throw ProverException(
                code = ProverException.TIMEOUT,
                message = "Proof generation took longer than $PROVE_TIMEOUT_MS ms",
                cause = t,
            )
        }
    }

    /**
     * Builds the JSON payload that prover.js consumes. Throws
     * [ProverException] with code [ProverException.WITNESS_INVALID]
     * on any shape violation.
     */
    private fun buildPayload(input: GenerateInput): String {
        val cred = input.unlocked

        // 1. Range-check decimal field elements.
        val biometricSecret = parseFieldElement("biometricSecret", cred.biometricSecret)
        val salt = parseFieldElement("salt", cred.salt)
        val commitment = parseFieldElement("commitment", cred.commitment)
        val didHashRaw = parseFieldElement("didHash", cred.didHash)

        // 2. Validate the session nonce hex shape. 31 bytes = 62
        //    hex chars per ADR-0009 §"Pinned parameters".
        val nonceHex = input.sessionNonceHex
        if (nonceHex.length != 62) {
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "sessionNonceHex must be 62 hex chars (31 bytes); got ${nonceHex.length}",
            )
        }
        if (!nonceHex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "sessionNonceHex must be lower- or upper-case hex",
            )
        }
        val sessionNonce = try {
            BigInteger(nonceHex, 16)
        } catch (e: NumberFormatException) {
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "sessionNonceHex did not parse as a BigInteger",
                cause = e,
            )
        }
        if (sessionNonce.signum() < 0 || sessionNonce >= FIELD_MODULUS) {
            // 31 bytes is < 2^248 which is well inside the BN128 prime,
            // so this should be unreachable for well-formed input — but
            // we belt-and-brace it because the modular bias is exactly
            // the reason ADR-0009 picked 31 not 32.
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "sessionNonce out of BN128 field range",
            )
        }

        if (cred.did.isBlank()) {
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "did must not be blank",
            )
        }

        // 3. Serialise. Hand-build JSON to avoid pulling kotlinx-serialization
        //    into a hot path (we already have a JSON parser for the inbound
        //    side; the outbound side is fixed-shape).
        return buildString(256) {
            append("{\"type\":\"prove\",\"inputs\":{")
            append("\"biometricSecret\":\"").append(biometricSecret.toString(10)).append("\",")
            append("\"salt\":\"").append(salt.toString(10)).append("\",")
            append("\"commitment\":\"").append(commitment.toString(10)).append("\",")
            append("\"didHashRaw\":\"").append(didHashRaw.toString(10)).append("\",")
            append("\"sessionNonce\":\"").append(sessionNonce.toString(10)).append("\"")
            append("}}")
        }
    }

    /**
     * Lazy WebView construction. ADR-0010 §"WebView is process-isolated
     * and CSP-locked" — these settings are NOT optional.
     */
    private fun ensureWebView() {
        if (webView != null) return
        val wv = WebView(appContext).apply {
            settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                allowFileAccessFromFileURLs = false
                allowUniversalAccessFromFileURLs = false
                javaScriptCanOpenWindowsAutomatically = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                domStorageEnabled = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                databaseEnabled = false
                builtInZoomControls = false
                displayZoomControls = false
                setGeolocationEnabled(false)
                blockNetworkImage = true
                blockNetworkLoads = true
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun onRenderProcessGone(
                    view: WebView,
                    detail: RenderProcessGoneDetail,
                ): Boolean {
                    Timber.tag(TAG).e(
                        "WebView renderer process died (didCrash=%s)",
                        detail.didCrash(),
                    )
                    val active = inFlight
                    inFlight = null
                    queuedPayload = null
                    active?.cont?.resumeWithException(
                        ProverException(
                            code = ProverException.WEBVIEW_CRASHED,
                            message = "renderer process gone (didCrash=${detail.didCrash()})",
                        )
                    )
                    // The WebView object is now unusable; null it out
                    // so the next generate() builds a fresh one.
                    webView = null
                    return true
                }
            }
            // The bridge name is intentionally specific — `ZABridge` is
            // checked by name on the JS side (window.ZABridge.onMessage),
            // so this is the supply-chain contract surface. If the
            // installed JS doesn't see this exact name we'd much rather
            // hang on a Kotlin timeout than be silently bypassed.
            addJavascriptInterface(Bridge(), JS_BRIDGE_NAME)
        }
        webView = wv
    }

    /**
     * `@JavascriptInterface` host that prover.js calls into. All
     * methods are reachable from arbitrary JS executing in the WebView
     * — keep this surface tiny.
     */
    private inner class Bridge {

        @JavascriptInterface
        fun onMessage(raw: String) {
            // Off-thread parse to keep the JS thread responsive.
            val message: JsonElement = try {
                json.parseToJsonElement(raw)
            } catch (t: Throwable) {
                Timber.tag(TAG).w(t, "ZABridge.onMessage: bad JSON")
                return
            }
            val obj = (message as? JsonObject) ?: return
            val type = obj["type"]?.jsonPrimitive?.contentOrNullSafe() ?: return

            mainHandler.post { dispatch(type, obj) }
        }
    }

    /**
     * Main-thread dispatch from the JS bridge. Switching to the main
     * thread before touching the [inFlight] continuation removes the
     * need for synchronisation in `dispatch` itself.
     */
    private fun dispatch(type: String, obj: JsonObject) {
        val flight = inFlight ?: return

        when (type) {
            "ready" -> {
                if (!flight.ready) {
                    flight.ready = true
                    val payload = queuedPayload
                    queuedPayload = null
                    if (payload != null) {
                        // Fire the prove request. We use a javascript:
                        // URL not postMessage because (a) the CSP permits
                        // it (same-origin), (b) it sidesteps the WebView's
                        // postMessage origin filter, and (c) JS syntax
                        // errors surface as result callbacks.
                        val js = "javascript:window.zaHandleProve(${jsString(payload)})"
                        webView?.loadUrl(js)
                    }
                }
            }
            "progress" -> {
                val pct = obj["percent"]?.jsonPrimitive?.contentOrNullSafe()?.toIntOrNull()
                if (pct != null) {
                    flight.onProgress(pct.coerceIn(0, 100) / 100f)
                }
            }
            "result" -> {
                if (flight.cont.isActive) {
                    runCatching { parseResult(obj, flight.did) }
                        .onSuccess { out ->
                            inFlight = null
                            flight.cont.resume(out)
                        }
                        .onFailure { t ->
                            inFlight = null
                            flight.cont.resumeWithException(
                                ProverException(
                                    code = ProverException.PROVER_FAILED,
                                    message = "Malformed result envelope: ${t.message}",
                                    cause = t,
                                )
                            )
                        }
                }
            }
            "error" -> {
                val code = obj["code"]?.jsonPrimitive?.contentOrNullSafe().orEmpty()
                val message = obj["message"]?.jsonPrimitive?.contentOrNullSafe().orEmpty()
                val mapped = when (code) {
                    "self_verify_failed" -> ProverException(
                        code = ProverException.PROVER_FAILED,
                        message = "snarkjs.groth16.verify returned false on-device",
                    )
                    "boot_failed", "serialize_failed" -> ProverException(
                        code = ProverException.PROVER_FAILED,
                        message = "prover boot failed [$code]: $message",
                    )
                    else -> ProverException(
                        code = ProverException.WITNESS_INVALID,
                        message = "prover error [$code]: $message",
                    )
                }
                if (flight.cont.isActive) {
                    inFlight = null
                    flight.cont.resumeWithException(mapped)
                }
            }
            else -> {
                Timber.tag(TAG).w("Unknown message type from prover.js: %s", type)
            }
        }
    }

    private fun parseResult(obj: JsonObject, did: String): GenerateOutput {
        val proofObj = obj["proof"]?.jsonObject
            ?: throw IllegalArgumentException("missing proof")
        val publicSignals = obj["publicSignals"]?.jsonArray
            ?: throw IllegalArgumentException("missing publicSignals")
        val proofMs = obj["proofMs"]?.jsonPrimitive?.contentOrNullSafe()?.toLongOrNull() ?: 0L

        val pi_a = proofObj["pi_a"]?.jsonArray
            ?.map { it.jsonPrimitive.content }
            ?: throw IllegalArgumentException("missing pi_a")
        val pi_b = proofObj["pi_b"]?.jsonArray
            ?.map { row -> row.jsonArray.map { it.jsonPrimitive.content } }
            ?: throw IllegalArgumentException("missing pi_b")
        val pi_c = proofObj["pi_c"]?.jsonArray
            ?.map { it.jsonPrimitive.content }
            ?: throw IllegalArgumentException("missing pi_c")

        return GenerateOutput(
            proof = Groth16Proof(
                pi_a = pi_a,
                pi_b = pi_b,
                pi_c = pi_c,
                protocol = proofObj["protocol"]?.jsonPrimitive?.contentOrNullSafe() ?: "groth16",
                curve = proofObj["curve"]?.jsonPrimitive?.contentOrNullSafe() ?: "bn128",
            ),
            publicSignals = publicSignals.map { it.jsonPrimitive.content },
            did = did,
            proofMs = proofMs,
        )
    }

    /**
     * Optional best-effort tear-down. Android GCs the WebView when its
     * containing process exits anyway; this is exposed so the prover
     * activity can call it from its own `onDestroy` to bring the
     * renderer process down deterministically.
     */
    fun destroy() {
        mainHandler.post {
            inFlight = null
            queuedPayload = null
            webView?.destroy()
            webView = null
        }
    }

    companion object {
        private const val TAG = "WebViewMobileProver"
        private const val JS_BRIDGE_NAME = "ZABridge"
        private const val PROVER_URL =
            "https://appassets.androidplatform.net/assets/prover/prover.html"

        /**
         * 30 s — ADR-0010 measures snarkjs WebView proofs at 3-8 s on
         * mid-range Android. The cap is generous so a slow first-launch
         * compile of the WASM doesn't time out, but tight enough that
         * a hung renderer surfaces quickly.
         */
        const val PROVE_TIMEOUT_MS = 30_000L

        /** BN128 scalar field modulus. */
        internal val FIELD_MODULUS: BigInteger = BigInteger(
            "21888242871839275222246405745257275088548364400416034343698204186575808495617"
        )

        /**
         * Build the default [WebViewAssetLoader]. The synthetic origin
         * `https://appassets.androidplatform.net/` is the documented
         * default; per the WebKit team this hostname is reserved for
         * this purpose and is not routable on the internet.
         */
        fun defaultAssetLoader(context: Context): WebViewAssetLoader =
            WebViewAssetLoader.Builder()
                .addPathHandler(
                    "/assets/",
                    WebViewAssetLoader.AssetsPathHandler(context.applicationContext),
                )
                .build()

        /**
         * Validates that [raw] is a decimal-string field element
         * inside the BN128 scalar field. Returns the BigInteger so
         * the caller can re-emit a canonical decimal (no leading
         * zeros) into the JSON payload.
         */
        internal fun parseFieldElement(name: String, raw: String): BigInteger {
            if (raw.isEmpty()) {
                throw ProverException(
                    code = ProverException.WITNESS_INVALID,
                    message = "$name must be a non-empty decimal string",
                )
            }
            if (!raw.all { it in '0'..'9' }) {
                throw ProverException(
                    code = ProverException.WITNESS_INVALID,
                    message = "$name must be a decimal string of digits (got: ${raw.take(16)}…)",
                )
            }
            val n = try {
                BigInteger(raw)
            } catch (e: NumberFormatException) {
                throw ProverException(
                    code = ProverException.WITNESS_INVALID,
                    message = "$name did not parse as a BigInteger",
                    cause = e,
                )
            }
            if (n.signum() < 0 || n >= FIELD_MODULUS) {
                throw ProverException(
                    code = ProverException.WITNESS_INVALID,
                    message = "$name out of BN128 field range",
                )
            }
            return n
        }

        /**
         * Encode a string as a JS string literal so it can be embedded
         * in a `javascript:` URL passed to `loadUrl()`. The string
         * we're encoding is itself a JSON document; prover.js calls
         * `JSON.parse(arg)` on receipt.
         */
        internal fun jsString(s: String): String {
            val sb = StringBuilder(s.length + 8)
            sb.append('"')
            for (c in s) {
                when {
                    c == '\\' -> sb.append("\\\\")
                    c == '"' -> sb.append("\\\"")
                    c == '\n' -> sb.append("\\n")
                    c == '\r' -> sb.append("\\r")
                    c == '\t' -> sb.append("\\t")
                    // U+2028 LINE SEPARATOR + U+2029 PARAGRAPH SEPARATOR
                    // are valid JSON but illegal in JS string literals;
                    // explicit escape required.
                    c.code == 0x2028 -> sb.append("\\u2028")
                    c.code == 0x2029 -> sb.append("\\u2029")
                    c.code < 0x20 -> sb.append("\\u%04x".format(c.code))
                    else -> sb.append(c)
                }
            }
            sb.append('"')
            return sb.toString()
        }
    }
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * `kotlinx.serialization.json.JsonPrimitive#contentOrNull` ships in
 * a later release; copy the trivial implementation here so we don't
 * tie a version bump to this PR.
 */
private fun JsonPrimitive.contentOrNullSafe(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else this.content
