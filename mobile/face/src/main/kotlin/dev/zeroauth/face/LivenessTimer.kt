package dev.zeroauth.face

/**
 * Tracks "face present continuously for N ms" — the v1 liveness gate.
 *
 * ## Why a separate class
 *
 * The 1.5 s stability check is the entire "liveness" story at v1. We
 * isolate it from the Compose state machine because:
 *
 *   * The timer can be exhaustively unit-tested on the JVM by injecting
 *     a controlled clock function.
 *   * When the real liveness implementation lands — blink detection,
 *     head-turn challenge, depth probing — it replaces this timer
 *     wholesale. Keeping the v1 timer behind a narrow surface means the
 *     `:app` integration changes one line.
 *
 * ## v1 limitation (read this before shipping)
 *
 * TODO: ADR 0020 — full liveness
 *
 * This timer is NOT a real liveness gate. A still photograph of a face
 * held in front of the front camera will satisfy this check. The
 * production liveness module (target: Phase 1 Sprint 3, C-148) will:
 *
 *   * Require a randomized head-turn challenge ("look left", "look up").
 *   * Run blink detection over ML Kit's eye-open probability per frame.
 *   * Require an on-device depth probe via the front sensor where
 *     available.
 *
 * Until that module lands, this timer satisfies the Phase 1 Sprint 2
 * acceptance criterion ("face stable for ≥ 1.5 s") and nothing more.
 * The enrollment flow at C-143 ships with this timer plus an explicit
 * "liveness v1" string in the Compose UI so the operator demoing the
 * bank pitch knows which liveness story they're showing.
 *
 * ## Clock injection
 *
 * The single ctor arg `clock: () -> Long` returns a monotonic
 * millisecond reading. In production callers pass
 * `android.os.SystemClock::elapsedRealtime` (a monotonic clock that
 * keeps ticking through sleep). In tests we pass a closure over a
 * mutable `Long` so we can advance time deterministically.
 *
 * The class is NOT thread-safe; callers must invoke its methods on a
 * single thread (typically the CameraX ImageAnalysis thread).
 *
 * @property thresholdMillis ms of continuous face-present time
 *   required to trigger [hasReachedThreshold]. v1 default is
 *   [CaptureStateMachine.REQUIRED_STABLE_MILLIS] (1500 ms).
 * @property clock monotonic-clock reader (see above).
 */
class LivenessTimer(
    private val thresholdMillis: Long = CaptureStateMachine.REQUIRED_STABLE_MILLIS,
    private val clock: () -> Long,
) {

    /** Timestamp at which the current contiguous "face present" run began. */
    private var faceFirstSeenAtMillis: Long? = null

    /**
     * Called for every analysis frame in which a face is detected,
     * centred, and within the size band. Idempotent — the timer
     * doesn't restart for an already-running session.
     */
    fun onFacePresent() {
        if (faceFirstSeenAtMillis == null) {
            faceFirstSeenAtMillis = clock()
        }
    }

    /**
     * Called when a frame contains no face, multiple faces, or a face
     * outside the centring/size bounds. Resets the timer — the next
     * call to [onFacePresent] starts a fresh session.
     */
    fun onFaceLost() {
        faceFirstSeenAtMillis = null
    }

    /**
     * Returns the elapsed ms in the current "face present" session, or
     * 0 if the session has been reset. Bounded below by 0; bounded
     * above by the live wall-clock delta.
     */
    fun stableForMillis(): Long {
        val seenAt = faceFirstSeenAtMillis ?: return 0L
        val elapsed = clock() - seenAt
        return if (elapsed < 0L) 0L else elapsed
    }

    /**
     * True iff the current session has reached the threshold. Stays
     * true until [onFaceLost] is called.
     */
    fun hasReachedThreshold(): Boolean =
        stableForMillis() >= thresholdMillis

    /** Explicit reset for the state machine to call on terminal transitions. */
    fun reset() {
        faceFirstSeenAtMillis = null
    }
}
