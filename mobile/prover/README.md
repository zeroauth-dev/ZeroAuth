# `:prover` — rapidsnark JNI bridge

The Phase 1 mobile prover module. Owns the contract between the Compose
UI in `:app` and the native Groth16 prover (rapidsnark) that generates
the proofs consumed by the central API at `/v1/zkp/verify`.

## What ships at C-101 (scaffold)

- `Prover.kt` — the interface every prover implementation conforms to.
- `DefaultProver` — a throwing stub that fails with `NotImplementedError`
  on every call. It exists so downstream feature commits (C-143
  enrollment, C-146 login) can depend on the interface without blocking
  on the JNI POC.

## What lands at C-104

- `src/main/cpp/CMakeLists.txt`, NDK toolchain config, `externalNativeBuild`
  pinning rapidsnark to the version locked in ADR 0015 (circuit version
  `cct-v1.2`).
- A real `RapidsnarkProver` implementation backed by `nativeGenerateProof(
  witnessJson: String): String`.
- `src/androidTest/.../ProverSmokeTest.kt` asserting "generates a valid
  proof against fixed witness".

## Cross-line review

Per `docs/plan/bfsi-v1/06-ways-of-working.md`, every change under
`mobile/prover/**` triggers the `cryptographer-reviewer` subagent. The
review is scoped to this directory; the rest of `mobile/` does not need
to be paged in.
