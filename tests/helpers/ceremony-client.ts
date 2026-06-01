/**
 * ceremony-client.ts — pure-Node mobile-equivalent for the ADR-0023
 * registration ceremony + W3 proof-pairing login flow.
 *
 * Ported from the Kotlin sources of truth:
 *   - android/.../ui/reg/RealRegistrationProver.kt   (witness construction)
 *   - android/.../ui/reg/RegistrationHelpers.kt      (DeriveDidAndCommitment)
 *   - android/.../assets/prover/prover.js            (Option B' fold)
 *
 * Lets a server-side integration test drive the FULL three-QR
 * ceremony + login flow without spinning up an Android emulator. All
 * cryptography matches the on-device path byte-for-byte:
 *
 *   biometricSecret = BigInteger(1, randomBytes(32)).mod(BN128_FIELD)
 *   salt            = 0n
 *   commitment      = Poseidon(biometricSecret, salt)
 *   didHashRaw      = Poseidon(commitment)               // single-arg
 *   didSuffix       = sha256(commitmentHex)[0:20] hex    // V1 placeholder
 *   did             = "did:zeroauth:face:" + didSuffix
 *   sessionNonce    = BigInt('0x' + sessionNonceHex)     // 31 bytes
 *   didHashSession  = Poseidon(didHashRaw, sessionNonce) // the fold
 *   identityBinding = Poseidon(biometricSecret, didHashSession)
 *
 * The witness sent to snarkjs.groth16.fullProve names the public
 * signals exactly as the circom `main {public [...]}` declares them:
 *   - commitment
 *   - didHash         (the SESSION-folded one)
 *   - identityBinding
 *
 * publicSignals returned by snarkjs are in that same order:
 *   [0] = commitment       (decimal)
 *   [1] = didHashSession   (decimal)
 *   [2] = identityBinding  (decimal)
 *
 * Helpers exposed:
 *   - generateBiometricSecret()             — fresh 32-byte secret
 *   - deriveDidAndCommitment(secret)        — (did, commitmentHex)
 *   - buildProof(secret, sessionNonceHex)   — real Groth16 proof + signals
 *   - mutateProof(proof)                    — flip pi_a[0] for negative tests
 *   - terminateSnarkjs()                    — release the bn128 worker pool
 */
import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';

/**
 * BN128 scalar field modulus. MUST match the constant in:
 *   - android/.../ui/reg/RealRegistrationProver.kt
 *   - android/.../ui/reg/RegistrationHelpers.kt
 *   - android/.../assets/prover/poseidon.js
 *   - circuit.r1cs / zkey (implicitly, via the bn128 curve)
 */
export const BN128_FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

/**
 * Canonical paths to the circuit artefacts. We use the /circuits/build/
 * copies (not the android/assets/prover/ copies) because the diagnostic
 * + roundtrip tests both source from there — they ARE the same bytes,
 * but /circuits/build/verification_key.json lives only here.
 */
const ROOT = path.resolve(__dirname, '..', '..');
export const WASM_PATH = path.join(ROOT, 'circuits/build/identity_proof_js/identity_proof.wasm');
export const ZKEY_PATH = path.join(ROOT, 'circuits/build/circuit_final.zkey');
export const VKEY_PATH = path.join(ROOT, 'circuits/build/verification_key.json');

export function haveCeremonyArtefacts(): boolean {
  return (
    fs.existsSync(WASM_PATH)
    && fs.existsSync(ZKEY_PATH)
    && fs.existsSync(VKEY_PATH)
  );
}

// snarkjs has no usable TypeScript types for fullProve / verify, so we
// declare the bits we actually call. The runtime API is stable.
const sj = snarkjs as unknown as {
  groth16: {
    fullProve: (
      witness: Record<string, string>,
      wasm: string,
      zkey: string,
    ) => Promise<{
      proof: Record<string, unknown>;
      publicSignals: string[];
    }>;
    verify: (
      vkey: unknown,
      publicSignals: string[],
      proof: unknown,
    ) => Promise<boolean>;
  };
};

/** Generate a fresh 32-byte biometric secret. Equivalent to
 * `PerInstallStableSecret.secret()` on first use. */
export function generateBiometricSecret(): Buffer {
  return randomBytes(32);
}

/**
 * Convert a 32-byte secret to its BN128 field-element form. Mirrors the
 * `BigInteger(1, secret).mod(BN128_FIELD)` reduction in the Kotlin path
 * exactly — a 32-byte buffer can encode a value >= FIELD, which the
 * circuit + snarkjs both reject, so we reduce.
 */
export function secretToField(secret: Buffer): bigint {
  if (secret.length !== 32) {
    throw new Error(`secret must be 32 bytes; got ${secret.length}`);
  }
  return BigInt('0x' + secret.toString('hex')) % BN128_FIELD;
}

/**
 * Compute commitment + DID from a 32-byte secret.
 *
 * Matches `DeriveDidAndCommitment.from` in RegistrationHelpers.kt:
 *   commitment = Poseidon(secretField, 0)
 *   didSuffix  = sha256(commitmentHex)[0:20] hex      (V1 placeholder
 *                                                      for Keccak256)
 *   did        = "did:zeroauth:face:" + didSuffix
 *
 * Returns the commitment as a 64-char lower-case hex string (no 0x
 * prefix) — same shape /v1/registrations/submit-commitment receives.
 */
export function deriveDidAndCommitment(secret: Buffer): {
  did: string;
  commitmentHex: string;
  commitmentBigInt: bigint;
} {
  const s = secretToField(secret);
  const commitmentBi = poseidon2([s, 0n]);
  // 64-char hex, lower-case, no 0x prefix. The server's
  // submitCommitmentForRegistration accepts both `0x`-prefixed and
  // unprefixed forms; we match the mobile path which strips the prefix.
  const commitmentHex = commitmentBi.toString(16).padStart(64, '0');

  // SHA-256 of the commitment hex string, sliced to 20 bytes = 40 hex
  // chars. Matches RegistrationHelpers.from's V1 placeholder. The
  // server-side regex accepts /^did:zeroauth:[a-z0-9_-]+:[0-9a-f]{8,80}$/
  // which our 40-char suffix satisfies.
  const didSuffix = createHash('sha256')
    .update(commitmentHex, 'utf8')
    .digest('hex')
    .slice(0, 40);
  const did = `did:zeroauth:face:${didSuffix}`;

  return { did, commitmentHex, commitmentBigInt: commitmentBi };
}

/**
 * Generate a real Groth16 proof for the registration verify step
 * (or the proof-pairing login submit). Reproduces the Kotlin path
 * exactly so the proof is indistinguishable from one the on-device
 * prover would have emitted.
 *
 * @param secret           32-byte biometric secret (same one used at
 *                          commitment time — the proof is bound to it).
 * @param sessionNonceHex  31-byte (62-char) hex nonce minted by the
 *                          server in step 2 (challengeNonce) or by
 *                          /v1/proof-pairing/sessions (nonce field).
 *
 * @returns proof, publicSignals (decimal), and the local witness
 *          values so tests can sanity-check the fold.
 */
export async function buildProof(
  secret: Buffer,
  sessionNonceHex: string,
): Promise<{
  proof: Record<string, unknown>;
  publicSignals: string[];
  commitmentDec: string;
  commitmentHex: string;
  didHashSessionDec: string;
  identityBindingDec: string;
}> {
  if (!/^[0-9a-f]{62}$/i.test(sessionNonceHex)) {
    throw new Error(
      `sessionNonceHex must be 62 hex chars (31 bytes); got ${sessionNonceHex.length} chars`,
    );
  }

  const biometricSecret = secretToField(secret);
  const salt = 0n;

  const commitment = poseidon2([biometricSecret, salt]);
  const didHashRaw = poseidon1([commitment]);

  const sessionNonce = BigInt('0x' + sessionNonceHex);
  const didHashSession = poseidon2([didHashRaw, sessionNonce]);
  const identityBinding = poseidon2([biometricSecret, didHashSession]);

  const witness = {
    biometricSecret: biometricSecret.toString(10),
    salt: salt.toString(10),
    commitment: commitment.toString(10),
    // Circuit signal is named `didHash`, but the value fed in is the
    // SESSION-folded one. Matches RealRegistrationProver.kt + prover.js.
    didHash: didHashSession.toString(10),
    identityBinding: identityBinding.toString(10),
  };

  const proveResult = await sj.groth16.fullProve(witness, WASM_PATH, ZKEY_PATH);

  return {
    proof: proveResult.proof,
    publicSignals: proveResult.publicSignals,
    commitmentDec: commitment.toString(10),
    commitmentHex: commitment.toString(16).padStart(64, '0'),
    didHashSessionDec: didHashSession.toString(10),
    identityBindingDec: identityBinding.toString(10),
  };
}

/**
 * Return a structurally-valid but cryptographically-invalid copy of
 * the proof — perturbs pi_a[0] by one field element. Matches the
 * "negative control" pattern used in scripts/diagnose-ceremony-proof.ts
 * and tests/proof-roundtrip.test.ts.
 */
export function mutateProof(proof: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(proof));
  const piA = cloned.pi_a as string[];
  piA[0] = ((BigInt(piA[0]) + 1n) % BN128_FIELD).toString(10);
  return cloned;
}

/**
 * Compute the Poseidon-derived did_hash that the proof-pairing service
 * stores in tenant_users.metadata.did_hash. The service re-computes
 * `expectedDidHashSession = Poseidon2(storedDidHash, nonce)` and
 * compares it against publicSignals[1]. We mirror that derivation here
 * so the e2e test can seed the metadata correctly.
 */
export function computeDidHashRaw(commitmentBigInt: bigint): bigint {
  return poseidon1([commitmentBigInt]);
}

/**
 * snarkjs leaves a global `curve_bn128` worker pool dangling. Call this
 * from your test's afterAll to keep `jest --detectOpenHandles` quiet.
 */
export async function terminateSnarkjs(): Promise<void> {
  const c = (globalThis as unknown as { curve_bn128?: { terminate: () => Promise<void> } }).curve_bn128;
  if (c && typeof c.terminate === 'function') {
    await c.terminate().catch(() => undefined);
  }
}
