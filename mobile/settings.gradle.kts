// mobile/settings.gradle.kts — root settings for the Phase 1 Pramaan app.
//
// The Phase 1 mobile tree is intentionally three modules so the surface
// areas with the highest review burden — the prover (Groth16 + rapidsnark
// JNI) and the sensors (R307 USB-OTG + BiometricPrompt) — sit behind their
// own Gradle module boundary. Cross-line review (security-reviewer +
// cryptographer-reviewer per docs/plan/bfsi-v1/06-ways-of-working.md) only
// needs to read the module that owns the change.
//
// Modules:
//   :app                          — Android app (Activity, Compose UI)
//   :prover                       — rapidsnark JNI bridge (impl lands C-104)
//   :sensors:r307                 — R307 USB-OTG driver (impl lands C-145)
//   :sensors:biometric_prompt     — BiometricPrompt fallback (impl lands C-144)
//   :face                         — CameraX + ML Kit face capture flow
//                                   (produces the 112×112 bitmap consumed by
//                                   the on-device biometric/embedder pipeline;
//                                   Scene 1 step 4 in 02-bank-demo.md).
//
// The existing android/ subtree (the W3 desktop-login WebView spike) is
// independent: it has its own settings.gradle.kts and Gradle root. Android
// Studio opens mobile/ as a separate project. Keeping them apart prevents
// the rapidsnark JNI build from leaking into the snarkjs spike and vice
// versa during the W3-to-W4 transition.

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
    // Gradle 8+ auto-discovers gradle/libs.versions.toml as the `libs`
    // catalog. We do NOT call versionCatalogs.create("libs") { from(...) }
    // here — that triggers Gradle's "you can only call the from method
    // a single time" error against the auto-discovered catalog.
}

rootProject.name = "ZeroAuthBanking"

include(":app")
include(":prover")
include(":sensors:r307")
include(":sensors:biometric_prompt")
include(":face")
