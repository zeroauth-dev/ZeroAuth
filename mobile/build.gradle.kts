// mobile/build.gradle.kts — project-level Gradle.
//
// Only declares plugins; per-module configuration lives under each
// module's own build.gradle.kts. Plugins are declared with `apply false`
// here and applied in the modules that need them. The version catalog at
// gradle/libs.versions.toml is the single source of truth for plugin and
// dependency versions across :app, :prover, :sensors:r307,
// :sensors:biometric_prompt.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
}
