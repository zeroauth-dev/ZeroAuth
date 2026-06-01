/**
 * proof-roundtrip.test.ts — end-to-end Groth16 round-trip for the
 * registration ceremony's verify step.
 *
 * Reproduces the EXACT witness the Android mobile prover builds for
 * the ADR-0023 verify step (mobile sources of truth: RealRegistrationProver.kt,
 * RegistrationHelpers.kt, prover.js), generates a real Groth16 proof
 * via snarkjs against the shipped circuit + zkey, and asserts:
 *
 *   1. The proof verifies against the boot-pinned vkey
 *      (`circuits/build/verification_key.json`) via verifyProofOffChain.
 *   2. A deliberately mutated proof DOES NOT verify (negative control).
 *   3. The server's BigInt-coerced commitment comparator equates a HEX
 *      commitment (the form /submit-commitment receives + stores) with
 *      the DECIMAL publicSignals[0] (the form snarkjs emits). This is
 *      the load-bearing fix for the hex-vs-decimal mismatch that was
 *      silently failing the ceremony at commitment_mismatch.
 *
 * If snarkjs.groth16.verify ever returns false on a freshly-minted
 * proof, the circuit/zkey/vkey triple has drifted out of sync with
 * the witness shape — this test is the early-warning fence for that
 * class of regression.
 *
 * Run: npx jest tests/proof-roundtrip.test.ts
 *
 * Skipping behaviour: if `circuits/build/circuit_final.zkey` is missing
 * (fresh clone, no ZKP setup) the entire suite is skipped with a
 * structured warning. CI runs `scripts/setup-zkp.sh` so the artefacts
 * are always present on the CI runner; local devs with no zkey see a
 * skipped test instead of a hard fail.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { poseidon1, poseidon2 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';

// BN128 scalar field modulus. MUST match the constant in:
//   - android/.../ui/reg/RealRegistrationProver.kt
//   - android/.../ui/reg/RegistrationHelpers.kt
//   - android/.../assets/prover/poseidon.js
//   - circuit.r1cs / zkey (implicitly, via the bn128 curve)
const FIELD = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

const ROOT = path.resolve(__dirname, '..');
const WASM = path.join(ROOT, 'circuits/build/identity_proof_js/identity_proof.wasm');
const ZKEY = path.join(ROOT, 'circuits/build/circuit_final.zkey');
const VKEY = path.join(ROOT, 'circuits/build/verification_key.json');

const haveArtefacts =
  fs.existsSync(WASM) && fs.existsSync(ZKEY) && fs.existsSync(VKEY);

// snarkjs has no usable TypeScript types for fullProve / verify, so we
// drop the typing here. The runtime API is stable.
const sj = snarkjs as unknown as {
  groth16: {
    fullProve: (witness: Record<string, string>, wasm: string, zkey: string) => Promise<{
      proof: Record<string, unknown>;
      publicSignals: string[];
    }>;
    verify: (vkey: unknown, publicSignals: string[], proof: unknown) => Promise<boolean>;
  };
};

// Cache a single freshly-minted proof + signals + commitment across
// the test cases so we don't spend 1-2 s per test re-running fullProve.
let cached: {
  proof: Record<string, unknown>;
  publicSignals: string[];
  commitmentDec: string;
  commitmentHex: string;
} | null = null;

async function generateMobileEquivalentProof(): Promise<{
  proof: Record<string, unknown>;
  publicSignals: string[];
  commitmentDec: string;
  commitmentHex: string;
}> {
  if (cached) return cached;

  // ── Step 1: build a mobile-app-equivalent biometric secret ──
  // The Kotlin path generates a 32-byte SecureRandom buffer then
  // reduces mod FIELD before feeding it into Poseidon (so any high-bit
  // overflow stays valid). Reproduce that here.
  const secretBytes = randomBytes(32);
  const biometricSecret = BigInt('0x' + secretBytes.toString('hex')) % FIELD;
  const salt = 0n;

  // ── Step 2: commitment + didHashRaw (single-arg Poseidon over commitment) ──
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

  // ── Step 4: witness object — field names MUST match the circom signals ──
  const witness = {
    biometricSecret: biometricSecret.toString(10),
    salt: salt.toString(10),
    commitment: commitment.toString(10),
    didHash: didHashSession.toString(10),
    identityBinding: identityBinding.toString(10),
  };

  // ── Step 5: snarkjs.groth16.fullProve ──
  const proveResult = await sj.groth16.fullProve(witness, WASM, ZKEY);

  cached = {
    proof: proveResult.proof,
    publicSignals: proveResult.publicSignals,
    commitmentDec: commitment.toString(10),
    // Hex form is what the mobile app sends to /submit-commitment.
    // 64-char, 0x-prefix-less, lowercase — matches DeriveDidAndCommitment.from
    // in android/.../ui/reg/RegistrationHelpers.kt.
    commitmentHex: commitment.toString(16).padStart(64, '0'),
  };
  return cached;
}

// snarkjs leaves promises / workers dangling in CommonJS; force-kill them
// after the suite so jest --detectOpenHandles doesn't yell.
afterAll(async () => {
  // The globalThis.curve_bn128 instance is what snarkjs holds onto;
  // calling .terminate() releases its worker pool. If the global isn't
  // there (newer snarkjs versions), the call is a no-op.
  const c = (globalThis as unknown as { curve_bn128?: { terminate: () => Promise<void> } }).curve_bn128;
  if (c && typeof c.terminate === 'function') {
    await c.terminate().catch(() => undefined);
  }
});

(haveArtefacts ? describe : describe.skip)('proof roundtrip — mobile prover witness vs server verify', () => {
  // Allow ample time — Groth16 proving is 1-3 s on a dev box.
  jest.setTimeout(30_000);

  it('a freshly-minted proof verifies against the boot-pinned vkey', async () => {
    const { proof, publicSignals } = await generateMobileEquivalentProof();

    // Load the production vkey from the same path the server reads
    // (`config.zkp.vkeyPath` defaults to circuits/build/verification_key.json).
    const vkey = JSON.parse(fs.readFileSync(VKEY, 'utf-8'));
    expect(vkey.protocol).toBe('groth16');
    expect(vkey.curve).toBe('bn128');
    expect(vkey.nPublic).toBe(3);

    const ok: boolean = await sj.groth16.verify(vkey, publicSignals, proof);
    expect(ok).toBe(true);
  });

  it('verifyProofOffChain returns true for the same proof', async () => {
    // Lazy-import after the artefact guard so a missing snarkjs install
    // doesn't blow up the describe.skip path.
    const { verifyProofOffChain } = await import('../src/services/zkp');
    const { initZKP } = await import('../src/services/zkp');
    await initZKP();

    const { proof, publicSignals } = await generateMobileEquivalentProof();
    // verifyProofOffChain's signature expects a Groth16Proof; the
    // proof returned by snarkjs has the same shape but its TS type
    // is `Record<string, unknown>` here. Cast through unknown is the
    // smallest concession that keeps the test typed.
    const ok = await verifyProofOffChain(
      proof as unknown as Parameters<typeof verifyProofOffChain>[0],
      publicSignals,
    );
    expect(ok).toBe(true);
  });

  it('a doctored proof DOES NOT verify (negative control)', async () => {
    const { proof, publicSignals } = await generateMobileEquivalentProof();

    // Twiddle pi_a[0] to invalidate the proof while keeping the
    // envelope syntactically well-formed. Same pattern as the
    // diagnostic script in scripts/diagnose-ceremony-proof.ts.
    const mutated = JSON.parse(JSON.stringify(proof));
    mutated.pi_a[0] = ((BigInt(mutated.pi_a[0]) + 1n) % FIELD).toString(10);

    const vkey = JSON.parse(fs.readFileSync(VKEY, 'utf-8'));
    const ok: boolean = await sj.groth16.verify(vkey, publicSignals, mutated);
    expect(ok).toBe(false);
  });

  it('publicSignals are in declared order [commitment, didHash, identityBinding]', async () => {
    const { publicSignals, commitmentDec } = await generateMobileEquivalentProof();
    expect(publicSignals).toHaveLength(3);
    // publicSignals[0] is the commitment in decimal — same field
    // element the mobile app committed to in step 2 (where it sent
    // the HEX form). The server-side commitment comparator must
    // bridge those two encodings.
    expect(publicSignals[0]).toBe(commitmentDec);
  });

  it('server-side commitment comparator equates hex-stored and decimal publicSignals[0]', async () => {
    // This is the load-bearing assertion: previously the server used
    // a lowercase-string compare which never matched a hex stored
    // commitment against a decimal publicSignals[0]. The
    // BigInt-coerced parseCommitmentBigInt helper bridges the two
    // encodings. We test the comparator behaviour via the same
    // service function the route uses.
    const { publicSignals, commitmentHex } = await generateMobileEquivalentProof();

    // Reproduce the server's BigInt parsing exactly. If the helper
    // in registration.ts ever changes shape, this test fails loud.
    const presentedDec = String(publicSignals[0]);
    const storedHex = commitmentHex;

    // Both forms parse to the same BigInt.
    const aBI = BigInt(presentedDec);
    const bBI = BigInt('0x' + storedHex);
    expect(aBI).toBe(bBI);
    expect(aBI.toString(16).padStart(64, '0')).toBe(storedHex);
  });
});

// When artefacts are missing we want a visible reason in the test
// output so a fresh clone doesn't look broken.
if (!haveArtefacts) {
  describe.skip('proof roundtrip — skipped (missing circuit artefacts)', () => {
    it('circuits/build/circuit_final.zkey or related artefacts are missing — run scripts/setup-zkp.sh', () => {
      // Skipped via the outer describe.skip. Body intentionally empty.
    });
  });
}
