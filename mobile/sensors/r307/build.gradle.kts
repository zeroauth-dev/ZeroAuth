// mobile/sensors/r307/build.gradle.kts — R307 fingerprint sensor module.
//
// Scope at C-101: interface-only library. The real driver — USB host
// mode enumeration, GETIMAGE / GENCHAR command framing, latency budget
// per device tier — lands with C-145 (per the agent-17 plan and the
// device-support matrix R307 sub-matrix).

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.sensors.r307"
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
    testImplementation(libs.junit)
}
