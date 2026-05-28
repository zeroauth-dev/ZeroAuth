// mobile/app/build.gradle.kts — the Pramaan banking app's Android module.
//
// Scope of this scaffold (C-101):
//
//   * Compile a debug + release APK from a single Activity that renders a
//     placeholder Compose surface saying "ZeroAuth — coming soon (scaffold
//     C-101)". That is enough to (a) prove the Gradle wiring is internally
//     consistent and (b) give downstream commits (C-104 prover, C-143
//     enrollment, C-144 keystore, C-145 R307, C-146 e2e login) a place to
//     land.
//   * No business logic, no real biometrics, no real network, no real
//     proof generation. The :prover, :sensors:r307 and
//     :sensors:biometric_prompt modules ship as wired-but-throwing
//     interfaces.
//
// The compose-compiler is wired via composeOptions because we are on
// Kotlin 1.9.22 (the K2 `plugin.compose` Gradle plugin is a Kotlin 2.x
// thing). This matches the Kotlin 1.9 baseline pinned in
// gradle/libs.versions.toml.

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.banking"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.zeroauth.banking"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
            isDebuggable = true
        }
        release {
            // Release-side signing is wired in a later commit when the
            // CI workflow lands the base64-decoded keystore step. The
            // four ZEROAUTH_RELEASE_* env vars in the W3 spike's
            // android/app/build.gradle.kts are the reference shape; we
            // do not duplicate the block here because the scaffold ships
            // unsigned and CI is not yet building release variants for
            // the mobile/ tree.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
        viewBinding = false
        buildConfig = true
    }

    composeOptions {
        // Compose compiler version tied to Kotlin 1.9.22 — see the
        // compatibility map at developer.android.com/jetpack/androidx/
        // releases/compose-kotlin. Bumping Kotlin without bumping this
        // version is a build error.
        kotlinCompilerExtensionVersion = libs.versions.compose.compiler.get()
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

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    // Core / lifecycle / activity
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    // Compose — BOM aligns the constellation
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose.ui)
    debugImplementation(libs.bundles.compose.debug)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)

    // Sister modules. The :prover module is consumed even though its
    // current Prover.kt is a throwing stub — this guarantees the module
    // graph is exercised from day one so the C-104 implementation drop
    // is a one-line module-internal change, not a wire-up exercise.
    implementation(project(":prover"))
    implementation(project(":sensors:r307"))
    implementation(project(":sensors:biometric_prompt"))

    // Test
    testImplementation(libs.junit)

    // Instrumented
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.espresso.core)
}
