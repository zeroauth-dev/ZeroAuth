# ZeroAuth Android — desktop-login wrapper

The W3 wrapper app: scan the QR on your laptop, generate a Groth16
proof from your biometric, render the response QR, the desktop submits
it, the desktop is signed in. Two devices, two QR scans, no biometric
data ever leaves the phone.

The current scaffold is **shell-only**. The four Compose screens
(Splash → Enroll → Scan → Done) and the CameraX + ML Kit pipeline are
real and demoable. The snarkjs prover, the Retrofit `/v1/proof-pairing`
client, the Keystore-bound credential, the Biometric prompt — those
all land in the follow-on prover-glue sprint task.

See:

- [ADR-0009 — QR proof-pairing protocol](../adr/0009-qr-proof-pairing-protocol.md)
- [ADR-0010 — Android WebView snarkjs bundling](../adr/0010-android-webview-snarkjs-bundling.md)
- [`docs/api_contract.md`](../docs/api_contract.md) — the four
  `/v1/proof-pairing/*` endpoints.

## Prerequisites

- **Android Studio Iguana (2023.2)+** — Kotlin 2.0 + Compose K2 needs
  it. Older Studio versions will refuse to sync.
- **JDK 17** — the toolchain config in `app/build.gradle.kts`
  pins `sourceCompatibility` / `targetCompatibility` / `jvmTarget` to
  17. Anything older breaks the build; anything newer is fine because
  Gradle invokes `javac --release 17`.
- **Android SDK** with platform 34 + build-tools 34.x installed.
- **Device**: Android 11+ (API 30+). The CameraX + biometric paths
  both want fairly recent hardware. The emulator works for the Scan
  screen if you point a webcam at a printed QR or use the emulator's
  "virtual scene".

## First-time setup

```bash
cd android
gradle wrapper --gradle-version 8.7   # populates gradle-wrapper.jar
./gradlew :app:assembleDebug
./gradlew :app:installDebug           # device must be plugged in / ADB pairing
```

The wrapper jar is **not** committed — `gradle wrapper` regenerates it
locally. CI installs Gradle directly via `gradle/actions/setup-gradle@v3`.
See [`gradle/wrapper/README.md`](gradle/wrapper/README.md).

## Project structure

```
android/
├── settings.gradle.kts            ← single module ":app"
├── build.gradle.kts               ← plugin alias declarations only
├── gradle/
│   ├── libs.versions.toml         ← version catalog (every dep pinned)
│   └── wrapper/
│       ├── gradle-wrapper.properties
│       └── README.md
├── app/
│   ├── build.gradle.kts           ← AGP + Compose + verifyProverAssets task
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── assets/prover/         ← snarkjs bundle drop point
│       │                            (ADR-0010 — empty today)
│       ├── res/                   ← M3 ink-mono theme + strings
│       └── java/dev/zeroauth/android/
│           ├── ZeroAuthApp.kt     ← Application entry point
│           ├── MainActivity.kt
│           ├── nav/Nav.kt         ← Compose NavHost + Screen sealed class
│           └── ui/
│               ├── theme/         ← Color, Type, Theme
│               ├── SplashScreen.kt
│               ├── EnrollScreen.kt
│               ├── ScanScreen.kt  ← CameraX preview + ML Kit barcode
│               └── DoneScreen.kt
└── .gitignore
```

## What's stubbed

The scaffold deliberately ships **without**:

- **The snarkjs prover bundle.** `assets/prover/` is empty. The
  `verifyProverAssets` Gradle task is wired into the assemble graph
  but short-circuits with an informational log; once the bundle lands
  the task fails the build on hash drift per ADR-0010.
- **The Retrofit client for `/v1/proof-pairing/*`.** Done screen just
  parses the QR locally and renders the session id + nonce preview.
- **KeystoreManager + BiometricGate.** Splash always treats the user
  as first-launch so the Enroll → Scan flow is exercised every time.
- **Play Integrity attestation.** ADR-0010 plumbs the field but
  server-side enforcement is W4.
- **The release signing config.** CI assembles `:app:assembleDebug`
  only. A signed bundle ships when we wire the Play upload key.

Each stub has a `TODO(prover-glue)` comment pointing at the next sprint.

## Day-to-day commands

```bash
./gradlew :app:assembleDebug              # builds the debug APK
./gradlew :app:installDebug               # installs on the connected device
./gradlew :app:lintDebug                  # lint + bug-checker
./gradlew :app:verifyProverAssets         # standalone ADR-0010 hash gate
./gradlew :app:test                       # unit tests (currently none)
./gradlew :app:connectedDebugAndroidTest  # instrumentation tests (none yet)
```

The debug APK lands at
`app/build/outputs/apk/debug/app-debug.apk`. Its applicationId is
`dev.zeroauth.android.debug` so it sits alongside the eventual release
build on the same device.

## Demoing the scan flow today

Once the APK is installed:

1. Open the dashboard demo page that issues the desktop challenge QR
   (lands in the parallel dashboard sprint task).
2. Tap **Get started** → **Set up** → grant camera → point at the QR.
3. The Done screen displays the parsed session id + first 8 hex chars
   of the nonce, confirming the decode path is wired.

The actual proof generation + submission lands in the prover-glue
sprint task. Until then the demo proves wiring only.
