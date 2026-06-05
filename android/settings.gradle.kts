// android/settings.gradle.kts — root settings for the W3 desktop-login wrapper app.
//
// Single Gradle project (`:app`) for now. If we ever add a `:prover` or
// `:keystore` module we'll wire them here. The version catalog lives at
// android/gradle/libs.versions.toml (NOT the repo-root gradle/ directory)
// so the Android workspace stays self-contained — Android Studio opens
// `android/` as a project root.

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
    // Gradle 8+ auto-discovers `gradle/libs.versions.toml` as the
    // `libs` catalog. An explicit `versionCatalogs { create("libs") {
    // from(...) } }` block here would call `from()` a second time and
    // fail with 'In version catalog libs, you can only call the from
    // method a single time.' — see the Gradle 8.7 catalog docs.
}

rootProject.name = "ZeroAuth"

include(":app")

// ── Phase 1 modules consumed by :app ───────────────────────────────────────
//
// The sources live under repo-root mobile/ — that tree was originally
// scaffolded with its own settings.gradle.kts (Kotlin 1.9.22 + AGP 8.3),
// but the production W3-spike app under android/ is what actually ships,
// so we expose the two modules here and let them resolve against this
// project's catalog (Kotlin 2.0.20 + AGP 8.5.2). The per-module
// build.gradle.kts files have been patched to use this catalog's
// aliases.
//
// :biometric — on-device face → Poseidon commitment pipeline
//              (FaceEmbedder + Quantizer + SHA-256 + Poseidon + Keccak256).
// :face      — CameraX + ML Kit face-capture state machine
//              (produces the 112×112 cropped face Bitmap consumed by
//              :biometric and the registration / scan flows in :app).
include(":biometric")
include(":face")
project(":biometric").projectDir = file("../mobile/biometric")
project(":face").projectDir = file("../mobile/face")
