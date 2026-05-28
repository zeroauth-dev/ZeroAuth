package dev.zeroauth

import android.app.Application
import android.util.Log

/**
 * Process-level lifecycle owner for the Pramaan banking app.
 *
 * This Application class is intentionally empty at scaffold time (C-101).
 * Initialisation of the real subsystems happens here as feature commits
 * land:
 *
 *  * C-104 — bind a [dev.zeroauth.prover.Prover] singleton against the
 *    rapidsnark JNI bridge. Loaded eagerly because the native library
 *    is ~6 MB and a cold init at first-proof time would blow the login
 *    latency budget documented in `docs/plan/bfsi-v1/02-bank-demo.md`
 *    Scene 2 (1.0–1.5 s wall-clock).
 *  * C-143 — wire CameraX + ML Kit face detection for the enrollment
 *    flow described in Scene 1.
 *  * C-144 — initialise the StrongBox-backed Keystore manager so the
 *    biometric helper data has somewhere to live before the
 *    enrollment Activity needs it.
 *  * C-145 — register the R307 USB-OTG driver as a USB-attached
 *    BroadcastReceiver target.
 *
 * Keep the `Log.i` below in place: the post-install smoke test set up
 * in C-104 greps for this line in `adb logcat` to confirm the app
 * actually launched on the device under test.
 */
class ZeroAuthApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        // Marker line consumed by the smoke harness; do not remove
        // without updating `docs/team/mobile/jni-poc-result.md`.
        Log.i(TAG, "Application start")
    }

    private companion object {
        const val TAG = "ZeroAuth"
    }
}
