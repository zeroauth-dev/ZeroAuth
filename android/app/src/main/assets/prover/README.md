# `assets/prover/` — snarkjs WebView bundle

The on-phone Groth16 prover bundle, loaded by the WebView at
`https://appassets.androidplatform.net/assets/prover/prover.html` via
`WebViewAssetLoader`. Everything in this directory is hash-pinned in
`/android/prover-assets.sha256` and audited in
[ADR-0010](../../../../../../../adr/0010-android-webview-snarkjs-bundling.md).

## Contents

| File | Approx size | Source |
|---|---|---|
| `prover.html` | ~1.5 KB | This repo; the hosting page + locked CSP. |
| `prover.js` | ~11 KB | This repo; the bridge glue + Option B′ fold. |
| `poseidon.js` | ~15 KB | Inlined from `poseidon-lite@0.3.0` (constants + kernel). |
| `snarkjs.min.js` | ~689 KB | Upstream `snarkjs@0.7.6` build artifact. |
| `identity_proof.wasm` | ~1.75 MB | `circuits/build/identity_proof_js/identity_proof.wasm` |
| `circuit_final.zkey` | ~507 KB | `circuits/build/circuit_final.zkey` |
| `verification_key.json` | ~3 KB | `circuits/build/verification_key.json` |

## Bumping any asset

A 3-file PR:

1. drop the new file under this directory
2. update `/android/prover-assets.sha256` with the new SHA-256
3. update the "Pinned asset hashes" table in
   `/adr/0010-android-webview-snarkjs-bundling.md`

The Gradle task `verifyProverAssets` (in `/android/app/build.gradle.kts`)
hashes every file here at build time and fails the build if any file
drifts from the manifest, if a manifest entry is missing its file, or
if a new file is added without a manifest entry.

## What's pinned vs reproducible

`prover.html`, `prover.js`, and `poseidon.js` are first-party source
committed verbatim — `git blame` is the audit trail. `snarkjs.min.js`,
`identity_proof.wasm`, `circuit_final.zkey`, and `verification_key.json`
are externally-produced binaries; their provenance is recorded in
ADR-0010 along with the upstream version they came from.

## Reference

- [ADR-0009 — QR proof-pairing protocol](../../../../../../../adr/0009-qr-proof-pairing-protocol.md)
- [ADR-0010 — Android WebView snarkjs bundling](../../../../../../../adr/0010-android-webview-snarkjs-bundling.md)
