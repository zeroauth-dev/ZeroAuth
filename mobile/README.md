# `mobile/` — ZeroAuth Banking Android client

The Android client for the ZeroAuth Pramaan protocol — the bank-facing
customer + workforce identity verification app demonstrated in
`docs/plan/bfsi-v1/02-bank-demo.md`. Generates Groth16 proofs on-device
against `identity_proof.circom` v1.2 (pinned by ADR 0015), gates them
behind the platform's class-3 biometric + StrongBox-bound key wrap, and
submits them to the central API at `https://zeroauth.dev/v1/zkp/verify`
for verification.

This subtree is the **Phase 1 production track**. The sibling
`android/` subtree at the repo root is the **W3 desktop-login WebView
spike** that exercises the QR-pairing protocol via snarkjs in a
WebView. They coexist — `android/` is the test bench, `mobile/` is the
real banking app. Once C-104 lands the rapidsnark JNI bridge in this
tree, the W3 WebView path becomes a fallback for tier-2 devices and the
authoritative implementation lives here.

## Module map

| Module | Owner | What it does | Implementation lands |
|---|---|---|---|
| `:app` | Agent #17 (prover) + Agent #19 (UX) | The Pramaan banking app: Activity, Compose UI, enrollment + login + transaction-step-up flows. | C-101 scaffold; C-143, C-146, C-167 implementation. |
| `:prover` | Agent #17 | rapidsnark JNI bridge — produces Groth16 proofs against `identity_proof.circom` v1.2. | C-101 scaffold; C-104 implementation. |
| `:sensors:r307` | Agent #18 | R307 fingerprint sensor driver over USB-OTG host mode. | C-101 scaffold; C-145 implementation. |
| `:sensors:biometric_prompt` | Agent #17 | Android `BiometricPrompt` class-3 fallback with StrongBox-bound `CryptoObject`. | C-101 scaffold; C-144 implementation. |

The Compose `:app` module consumes all three sibling modules from day
one so the C-104 / C-144 / C-145 implementation drops are
module-internal changes and do not require re-wiring across module
boundaries.

## Build commands

```bash
# Assemble the debug APK.
./gradlew :app:assembleDebug

# Run the JVM-side unit tests (fast — no emulator needed).
./gradlew :app:test

# Run the instrumented tests on a connected device or emulator.
./gradlew :app:connectedAndroidTest

# Per-module test invocations once C-104 / C-144 / C-145 land:
./gradlew :prover:connectedAndroidTest
./gradlew :sensors:r307:connectedAndroidTest
./gradlew :sensors:biometric_prompt:connectedAndroidTest
```

The Gradle wrapper itself (`gradlew`, `gradlew.bat`, `gradle-wrapper.jar`)
is not committed at C-101; it lands once the CI workflow that exercises
`mobile/` is wired up in the next commit. Local dev today runs against
the developer's own Gradle 8.6 install pointed at this directory as the
project root.

## Device requirements

- `minSdk = 30` (Android 11). StrongBox + class-3 BiometricPrompt
  + Play Integrity are not reliable below this baseline.
- `compileSdk = 34`, `targetSdk = 34`.
- Tier-1 devices are listed in `docs/operations/device-support-matrix.md`
  — Pixel 7/8, Samsung S22/S23/A54, OnePlus 11/12, Xiaomi Redmi Note 13
  + Pro, Realme GT Neo 5, Motorola Edge 40, Vivo V29. The capability
  columns in that matrix drive the per-flow gating documented below.

## Phase 1 sprint plan

The subtree's road from scaffold to first-customer demo:

| Commit | What | Sprint |
|---|---|---|
| **C-101** | Subtree bootstrap (this commit). Scaffold + module shell. | S1 (W2) |
| **C-104** | Rapidsnark JNI POC — `Prover.kt` becomes real. | S1 (W3–W4) |
| **C-143** | Enrollment flow — CameraX face + BiometricPrompt finger + DID anchor (Scene 1). | S2 (W5–W6) |
| **C-144** | StrongBox key wrap — `BiometricPromptFallback.kt` becomes real. | S2 (W5–W6) |
| **C-145** | R307 driver — `R307Driver.kt` becomes real. | S2 (W6) |
| **C-146** | End-to-end login flow — Scene 2 working on a tier-1 SKU. | S2 (W7) |
| **C-167** | Tier 1 acceptance sign-off across the 6-SKU first batch. | S3 (W9) |

Each row above maps to one or more tickets in the relevant agent's plan
in `docs/plan/bfsi-v1/agents/agent-17-android-prover.md`,
`docs/plan/bfsi-v1/agents/agent-18-android-r307.md`,
`docs/plan/bfsi-v1/agents/agent-19-android-ux.md`.

## What this scaffold does NOT include yet

The C-101 scaffold deliberately ships nothing that would lock in a
design we have not yet ADR'd. The following land later, with the
commit that adds the feature also adding the corresponding code:

- **Rapidsnark JNI bridge** — interface only at C-101; real native call
  lands with **C-104** (per `docs/plan/bfsi-v1/agents/agent-17-android-prover.md`
  ticket A17-W3-Mon).
- **CameraX face capture** — no CameraX dep, no preview composable.
  Lands with **C-143** alongside ML Kit face detection.
- **BiometricPrompt + StrongBox key wrap** — interface only at C-101;
  real `androidx.biometric` invocation + class-3 enforcement + StrongBox
  binding land with **C-144**.
- **R307 USB-OTG driver** — interface only at C-101; real USB host
  enumeration + R307 protocol framing land with **C-145**.
- **Network layer** — no Retrofit, no OkHttp, no kotlinx-serialization
  network deps. The `/v1/identity/register` + `/v1/zkp/verify` clients
  land with **C-143** + **C-146** respectively.
- **Play Integrity** — no Play Integrity API client at C-101. Lands
  with **C-143** (enrollment-time attestation collection).
- **FCM push** — no FCM at C-101. Lands with **C-167** for the
  Scene 3 transaction-step-up push notification.
- **Gradle wrapper jar** — `gradle/wrapper/gradle-wrapper.jar` ships in
  the CI-wiring commit that follows C-101, not here. Local dev uses the
  developer's Gradle 8.6 install.

## Cross-line review

Per `docs/plan/bfsi-v1/06-ways-of-working.md` §"Sub-agent rules", any
PR that touches `mobile/prover/**` invokes the `cryptographer-reviewer`
subagent automatically. Touching `mobile/sensors/biometric_prompt/**`
also engages the `security-reviewer`. Plan mode is mandatory for any
change touching `mobile/prover/**` or (once it lands) `mobile/keystore/**`.

LAST_UPDATED: 2026-06-01
OWNER: Agent #17 (Senior Android Engineer, prover core)
