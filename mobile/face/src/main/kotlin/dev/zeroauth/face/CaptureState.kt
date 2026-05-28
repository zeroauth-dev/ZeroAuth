package dev.zeroauth.face

/**
 * The state machine that drives the [FaceCaptureScreen] Compose flow.
 *
 * Implemented as a `sealed class` so the state surface is closed (the
 * compiler enforces exhaustive `when` arms on transition). Each variant
 * carries only the data needed for that state — keeping the
 * "data the screen renders for state X" coupling tight.
 *
 * ## States
 *
 * ```
 *                  ┌────────────────────────┐
 *                  │  RequestingPermission  │
 *                  └───────────┬────────────┘
 *                              │
 *               permission granted     permission denied
 *                              │            │
 *                              ▼            ▼
 *                      ┌──────────────┐  ┌──────────────────┐
 *                      │ Initializing │  │ Error            │
 *                      └──────┬───────┘  │  (PermissionDenied)│
 *                             │          └──────────────────┘
 *           camera bound      │
 *                             ▼
 *                      ┌──────────────┐
 *                      │WaitingForFace│ ◀───── face leaves frame
 *                      └──────┬───────┘                │
 *                             │                        │
 *                  face appears                        │
 *                             │                        │
 *                             ▼                        │
 *                      ┌──────────────┐                │
 *                      │FaceDetected  │ ───── face leaves / mis-centred
 *                      └──────┬───────┘
 *                             │
 *               face stable ≥ 1.5 s
 *                             │
 *                             ▼
 *                      ┌──────────────┐
 *                      │   Stable     │ ───── (instant) capture fires
 *                      └──────┬───────┘
 *                             │
 *                             ▼
 *                      ┌──────────────┐
 *                      │  Captured    │  (terminal — onCaptured fires)
 *                      └──────────────┘
 *
 *  Any non-recoverable failure transitions to Error from any node.
 * ```
 *
 * The transitions are documented by [CaptureStateMachine.next]; the
 * `:test` source set exercises every transition listed there.
 *
 * v1 scope: the [Stable] state is reached by a 1.5 s "face present
 * + centred + size band" stability check. Real liveness (blink, head
 * turn, depth) is deferred — see the README of this module + the
 * `TODO: ADR 0020 — full liveness` markers in the source.
 */
sealed class CaptureState {

    /**
     * The CAMERA runtime permission has not been granted yet.
     *
     * On entry [FaceCaptureScreen] renders the rationale screen and
     * fires the system permission prompt. The rationale screen has a
     * button that deep-links to the system Settings → App info for
     * the case where the user has previously selected "Don't ask
     * again".
     */
    data object RequestingPermission : CaptureState()

    /**
     * Permission is granted; CameraX is binding the use cases to the
     * lifecycle owner. Brief — typically < 200 ms on tier-1 devices.
     */
    data object Initializing : CaptureState()

    /**
     * The camera is running but no face is currently detected in
     * frame.
     */
    data object WaitingForFace : CaptureState()

    /**
     * One face is detected and is within the centring + size bounds.
     * The [LivenessTimer] is accumulating time-in-frame. If the face
     * leaves frame or mis-centres before the threshold, transitions
     * back to [WaitingForFace] and the timer resets.
     *
     * @property stableForMillis monotonic-clock milliseconds the face
     *   has been continuously stable for. Surfaced to the UI so the
     *   progress ring can render fill.
     * @property requiredMillis the threshold the timer must reach for
     *   the [Stable] transition. Constant per session — emitted into
     *   the state so the UI doesn't have to read the timer's internal
     *   pin. Defaults to 1500 ms per the v1 stability gate.
     */
    data class FaceDetected(
        val stableForMillis: Long,
        val requiredMillis: Long,
    ) : CaptureState()

    /**
     * Stability threshold reached. This state is transient — the
     * Compose layer fires the capture as soon as the state machine
     * enters [Stable] and the next reduction takes the machine into
     * [Captured].
     *
     * Carrying this as a separate state (rather than collapsing
     * "stable + captured" into one) gives the Compose layer a brief
     * window to render the "captured!" affordance (haptic, viewfinder
     * flash) before the screen exits.
     */
    data object Stable : CaptureState()

    /**
     * Terminal success state. The `onCaptured(Bitmap)` callback has
     * been invoked (or is about to be invoked — the Compose layer is
     * the one that actually fires the callback after observing this
     * state).
     */
    data object Captured : CaptureState()

    /**
     * Terminal failure state. Carries a tagged reason so the screen
     * can render the right message + recovery affordance.
     */
    data class Error(val reason: ErrorReason) : CaptureState()

    /** Non-recoverable failure categories. */
    enum class ErrorReason {
        /** User denied the CAMERA permission (possibly forever). */
        PermissionDenied,

        /** No front-facing camera available on this device. */
        CameraUnavailable,

        /** CameraX threw during bind. ML Kit Face Detection threw, etc. */
        CameraInitFailed,

        /** User explicitly cancelled (back button, system gesture). */
        UserCancelled,
    }
}

/**
 * The transition events fed into [CaptureStateMachine.next].
 *
 * Distinct from [CaptureState] — events are *what happened* and states
 * are *what we render*. A 1:1 mapping is sometimes possible (e.g.
 * [Event.CameraReady] → [CaptureState.WaitingForFace]) but the
 * distinction keeps the state machine pure and exhaustively-testable
 * on the JVM.
 */
sealed class Event {

    /** The system permission prompt returned `granted = true`. */
    data object PermissionGranted : Event()

    /** The system permission prompt returned `granted = false`. */
    data object PermissionDenied : Event()

    /** CameraX `bindToLifecycle` resolved successfully. */
    data object CameraReady : Event()

    /** No front camera available, or CameraX `bindToLifecycle` threw. */
    data class CameraFailed(val isUnavailable: Boolean) : Event()

    /**
     * The latest ML Kit detection produced one face that is centred +
     * within the size band. Carries the timer's current `stableForMillis`
     * so the reducer can echo it into [CaptureState.FaceDetected].
     */
    data class FaceStillStable(val stableForMillis: Long) : Event()

    /**
     * The latest ML Kit detection produced zero faces, multiple faces,
     * or a face outside the centring / size bounds.
     */
    data object FaceLost : Event()

    /**
     * The [LivenessTimer] hit its threshold. The next state is
     * [CaptureState.Stable].
     */
    data object StabilityThresholdReached : Event()

    /**
     * The Compose layer has finished the bitmap crop + resize and is
     * about to invoke the `onCaptured(Bitmap)` callback. Moves the
     * machine to its terminal success state.
     */
    data object CaptureSucceeded : Event()

    /** User pressed the system back button or the cancel affordance. */
    data object UserCancelled : Event()
}

/**
 * The pure state-machine reducer.
 *
 * Lifted out of [FaceCaptureScreen] so the transition logic can be
 * exhaustively unit-tested on the JVM with no Android, no CameraX, no
 * ML Kit dependency. The reducer is a single function — `next(state,
 * event) -> state` — which makes it trivial to mock in tests.
 *
 * Transitions implemented:
 *
 * | From                  | Event                       | To                    |
 * |-----------------------|-----------------------------|-----------------------|
 * | RequestingPermission  | PermissionGranted           | Initializing          |
 * | RequestingPermission  | PermissionDenied            | Error(PermissionDenied)|
 * | Initializing          | CameraReady                 | WaitingForFace        |
 * | Initializing          | CameraFailed(unavail=true)  | Error(CameraUnavailable)|
 * | Initializing          | CameraFailed(unavail=false) | Error(CameraInitFailed)|
 * | WaitingForFace        | FaceStillStable(ms)         | FaceDetected(ms, 1500) |
 * | WaitingForFace        | FaceLost                    | WaitingForFace (no-op) |
 * | FaceDetected          | FaceStillStable(ms)         | FaceDetected(ms, 1500) |
 * | FaceDetected          | FaceLost                    | WaitingForFace        |
 * | FaceDetected          | StabilityThresholdReached   | Stable                |
 * | Stable                | CaptureSucceeded            | Captured              |
 * | Any non-terminal      | UserCancelled               | Error(UserCancelled)  |
 *
 * Events that are not legal in the current state are silently dropped
 * (the reducer returns the current state unchanged). This matches the
 * "ML Kit can deliver a late frame after the user has already
 * cancelled" case without crashing the machine.
 */
object CaptureStateMachine {

    /** The v1 stability threshold. See module README. */
    const val REQUIRED_STABLE_MILLIS: Long = 1500L

    fun next(state: CaptureState, event: Event): CaptureState {
        // Cancellation from any non-terminal state goes to Error.
        if (event is Event.UserCancelled && !isTerminal(state)) {
            return CaptureState.Error(CaptureState.ErrorReason.UserCancelled)
        }
        return when (state) {
            is CaptureState.RequestingPermission -> when (event) {
                is Event.PermissionGranted -> CaptureState.Initializing
                is Event.PermissionDenied ->
                    CaptureState.Error(CaptureState.ErrorReason.PermissionDenied)
                else -> state
            }
            is CaptureState.Initializing -> when (event) {
                is Event.CameraReady -> CaptureState.WaitingForFace
                is Event.CameraFailed ->
                    if (event.isUnavailable) {
                        CaptureState.Error(CaptureState.ErrorReason.CameraUnavailable)
                    } else {
                        CaptureState.Error(CaptureState.ErrorReason.CameraInitFailed)
                    }
                else -> state
            }
            is CaptureState.WaitingForFace -> when (event) {
                is Event.FaceStillStable -> CaptureState.FaceDetected(
                    stableForMillis = event.stableForMillis,
                    requiredMillis = REQUIRED_STABLE_MILLIS,
                )
                is Event.FaceLost -> state
                else -> state
            }
            is CaptureState.FaceDetected -> when (event) {
                is Event.FaceStillStable -> CaptureState.FaceDetected(
                    stableForMillis = event.stableForMillis,
                    requiredMillis = state.requiredMillis,
                )
                is Event.FaceLost -> CaptureState.WaitingForFace
                is Event.StabilityThresholdReached -> CaptureState.Stable
                else -> state
            }
            is CaptureState.Stable -> when (event) {
                is Event.CaptureSucceeded -> CaptureState.Captured
                else -> state
            }
            // Terminal states absorb everything.
            is CaptureState.Captured -> state
            is CaptureState.Error -> state
        }
    }

    /** Terminal states: [CaptureState.Captured] and [CaptureState.Error]. */
    fun isTerminal(state: CaptureState): Boolean =
        state is CaptureState.Captured || state is CaptureState.Error
}
