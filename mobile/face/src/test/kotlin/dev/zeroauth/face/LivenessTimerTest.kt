package dev.zeroauth.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM-only tests for [LivenessTimer], driven by a closure-controlled
 * clock so we can advance time deterministically.
 *
 * The timer is the entirety of the v1 liveness gate (see the file-
 * level comment on `LivenessTimer.kt`). Every transition documented
 * there has a test below.
 */
class LivenessTimerTest {

    /** Mutable monotonic clock used by the timer under test. */
    private var nowMillis: Long = 0L
    private val clock: () -> Long = { nowMillis }

    @Test
    fun `fresh timer reports zero elapsed`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        assertEquals(0L, t.stableForMillis())
        assertFalse(t.hasReachedThreshold())
    }

    @Test
    fun `single onFacePresent records timestamp`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        assertEquals(0L, t.stableForMillis())
        nowMillis = 1500L
        assertEquals(500L, t.stableForMillis())
        nowMillis = 2500L
        assertEquals(1500L, t.stableForMillis())
        assertTrue(t.hasReachedThreshold())
    }

    @Test
    fun `repeated onFacePresent calls are idempotent`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        nowMillis = 1100L
        t.onFacePresent()
        nowMillis = 1200L
        t.onFacePresent()
        // The first call sets the timestamp; subsequent calls inside
        // the same session don't restart it.
        assertEquals(200L, t.stableForMillis())
    }

    @Test
    fun `onFaceLost resets the timer`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        nowMillis = 2400L
        assertEquals(1400L, t.stableForMillis())

        t.onFaceLost()
        assertEquals(0L, t.stableForMillis())
        assertFalse(t.hasReachedThreshold())
    }

    @Test
    fun `face lost and re-found starts a fresh session`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        nowMillis = 2400L
        // 1400 ms elapsed — almost at threshold but not yet.
        assertFalse(t.hasReachedThreshold())

        t.onFaceLost()
        nowMillis = 3000L
        t.onFacePresent()
        assertEquals(0L, t.stableForMillis())

        nowMillis = 4499L
        // 1499 ms after re-seeing face — still under threshold.
        assertFalse(t.hasReachedThreshold())

        nowMillis = 4500L
        // 1500 ms after re-seeing face — threshold reached.
        assertTrue(t.hasReachedThreshold())
    }

    @Test
    fun `threshold flag stays true once tripped until reset`() {
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        nowMillis = 5000L  // far past threshold
        assertTrue(t.hasReachedThreshold())
        // Calling onFacePresent again doesn't un-trip — same session
        // continues.
        t.onFacePresent()
        assertTrue(t.hasReachedThreshold())
        // Explicit reset clears it.
        t.reset()
        assertFalse(t.hasReachedThreshold())
        assertEquals(0L, t.stableForMillis())
    }

    @Test
    fun `clock that ticks backwards reports zero elapsed`() {
        // Defensive: if the injected clock somehow ticks backwards
        // (clock skew, test mishap), the timer should not report a
        // negative elapsed. This matches the `if (elapsed < 0L)
        // return 0L` guard in `stableForMillis`.
        val t = LivenessTimer(thresholdMillis = 1500L, clock = clock)
        nowMillis = 5000L
        t.onFacePresent()
        nowMillis = 4000L
        assertEquals(0L, t.stableForMillis())
    }

    @Test
    fun `threshold is configurable per session`() {
        val short = LivenessTimer(thresholdMillis = 500L, clock = clock)
        val long = LivenessTimer(thresholdMillis = 3000L, clock = clock)
        nowMillis = 1000L
        short.onFacePresent()
        long.onFacePresent()
        nowMillis = 2000L
        // 1000 ms elapsed → short timer past 500, long timer not at 3000.
        assertTrue(short.hasReachedThreshold())
        assertFalse(long.hasReachedThreshold())
    }

    @Test
    fun `default threshold matches the state machine constant`() {
        val t = LivenessTimer(clock = clock)
        nowMillis = 1000L
        t.onFacePresent()
        nowMillis = 1000L + CaptureStateMachine.REQUIRED_STABLE_MILLIS - 1L
        assertFalse(t.hasReachedThreshold())
        nowMillis = 1000L + CaptureStateMachine.REQUIRED_STABLE_MILLIS
        assertTrue(t.hasReachedThreshold())
    }
}
