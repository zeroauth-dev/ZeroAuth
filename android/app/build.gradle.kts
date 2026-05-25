// android/app/build.gradle.kts — the single application module.
//
// Stack pinned by ADR-0009 / ADR-0010 + CLAUDE.md. The notable bits below:
//
//   * Kotlin 2.0 + Compose compiler plugin (no kotlinCompilerExtensionVersion
//     dance — the compose Gradle plugin owns the version mapping in K2).
//   * minSdk 30 (Android 11). StrongBox + Class-3 biometric story is cleanest
//     from there up; below that the WebView + Compose surface gets fiddly.
//   * verifyProverAssets task — STUB for now. ADR-0010 mandates a SHA-256
//     gate on assets/prover/* before assembleDebug/assembleRelease. The
//     real hash check lands in the prover-glue sprint task once the
//     snarkjs + .wasm + .zkey files are committed. Wiring the task today
//     so the build graph already has the dependency edge.

import java.security.MessageDigest

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "dev.zeroauth.android"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.zeroauth.android"
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
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // No signing config here yet — release signing lands with the
            // Play upload key in a follow-on infra task. CI builds will
            // assemble only the debug variant until then.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        // Compose 1.7's lifecycle integration needs the K2-compatible flag
        // set; the kotlin-compose plugin sets the rest.
        freeCompilerArgs = freeCompilerArgs + listOf(
            "-opt-in=kotlin.RequiresOptIn",
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
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
    // Core / lifecycle / activity
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.ktx)
    implementation(libs.androidx.activity.compose)

    // Compose — BOM aligns the constellation
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.bundles.compose.ui)
    implementation(libs.androidx.compose.navigation)
    debugImplementation(libs.bundles.compose.debug)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)

    // Biometric
    implementation(libs.androidx.biometric)

    // CameraX + ML Kit barcode
    implementation(libs.bundles.camerax)
    implementation(libs.mlkit.barcode.scanning)

    // ZXing core (used by the proof-side QR generation in a follow-on iteration)
    implementation(libs.zxing.core)

    // Networking + serialization
    implementation(libs.bundles.network)

    // Logging — Timber is ~40 KB and we want the import resolvable in
    // every variant. The runtime cost is gated by BuildConfig.DEBUG
    // inside ZeroAuthApp.kt so a release build does nothing at runtime,
    // and R8 strips the unreachable DebugTree branch.
    implementation(libs.timber)

    // Test
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.turbine)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockito.kotlin)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
}

// Robolectric needs Android resources for inflation. Most of our unit
// tests don't touch resources but the safety toggle prevents a flaky
// "resource not found" if a future test references a string.
android.testOptions {
    unitTests {
        isIncludeAndroidResources = true
    }
}

// ─── ADR-0010 prover-asset integrity gate ─────────────────────────────────
//
// `verifyProverAssets` walks assets/prover/* and SHA-256s each file,
// failing the build if a digest does not match the value pinned in
// ADR-0010. The real digest table lives in the ADR — when the snarkjs
// bundle + .wasm + .zkey files land in the prover-glue sprint task,
// the implementing engineer will:
//
//   1. drop the new files under app/src/main/assets/prover/
//   2. update the digest map in this task body (or move it to a
//      pinned text file alongside the ADR, TBD)
//   3. update ADR-0010's pinned table
//
// Today the assets directory is empty (only a .gitkeep + README), so the
// task short-circuits with an informational log. The dependency edge to
// assembleDebug / assembleRelease is wired NOW so we never accidentally
// ship a build that skipped the check once the assets exist.
val verifyProverAssets by tasks.registering {
    group = "verification"
    description = "Hash-check app/src/main/assets/prover/* against the table pinned in ADR-0010."

    val proverDir = file("src/main/assets/prover")
    inputs.dir(proverDir).withPropertyName("proverAssets").skipWhenEmpty(false)

    doLast {
        val hashableFiles = proverDir
            .walkTopDown()
            .filter { it.isFile && it.name != ".gitkeep" && !it.name.endsWith(".md") }
            .toList()

        if (hashableFiles.isEmpty()) {
            logger.lifecycle(
                "[verifyProverAssets] prover asset hash check skipped — assets not yet committed; " +
                    "ADR-0010 pins them once they land."
            )
            return@doLast
        }

        // Once assets land, populate this map from ADR-0010's pinned table.
        // Until then we deliberately fail-loud on any unexpected file so a
        // drop-in cannot land without an ADR update.
        val pinned: Map<String, String> = emptyMap()

        val mismatches = mutableListOf<String>()
        hashableFiles.forEach { file ->
            val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
                .joinToString("") { "%02x".format(it) }
            val expected = pinned[file.name]
            if (expected == null) {
                mismatches += "${file.name}: no pinned digest in ADR-0010 (computed $digest)"
            } else if (!expected.equals(digest, ignoreCase = true)) {
                mismatches += "${file.name}: expected $expected, got $digest"
            }
        }

        if (mismatches.isNotEmpty()) {
            throw GradleException(
                "ADR-0010 prover asset integrity check failed:\n  " +
                    mismatches.joinToString("\n  ")
            )
        }
        logger.lifecycle("[verifyProverAssets] all ${hashableFiles.size} prover assets match ADR-0010.")
    }
}

// Wire the gate into both debug and release assembly. We do this after
// project evaluation so the variant-specific tasks exist.
afterEvaluate {
    listOf("assembleDebug", "assembleRelease").forEach { name ->
        tasks.findByName(name)?.dependsOn(verifyProverAssets)
    }
}
