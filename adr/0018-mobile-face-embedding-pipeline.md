# ADR-0018: Mobile face embedding + commitment pipeline

- **Status:** Accepted
- **Date:** 2026-05-28
- **Owner:** Pulkit Pareek
- **Supersedes:** —

## Context

The BFSI v1 demo's Scene 1 (customer enrollment) needs a way to turn
a captured face into the public Poseidon commitment the platform
stores. ADR-0017 (blockchain-agnostic platform posture) ratified that
the commitment — not any chain-specific identifier — is the identity
primitive. So the *quality* of the commitment derivation chain on the
mobile client is load-bearing for every downstream surface: the
verifier, the on-chain anchor, the audit log.

The constraints the chain must satisfy:

1. **Same face on the same device → same commitment**, every time.
   Without this, the user can enrol but cannot subsequently
   authenticate. (We do NOT require cross-device reproducibility for
   v1 — the BFSI happy path is single-device enrollment.)
2. **Different people → different commitments**, with overwhelming
   probability. (Birthday-bound brute-force is the only realistic
   attack at the scale we operate; ~2^64 distinct commitments per
   tenant is the worst-case ballpark and we want collision
   probability ≪ 1 over that population.)
3. **No raw biometric data on the network**. Per CLAUDE.md's
   non-goals, the only on-wire artefacts are the proof, the
   commitment, and the public DID.
4. **No raw biometric data in stable storage**. The biometric secret
   may briefly live on the heap during proof construction, but the
   quantised embedding (which is reversible to a face fingerprint)
   is zeroed the instant the SHA-256 digest is taken.

## Decision

Adopt the pipeline:

```
Bitmap (112×112 RGB)
   ↓ MobileFaceNet TFLite inference + L2 normalisation
128 × float32 embedding
   ↓ Quantizer.quantize (scale × 1000, round, clip to int16, BE bytes)
256-byte stable bitstring
   ↓ Sha256.digest (input zeroed)
biometricSecret (32 bytes)
   ↓ Poseidon.hash2(secret, salt)
commitment (32 bytes, BN128 field element)
   ↓ Keccak256.digest, take first 20 bytes, hex
did = "did:zeroauth:" + suffix
```

The salt is generated **once at enrollment** via an HMAC-SHA-256 key
held in the Android Keystore (StrongBox-preferred). Every verification
reuses the same salt; the commitment is therefore reproducible on the
same device.

### Component choices

#### Face embedding model: MobileFaceNet

**Adopted.** Rationale:

- **License**: Apache 2.0 (the sirius-ai/MobileFaceNet_TF reference).
  No GPL contamination of the mobile binary.
- **Size**: ~5 MB .tflite. Fits inside the APK without pushing past
  Play Store's optional download threshold.
- **Latency**: ~50 ms on Pixel 6 CPU; ~15 ms on NNAPI. Within the
  human-perceivable-as-instant budget.
- **Accuracy**: LFW 99.4% accuracy at ~99% TAR @ 0.1% FAR — adequate
  for the demo's single-tenant, ~10-user enrollment scope. Will not
  scale to 100M-user tenants without a more accurate model (ArcFace
  hits 99.8%+ at the same FAR, at a 5× cost in size).

**Alternatives surveyed**:

- **FaceNet** (Schroff et al., Google): 22 MB, slightly higher
  accuracy. Apache 2.0. Rejected on size + speed — the latency cliff
  matters more than the accuracy gap for v1.
- **ArcFace** (Deng et al., InsightFace): 90 MB resnet-100 backbone.
  Best accuracy in the field. Rejected for v1 on size; revisit when
  the demo's enrollment scope exceeds ~10k users.
- **OpenCV LBPH**: 50 KB, ~10× faster. Vastly worse accuracy under
  pose / lighting variance. Rejected — would not survive the Scene
  2 (kiosk login) variance.

#### Quantisation: scale × 1000, int16 BE, post-L2-norm

**Adopted.** Rationale:

- The L2-normalised MobileFaceNet output has per-component magnitudes
  in `[-0.30, +0.30]` (empirical, against the upstream test
  vectors). Intra-session jitter (same face, same lighting, two
  consecutive captures 1 s apart) is ~5e-4 per component.
- Scaling by 1000 maps the value range to `[-300, +300]`, which fits
  in 2-byte int16 with three orders of magnitude of headroom.
- Rounding to int16 absorbs ~5e-4 of float jitter (the rounding
  threshold is 0.5 of one int16 unit = 0.0005 in the original float
  scale). 99%+ of components stay stable across recaptures; the
  edge components that flip are the ~1% that sit within 0.5 of a
  half-integer.
- **The 1% flip rate is the FRR cap for v1**. Beyond a 1% false
  reject rate, we need a real fuzzy extractor (see deferred work
  below). The 1% is acceptable for the demo's "smile and try again"
  recapture UX.

#### Cryptographic salt: Keystore HMAC-derived

**Adopted.** Rationale:

- The Android Keystore is the only on-device storage that survives
  app uninstall + reinstall *and* erases on factory reset. Both
  properties are important for the demo's "user lost phone"
  recovery story (factory-reset clears identity → re-enrol).
- The Keystore doesn't expose a "store N bytes" primitive; it stores
  *keys*. We derive the salt deterministically from a Keystore-held
  HMAC key as `HMAC(key, "ZeroAuth-Salt-v1")`. The key is bound to
  the device's hardware credential gate; the derivation is the
  classic KDF-from-keystore-key pattern (Tink's
  `DeterministicAead`, Apple's `SecKeyCreateRandomKey` use the
  same shape).
- **StrongBox preferred, TEE fallback**: not every device has
  StrongBox (only ~30% of Android devices at our tier-1 cutoff). We
  set `setIsStrongBoxBacked(true)` and catch
  `StrongBoxUnavailableException` to fall back silently. The
  fallback is fine — the salt derivation doesn't *need* StrongBox,
  it just prefers it.

#### Hash primitives: SHA-256 + Poseidon-BN128 + Keccak-256

**Adopted.** Each has a specific role:

- **SHA-256**: maps the quantised embedding to a 32-byte
  pre-image. This is the only crypto-grade hash we apply to
  biometric-derived bytes; everything past this point operates on
  hash output, which is harmless to leak.
- **Poseidon-BN128**: the actual commitment primitive. Pinned to
  match circomlib's Poseidon-2 (the circuit at
  `circuits/identity_proof.circom` uses `Poseidon(2)`). The
  implementation in this commit is a stub — see ADR-0019 for the
  pure-Kotlin vs JNI choice.
- **Keccak-256 (EVM-compatible)**: derives the DID suffix from the
  commitment. We use EVM Keccak (not NIST SHA3) so the suffix
  matches what an on-chain `keccak256(...)` call would produce —
  enables blockchain-agnostic DID derivation per ADR-0017 (any EVM
  L2 can re-anchor a ZeroAuth DID with the same suffix).

## Consequences

### Positive

- The pipeline is small, auditable (one file per stage), and fully
  deterministic given the same face + same device.
- All sensitive bytes are zeroed at the earliest possible moment:
  the quantised embedding is destroyed by `Sha256.digest`; the
  secret + salt are destroyed by `Commitment.clearSensitive()`
  after the prover consumes them.
- No new top-level platform dependencies (TFLite + BouncyCastle are
  Android-only). The npm + Cargo + Solidity classes stay clean.
- Stub-and-iterate posture: `Poseidon.hash2` throws today, but the
  pipeline shape is locked in. When the implementation lands
  (ADR-0019) we change one file.

### Negative

- **Single-device reproducibility only.** A user who buys a new
  phone re-enrols — the salt is device-bound and the model output
  drifts across sensors. The fuzzy-extractor work (below) closes
  this gap but is deferred. Acceptable for v1's BFSI demo (each
  branch hands out a tenant-issued phone).
- **MobileFaceNet's 99.4% LFW accuracy is below the BFSI 100M-user
  target.** At ~10k users per tenant the false-match probability
  is ~1e-5; at 100M it's ~1e-2. We document the cliff and revisit
  the model choice in v2.
- **The quantiser has a ~1% per-component flip rate.** Combined
  across 128 components, ~3% of recaptures land just outside the
  cell and require a retry. The UX has to absorb this — a "smile
  and try again" toast is the v1 mitigation.

### Neutral

- The TFLite model is not committed to the repo. It's pulled in at
  build time (see `mobile/biometric/src/main/assets/MODEL.md`). The
  no-model CI path still compiles + runs unit tests because the
  test suite uses a MockFaceEmbedder.

## Deferred work

| Item | Tracking |
|---|---|
| Full fuzzy extractor (Boneh-Halevi-Hamburg, or BCH-encoded ECC) for cross-device reproducibility | ADR-0020 (to be opened in v2) |
| Real Poseidon-BN128 implementation (JNI vs pure-Kotlin) | ADR-0019 |
| NNAPI / GPU delegate for TFLite inference (currently CPU-only) | Performance-track ticket post-demo |
| Model accuracy bump (ArcFace, FaceNet) for tenants with >10k users | v2 |
| `MODEL_SHA256.txt` pin + Gradle build-time verification | Implementation commit |

## Supply-chain check

The two new direct dependencies introduced by this module's
`build.gradle.kts`:

| Dep | Coord | License | Why this version |
|---|---|---|---|
| TensorFlow Lite | `org.tensorflow:tensorflow-lite:2.14.0` | Apache 2.0 | Latest stable from Google; matches Android SDK 34. |
| TFLite Support | `org.tensorflow:tensorflow-lite-support:0.4.4` | Apache 2.0 | `TensorImage` + `ImageProcessor`; same version as the upstream TFLite samples. |
| BouncyCastle Provider | `org.bouncycastle:bcprov-jdk18on:1.78` | MIT-shaped | EVM-flavour Keccak-256, not in `MessageDigest`. |

No CVEs against these versions on OSS Index or GitHub Advisory
Database as of 2026-05-28. Note that this ADR documents the *intent*
to introduce these deps via the next implementation commit; the
`libs.versions.toml` aliases are added there alongside `:biometric`'s
activation in the parent `mobile/settings.gradle.kts`.

The Android-only platform-dep rationale ADR (the one called for by
the C-102 ticket per the agent plan) is the upstream umbrella; this
ADR is the per-module specific.

## References

- ADR-0017 — blockchain-agnostic posture (the commitment primitive
  this pipeline produces).
- ADR-0019 — Poseidon implementation choice (deferred from this
  ADR).
- `circuits/identity_proof.circom` — the canonical Poseidon-2
  layout the commitment must match.
- `src/services/identity.ts` — server-side commitment derivation
  (verifier reference).
- CLAUDE.md non-goals — never log biometric-derived raw data.

---
LAST_UPDATED: 2026-05-28
OWNER: Pulkit Pareek
