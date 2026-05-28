// mobile/sensors/biometric_prompt/build.gradle.kts — Android BiometricPrompt
// fallback module.
//
// Scope at C-101: interface-only library. The real BiometricPrompt
// invocation (class-3 / setUserAuthenticationRequired(true) /
// StrongBox-bound CryptoObject) lands with C-144 (per the agent-17
// plan W4-Wed and the C-144 commit in `docs/plan/bfsi-v1/04-commits.md`).

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.sensors.biometric"
    compileSdk = 34

    defaultConfig {
        minSdk = 30
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // androidx.biometric will land alongside C-144. Not pulled in at
    // C-101 because the interface here does not yet reference any of
    // its types.
    testImplementation(libs.junit)
}
