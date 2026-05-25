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
