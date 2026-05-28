/**
 * :biometric — on-device face embedding + Poseidon commitment pipeline.
 *
 * This module turns a captured face Bitmap (cropped to 112x112 by the
 * upstream CameraX face-capture surface) into the public Poseidon
 * commitment that the platform stores. The full pipeline is documented
 * in adr/0018-mobile-face-embedding-pipeline.md.
 *
 * Library module — no applicationId. Consumed by :app at enrollment and
 * by :prover at verification (the secret is the witness input to the
 * Groth16 circuit; the salt comes from Keystore).
 *
 * Non-negotiable: raw biometric bytes never leave this module. The
 * Bitmap is caller-owned; the quantised int16 buffer is zeroed
 * immediately after the SHA-256 digest is taken (see Sha256.kt). This
 * mirrors the CLAUDE.md non-goal "Never log biometric-derived raw data."
 *
 * The TFLite model is NOT committed. See src/main/assets/MODEL.md for
 * how it gets pulled in at build time. When BIOMETRIC_MODEL_PATH is
 * unset (i.e. CI without the model checked out) the test fixtures use
 * a deterministic MockFaceEmbedder instead — the model only ships in
 * release builds.
 */
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.biometric"
    compileSdk = 34

    defaultConfig {
        minSdk = 30
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        // Keep stdlib calls strict — the quantiser uses arithmetic edge
        // cases (Float.NaN, +/- Infinity) that must reject early rather
        // than silently produce non-deterministic bytes.
        freeCompilerArgs += listOf(
            "-opt-in=kotlin.RequiresOptIn",
        )
    }

    // The TFLite model gets copied into src/main/assets/ at build time
    // by the buildscript below when BIOMETRIC_MODEL_PATH is set. The
    // src/main/assets/MODEL.md sentinel ships unconditionally so the
    // module compiles in the no-model CI path; the Quantizer +
    // CommitmentBuilder unit tests use a MockFaceEmbedder that does
    // not load the .tflite at all.
    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Kotlin coroutines — the FaceEmbedder.embed() suspend fun runs
    // TFLite inference on Dispatchers.Default; the orchestration in
    // CommitmentBuilder.build() is suspend-fun-shaped because the
    // SaltProvider's Keystore call can block on the StrongBox HAL.
    implementation(libs.kotlinx.coroutines.android)

    // TensorFlow Lite — runs MobileFaceNet inference on CPU/NNAPI/GPU
    // depending on device capabilities. Pinned via ADR-0018.
    implementation(libs.tensorflow.lite)
    implementation(libs.tensorflow.lite.support)

    // BouncyCastle — Keccak-256 (the DID derivation hash). Android's
    // built-in MessageDigest registry knows SHA-256 + SHA-3 family but
    // NOT the original Keccak (pre-NIST-padding) flavour the EVM uses.
    // We need EVM-compatible Keccak because the on-chain DIDRegistry
    // (src/services/blockchain.ts + contracts/DIDRegistry.sol) uses
    // keccak256 as its DID derivation function. Pinned via ADR-0018.
    implementation(libs.bouncycastle.provider)

    // AndroidX core — needed for Bitmap helpers used by Quantizer's
    // companion preprocessing surface (the actual pixel copy stays
    // in the FaceEmbedder; this is reserved for downstream callers).
    implementation(libs.androidx.core.ktx)

    // Unit tests — pure JVM, no Robolectric (the biometric pipeline
    // is platform-agnostic Kotlin; we only need Bitmap stubs for
    // CommitmentBuilderTest which uses a MockFaceEmbedder anyway).
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.kotlin.test)
}
