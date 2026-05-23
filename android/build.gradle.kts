// android/build.gradle.kts — project-level. Only declares plugins; per-module
// configuration lives under app/build.gradle.kts. Plugins are declared with
// `apply false` here and applied in the module that uses them.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
