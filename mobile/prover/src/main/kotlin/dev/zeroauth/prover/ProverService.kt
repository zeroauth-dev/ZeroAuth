package dev.zeroauth.prover

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import dev.zeroauth.prover.UnlockedCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Bound Service hosting the snarkjs WebView in the `:prover` OS process.
 *
 * ADR-0010 §"WebView is process-isolated and CSP-locked" calls for the
 * WebView running snarkjs to live in its own OS process so a renderer
 * compromise can't read the biometric secret out of the main process's
 * heap. The manifest declaration in AndroidManifest.xml pins this
 * Service to:
 *
 * ```
 *   android:process=":prover"
 *   android:isolatedProcess="true"
 *   android:exported="false"
 * ```
 *
 * **`android:isolatedProcess="true"` is the load-bearing flag.** An
 * isolated process runs with `uid=u0_aXXXX`, has no filesystem access
 * to the app's private data directory, cannot bind to Keystore, cannot
 * read SharedPreferences, cannot open `:authority=` content providers,
 * and can only talk to the rest of the world through its already-bound
 * IBinder. A renderer compromise inside the snarkjs WebView running
 * here is contained to that sandboxed UID — even if the WebView's JS
 * engine is fully exploited, the only credential material it can reach
 * is the in-flight witness for the CURRENT proof. Past proofs and the
 * Keystore-wrapped secret are unreachable.
 *
 * ## What's inside this Service
 *
 * The actual WebView lives in [WebViewMobileProver], scoped to this
 * Service's lifetime. The Service is a thin adapter:
 *
 *  1. `onBind`  → returns a Messenger backed by [IncomingHandler] on
 *     the main looper.
 *  2. On [MESSAGE_PROVE_REQUEST] → unmarshal the [ProverRequest], spin
 *     up the WebView prover (if not already), invoke `generate` on a
 *     coroutine, and forward progress / terminal events back to the
 *     client via the message's `replyTo`.
 *  3. On unbind with no bound clients → tear down the WebView so the
 *     `:prover` process can exit. Android reclaims the process the
 *     moment nothing is bound — keeping it warm would defeat the
 *     "fresh sandbox per session" property.
 *
 * ## Why we don't host the WebView body inline here
 *
 * [WebViewMobileProver] is reused as-is (the in-process fallback for
 * unit tests still constructs it directly). Inlining its body would
 * mean duplicating ~400 lines of WebView wiring just to drop one layer
 * of indirection — not worth it. The Service is a pure transport
 * wrapper.
 */
class ProverService : Service() {

    /**
     * Messenger handed back from [onBind]. Lifetime is tied to the
     * Service; Android invalidates the IBinder when the Service stops.
     */
    private lateinit var messenger: Messenger

    /**
     * Background coroutine scope for proof generation. Cancelled in
     * [onDestroy] so a hung in-flight prover doesn't leak across the
     * Service's lifetime.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /**
     * The actual WebView-hosted prover. Lazily constructed on first
     * [MESSAGE_PROVE_REQUEST] so the Service start cost is amortised
     * across the first proof rather than every bind.
     *
     * Single instance per Service lifetime — snarkjs is single-threaded
     * inside the WebView, so even if Messenger delivered two requests
     * concurrently the underlying prover would serialise them. We
     * additionally guard with [inFlight] below so any concurrent
     * request gets a clean Failure rather than queueing.
     */
    @Volatile
    private var webViewProver: WebViewMobileProver? = null

    @Volatile
    private var inFlight: Job? = null

    override fun onCreate() {
        super.onCreate()
        Timber.tag(TAG).d("ProverService.onCreate (pid=%d)", android.os.Process.myPid())
        messenger = Messenger(IncomingHandler(Looper.getMainLooper()))
    }

    /**
     * Single-binder Service. The same Messenger is returned for every
     * bind so multiple call sites can share the in-process state.
     * Android keeps the binding alive as long as at least one client
     * holds it.
     */
    override fun onBind(intent: Intent?): IBinder = messenger.binder

    override fun onUnbind(intent: Intent?): Boolean {
        Timber.tag(TAG).d("ProverService.onUnbind")
        // Returning false (the default) means onRebind is NOT called
        // on the next bind; Android will treat each new bind as a
        // fresh connection. Good — a fresh connection guarantees we
        // start from a clean WebView state.
        teardownWebView()
        return false
    }

    override fun onDestroy() {
        Timber.tag(TAG).d("ProverService.onDestroy (pid=%d)", android.os.Process.myPid())
        teardownWebView()
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Drop the WebView and cancel any in-flight prover. Idempotent.
     * Runs on the main looper because WebView.destroy() is required
     * to.
     */
    private fun teardownWebView() {
        inFlight?.cancel()
        inFlight = null
        val proverRef = webViewProver
        webViewProver = null
        if (proverRef != null) {
            // WebViewMobileProver.destroy() already hops to the main
            // looper internally; we still post for paranoia in case
            // onDestroy reaches us from a non-main thread (rare but
            // legal during forced-stop scenarios).
            Handler(Looper.getMainLooper()).post { proverRef.destroy() }
        }
    }

    /**
     * Handles MESSAGE_PROVE_REQUEST. Hosted on the main looper so
     * WebView.loadUrl from inside [WebViewMobileProver] is safe.
     */
    private inner class IncomingHandler(looper: Looper) : Handler(looper) {

        override fun handleMessage(msg: Message) {
            when (msg.what) {
                MESSAGE_PROVE_REQUEST -> handleProveRequest(msg)
                else -> {
                    Timber.tag(TAG).w("Unknown msg.what=%d", msg.what)
                }
            }
        }
    }

    /**
     * Run a single proof generation. Parameters arrive as a
     * [ProverRequest] in the message's data bundle; progress + the
     * terminal envelope are posted back through `msg.replyTo`.
     *
     * Defensive contract:
     *   * If [inFlight] is non-null we reject with PROVER_FAILED
     *     ("busy"). The client should serialise its calls.
     *   * If the request data is malformed we reply with
     *     WITNESS_INVALID — never silently drop.
     *   * If the underlying WebView throws we map to its
     *     [ProverException] code unchanged.
     */
    private fun handleProveRequest(msg: Message) {
        val replyTo = msg.replyTo
        if (replyTo == null) {
            Timber.tag(TAG).w("MESSAGE_PROVE_REQUEST missing replyTo; dropping")
            return
        }

        val request = parseRequest(msg)
        if (request == null) {
            sendFailure(
                replyTo,
                ProverException.WITNESS_INVALID,
                "ProverRequest payload missing from message data",
            )
            return
        }

        if (inFlight != null) {
            sendFailure(
                replyTo,
                ProverException.PROVER_FAILED,
                "ProverService is busy with another proof",
            )
            return
        }

        val prover = ensureWebViewProver()
        val input = GenerateInput(
            unlocked = IpcCredential(request),
            sessionNonceHex = request.sessionNonceHex,
        )

        inFlight = scope.launch {
            try {
                val out = prover.generate(input) { progress ->
                    sendProgress(replyTo, progress)
                }
                sendSuccess(replyTo, out)
            } catch (t: ProverException) {
                Timber.tag(TAG).w(t, "ProverService: prover failed code=%s", t.code)
                sendFailure(replyTo, t.code, t.message ?: "Prover failed")
            } catch (t: Throwable) {
                Timber.tag(TAG).e(t, "ProverService: unexpected error")
                sendFailure(
                    replyTo,
                    ProverException.PROVER_FAILED,
                    t.message ?: "Prover threw an unhandled error",
                )
            } finally {
                inFlight = null
                // The credential we built from the request lives only
                // for the duration of this proof; closing it lets the
                // GC reclaim the field-element strings without any
                // further reference.
                runCatching { input.unlocked.close() }
            }
        }
    }

    private fun ensureWebViewProver(): WebViewMobileProver {
        webViewProver?.let { return it }
        synchronized(this) {
            webViewProver?.let { return it }
            // Build the prover against the Service context. In an
            // isolated process the application context here is the
            // Service-local context — there's no app singleton to
            // reach back to. WebViewMobileProver's `appContext` is
            // already scoped via applicationContext, which on a
            // Service reduces to the Service's own context. That's
            // fine for the WebView since the asset loader only needs
            // a Context to read from APK assets.
            val p = WebViewMobileProver(this)
            webViewProver = p
            return p
        }
    }

    private fun parseRequest(msg: Message): ProverRequest? {
        // Messenger marshals objects through the message's `data`
        // Bundle, not through `obj` (which doesn't survive an IPC
        // hop). The client side sets the bundle via setData(); we
        // mirror that here.
        val bundle: Bundle = msg.data ?: return null
        bundle.classLoader = ProverRequest::class.java.classLoader
        @Suppress("DEPRECATION")
        val req: ProverRequest? = if (android.os.Build.VERSION.SDK_INT >= 33) {
            bundle.getParcelable(KEY_REQUEST, ProverRequest::class.java)
        } else {
            bundle.getParcelable(KEY_REQUEST)
        }
        return req
    }

    private fun sendProgress(replyTo: Messenger, fraction: Float) {
        sendResponse(replyTo, ProverResponse.Progress(fraction.coerceIn(0f, 1f)))
    }

    private fun sendSuccess(replyTo: Messenger, out: GenerateOutput) {
        sendResponse(replyTo, ProverResponse.Success.fromGenerateOutput(out))
    }

    private fun sendFailure(replyTo: Messenger, code: String, message: String) {
        sendResponse(replyTo, ProverResponse.Failure(code, message))
    }

    private fun sendResponse(replyTo: Messenger, response: ProverResponse) {
        val msg = Message.obtain().apply {
            what = MESSAGE_PROVE_RESPONSE
            data = Bundle().apply {
                classLoader = ProverResponse::class.java.classLoader
                putParcelable(KEY_RESPONSE, response)
            }
        }
        try {
            replyTo.send(msg)
        } catch (t: RemoteException) {
            // Client process died mid-request. Nothing we can do —
            // log and let the in-flight coroutine wind down naturally.
            Timber.tag(TAG).w(t, "ProverService: replyTo.send failed (client gone)")
        }
    }

    /**
     * Lightweight [UnlockedCredential] backed by IPC inputs. Owns no
     * Keystore handle (it can't — we're in an isolated process), just
     * carries the field-element strings through to
     * [WebViewMobileProver].
     *
     * `close()` is best-effort. The String references reach the JS
     * bridge via `WebViewMobileProver.buildPayload`, which copies them
     * into a JSON document. After the WebView returns, both this
     * IpcCredential and the JSON payload become GC-reachable garbage;
     * we can't actively zero a JVM String. The defence-in-depth is
     * the process boundary itself — when the Service shuts down (on
     * unbind), the entire `:prover` process exits and all heap
     * contents are unmapped at the kernel level.
     */
    private class IpcCredential(req: ProverRequest) : UnlockedCredential() {
        override val biometricSecret: String = req.biometricSecret
        override val salt: String = req.salt
        override val commitment: String = req.commitment
        override val didHash: String = req.didHash
        override val did: String = req.did
        override fun close() {
            // Intentionally no-op — see kdoc above.
        }
    }

    companion object {
        private const val TAG = "ProverService"

        /** Bundle key for a [ProverRequest] in MESSAGE_PROVE_REQUEST. */
        const val KEY_REQUEST: String = "ProverService.request"

        /** Bundle key for a [ProverResponse] in MESSAGE_PROVE_RESPONSE. */
        const val KEY_RESPONSE: String = "ProverService.response"
    }
}
