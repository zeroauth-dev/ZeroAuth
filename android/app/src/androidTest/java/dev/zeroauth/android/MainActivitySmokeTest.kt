package dev.zeroauth.android

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented smoke test — boots MainActivity inside the real Android
 * runtime (emulator or device) and verifies the activity reaches the
 * RESUMED state without crashing.
 *
 * The point of this test is NOT to assert UI correctness — Robolectric
 * + Compose Test cover ScanScreen's state machine in JVM-time. This is
 * the only end-to-end check that the APK we ship actually installs and
 * boots on a real Android runtime, including:
 *
 *   * The R8 / minification config doesn't strip something Compose
 *     needs (Compose's runtime relies on @StableMarker reflection that
 *     a too-aggressive proguard config breaks).
 *   * verifyProverAssets's bundled WebView assets are present at the
 *     expected /assets/prover/ path inside the installed APK.
 *   * The manifest is well-formed (intent filters, permissions, the
 *     ProverService entry once it lands).
 *   * The Theme.ZeroAuth + edge-to-edge wiring compiles + applies on
 *     API 30 (our minSdk).
 *
 * Runs in CI under .github/workflows/android.yml against the
 * reactivecircus/android-emulator-runner@v2 emulator at API 30. Local
 * dev: `./gradlew :app:connectedDebugAndroidTest` against an attached
 * device or `adb` emulator.
 */
@RunWith(AndroidJUnit4::class)
class MainActivitySmokeTest {

    @Test
    fun mainActivity_reachesResumed_withoutCrash() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // ActivityScenario.launch drives the activity to RESUMED
            // synchronously. If anything in onCreate / onStart / onResume
            // throws (theme resolution, Compose setContent, nav graph
            // construction, …), the launch itself fails with a propagated
            // exception and the test is red.
            assertNotNull("Activity scenario must not be null", scenario)

            // Be explicit so future readers see the intent: after launch,
            // moveToState(RESUMED) is a no-op if we're already there, but
            // it documents the contract under test.
            scenario.onActivity { activity ->
                assertNotNull("MainActivity reference must be non-null", activity)
            }
        }
    }
}
