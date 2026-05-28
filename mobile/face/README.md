# `:face` — on-device face capture flow

The Compose-based face-capture module for the ZeroAuth Pramaan
Android client. Produces a deterministic 112×112 pixel cropped face
bitmap that the downstream `:biometric` module hashes into the SHA-256
biometric descriptor consumed by the fuzzy extractor + Poseidon
commitment (Scene 1 step 4–7 in
`docs/plan/bfsi-v1/02-bank-demo.md`):

> "Face capture (CameraX + on-device ML Kit face detection). App shows
> a viewfinder, waits for a centred, well-lit face, takes the capture
> entirely on-device. The face image never leaves the device. SHA-256
> of the face descriptor is computed."

## What ships here

| File | Role |
|---|---|
| `FaceCaptureScreen.kt` | The Compose composable. CameraX preview + ML Kit analysis + the 1.5 s liveness gate + the bitmap callback. |
| `FaceDetectorWrapper.kt` | ML Kit `FaceDetector` wrapped behind a clean coroutine API. Configured FAST + tracking, NO landmarks / classifications. |
| `LivenessTimer.kt` | The "face present continuously for N ms" timer. Pure, JVM-testable via injected clock. |
| `CaptureState.kt` | Sealed-class state machine + pure reducer. Drives the Compose screen. |
| `BitmapCrop.kt` | Deterministic crop-to-square + resize-to-112×112 helpers. Pure math in `computeSquareBounds`; JVM-testable. |
| `res/drawable/face_viewfinder.xml` | Vector ring overlay for the viewfinder. |

## Integration

The `:app` module consumes this surface as:

```kotlin
FaceCaptureScreen(
    onCaptured = { bitmap: Bitmap ->
        // In-process callback only. See "Bitmap-flow contract" below.
        // The :biometric module (lands with C-143) consumes this
        // bitmap, hashes it with SHA-256, then passes the hash to the
        // fuzzy extractor. The bitmap is GC-ed immediately after.
        biometricEmbedder.consumeFace(bitmap)
    },
    onCancelled = { navController.popBackStack() },
)
```

The `:biometric` module is wired in alongside C-143; until then the
bitmap is the output and it's the integrating code's job to keep the
bitmap in-process.

## Bitmap-flow contract (NON-NEGOTIABLE)

The `Bitmap` passed to `onCaptured` MUST be consumed by an
**in-process** callback. It MUST NOT be:

- Sent over the network (HTTP, gRPC, WebSocket, any wire protocol).
- Written to external storage.
- Logged via logcat or any logging framework.
- Passed across a Binder boundary to another process.

This is enforced in two complementary ways:

1. **Source review.** This module imports zero network libraries. The
   `AndroidManifest.xml` does not declare `INTERNET`. Adding either
   trips the `security-reviewer` subagent automatically (see the
   "Cross-line review" section of the `mobile/README.md`).

2. **Runtime assertion.** `FaceCaptureScreen.kt`'s
   `assertCallbackIsInProcess` walks the callback's declaring class
   name and crashes if the class name contains substrings that
   indicate a network stack (`okhttp`, `retrofit`, `http`, `rpc`,
   `websocket`, `java.net.`, `android.net.http`). Best-effort but
   catches the obvious shape (`onCaptured = ::uploadFace`).

The Scene 1 demo guarantee in `docs/plan/bfsi-v1/02-bank-demo.md` —
"the face image never leaves the device" — is the structural reason
both guards exist. ADR 0017 (blockchain-agnostic posture) preserves
this guarantee independent of which provider slots are wired in: the
biometric commitment lives off-chain by default and the on-chain
identity provider is opt-in per tenant.

## v1 liveness — limitations

> ⚠ **TODO: ADR 0020 — full liveness**

The v1 liveness gate is **only** a 1.5 s continuous-face-present
stability check (`LivenessTimer.kt`). A still photograph held in front
of the front camera satisfies this check.

The full liveness module (target: Phase 1 Sprint 3, commit C-148)
lands the following on top of this scaffold:

- Randomized head-turn challenge ("look left", "look up") driven by
  ML Kit's `headEulerAngle{X,Y,Z}` outputs (re-enable
  `LANDMARK_MODE_ALL`).
- Blink detection via `leftEyeOpenProbability` + `rightEyeOpenProbability`
  (re-enable `CLASSIFICATION_MODE_ALL`).
- Depth probing where the device's front sensor exposes one (Pixel
  7/8 Tensor depth API, S22+ ToF sensor).
- ADR 0020 — formalises the liveness threat model + the per-tier
  device matrix (tier-1 must satisfy full liveness, tier-2 may
  fall back to a longer stability window, tier-3 is denied).

Until ADR 0020 lands, the Compose UI strings refer to "stability
check" rather than "liveness" so the operator demoing Scene 1 is
explicit about what the v1 module does.

## On-device guarantees

- **No network code.** `INTERNET` permission is intentionally absent
  from this module's manifest.
- **No external storage.** The bitmap lives in process heap only,
  released to the GC as soon as the `onCaptured` callback returns.
- **Bundled ML Kit model.** `face-detection` is the bundled artefact;
  the model is shipped inside the AAR and never fetched at runtime.
  (The unbundled `face-detection-base` variant would lazily fetch the
  model — explicitly rejected; see the comment on `mlkit-face-detection`
  in `gradle/libs.versions.toml`.)
- **Camera is unbound on dispose.** The CameraX provider is unbound
  in the composable's `onDispose`; the `FaceDetectorWrapper` is
  closed in the same hook. The system camera HAL is freed as soon as
  the screen leaves composition.

## Tests

Three JVM-only unit tests run on Gradle's `:test` task. No emulator,
no instrumented test runner, no Android stubs required:

```bash
./gradlew :face:test
```

The tests cover:

- `BitmapCropTest` — every code path in `computeSquareBounds`
  including the right-edge slide and the "face larger than bitmap"
  clamp. Verifies the determinism property: identical inputs produce
  byte-for-byte identical outputs (the v1 commitment scheme depends
  on this).
- `LivenessTimerTest` — every transition in the timer, driven by a
  closure-controlled clock so we can advance time deterministically.
- `CaptureStateMachineTest` — every row in the
  [`CaptureStateMachine.next`] transition table, plus a full
  happy-path round-trip and a face-lost-mid-stability recovery.

Instrumented tests (CameraX preview render, ML Kit detection
end-to-end against a fixed input image) land alongside C-143 — they
require a connected emulator and are deferred to the C-143 PR rather
than blocking this scaffold.

## Cross-line review

Per `docs/plan/bfsi-v1/06-ways-of-working.md` §"Sub-agent rules",
every PR that touches `mobile/face/**` invokes the
`security-reviewer` subagent. The review focus is:

- No new network libraries.
- No new permissions that could leak the bitmap (e.g.,
  `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`,
  `READ_MEDIA_IMAGES`).
- `assertCallbackIsInProcess` is invoked on every code path that
  fires `onCaptured`.
- The bundled ML Kit model is pinned (not the unbundled variant).

LAST_UPDATED: 2026-05-28
OWNER: Agent #19 (Mid Android Engineer, UX + flows)
