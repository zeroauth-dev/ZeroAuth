// mobile/face/build.gradle.kts — the on-device face-capture module.
//
// Scope: the CameraX preview + ML Kit face detection + 1.5 s stability
// liveness gate that produces a 112×112 cropped face bitmap for the
// downstream biometric/embedder pipeline. Scene 1 step 4 in
// `docs/plan/bfsi-v1/02-bank-demo.md`:
//
//   "Face capture (CameraX + on-device ML Kit face detection). App shows
//    a viewfinder, waits for a centred, well-lit face, takes the capture
//    entirely on-device. The face image never leaves the device."
//
// Module boundary contract:
//   * No network code in this module. The Lint network-traffic and
//     `INTERNET` permission rules are NOT relaxed here.
//   * The Bitmap produced by `FaceCaptureScreen.onCaptured` is consumed
//     by an in-process callback supplied by `:app`. The runtime
//     assertion in `FaceCaptureScreen.kt` enforces that no callback
//     reachable from a network stack consumes it.
//   * ML Kit Face Detection runs the bundled on-device model — the
//     `face-detection` artefact (not `face-detection-base`) is pinned
//     in `gradle/libs.versions.toml` precisely because the bundled
//     model is shipped inside the AAR and never fetched over the
//     network.
//
// Why a separate module (vs. a package inside :app):
//   * CameraX + ML Kit Face Detection pull in ~30 transitive deps.
//     Isolating them behind a module boundary lets the security-reviewer
//     subagent scope its review to this module on every change without
//     re-reading the whole app.
//   * The Compose layer in :app calls into this module via the
//     `FaceCaptureScreen` composable + the `onCaptured: (Bitmap) -> Unit`
//     callback. That callback is the ONLY way a bitmap leaves this
//     module. If a future change tries to add a network client here,
//     the security-reviewer subagent will catch it (the README has the
//     explicit "no network" line item).

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.face"
    compileSdk = 34

    defaultConfig {
        minSdk = 30
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // The face viewfinder vector drawable uses the compat support
        // library at API 21+, but on min API 30 this is effectively a
        // no-op — the platform handles vector drawables natively.
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            // The :face module ships unobfuscated for now; minification
            // is enabled in :app once the full app graph stabilises
            // (post-C-167). Keeping :face unobfuscated here also keeps
            // ML Kit's reflection-based model loader from tripping the
            // ProGuard keep-rules dance.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs = freeCompilerArgs + listOf(
            "-opt-in=kotlin.RequiresOptIn",
        )
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    composeOptions {
        // Same compose-compiler pin as :app — Kotlin 1.9.22 path.
        kotlinCompilerExtensionVersion = libs.versions.compose.compiler.get()
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            // Allow JVM tests to reference Android classes that are
            // declared `final` (Bitmap, Rect) by treating them as
            // returnDefaultValues. The pure cropping/resizing math
            // tests don't touch Android types — they exercise the
            // pure helpers under BitmapCrop.kt.
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/DEPENDENCIES",
                "/META-INF/LICENSE",
                "/META-INF/LICENSE.txt",
                "/META-INF/NOTICE",
                "/META-INF/NOTICE.txt",
            )
        }
    }
}

dependencies {
    // ── AndroidX core / lifecycle / activity-compose ────────────────────
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // ── Compose — pinned material3 (no BOM at the library boundary) ────
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3.pinned)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // ── CameraX — preview + analysis + lifecycle ───────────────────────
    implementation(libs.bundles.camerax)

    // ── ML Kit Face Detection — bundled on-device model ────────────────
    // The bundled-model artefact NEVER hits the network at runtime; the
    // model ships inside the AAR. See the comment on
    // `mlkit-face-detection` in `gradle/libs.versions.toml` for the
    // rationale (CLAUDE.md non-goal: "biometric data never crosses the
    // network").
    implementation(libs.mlkit.face.detection)

    // ── kotlinx-coroutines — Task<>→ suspend bridge for ML Kit ─────────
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // ── Test ───────────────────────────────────────────────────────────
    testImplementation(libs.junit)
}
