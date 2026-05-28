// mobile/prover/build.gradle.kts — rapidsnark JNI bridge module.
//
// Scope at C-101: an Android *library* module containing nothing but
// the Prover interface and a throwing DefaultProver implementation.
// No native sources, no CMake, no .so artefacts. The full JNI bridge —
// CMakeLists.txt, NDK toolchain, externalNativeBuild block, ABIs, the
// rapidsnark git submodule under src/main/cpp/ — lands with C-104.
//
// The module exists at C-101 because:
//
//   1. Downstream feature commits (C-143 enrollment, C-146 login) can
//      depend on the :prover module without waiting for the JNI POC to
//      stabilise. They consume the interface; the implementation flips
//      from throwing-stub to real-rapidsnark-call on C-104 merge day.
//   2. The cryptographer-reviewer subagent in
//      `docs/plan/bfsi-v1/06-ways-of-working.md` is configured to run
//      on every commit that touches `mobile/prover/**`. Putting the
//      Prover surface behind a module boundary scopes that review to a
//      small directory.
//   3. The repo-root `.github/workflows/` config can target tests at
//      `:prover:test` once C-104 lands a real test.

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.zeroauth.prover"
    compileSdk = 34

    defaultConfig {
        minSdk = 30
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Once C-104 wires rapidsnark, the `ndk { abiFilters }` block
        // here will pin the ABIs to arm64-v8a + armeabi-v7a (production)
        // + x86_64 (emulator). Leaving the block out at C-101 because
        // there are no native sources yet and AGP would emit a noise
        // warning.
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
    // No deps at scaffold time. C-104 will add rapidsnark JNI loading
    // helpers + a kotlinx-serialization-json dep for witness parsing.
    testImplementation(libs.junit)
}
