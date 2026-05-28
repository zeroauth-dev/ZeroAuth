# MobileFaceNet — face embedding model

This directory is the assets root for the `:biometric` Gradle module.
At runtime, `TfliteFaceEmbedder` loads `mobilefacenet.tflite` from this
folder via the AndroidX `AssetManager`. **The model file itself is NOT
committed to the repo** — the asset is large (~5 MB), tracked separately,
and pulled in at build time.

## Why the model is not in git

- Model artefacts are binary blobs with their own provenance chain.
  Committing them obscures `git log -p` and inflates the repo. See
  the comparable rule in [`circuits/build/.gitignore`](../../../../../circuits/build/.gitignore)
  for the zkey + wasm artefacts.
- The reference upstream (sirius-ai/MobileFaceNet_TF) is Apache 2.0,
  but our distribution channel for release APKs ships the .tflite as
  a separately-signed artifact bundled by the GitHub Actions release
  job. Keeping it out of source-control keeps the supply-chain
  attestation crisp.

## How the model gets in at build time

The release build job sets the environment variable
`BIOMETRIC_MODEL_PATH` to the absolute path of a vetted
`mobilefacenet.tflite`. A Gradle `Sync` task in
`mobile/biometric/build.gradle.kts` (added by the next implementation
commit alongside the JNI Poseidon work — see ADR-0019) reads that
variable and copies the file into this directory before the
`mergeReleaseAssets` task runs.

CI builds without the model still compile and run the unit-test
suite, because the `Quantizer`, `Sha256`, and `Poseidon` tests use
`MockFaceEmbedder` (a deterministic FloatArray fixture) and never
touch the TFLite interpreter.

## Recommended source

- Repository: <https://github.com/sirius-ai/MobileFaceNet_TF>
- License: Apache 2.0
- Conversion: the upstream ships `.pb` + a Python conversion notebook
  that emits a 5.0 MB `.tflite` with the IO shapes pinned below.

## Pinned IO contract

| Field          | Shape                | dtype   | Notes                                                           |
|----------------|----------------------|---------|-----------------------------------------------------------------|
| Input tensor   | `[1, 112, 112, 3]`   | float32 | Normalised to `[-1.0, 1.0]` (pixel/127.5 - 1.0).                |
| Output tensor  | `[1, 128]`           | float32 | L2-normalised embedding (the embedder does this post-hoc).      |

Any model with the same IO contract is drop-in compatible. If a future
model bumps the embedding dimension (256 ArcFace, 512 FaceNet), the
quantiser's output length changes accordingly — the commitment
derivation chain still works, but the on-device fingerprint shifts
and existing enrollments invalidate. That's a v2 problem; flag it via
a new ADR if it ever lands.

## Verification

The SHA-256 of the model file MUST be pinned in
`mobile/biometric/MODEL_SHA256.txt` (added in the implementation
commit) and Gradle MUST reject a mismatched checksum at
`processReleaseAssets` time. This is the same supply-chain guard the
Web prover uses for snarkjs (see
[adr/0010-android-webview-snarkjs-bundling.md](../../../../../adr/0010-android-webview-snarkjs-bundling.md)).
