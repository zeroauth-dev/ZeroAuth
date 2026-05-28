# `:biometric` — face → Poseidon commitment

On-device face embedding + commitment derivation. This module turns
a captured face Bitmap into the public Poseidon commitment that the
ZeroAuth platform stores. **No raw biometric data leaves this module.**

See [`adr/0018-mobile-face-embedding-pipeline.md`](../../adr/0018-mobile-face-embedding-pipeline.md)
for the full architecture rationale.

## Pipeline

```
Bitmap (112x112 ARGB_8888)                ← caller-owned, FaceCapture
   ↓ TfliteFaceEmbedder.embed                (MobileFaceNet)
FloatArray (128 x float32, L2-normalised)
   ↓ Quantizer.quantize                      (scale 1000, int16 BE)
ByteArray (256 bytes)
   ↓ Sha256.digest                           (input zeroed in place)
biometricSecret (32 bytes)
   ↓ KeystoreSaltProvider.salt              (HMAC-derived, device-bound)
salt (32 bytes)
   ↓ Poseidon.hash2(secret, salt)           (BN128, stub in this commit)
commitment (32 bytes)
   ↓ Keccak256.digest, first 20 bytes
did = "did:zeroauth:" + hex
```

## Public surface

```kotlin
// Build a commitment for a face. The Bitmap is caller-owned and
// not retained. The returned Commitment carries both public fields
// (did, value) and secret fields (salt, secret); secret fields must
// be cleared with clearSensitive() after the Groth16 prover consumes
// them.
val builder = CommitmentBuilder(
    embedder = TfliteFaceEmbedder(applicationContext),
    saltProvider = KeystoreSaltProvider(applicationContext),
)
val commitment: Commitment = builder.build(faceBitmap)
// ... feed commitment.secret + commitment.salt into the prover ...
commitment.clearSensitive()
```

## What this module is NOT

- **Not a face detector.** The caller (`:app`'s FaceCapture surface)
  is responsible for face detection, liveness assertion, and crop +
  resize to 112×112. This module rejects inputs of any other shape.
- **Not a fuzzy extractor.** The quantiser is robust against ~5e-4
  per-component float jitter, which covers same-device same-lighting
  recaptures. Cross-device or cross-camera enrollment requires a
  real fuzzy extractor — that's deferred to v2 (ADR-0020).
- **Not the Groth16 prover.** This module produces the commitment +
  the witness inputs (secret + salt). The :prover module consumes
  those + the circuit to produce the proof.

## Tests

The unit tests run on the JVM (no Robolectric, no emulator):

- `QuantizerTest` — determinism, perturbation, length, NaN/Inf
  rejection, byte-order, L2-bound check.
- `Sha256Test` — KAT against the empty-string vector + the
  buffer-zeroing post-condition.
- `PoseidonTest` — field constant, `toField` masking, stub-rejection.
- `CommitmentBuilderTest` — end-to-end wiring with mock embedder +
  mock salt provider; asserts the pipeline reaches the Poseidon
  stub.

The instrumented (real-Bitmap, real-Keystore) tests land alongside
the FaceCapture surface in a subsequent commit.

## Implementation status

- [x] FaceEmbedder + TfliteFaceEmbedder (CPU-only, no NNAPI delegate).
- [x] Quantizer (scale × 1000, int16 BE).
- [x] Sha256 with in-place zeroing.
- [x] Keccak256 (EVM flavour, via BouncyCastle).
- [x] SaltProvider + KeystoreSaltProvider (StrongBox preferred).
- [x] CommitmentBuilder (full pipeline).
- [ ] Poseidon.hash2 — STUB. Lands in the next commit per ADR-0019.
- [ ] NNAPI / GPU TFLite delegate — performance-track.
- [ ] MODEL_SHA256.txt pin + Gradle build-time verification.

## Activation

This README is the README for the `:biometric` Gradle module. The
module is wired into the parent `mobile/` build via the existing
`mobile/settings.gradle.kts` `include(":biometric")` line (or, if
the parent `mobile/` bootstrap is on a separate landing path, will
be added there alongside the other module declarations). The module
is self-contained; nothing in this directory depends on `:app`,
`:prover`, or `:sensors`.
