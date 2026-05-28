# `:prover` — WebView + snarkjs Groth16 prover

The Phase 1 mobile prover module. Owns the contract between the Compose
UI in `:app` and the in-process snarkjs prover that generates the
proofs consumed by the central API at `/v1/identity/verify`.

## What ships today

Vendored from the W3 reference implementation at
`android/app/src/main/java/dev/zeroauth/android/prover/`, which has been
running in the live demo + smoke tests since the W3 cycle.

Five Kotlin files + the snarkjs asset bundle:

| File | Purpose |
|---|---|
| `MobileProver.kt` | The public interface. `generate(input, onProgress) → output`. |
| `WebViewMobileProver.kt` | Loads a WebView, runs `snarkjs.fullProve` against `identity_proof.wasm` + `circuit_final.zkey`, returns a Groth16 proof + public signals. |
| `IsolatedMobileProver.kt` | Wraps `WebViewMobileProver` behind an `android:process=":prover"` IPC boundary. A compromised renderer cannot reach the main process's Keystore. |
| `ProverService.kt` | The Android `Service` that hosts the WebView in the `:prover` process. |
| `ProverIpc.kt` | Messenger-based IPC between `:app` and `:prover`. |
| `UnlockedCredential.kt` | Adapter type — the prover's witness inputs (DID, commitment, biometricSecret, salt) as `BigInteger`s. The host activity builds this from `dev.zeroauth.biometric.Commitment` at the moment the operator confirms the BiometricPrompt. |

Assets (under `src/main/assets/prover/`):

| File | Size | Purpose |
|---|---|---|
| `prover.html` | 1.5 KB | The page the WebView loads. |
| `prover.js` | 10 KB | Wraps snarkjs.fullProve in a single async function bridged to the Kotlin side. |
| `poseidon.js` | 14 KB | circomlibjs's Poseidon-BN254, byte-identical to `mobile/biometric/Poseidon.kt`. |
| `snarkjs.min.js` | 688 KB | snarkjs bundle (Groth16 prover + verifier). Pinned to the W3 cycle's vendored version. |

The WebView loads with `connect-src 'none'` (per ADR 0010) so the
renderer cannot reach the network even if a malicious script were
loaded into it. The proof comes back via a `@JavascriptInterface`
bridge to the Kotlin side.

## What is NOT here

- The `identity_proof.wasm` + `circuit_final.zkey` artefacts. These
  are large binary files (~10 MB + ~2 MB) checked in at the repo root
  under `circuits/build/`. The Gradle build copies them into the
  `:prover` assets at packaging time. They are NOT in this module's
  assets directory.

## Host-side wiring (the `:app` module's job)

The host activity:

1. Captures a face via `:face` (CameraX + ML Kit).
2. Builds a `Commitment` via `:biometric`'s `CommitmentBuilder.build()`.
3. Confirms the operator's intent via `BiometricPrompt`.
4. Constructs an `UnlockedCredential` from the `Commitment`:
   ```kotlin
   val cred = UnlockedCredential(
       did = commitment.did,
       commitment = BigInteger(1, commitment.value),
       biometricSecret = BigInteger(1, commitment.secret),
       salt = BigInteger(1, commitment.salt),
   )
   ```
5. Binds the `:prover` service via `ProverIpc.bind(context)`.
6. Calls `prover.generate(GenerateInput(cred, sessionNonceHex)) → output`.
7. POSTs the resulting proof to `/v1/identity/verify` with the DID +
   public signals.
8. Releases the credential (`cred.clear()` — currently a no-op but
   signals intent; the BigInteger refs go out of scope and are GC'd).

## C-104 follow-on: rapidsnark JNI

The WebView prover takes 3-8 s per proof on mid-range Android (per
ADR 0009). A future rapidsnark JNI bridge would drop that to ~300 ms.
The migration is tracked as Phase 1 Sprint 3 commit C-104; the
interface in `MobileProver.kt` is stable across both implementations.

## Cross-line review

Per `docs/plan/bfsi-v1/06-ways-of-working.md`, every change under
`mobile/prover/**` triggers the `cryptographer-reviewer` subagent. The
review is scoped to this directory; the rest of `mobile/` does not need
to be paged in.
