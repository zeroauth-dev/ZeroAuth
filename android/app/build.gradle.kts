// android/app/build.gradle.kts — the single application module.
//
// Stack pinned by ADR-0009 / ADR-0010 + CLAUDE.md. The notable bits below:
//
//   * Kotlin 2.0 + Compose compiler plugin (no kotlinCompilerExtensionVersion
//     dance — the compose Gradle plugin owns the version mapping in K2).
//   * minSdk 30 (Android 11). StrongBox + Class-3 biometric story is cleanest
//     from there up; below that the WebView + Compose surface gets fiddly.
//   * verifyProverAssets — ADR-0010 SHA-256 integrity gate. Reads the
//     pinned digests from android/prover-assets.sha256 and fails the
//     build if any file under assets/prover/ drifts from the manifest
//     (or vice versa). Hooked into preBuild so it runs ahead of EVERY
//     variant's assembly (assembleDebug, bundleRelease, installDebug,
//     …). Bumping a prover asset is a 3-file PR — see the task body
//     and ADR-0010 for the recipe.

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

    // Release signing.
    //
    // The Gradle build looks for four properties — in order — and only
    // wires the release signing config when ALL four resolve. Otherwise
    // it falls back to leaving the release variant unsigned, which keeps
    // local debug-only workflows working without operators dropping a
    // keystore on disk.
    //
    //   ZEROAUTH_RELEASE_KEYSTORE        absolute path to the .jks
    //   ZEROAUTH_RELEASE_KEYSTORE_PASS   keystore password
    //   ZEROAUTH_RELEASE_KEY_ALIAS       key alias inside the keystore
    //   ZEROAUTH_RELEASE_KEY_PASS        key password
    //
    // The CI workflow at .github/workflows/android.yml decodes the
    // base64-encoded keystore from a GH secret into a tmp file and
    // exports these four as env vars before invoking ./gradlew
    // bundleRelease. See android/RELEASE.md for the operator-side
    // one-time setup.
    val releaseKeystorePath: String? = (project.findProperty("ZEROAUTH_RELEASE_KEYSTORE") as String?)
        ?: System.getenv("ZEROAUTH_RELEASE_KEYSTORE")
    val releaseKeystorePass: String? = (project.findProperty("ZEROAUTH_RELEASE_KEYSTORE_PASS") as String?)
        ?: System.getenv("ZEROAUTH_RELEASE_KEYSTORE_PASS")
    val releaseKeyAlias: String? = (project.findProperty("ZEROAUTH_RELEASE_KEY_ALIAS") as String?)
        ?: System.getenv("ZEROAUTH_RELEASE_KEY_ALIAS")
    val releaseKeyPass: String? = (project.findProperty("ZEROAUTH_RELEASE_KEY_PASS") as String?)
        ?: System.getenv("ZEROAUTH_RELEASE_KEY_PASS")
    val releaseSigningConfigured =
        !releaseKeystorePath.isNullOrBlank()
            && !releaseKeystorePass.isNullOrBlank()
            && !releaseKeyAlias.isNullOrBlank()
            && !releaseKeyPass.isNullOrBlank()
            && file(releaseKeystorePath!!).exists()

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePass
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPass
                // v2 + v1 for max device coverage; v3/v4 lifted by AGP automatically.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
            isDebuggable = true
            // ─── DEMO_USE_STABLE_SECRET ───────────────────────────────
            //
            // When `true`, the production [RealBiometricSecretSource]
            // delegates to [PerInstallStableSecret] — a deterministic
            // 32-byte SharedPreferences-backed blob — instead of running
            // CameraX + ML Kit + MobileFaceNet on the device. This is
            // load-bearing for the POC demo because the Android emulator
            // (AVD) has no live face camera; without the toggle a
            // demo-from-emulator build can't reach the verify step.
            //
            // Default: `true` in debug — operators + investors run the
            //          demo on the emulator and need the flow to "just
            //          work". The dashboard surfaces the active mode
            //          via [BiometricSecretMode] so the demoer can see
            //          which path the build is on.
            //
            // Investors / pilot operators flipping to a real device for
            // the "real face capture" segment of the pitch can pass
            // `-PZEROAUTH_DEMO_USE_STABLE_SECRET=false` on the Gradle
            // command line to override (the Property resolution below
            // checks the Gradle property first, then falls back to the
            // default per variant).
            val demoFlag: Boolean = (project.findProperty("ZEROAUTH_DEMO_USE_STABLE_SECRET") as String?)
                ?.equals("false", ignoreCase = true)
                ?.let { !it }  // explicit false → flag = false
                ?: true        // unset → debug default = true
            buildConfigField("boolean", "DEMO_USE_STABLE_SECRET", demoFlag.toString())

            // API base URL. Overridable via `-PZEROAUTH_BASE_URL=…` so a
            // debug-signed (auto-signed, installable) build can point at
            // the LIVE server without the release keystore — e.g.
            //   assembleDebug -PZEROAUTH_BASE_URL=https://api.zeroauth.dev/
            // Default = localhost (the adb-reverse tunnel target).
            val baseUrl: String = (project.findProperty("ZEROAUTH_BASE_URL") as String?)
                ?: "http://localhost:3030/"
            buildConfigField("String", "ZEROAUTH_BASE_URL", "\"$baseUrl\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
            // When releaseSigningConfigured is false the release variant
            // assembles unsigned. Distributors must sign + zipalign by
            // hand, or set the four ZEROAUTH_RELEASE_* properties.
            //
            // DEMO_USE_STABLE_SECRET defaults to `false` in release —
            // production builds always run the real CameraX + MobileFaceNet
            // pipeline. An operator can opt into the demo fallback for
            // an *internal* release build (e.g. a hardware-less roadshow)
            // by passing `-PZEROAUTH_DEMO_USE_STABLE_SECRET=true` — the
            // CLAUDE.md banner that says "never accept raw biometric data
            // over the wire" is unaffected either way (PerInstallStableSecret
            // emits a per-install SecureRandom blob; the network surface
            // remains identical to the real pipeline because both paths
            // produce a 32-byte secret that derives a Poseidon commitment
            // on-device).
            val demoFlag: Boolean = (project.findProperty("ZEROAUTH_DEMO_USE_STABLE_SECRET") as String?)
                ?.equals("true", ignoreCase = true)
                ?: false       // unset → release default = false
            buildConfigField("boolean", "DEMO_USE_STABLE_SECRET", demoFlag.toString())

            // API base URL — defaults to the production host. Overridable
            // via `-PZEROAUTH_BASE_URL=…` for staging/internal release
            // builds.
            val baseUrl: String = (project.findProperty("ZEROAUTH_BASE_URL") as String?)
                ?: "https://api.zeroauth.dev/"
            buildConfigField("String", "ZEROAUTH_BASE_URL", "\"$baseUrl\"")
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
    // ── Phase 1 modules (sources live under repo-root mobile/) ──────────
    //
    // :biometric — on-device Bitmap → Poseidon commitment pipeline
    //              (FaceEmbedder + Quantizer + SHA-256 + Poseidon +
    //              Keccak256). Consumed by RegistrationViewModel +
    //              ScanViewModel to derive the witness inputs for the
    //              Groth16 prover and the public commitment the API
    //              registers under the DID.
    // :face      — CameraX + ML Kit face-capture state machine.
    //              Produces the 112×112 cropped face Bitmap that flows
    //              into :biometric. Owned by the FaceCaptureScreen
    //              composable rendered from the registration + scan
    //              screens.
    //
    // The module sources are checked in under mobile/biometric and
    // mobile/face; the include + projectDir mapping lives in
    // android/settings.gradle.kts.
    implementation(project(":biometric"))
    implementation(project(":face"))

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

    // Biometric + Keystore-bound encryption
    implementation(libs.androidx.biometric)
    implementation(libs.androidx.security.crypto)

    // Coroutines — needed by AndroidBiometricGate's suspend-fun BiometricPrompt wrapper.
    // kotlinx-serialization-json is already pulled in via the `network` bundle below
    // and used by AndroidKeystoreManager's on-disk envelope.
    implementation(libs.kotlinx.coroutines.android)

    // AndroidX WebKit — WebViewAssetLoader for ADR-0010's prover bundle.
    implementation(libs.androidx.webkit)

    // CameraX + ML Kit barcode.
    //
    // Guava is needed here because `ProcessCameraProvider.getInstance()`
    // returns a `com.google.common.util.concurrent.ListenableFuture`,
    // and CameraX 1.3.x ships Guava as a `compileOnly` dep — its
    // ListenableFuture type must therefore appear on :app's compile
    // classpath explicitly. Without it Kotlin 2's stricter type
    // inference rejects every `cameraProviderFuture.addListener {…}`
    // call-site with "Cannot access class
    // com.google.common.util.concurrent.ListenableFuture."
    implementation(libs.bundles.camerax)
    implementation(libs.guava)
    implementation(libs.mlkit.barcode.scanning)

    // ML Kit face detection — drives the face-capture composable at
    // ui/face/FaceCaptureScreen.kt. Bundled flavour (model ships in
    // the APK) for the same zero-Play-Services posture the barcode
    // scanner takes. See ADR-0010 addendum: this module is consumed
    // entirely on-device — the detected face bounding box never
    // crosses a process boundary and the cropped Bitmap never leaves
    // the application process.
    implementation(libs.mlkit.face.detection)

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
    // androidx.test:core for ApplicationProvider — used by Robolectric
    // tests under app/src/test/ (notably AndroidKeystoreManagerTest).
    // Instrumented tests get it transitively from androidx.test.ext:junit.
    testImplementation(libs.androidx.test.core)
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
// failing the build if a digest does not match the value pinned in the
// sibling manifest at android/prover-assets.sha256. That manifest is the
// build-side enforcement; ADR-0010 holds the same hashes for audit /
// review.
//
// Bumping a prover asset is a 3-part PR (described in adr/0010-...):
//
//   1. drop the new file into android/app/src/main/assets/prover/
//   2. update android/prover-assets.sha256 with the new SHA-256
//   3. update ADR-0010's "Pinned asset hashes" table to match
//
// CI runs the same task so a digest drift on either side stops the
// merge.
//
// The manifest parser below is intentionally trivial — `key=hex`, no
// quoting, no commas — so an attacker can't smuggle a digest in
// through a weird encoding.
val verifyProverAssets by tasks.registering {
    group = "verification"
    description =
        "Hash-check app/src/main/assets/prover/* against android/prover-assets.sha256 (ADR-0010)."

    val proverDir = file("src/main/assets/prover")
    val manifestFile = rootProject.file("prover-assets.sha256")
    inputs.dir(proverDir).withPropertyName("proverAssets").skipWhenEmpty(false)
    inputs.file(manifestFile).withPropertyName("proverAssetsManifest")

    doLast {
        if (!manifestFile.exists()) {
            throw GradleException(
                "ADR-0010 manifest not found at ${manifestFile.absolutePath} — " +
                    "refusing to build a prover bundle without a pinned hash table."
            )
        }

        // Parse `key=hex`, ignoring blank lines and comments. Lowercase
        // the digest because shasum / sha256sum disagree on the case of
        // the column they emit.
        val pinned: Map<String, String> = manifestFile.readLines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("#") }
            .mapNotNull { line ->
                val idx = line.indexOf('=')
                if (idx <= 0) null else line.substring(0, idx).trim() to
                    line.substring(idx + 1).trim().lowercase()
            }
            .toMap()

        if (pinned.isEmpty()) {
            throw GradleException(
                "ADR-0010 manifest at ${manifestFile.absolutePath} parsed to zero entries " +
                    "— refusing to assemble an APK with an empty pinning policy."
            )
        }

        // Files in assets/prover/ that we DON'T hash:
        //   * .gitkeep — placeholder, never shipped
        //   * *.md     — operator notes, never shipped
        val hashableFiles = proverDir
            .walkTopDown()
            .filter { it.isFile && it.name != ".gitkeep" && !it.name.endsWith(".md") }
            .toList()

        val mismatches = mutableListOf<String>()
        val seenInManifest = mutableSetOf<String>()
        hashableFiles.forEach { file ->
            val digest = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
                .joinToString("") { "%02x".format(it) }
            val expected = pinned[file.name]
            seenInManifest += file.name
            if (expected == null) {
                mismatches += "${file.name}: not pinned in prover-assets.sha256 (computed $digest)"
            } else if (expected != digest) {
                mismatches += "${file.name}: expected $expected, got $digest"
            }
        }
        // Reject the opposite drift too: a manifest entry with no file.
        // Without this an attacker could delete a load-bearing asset
        // (zkey, vkey) and the build would still pass.
        val missing = pinned.keys - seenInManifest
        missing.forEach { name ->
            mismatches += "$name: pinned in prover-assets.sha256 but missing from assets/prover/"
        }

        if (mismatches.isNotEmpty()) {
            throw GradleException(
                "ADR-0010 prover asset integrity check failed:\n  " +
                    mismatches.joinToString("\n  ")
            )
        }
        logger.lifecycle(
            "[verifyProverAssets] all ${hashableFiles.size} prover assets match ADR-0010."
        )
    }
}

// Wire the gate into preBuild so it runs before EVERY variant assembly,
// debug or release. The previous "find assembleDebug after evaluate"
// approach skipped the check on tasks that bypass assemble (`bundleDebug`,
// `installDebug`, etc); preBuild is the universal ancestor so we never
// ship a build that skipped the integrity check.
tasks.named("preBuild").configure {
    dependsOn(verifyProverAssets)
}
