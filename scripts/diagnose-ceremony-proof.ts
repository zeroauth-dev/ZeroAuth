/**
 * diagnose-ceremony-proof.ts — one-shot diagnostic for the registration
 * ceremony's Groth16 proof pipeline.
 *
 * This script reproduces *exactly* what the Android mobile prover does
 * for the ADR-0023 verify step (Step 3 / QR3 of the registration
 * ceremony), but in pure Node.js so we can isolate whether the
 * circuit + witness + vkey triple is internally consistent.
 *
 * Mirrors:
 *   - android/.../ui/reg/RealRegistrationProver.kt  (witness construction)
 *   - android/.../ui/reg/RegistrationHelpers.kt     (DeriveDidAndCommitment)
 *   - android/.../assets/prover/prover.js           (fold + fullProve)
 *
 * Witness construction (must match the mobile path byte-for-byte):
 *   biometricSecret = BigInteger(1, random32Bytes).mod(FIELD)
 *   salt            = 0n
 *   commitment      = Poseidon(biometricSecret, salt)
 *   didHashRaw      = Poseidon(commitment)               // single-arg
 *   sessionNonceHex = random 31-byte hex (62 chars)
 *   sessionNonce    = BigInt('0x' + sessionNonceHex)
 *   didHashSession  = Poseidon(didHashRaw, sessionNonce) // the fold
 *   identityBinding = Poseidon(biometricSecret, didHashSession)
 *
 * Witness fed to circuit identity_proof.circom v1.2:
 *   private: biometricSecret, salt
 *   public : commitment, didHash (== didHashSession), identityBinding
 *
 * publicSignals returned by snarkjs are in `main {public [...]}` order:
 *   [0] = commitment
 *   [1] = didHash       (the SESSION-bound one — what the server stores
 *                        in `session.commitment` is publicSignals[0], not
 *                        this; this is the fold output)
 *   [2] = identityBinding
 *
 * Run:
 *   cd /Users/pulkitpareek18/Desktop/ZeroAuth && npx tsx scripts/diagnose-ceremony-proof.ts
 *
 * Pass criterion: snarkjs.groth16.verify returns TRUE against the
 * verification_key.json that ships in /circuits/build/. If true, the
 * circuit + zkey + vkey + witness pipeline are mutually consistent and
 * any failing /v1/registrations/complete or /v1/identity/verify call
 * must be failing somewhere outside the proof itself (commitment
 * mismatch, vkey mismatch on the server, etc).
 */

import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';

// snarkjs has no proper TS types for fullProve/verify, but the runtime
// API is stable. We `as any` the import for the call sites.
import * as snarkjs from 'snarkjs';
// poseidon-lite/poseidon2 — same BN128 Poseidon the server uses in
// src/services/proof-pairing.ts and that the mobile prover replicates
// in /android/.../assets/prover/poseidon.js. poseidon1 is the
// single-arg variant used for didHashRaw = Poseidon(commitment).
import { poseidon1, poseidon2 } from 'poseidon-lite';

// BN128 scalar field modulus. MUST match the constant in:
//   - android/.../ui/reg/RealRegistrationProver.kt
//   - android/.../ui/reg/RegistrationHelpers.kt
//   - android/.../assets/prover/poseidon.js
//   - circuit.r1cs / zkey (implicitly, via the bn128 curve)
const FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

// Asset paths. The mobile APK ships these under assets/prover/, but
// they're byte-identical to /circuits/build/. We prefer the
// /circuits/build/ copies because the vkey file we verify against
// lives only there.
const ROOT = '/Users/pulkitpareek18/Desktop/ZeroAuth';
const WASM_PATH = path.join(ROOT, 'android/app/src/main/assets/prover/identity_proof.wasm');
const ZKEY_PATH = path.join(ROOT, 'android/app/src/main/assets/prover/circuit_final.zkey');
const VKEY_PATH = path.join(ROOT, 'circuits/build/verification_key.json');
// Fall back to /circuits/build/ if the prover/ copies are missing.
const WASM = fs.existsSync(WASM_PATH)
  ? WASM_PATH
  : path.join(ROOT, 'circuits/build/identity_proof_js/identity_proof.wasm');
const ZKEY = fs.existsSync(ZKEY_PATH)
  ? ZKEY_PATH
  : path.join(ROOT, 'circuits/build/circuit_final.zkey');

function log(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[diag] ${label}:`, value);
}

function logHeader(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<number> {
  logHeader('paths');
  log('WASM', WASM);
  log('ZKEY', ZKEY);
  log('VKEY', VKEY_PATH);
  log('WASM exists', fs.existsSync(WASM));
  log('ZKEY exists', fs.existsSync(ZKEY));
  log('VKEY exists', fs.existsSync(VKEY_PATH));

  if (!fs.existsSync(WASM) || !fs.existsSync(ZKEY) || !fs.existsSync(VKEY_PATH)) {
    // eslint-disable-next-line no-console
    console.error('[diag] FATAL: missing required artefact; aborting');
    return 2;
  }

  // ── Step 1: build a mobile-app-equivalent biometric secret ──
  // The mobile path uses a 32-byte SecureRandom value then reduces mod
  // FIELD before feeding it into Poseidon. We reproduce that exactly.
  const secretBytes = randomBytes(32);
  const secretBI = BigInt('0x' + secretBytes.toString('hex')) % FIELD;
  const biometricSecret = secretBI;
  const salt = 0n;

  // ── Step 2: commitment + didHash (single-arg Poseidon over commitment) ──
  const commitment = poseidon2([biometricSecret, salt]);
  const didHashRaw = poseidon1([commitment]);

  // ── Step 3: session nonce + Option B' fold ──
  // The server mints a 31-byte (62-hex-char) challenge_nonce in
  // src/services/registration.ts::generateChallengeNonce. The mobile
  // app feeds it into the prover as a hex string; the prover parses
  // it as a BigInt for the fold.
  const sessionNonceHex = randomBytes(31).toString('hex');
  const sessionNonce = BigInt('0x' + sessionNonceHex);
  const didHashSession = poseidon2([didHashRaw, sessionNonce]);
  const identityBinding = poseidon2([biometricSecret, didHashSession]);

  logHeader('witness inputs (decimal)');
  log('biometricSecret', biometricSecret.toString(10));
  log('salt', salt.toString(10));
  log('commitment', commitment.toString(10));
  log('didHashRaw (NOT a public signal)', didHashRaw.toString(10));
  log('sessionNonceHex', sessionNonceHex);
  log('sessionNonce', sessionNonce.toString(10));
  log('didHashSession (this becomes circuit.didHash public input)', didHashSession.toString(10));
  log('identityBinding', identityBinding.toString(10));

  // ── Step 4: assemble the witness object snarkjs expects ──
  // Field names MUST match the circom signal names exactly.
  const witness = {
    biometricSecret: biometricSecret.toString(10),
    salt: salt.toString(10),
    commitment: commitment.toString(10),
    // NB: the circuit's signal is named `didHash`, but the value we
    // feed it is the SESSION-folded one (didHashSession). This matches
    // RealRegistrationProver.kt + prover.js.
    didHash: didHashSession.toString(10),
    identityBinding: identityBinding.toString(10),
  };

  // ── Step 5: snarkjs.groth16.fullProve ──
  logHeader('fullProve');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sj: any = snarkjs;
  const startProve = Date.now();
  const proveResult: { proof: unknown; publicSignals: string[] } =
    await sj.groth16.fullProve(witness, WASM, ZKEY);
  const proveMs = Date.now() - startProve;
  log('proofMs', proveMs);

  const { proof, publicSignals } = proveResult;

  // ── Step 6: interpret publicSignals in declared order ──
  // From identity_proof.circom: `component main {public [commitment,
  // didHash, identityBinding]}` so the array indices are:
  //   [0] commitment
  //   [1] didHash         (the SESSION-folded one)
  //   [2] identityBinding
  logHeader('publicSignals (in declared order)');
  log('publicSignals[0] (commitment)', publicSignals[0]);
  log('publicSignals[1] (didHash == didHashSession)', publicSignals[1]);
  log('publicSignals[2] (identityBinding)', publicSignals[2]);

  // Sanity asserts — these MUST be byte-identical strings or the
  // witness we built differs from what snarkjs emitted (would point
  // at a Poseidon mismatch, e.g. wrong constants / matrix).
  const sanityOk =
    publicSignals[0] === commitment.toString(10) &&
    publicSignals[1] === didHashSession.toString(10) &&
    publicSignals[2] === identityBinding.toString(10);
  log('publicSignals match locally-computed values', sanityOk);

  // ── Step 7: verify against the boot-pinned vkey ──
  logHeader('verify');
  const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf-8'));
  log('vkey protocol', vkey.protocol);
  log('vkey curve', vkey.curve);
  log('vkey nPublic', vkey.nPublic);

  const verifyOk: boolean = await sj.groth16.verify(vkey, publicSignals, proof);
  logHeader('VERDICT');
  log('snarkjs.groth16.verify(vkey, publicSignals, proof)', verifyOk);

  // ── Step 8: also verify a deliberately mutated proof to ensure
  // we're not getting a vacuously-true result from a misconfigured
  // vkey. If THIS comes back true, the vkey is bogus. ──
  logHeader('negative control');
  const mutated = JSON.parse(JSON.stringify(proof));
  // Twiddle the first limb of pi_a — invalidates the proof while
  // staying syntactically well-formed.
  mutated.pi_a[0] = ((BigInt(mutated.pi_a[0]) + 1n) % FIELD).toString(10);
  const verifyMutated: boolean = await sj.groth16.verify(vkey, publicSignals, mutated);
  log('mutated proof verify (expected false)', verifyMutated);

  if (verifyOk && !verifyMutated && sanityOk) {
    logHeader('CONCLUSION');
    // eslint-disable-next-line no-console
    console.log('[diag] PASS — circuit + zkey + vkey + witness pipeline is internally consistent.');
    // eslint-disable-next-line no-console
    console.log('[diag] If /v1/registrations/complete is still failing, the bug is in the server side');
    // eslint-disable-next-line no-console
    console.log('[diag] (commitment storage / lookup, vkey file the server reads, or a normalisation');
    // eslint-disable-next-line no-console
    console.log('[diag] mismatch in the publicSignals[0] string-compare in completeRegistration).');
    return 0;
  }

  logHeader('CONCLUSION');
  // eslint-disable-next-line no-console
  console.error('[diag] FAIL — at least one assertion did not hold.');
  // eslint-disable-next-line no-console
  console.error(`[diag]   verifyOk=${verifyOk} verifyMutated=${verifyMutated} sanityOk=${sanityOk}`);
  return 1;
}

main()
  .then(code => {
    // snarkjs leaves dangling promises / workers; force-exit so the
    // shell pipeline actually terminates.
    process.exit(code);
  })
  .catch(err => {
    // eslint-disable-next-line no-console
    console.error('[diag] uncaught:', err);
    process.exit(1);
  });
