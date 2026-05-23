# `assets/prover/` — snarkjs WebView bundle drop point

This directory is the asset destination for the on-phone proof
generator. **Nothing is committed here yet.** The W3 scaffold sprint
established the build pipeline + integrity gate; the bundle drop lands
in the follow-on prover-glue sprint task.

## What lands here (per ADR-0010)

| Filename | Approx size | Source |
|---|---|---|
| `snarkjs-<version>.min.js` | ~600 KB | snarkjs upstream release tag |
| `identity_proof.wasm` | ~150 KB | copied from `circuits/build/` |
| `circuit_final.zkey` | ~3.3 MB | copied from `circuits/build/` |
| `verification_key.json` | ~3 KB | copied from `circuits/build/` |

Once the files land, update **two** places in one PR:

1. `adr/0010-android-webview-snarkjs-bundling.md` — populate the
   pinned-hash table with the SHA-256 of each file as committed.
2. `android/app/build.gradle.kts` — the `verifyProverAssets` task's
   `pinned` map (currently empty) so the build fails on any digest
   drift.

The Gradle task is already wired as a dependency of `:app:assembleDebug`
and `:app:assembleRelease`. Today it short-circuits with an
informational log because the directory is empty.

## Reference

- [ADR-0009 — QR proof-pairing protocol](../../../../../adr/0009-qr-proof-pairing-protocol.md)
- [ADR-0010 — Android WebView snarkjs bundling](../../../../../adr/0010-android-webview-snarkjs-bundling.md)
