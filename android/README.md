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

**ADR 0023 three-QR end-user signup ceremony** lives alongside the W3
QR-sign-in flow. The Splash screen has a second CTA ("Create a new
account (3-QR signup)") that routes to `RegistrationScreen` —
paste-deeplink + camera scan both work today (the camera path reuses
the same ML Kit pipeline as `ScanScreen.kt`). Real biometric capture
on QR3 still lands in Phase 1 Sprint 4 alongside the real FaceEmbedder
pipeline from `mobile/biometric/`. The phone-side endpoints
(`POST /v1/registrations/{pair-device, submit-commitment, complete}`)
are bound via `net/RegistrationApi.kt`; the deeplink parser is
`util/RegQrPayload.kt`; the orchestrator is
`ui/reg/RegistrationViewModel.kt`. See
[ADR 0023](../adr/0023-three-qr-signup-ceremony.md) for the wire
protocol + state machine.

See:

- [ADR-0009 — QR proof-pairing protocol](../adr/0009-qr-proof-pairing-protocol.md)
- [ADR-0010 — Android WebView snarkjs bundling](../adr/0010-android-webview-snarkjs-bundling.md)
- [ADR 0023 — Three-QR end-user signup ceremony](../adr/0023-three-qr-signup-ceremony.md)
- [`docs/api_contract.md`](../docs/api_contract.md) — the four
  `/v1/proof-pairing/*` endpoints + the six `/v1/registrations/*`
  endpoints.

## Overview — zero to logged-in, in plain English

You install the ZeroAuth app once. The app holds **one secret per
install** — derived from your face on a real device, or a per-install
random blob on the demo build (see §"What's currently rough"). That
secret never leaves the phone. Ever. The server only ever sees a
Poseidon commitment to the secret and, at login time, a zero-knowledge
proof that you know the secret behind that commitment.

That's it. You sign up once with three QR codes, then every site that
trusts ZeroAuth becomes "tap the app, scan one QR, biometric prompt,
you're in".

## The three flows

### Phase 1 — Install + first-ever registration

You're brand new. You've never used ZeroAuth before. You're sitting at
a laptop on, say, Anchor Bank's signup page.

1. **Install the app.** Either `./gradlew :app:installDebug` from a
   plugged-in dev laptop, or the side-loadable APK we hand out for
   the demo. (Play Store ships in Phase 2.) The app is
   `dev.zeroauth.android.debug` on debug builds so it sits alongside
   any future release build on the same device.

2. **Open the app and tap "Create a new account (3-QR signup)".**
   The Splash screen has two CTAs:
   - **Get started** → the desktop QR-sign-in flow (Phase 2 below).
   - **Create a new account (3-QR signup)** → drops into
     `RegistrationScreen` which drives ADR 0023.

3. **On the website that uses ZeroAuth, click "Sign up with ZeroAuth".**
   The site does not collect a password. It does not collect your
   email-for-magic-link. It just asks ZeroAuth to mint three QR codes
   — pair, enroll, verify — and renders them in sequence on the page.
   (For the demo, the dashboard at `/demo/registration` is the
   reference issuer; an embedded `<iframe>` or a "Sign up with
   ZeroAuth" button on the customer's site issues the same three QRs.)

4. **Three QR codes appear in sequence on the laptop.**
   - **QR1 — pair.** Encodes `zeroauth://reg?step=pair&session=…&code=ZA-XXXX-XXXX`.
     This is the "this phone is the device for this registration session" handshake.
   - **QR2 — enroll.** Encodes the same shape with `step=enroll`. This
     is "phone, derive your secret and submit the commitment".
   - **QR3 — verify.** Adds a `challenge` parameter. This is "phone,
     prove you know the secret behind that commitment by signing this
     challenge with a Groth16 proof".

5. **Phone scans each QR. Biometric prompts on the third.**
   - QR1 → `POST /v1/registrations/pair-device` with a device
     fingerprint. Server replies with a session id. The phone state
     transitions `Idle → Pairing → AwaitingEnrollScan`.
   - QR2 → phone derives the 32-byte biometric secret
     (`secretSource.secret()`), computes
     `(did, commitment) = DeriveDidAndCommitment.from(secret)`, posts
     to `/v1/registrations/submit-commitment`. The DID looks like
     `did:zeroauth:face:<20 hex>`; the commitment is the Poseidon
     hash of the secret. State transitions `Committing →
     AwaitingVerifyScan`.
   - QR3 → phone re-derives the same secret (same install ⇒ same
     bytes), runs `RealRegistrationProver.generate(secret, commitment,
     challenge_nonce)` which spins up the isolated `:prover` WebView
     process per ADR-0010, runs snarkjs Groth16, and posts the proof
     + public signals to `/v1/registrations/complete`. **The
     biometric prompt fires here** — Phase 1 Sprint 4 wires the real
     `RealBiometricSecretSource` to a CameraX + MobileFaceNet capture;
     today the demo build uses `PerInstallStableSecret` and the
     biometric prompt is the user-facing "this is where Face/Touch
     unlock would gate the keystore" beat.

6. **Account created. The user's biometric secret stays on the phone
   forever.** The server has the `(did, commitment)` row. The phone
   has the 32 bytes that hash to that commitment. The laptop has a
   freshly minted session cookie and the dashboard appears. No
   password was set. No email-for-magic-link was sent.

### Phase 2 — Login to any new site

A week later. You're on a completely different ZeroAuth-enabled site —
maybe the demo portal at `/demo-portal/`, maybe a hospital portal,
maybe a different bank. You've never logged in here before.

1. **Visit the ZeroAuth-enabled site.** No account creation prompt
   appears. There is no "Sign up here first" page.

2. **Click "Sign in with ZeroAuth".** The site asks ZeroAuth for a
   proof-pairing session, gets back a session id + a nonce + a
   short-lived challenge, and renders one QR encoding the
   challenge as `za:pair:1:<sessionId>:<nonceHex>:<tenantDomain>:<integrityTag>`.

3. **One QR appears** on the laptop. This is the W3 QR-sign-in flow,
   not a registration flow — the format is different and the wire
   endpoints are the four `/v1/proof-pairing/*` ones, not the six
   `/v1/registrations/*` ones.

4. **Open the ZeroAuth app, tap "Sign in (scan QR)".** This is the
   first CTA on Splash. The phone goes Splash → Scan, CameraX opens,
   ML Kit decodes the QR, the phone parses the proof-pairing payload.

5. **Phone scans, biometric prompts, proof generated.**
   - Biometric prompt fires (Phase 1 Sprint 4: gates the keystore
     unlock; today: placeholder).
   - Phone re-derives the same 32-byte secret as Phase 1 step 5
     (same install ⇒ same secret).
   - Phone re-derives `(did, commitment)` from the secret.
   - Phone runs `IsolatedMobileProver.generate(...)` with the
     proof-pairing nonce as the session nonce input — same circuit
     (`identity_proof.circom` v1.2), same verifier vkey, same wire
     format as the registration verify step.
   - Phone POSTs the proof to `/v1/proof-pairing/submit-proof` along
     with the DID.

6. **Site recognises the user, session minted, dashboard appears.**
   The server looks up the user by DID. It asserts
   `publicSignals[0] == stored_commitment`. It runs
   `snarkjs.groth16.verify` against the boot-pinned vkey. On success
   it mints a session, writes an audit row, and the laptop's open
   websocket fires "you're in" — the page redirects to the
   dashboard.

### Phase 3 — Login again on the same site

Same as Phase 2. There is no difference between "first login on this
site" and "tenth login on this site" — the phone always uses the same
per-install secret, the server always re-runs the same proof
verification, the only state that changes is the audit-event row
count.

This is a load-bearing claim: **the user does not register per site**.
Phase 1 registers them once with ZeroAuth itself. Every Phase 2 / Phase
3 login is a fresh proof-of-knowledge against the same commitment.

## Architecture (one paragraph)

The phone holds the secret. The server holds `(did, commitment)`. The
commitment is `Poseidon.hash2(secret, 0)` over the BN128 scalar field.
At every login, the phone re-derives the secret (from the face, or from
the per-install random blob in the demo build), re-derives the
commitment, builds a witness containing the secret + the
server-supplied nonce, runs snarkjs Groth16 inside an isolated
`:prover` WebView process (ADR-0010), and ships the resulting proof +
public signals to the server. The server runs
`snarkjs.groth16.verify` against a boot-pinned verification key and
mints a session. The biometric template, the camera frames, the
quantised embedding, the SHA-256 input buffer — none of those ever
leave the phone, ever touch the network, ever land in a log line. The
"breach a database, recover a user's face" attack class is structurally
impossible because the server never has the face data in the first
place.

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
│       ├── assets/prover/         ← snarkjs bundle drop point (ADR-0010)
│       ├── res/                   ← M3 ink-mono theme + strings
│       └── java/dev/zeroauth/android/
│           ├── ZeroAuthApp.kt     ← Application entry point
│           ├── MainActivity.kt
│           ├── nav/Nav.kt         ← Compose NavHost + Screen sealed class
│           ├── net/               ← Retrofit clients (proof-pairing + registration)
│           ├── prover/            ← IsolatedMobileProver (snarkjs in :prover process)
│           ├── sec/               ← Poseidon, UnlockedCredential
│           ├── util/              ← QR payload parsers, device fingerprint
│           └── ui/
│               ├── theme/         ← Color, Type, Theme
│               ├── SplashScreen.kt
│               ├── EnrollScreen.kt
│               ├── DoneScreen.kt
│               ├── scan/          ← CameraX preview + ML Kit barcode (W3 sign-in)
│               └── reg/           ← Three-QR registration ceremony (ADR 0023)
└── .gitignore
```

## What's currently rough

Honest list of where the floor is uneven. None of this changes the
zero-knowledge story — the phone still doesn't leak the secret in any
of these — but it does mean the demo has visible seams.

- **Emulator vs real device.**
  - Emulator works fine for the registration paste-deeplink path and
    for the camera path *if* you point the host webcam at a printed
    QR or use the emulator's "virtual scene". The biometric prompt
    on the emulator is a button labelled "Pass" — it does not test
    real Face/Touch unlock.
  - Real device is the only place the biometric prompt is meaningful,
    and the only place CameraX face capture (Phase 1 Sprint 4) will
    behave the way a customer will see it. We test on a Pixel 7 +
    a Samsung A53; we have not validated lower-end OEM skins.
- **The C-2 step-3 proof mile.** Audit finding C-2 is "mobile app
  ships with `FakeKeystoreManager`, `FakeMobileProver`,
  `FakeBiometricGate`". The fake prover is gone — `RealRegistrationProver`
  runs snarkjs Groth16 in the isolated `:prover` WebView process per
  ADR-0010, and the prover-assets SHA-256 gate (`prover-assets.sha256`)
  fails the build on hash drift. What's still rough:
  - Real proof generation depends on the prover assets being checked
    into `app/src/main/assets/prover/`. If the bundle is missing the
    `verifyProverAssets` Gradle task short-circuits with a log line
    instead of failing — that softness should tighten in Phase 1
    Sprint 4.
  - The witness shape for the registration verify step uses the
    *existing* `identity_proof.circom` v1.2 circuit. ADR 0023 §"V1
    limitation" notes that `publicSignals[1]` (the session nonce) is
    not bound into the circuit — replay defence is the single-use
    `verify_code` chain + 15-min TTL + per-IP rate-limit at the
    server. Circuit v1.3 in Phase 1 Sprint 4 binds the challenge
    into a circuit-constrained public signal, which closes the last
    soft edge on the registration verify step.
  - `KeystoreManager` + `BiometricGate` are still stubs on the W3
    sign-in path. Splash always treats the user as first-launch.
    Real keystore-bound credential unlock + real Biometric prompt
    wiring lands in the prover-glue sprint task on the W3 side; the
    registration side already calls into the real prover but does
    not yet gate it on a keystore unlock (so the demo can drive
    end-to-end on a device without a fingerprint enrolled).
- **The per-install secret is a placeholder for the real
  FaceEmbedder.** `PerInstallStableSecret` (in
  `ui/reg/RegistrationHelpers.kt`) generates a 32-byte
  `SecureRandom` blob on first use and writes it to
  SharedPreferences. Every call returns the same bytes for that
  install. That is **not** a biometric — it is a per-install device
  secret that happens to have the same shape as the real
  FaceEmbedder output (32 bytes, same Poseidon commitment pipeline,
  same DID derivation) so the rest of the wire protocol behaves
  identically. The real path lives in `RealBiometricSecretSource` and
  does:
  ```
  CameraX preview → ML Kit face detector → 112×112 ARGB_8888 crop
    → FaceEmbedder.embed (MobileFaceNet TFLite, 128-dim L2-normalised)
    → Quantizer.quantize (256 bytes int16 BE, ~5e-4 jitter budget)
    → Sha256.digest (32-byte secret; input buffer zeroed)
  ```
  Three things gate the swap from `PerInstallStableSecret` to
  `RealBiometricSecretSource`:
  1. `FaceCaptureCoordinator` doesn't exist yet at
     `ui/face/FaceCaptureCoordinator.kt` — see the TODO in
     `RealBiometricSecretSource.kt`. Agent #20 (mobile + IoT) owns
     this in Phase 1 Sprint 4.
  2. The `:biometric` Gradle module at
     `/mobile/biometric/` is not yet wired into
     `android/settings.gradle.kts` — the three-line patch is documented
     at the top of `RealBiometricSecretSource.kt`.
  3. The `mobilefacenet.tflite` model integrity story (separate from
     ADR-0010's prover-asset gate) is tracked in ADR-0018.

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

Once the APK is installed, you can drive either flow:

**W3 desktop sign-in (Phase 2/3 above):**

1. Open the dashboard demo page that issues the desktop challenge QR
   (the `/dashboard/demos/qr-proof-login` route).
2. Tap **Get started** → **Set up** → grant camera → point at the QR.
3. The Done screen displays the parsed session id + first 8 hex chars
   of the nonce.

**Three-QR registration (Phase 1 above):**

1. Open `/dashboard/demos/registration` (or the embed on a customer's
   "Sign up with ZeroAuth" button) which mints the three QRs.
2. Tap **Create a new account (3-QR signup)** on Splash.
3. Scan QR1 (pair) → QR2 (enroll) → QR3 (verify). The step badge
   reflects state; the screen shows a session-id stub after each step.
4. Successful completion ends on "Account created ✓". A failure at any
   step surfaces an error code (`pair_failed`, `enroll_failed`,
   `verify_failed`) and offers a "Start over" button.

The W3 actual proof submission lands in the prover-glue sprint task.
The three-QR ceremony already wires the real prover end-to-end; the
remaining rough edges are listed above.
