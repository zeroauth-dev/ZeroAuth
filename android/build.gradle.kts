// android/build.gradle.kts — project-level. Only declares plugins; per-module
// configuration lives under app/build.gradle.kts. Plugins are declared with
// `apply false` here and applied in the module that uses them.

plugins {
    alias(libs.plugins.android.application) apply false
    // :biometric and :face are library modules (no applicationId); declare
    // the android-library plugin at the root so the per-module aliases
    // resolve against a single AGP classpath version.
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
