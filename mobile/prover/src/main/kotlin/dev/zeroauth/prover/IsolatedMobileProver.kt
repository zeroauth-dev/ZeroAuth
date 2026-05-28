package dev.zeroauth.prover

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import timber.log.Timber

/**
 * Production [MobileProver] that ships proof generation to the
 * `:prover` OS process via a bound [ProverService].
 *
 * The class instance lives in the main app process. Its job is:
 *
 *  1. Validate the witness inputs client-side BEFORE anything crosses
 *     the IPC boundary. (Cheap rejection, no isolated-process spin-up
 *     for malformed requests.)
 *  2. Bind to [ProverService] on demand. The first call to
 *     [generate] triggers `bindService`; subsequent calls reuse the
 *     binding so we don't pay process-start latency per proof.
 *  3. Marshal a [ProverRequest] across the Messenger.
 *  4. Suspend the caller until a terminal [ProverResponse.Success]
 *     or [ProverResponse.Failure] (or the binding dies / the request
 *     times out).
 *  5. Convert the response back into the [MobileProver] contract —
 *     either a [GenerateOutput] or a thrown [ProverException].
 *
 * Threading: every state mutation runs on [mainHandler] (the main
 * Looper) so the [ServiceConnection] callbacks, the incoming
 * [Messenger], and the in-flight bookkeeping all live on the same
 * single-threaded executor. The public `generate` is `suspend` and
 * uses [suspendCancellableCoroutine] to bridge the callback API into
 * coroutines.
 *
 * ## Security posture
 *
 * After `generate` returns (success or failure), this class holds
 * NO reference to the witness inputs. The [ProverRequest] is
 * built once and immediately discarded; the response carries only
 * the public Groth16 proof + public signals. If the client wraps
 * `generate` in a `try { ... } finally { unlocked.close() }` (as
 * [ScanViewModel] does), the secret material is zeroed in main
 * within microseconds of the proof returning.
 *
 * The `:prover` process holds the witness only for the duration of
 * the proof. When [release] is called (or the Service unbinds
 * naturally), the Service tears down its WebView and Android
 * reclaims the entire process. Heap contents go with it.
 *
 * ## Binding-death handling
 *
 * Android's `onBindingDied` / `onServiceDisconnected` fires when the
 * `:prover` process crashes mid-request. We forward that as a
 * [ProverException] with code [ProverException.WEBVIEW_CRASHED] to
 * the in-flight continuation, mark the binding dead, and rebind on
 * the next [generate] call. The threat-model linkage is the same as
 * [WebViewMobileProver]'s in-process render-gone path (A-17): a
 * crashing renderer should never silently hang the proof.
 */
class IsolatedMobileProver internal constructor(
    context: Context,
    private val timeoutMs: Long,
    /**
     * Looper hosting the state-management thread. Production: the main
     * Looper, because WebView lifecycle methods and Android Service
     * connection callbacks both insist on the main thread. Tests:
     * Robolectric's PAUSED main looper. Test code that needs the
     * Looper drained must call
     * `ShadowLooper.shadowMainLooper().idle()` between coroutine
     * operations — see [IsolatedMobileProverTest].
     */
    looper: Looper,
    /**
     * Test seam — bypasses [Context.bindService] entirely and pretends
     * the Service is already connected. Non-null only in unit tests
     * where we want to inject a pre-baked Messenger that simulates the
     * Service responses without spinning Robolectric's bindService
     * shadow. Production code never sets this.
     */
    private val testOutgoing: Messenger?,
) : MobileProver {

    constructor(context: Context, timeoutMs: Long = DEFAULT_TIMEOUT_MS) :
        this(context, timeoutMs, looper = Looper.getMainLooper(), testOutgoing = null)

    private val appContext = context.applicationContext
    private val mainHandler = Handler(looper)

    /**
     * Serialise generate() calls. The Service tolerates only one
     * in-flight proof at a time, and the client side wants
     * deterministic FIFO ordering for the rare case where the UI
     * fires two consecutive scans before the first proof returns.
     */
    private val generateMutex = Mutex()

    /**
     * Single Messenger that the Service replies into. One incoming
     * handler dispatches to whichever continuation is currently
     * waiting for a response. Built off the same [looper] as
     * [mainHandler] so all state mutation happens on a single thread.
     */
    private val incoming = Messenger(IncomingHandler(looper))

    /**
     * Reference to the Service's Messenger once bound. Null while
     * unbound. All access guarded by [mainHandler].
     */
    @Volatile
    private var outgoing: Messenger? = null

    /**
     * Tracks whether [serviceConnection] has been registered against
     * the Service. `true` from when we call `bindService` until
     * `unbindService` returns.
     */
    private val bound = AtomicBoolean(false)

    /**
     * Coroutine continuation waiting for the Service to connect. Set
     * by [ensureBound]; resolved by [serviceConnection].
     */
    @Volatile
    private var connectionContinuation: CancellableContinuation<Messenger>? = null

    /**
     * Currently-suspended generate() call. Routes incoming
     * Service messages to the right continuation.
     */
    @Volatile
    private var inFlight: InFlightProof? = null

    private data class InFlightProof(
        val cont: CancellableContinuation<GenerateOutput>,
        val onProgress: (Float) -> Unit,
        val did: String,
    )

    // ─── Public API ───────────────────────────────────────────────────

    override suspend fun generate(
        input: GenerateInput,
        onProgress: (Float) -> Unit,
    ): GenerateOutput {
        // ─── Client-side validation. Identical to the in-process
        //     prover's checks so a misbehaving caller never ships a
        //     malformed witness to the isolated process.
        val request = try {
            buildRequest(input)
        } catch (e: ProverException) {
            throw e
        }

        return generateMutex.withLock {
            try {
                withTimeout(timeoutMs) {
                    val service = ensureBound()
                    invokeService(service, request, input.unlocked.did, onProgress)
                }
            } catch (t: TimeoutCancellationException) {
                throw ProverException(
                    code = ProverException.TIMEOUT,
                    message = "Isolated prover timed out after ${timeoutMs}ms",
                    cause = t,
                )
            }
        }
    }

    /**
     * Test-only hook: simulate the `:prover` Service binding dying
     * (process crash). Routes through the same code path as the
     * production [serviceConnection.onBindingDied] callback so the
     * test sees the same observable behaviour: in-flight continuation
     * fails with [ProverException.WEBVIEW_CRASHED] and the next
     * `generate` rebinds.
     *
     * Internal because it's a back door — production code observes
     * binding death through the system, never simulates it.
     */
    internal fun simulateBindingDied() {
        mainHandler.post {
            outgoing = null
            failInFlightWithCrash()
        }
    }

    /**
     * Best-effort tear-down. Releases the binding and lets Android
     * reclaim the `:prover` process. Safe to call repeatedly; safe to
     * call from any thread.
     */
    fun release() {
        mainHandler.post {
            if (bound.compareAndSet(true, false)) {
                try {
                    appContext.unbindService(serviceConnection)
                } catch (t: Throwable) {
                    Timber.tag(TAG).w(t, "unbindService threw (already unbound?)")
                }
            }
            outgoing = null
            inFlight?.let { flight ->
                inFlight = null
                if (flight.cont.isActive) {
                    flight.cont.resumeWithException(
                        ProverException(
                            code = ProverException.PROVER_FAILED,
                            message = "IsolatedMobileProver.release() called with proof in flight",
                        )
                    )
                }
            }
        }
    }

    // ─── Binding ──────────────────────────────────────────────────────

    /**
     * Ensure the Service is bound and the outgoing Messenger is live.
     * Idempotent: a no-op when already bound.
     */
    private suspend fun ensureBound(): Messenger {
        // Test injection: when [testOutgoing] is non-null we never bind
        // to a real Service. The injected Messenger acts as if
        // onServiceConnected fired immediately.
        testOutgoing?.let { return it }
        // Snapshot under the main-thread invariant. Volatile read is
        // safe because outgoing is only ever written from the main
        // thread (serviceConnection.onServiceConnected runs there).
        outgoing?.let { return it }
        return suspendCancellableCoroutine { cont ->
            mainHandler.post {
                val current = outgoing
                if (current != null) {
                    cont.resume(current)
                    return@post
                }
                // Stash the continuation so onServiceConnected can
                // resolve it. We support only ONE pending connect at
                // a time because generateMutex serialises generate()
                // calls.
                connectionContinuation = cont

                if (!bound.get()) {
                    val intent = Intent(appContext, ProverService::class.java)
                    val didBind = try {
                        appContext.bindService(
                            intent,
                            serviceConnection,
                            Context.BIND_AUTO_CREATE or Context.BIND_NOT_FOREGROUND,
                        )
                    } catch (t: Throwable) {
                        Timber.tag(TAG).e(t, "bindService threw")
                        false
                    }
                    if (!didBind) {
                        connectionContinuation = null
                        cont.resumeWithException(
                            ProverException(
                                code = ProverException.PROVER_FAILED,
                                message = "bindService returned false",
                            )
                        )
                        return@post
                    }
                    bound.set(true)
                }
                // Wait for serviceConnection.onServiceConnected to
                // resolve the continuation. If the binding dies in
                // the meantime, the same connection callback will
                // route a Failure into the same continuation.
            }
            cont.invokeOnCancellation {
                mainHandler.post {
                    connectionContinuation = null
                }
            }
        }
    }

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            Timber.tag(TAG).d("ProverService connected (%s)", name?.shortClassName)
            val m = Messenger(service)
            outgoing = m
            connectionContinuation?.let {
                connectionContinuation = null
                if (it.isActive) it.resume(m)
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            // Service process died unexpectedly. Android will retry
            // the binding when convenient; we proactively unbind so
            // the next generate() does a clean re-bind.
            Timber.tag(TAG).w("ProverService disconnected (%s)", name?.shortClassName)
            outgoing = null
            failInFlightWithCrash()
            // Don't flip `bound` here — Android will call
            // onBindingDied to confirm. Both paths converge on the
            // same fail-and-rebind behaviour.
        }

        override fun onBindingDied(name: ComponentName?) {
            Timber.tag(TAG).w("ProverService binding died (%s)", name?.shortClassName)
            outgoing = null
            if (bound.compareAndSet(true, false)) {
                try {
                    appContext.unbindService(this)
                } catch (t: Throwable) {
                    Timber.tag(TAG).w(t, "unbindService after onBindingDied threw")
                }
            }
            failInFlightWithCrash()
            connectionContinuation?.let {
                connectionContinuation = null
                if (it.isActive) {
                    it.resumeWithException(
                        ProverException(
                            code = ProverException.WEBVIEW_CRASHED,
                            message = "ProverService binding died before first response",
                        )
                    )
                }
            }
        }

        override fun onNullBinding(name: ComponentName?) {
            Timber.tag(TAG).e("ProverService.onBind returned null (%s)", name?.shortClassName)
            failInFlightWithCrash()
            connectionContinuation?.let {
                connectionContinuation = null
                if (it.isActive) {
                    it.resumeWithException(
                        ProverException(
                            code = ProverException.PROVER_FAILED,
                            message = "ProverService returned a null Binder",
                        )
                    )
                }
            }
        }
    }

    private fun failInFlightWithCrash() {
        val flight = inFlight ?: return
        inFlight = null
        if (flight.cont.isActive) {
            flight.cont.resumeWithException(
                ProverException(
                    code = ProverException.WEBVIEW_CRASHED,
                    message = "ProverService process died mid-proof",
                )
            )
        }
    }

    // ─── Service invocation ───────────────────────────────────────────

    private suspend fun invokeService(
        service: Messenger,
        request: ProverRequest,
        did: String,
        onProgress: (Float) -> Unit,
    ): GenerateOutput {
        return suspendCancellableCoroutine { cont ->
            mainHandler.post {
                if (inFlight != null) {
                    cont.resumeWithException(
                        ProverException(
                            code = ProverException.PROVER_FAILED,
                            message = "IsolatedMobileProver is busy with another proof",
                        )
                    )
                    return@post
                }
                inFlight = InFlightProof(cont, onProgress, did)

                val msg = Message.obtain().apply {
                    what = MESSAGE_PROVE_REQUEST
                    replyTo = incoming
                    data = Bundle().apply {
                        classLoader = ProverRequest::class.java.classLoader
                        putParcelable(ProverService.KEY_REQUEST, request)
                    }
                }
                try {
                    service.send(msg)
                } catch (t: RemoteException) {
                    Timber.tag(TAG).w(t, "service.send failed")
                    inFlight = null
                    cont.resumeWithException(
                        ProverException(
                            code = ProverException.WEBVIEW_CRASHED,
                            message = "ProverService crashed before accepting request",
                            cause = t,
                        )
                    )
                }
            }
            cont.invokeOnCancellation {
                mainHandler.post { inFlight = null }
            }
        }
    }

    /**
     * Handler that routes responses from the Service to the
     * in-flight proof's continuation.
     */
    private inner class IncomingHandler(looper: Looper) : Handler(looper) {
        override fun handleMessage(msg: Message) {
            if (msg.what != MESSAGE_PROVE_RESPONSE) {
                Timber.tag(TAG).w("Unknown response what=%d", msg.what)
                return
            }
            val data = msg.data
            data?.classLoader = ProverResponse::class.java.classLoader
            @Suppress("DEPRECATION")
            val response: ProverResponse? = if (android.os.Build.VERSION.SDK_INT >= 33) {
                data?.getParcelable(ProverService.KEY_RESPONSE, ProverResponse::class.java)
            } else {
                data?.getParcelable(ProverService.KEY_RESPONSE)
            }
            if (response == null) {
                Timber.tag(TAG).w("Empty ProverResponse")
                return
            }
            val flight = inFlight ?: run {
                Timber.tag(TAG).d("Late response with no in-flight continuation; ignored")
                return
            }
            when (response) {
                is ProverResponse.Progress -> {
                    runCatching { flight.onProgress(response.fraction) }
                        .onFailure { Timber.tag(TAG).w(it, "onProgress threw") }
                }
                is ProverResponse.Success -> {
                    inFlight = null
                    if (flight.cont.isActive) {
                        val out = response.toGenerateOutput()
                        // The Service's Success carries the did
                        // through verbatim, but in case of any
                        // future drift, the client's input.did
                        // remains the authoritative value we hand
                        // back to the caller.
                        flight.cont.resume(out.copy(did = flight.did))
                    }
                }
                is ProverResponse.Failure -> {
                    inFlight = null
                    if (flight.cont.isActive) {
                        flight.cont.resumeWithException(response.toException())
                    }
                }
            }
        }
    }

    // ─── Validation + request build ───────────────────────────────────

    /**
     * Build the IPC payload. Mirrors [WebViewMobileProver.buildPayload]
     * — same field-element bounds, same nonce shape — so a malformed
     * request never crosses the process boundary.
     */
    private fun buildRequest(input: GenerateInput): ProverRequest {
        val cred = input.unlocked
        // Range-check each field element. parseFieldElement throws
        // ProverException(WITNESS_INVALID) on any shape violation,
        // which propagates straight to the caller.
        WebViewMobileProver.parseFieldElement("biometricSecret", cred.biometricSecret)
        WebViewMobileProver.parseFieldElement("salt", cred.salt)
        WebViewMobileProver.parseFieldElement("commitment", cred.commitment)
        WebViewMobileProver.parseFieldElement("didHash", cred.didHash)

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

        if (cred.did.isBlank()) {
            throw ProverException(
                code = ProverException.WITNESS_INVALID,
                message = "did must not be blank",
            )
        }

        return ProverRequest(
            biometricSecret = cred.biometricSecret,
            salt = cred.salt,
            commitment = cred.commitment,
            didHash = cred.didHash,
            did = cred.did,
            sessionNonceHex = nonceHex,
        )
    }

    companion object {
        private const val TAG = "IsolatedMobileProver"

        /**
         * Default proof timeout. Slightly longer than the in-process
         * variant's 30 s because the first proof in a session pays the
         * `:prover` process-start cost (~50–150 ms on a mid-range
         * device).
         */
        const val DEFAULT_TIMEOUT_MS: Long = 35_000L
    }
}
