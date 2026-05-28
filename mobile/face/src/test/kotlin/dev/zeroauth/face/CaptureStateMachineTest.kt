package dev.zeroauth.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM-only tests for [CaptureStateMachine].
 *
 * One test per row in the transition table in the
 * [CaptureStateMachine] KDoc, plus exhaustive coverage of:
 *
 *   * UserCancelled from every non-terminal state lands at
 *     Error(UserCancelled).
 *   * Terminal states (Captured, Error) absorb every event.
 *   * Events that are not legal in the current state are no-ops
 *     (the reducer returns the current state unchanged).
 *
 * The state machine is a pure function — the tests are correspondingly
 * trivial. Their value is the *coverage* of every transition the
 * Compose layer relies on, so that a future refactor of the reducer
 * cannot silently break the screen.
 */
class CaptureStateMachineTest {

    /* ───────── RequestingPermission ───────── */

    @Test
    fun `RequestingPermission + PermissionGranted -- Initializing`() {
        val next = CaptureStateMachine.next(
            CaptureState.RequestingPermission, Event.PermissionGranted,
        )
        assertEquals(CaptureState.Initializing, next)
    }

    @Test
    fun `RequestingPermission + PermissionDenied -- Error(PermissionDenied)`() {
        val next = CaptureStateMachine.next(
            CaptureState.RequestingPermission, Event.PermissionDenied,
        )
        assertEquals(
            CaptureState.Error(CaptureState.ErrorReason.PermissionDenied),
            next,
        )
    }

    @Test
    fun `RequestingPermission ignores irrelevant events`() {
        val start = CaptureState.RequestingPermission
        // FaceStillStable, FaceLost, CameraReady, etc. all no-op.
        assertEquals(start, CaptureStateMachine.next(start, Event.FaceLost))
        assertEquals(start, CaptureStateMachine.next(start, Event.CameraReady))
        assertEquals(start, CaptureStateMachine.next(start, Event.FaceStillStable(0L)))
    }

    /* ───────── Initializing ───────── */

    @Test
    fun `Initializing + CameraReady -- WaitingForFace`() {
        val next = CaptureStateMachine.next(
            CaptureState.Initializing, Event.CameraReady,
        )
        assertEquals(CaptureState.WaitingForFace, next)
    }

    @Test
    fun `Initializing + CameraFailed(unavailable) -- Error(CameraUnavailable)`() {
        val next = CaptureStateMachine.next(
            CaptureState.Initializing,
            Event.CameraFailed(isUnavailable = true),
        )
        assertEquals(
            CaptureState.Error(CaptureState.ErrorReason.CameraUnavailable),
            next,
        )
    }

    @Test
    fun `Initializing + CameraFailed(other) -- Error(CameraInitFailed)`() {
        val next = CaptureStateMachine.next(
            CaptureState.Initializing,
            Event.CameraFailed(isUnavailable = false),
        )
        assertEquals(
            CaptureState.Error(CaptureState.ErrorReason.CameraInitFailed),
            next,
        )
    }

    /* ───────── WaitingForFace ───────── */

    @Test
    fun `WaitingForFace + FaceStillStable -- FaceDetected`() {
        val next = CaptureStateMachine.next(
            CaptureState.WaitingForFace,
            Event.FaceStillStable(stableForMillis = 250L),
        )
        assertEquals(
            CaptureState.FaceDetected(
                stableForMillis = 250L,
                requiredMillis = CaptureStateMachine.REQUIRED_STABLE_MILLIS,
            ),
            next,
        )
    }

    @Test
    fun `WaitingForFace + FaceLost is a no-op`() {
        val start = CaptureState.WaitingForFace
        val next = CaptureStateMachine.next(start, Event.FaceLost)
        assertSame(start, next)
    }

    /* ───────── FaceDetected ───────── */

    @Test
    fun `FaceDetected + FaceStillStable updates stableForMillis only`() {
        val start = CaptureState.FaceDetected(
            stableForMillis = 200L,
            requiredMillis = 1500L,
        )
        val next = CaptureStateMachine.next(
            start, Event.FaceStillStable(stableForMillis = 700L),
        )
        assertEquals(
            CaptureState.FaceDetected(stableForMillis = 700L, requiredMillis = 1500L),
            next,
        )
    }

    @Test
    fun `FaceDetected + FaceLost -- WaitingForFace`() {
        val start = CaptureState.FaceDetected(500L, 1500L)
        val next = CaptureStateMachine.next(start, Event.FaceLost)
        assertEquals(CaptureState.WaitingForFace, next)
    }

    @Test
    fun `FaceDetected + StabilityThresholdReached -- Stable`() {
        val start = CaptureState.FaceDetected(1500L, 1500L)
        val next = CaptureStateMachine.next(
            start, Event.StabilityThresholdReached,
        )
        assertEquals(CaptureState.Stable, next)
    }

    /* ───────── Stable ───────── */

    @Test
    fun `Stable + CaptureSucceeded -- Captured`() {
        val next = CaptureStateMachine.next(
            CaptureState.Stable, Event.CaptureSucceeded,
        )
        assertEquals(CaptureState.Captured, next)
    }

    @Test
    fun `Stable ignores other events`() {
        val start = CaptureState.Stable
        assertSame(start, CaptureStateMachine.next(start, Event.FaceLost))
        assertSame(start, CaptureStateMachine.next(start, Event.CameraReady))
    }

    /* ───────── Cancellation ───────── */

    @Test
    fun `UserCancelled from any non-terminal state -- Error(UserCancelled)`() {
        val nonTerminalStates = listOf(
            CaptureState.RequestingPermission,
            CaptureState.Initializing,
            CaptureState.WaitingForFace,
            CaptureState.FaceDetected(800L, 1500L),
            CaptureState.Stable,
        )
        for (s in nonTerminalStates) {
            val next = CaptureStateMachine.next(s, Event.UserCancelled)
            assertEquals(
                "UserCancelled from $s should produce Error(UserCancelled)",
                CaptureState.Error(CaptureState.ErrorReason.UserCancelled),
                next,
            )
        }
    }

    /* ───────── Terminal absorption ───────── */

    @Test
    fun `Captured absorbs every event`() {
        val start = CaptureState.Captured
        for (event in everyEvent()) {
            val next = CaptureStateMachine.next(start, event)
            assertSame(
                "Captured must absorb $event without transitioning",
                start, next,
            )
        }
    }

    @Test
    fun `Error absorbs every event`() {
        val start = CaptureState.Error(CaptureState.ErrorReason.CameraInitFailed)
        for (event in everyEvent()) {
            val next = CaptureStateMachine.next(start, event)
            assertSame(
                "Error must absorb $event without transitioning",
                start, next,
            )
        }
    }

    /* ───────── isTerminal ───────── */

    @Test
    fun `isTerminal returns true only for Captured and Error`() {
        assertTrue(CaptureStateMachine.isTerminal(CaptureState.Captured))
        assertTrue(
            CaptureStateMachine.isTerminal(
                CaptureState.Error(CaptureState.ErrorReason.UserCancelled),
            )
        )
        // Every other state is non-terminal.
        val nonTerminal = listOf(
            CaptureState.RequestingPermission,
            CaptureState.Initializing,
            CaptureState.WaitingForFace,
            CaptureState.FaceDetected(0L, 1500L),
            CaptureState.Stable,
        )
        for (s in nonTerminal) {
            assertEquals(
                "isTerminal($s) should be false",
                false, CaptureStateMachine.isTerminal(s),
            )
        }
    }

    /* ───────── Round-trip: full happy path ───────── */

    @Test
    fun `full happy path RequestingPermission to Captured`() {
        // Drive the machine through the demo Scene 1 success path.
        var state: CaptureState = CaptureState.RequestingPermission

        state = CaptureStateMachine.next(state, Event.PermissionGranted)
        assertEquals(CaptureState.Initializing, state)

        state = CaptureStateMachine.next(state, Event.CameraReady)
        assertEquals(CaptureState.WaitingForFace, state)

        state = CaptureStateMachine.next(state, Event.FaceStillStable(300L))
        assertTrue(state is CaptureState.FaceDetected)

        state = CaptureStateMachine.next(state, Event.FaceStillStable(1500L))
        assertTrue(state is CaptureState.FaceDetected)

        state = CaptureStateMachine.next(state, Event.StabilityThresholdReached)
        assertEquals(CaptureState.Stable, state)

        state = CaptureStateMachine.next(state, Event.CaptureSucceeded)
        assertEquals(CaptureState.Captured, state)
        assertTrue(CaptureStateMachine.isTerminal(state))
    }

    /* ───────── Round-trip: face lost + recovery ───────── */

    @Test
    fun `face lost mid-stability transitions back and resumes`() {
        var state: CaptureState = CaptureState.WaitingForFace

        state = CaptureStateMachine.next(state, Event.FaceStillStable(200L))
        assertTrue(state is CaptureState.FaceDetected)

        // User briefly looks away.
        state = CaptureStateMachine.next(state, Event.FaceLost)
        assertEquals(CaptureState.WaitingForFace, state)

        // User looks back; timer must restart (this is the
        // LivenessTimer's job — the state machine just records the
        // new stableForMillis).
        state = CaptureStateMachine.next(state, Event.FaceStillStable(0L))
        assertEquals(
            CaptureState.FaceDetected(0L, CaptureStateMachine.REQUIRED_STABLE_MILLIS),
            state,
        )
    }

    /* ───────── Helpers ───────── */

    private fun everyEvent(): List<Event> = listOf(
        Event.PermissionGranted,
        Event.PermissionDenied,
        Event.CameraReady,
        Event.CameraFailed(isUnavailable = true),
        Event.CameraFailed(isUnavailable = false),
        Event.FaceStillStable(0L),
        Event.FaceStillStable(750L),
        Event.FaceLost,
        Event.StabilityThresholdReached,
        Event.CaptureSucceeded,
        Event.UserCancelled,
    )
}
