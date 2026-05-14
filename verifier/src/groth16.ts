import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { Groth16Proof } from './types';

// snarkjs is loaded dynamically — it's an ESM module with sizeable
// transitive deps and we don't want it pulled in for the import graph
// of any caller that doesn't actually verify.
let snarkjs: any = null;
let verificationKey: any = null;
let vkeyAvailable = false;

/**
 * Load the Groth16 verification key from disk + dynamic-import snarkjs.
 * Called once at server startup. If the vkey file is absent (dev env
 * without compiled circuit), the service still starts but `verify()`
 * falls back to structural validation. **In a follow-up ADR this becomes
 * refuse-to-start when vkey is missing in production.**
 */
export async function initVerifier(vkeyPath: string): Promise<void> {
  snarkjs = await import('snarkjs');

  const absolutePath = path.resolve(process.cwd(), vkeyPath);
  if (fs.existsSync(absolutePath)) {
    const vkeyData = fs.readFileSync(absolutePath, 'utf-8');
    verificationKey = JSON.parse(vkeyData);
    vkeyAvailable = true;
    logger.info('Verifier: verification key loaded', { path: absolutePath });
  } else {
    vkeyAvailable = false;
    logger.warn('Verifier: verification key not found — running in structural-fallback mode', {
      path: absolutePath,
    });
  }
}

export function isVkeyLoaded(): boolean {
  return vkeyAvailable;
}

/**
 * Verify a Groth16 proof against the loaded verification key.
 *
 * Returns {verified, structuralFallback}. `structuralFallback=true` means
 * no vkey was loaded at startup so the result is a shape-only check, not
 * a cryptographic verification. Callers must treat this as a non-binding
 * signal in production.
 */
export async function verifyProof(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<{ verified: boolean; structuralFallback: boolean }> {
  if (snarkjs && verificationKey) {
    try {
      const verified = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
      return { verified, structuralFallback: false };
    } catch (err) {
      logger.error('Verifier: snarkjs.groth16.verify threw', { error: (err as Error).message });
      return { verified: false, structuralFallback: false };
    }
  }

  // Fallback: structural-only check when no vkey is available.
  return { verified: isValidProofStructure(proof), structuralFallback: true };
}

/**
 * Structural validation for the Groth16 proof shape we expect from
 * snarkjs's browser client. Used only when the verification key is
 * unavailable (dev without a compiled circuit).
 *
 * NOTE: this is a shape check, not a cryptographic verification. It must
 * never be relied on in production. The companion log line + the
 * `structuralFallback: true` flag in the response signal this to callers.
 */
function isValidProofStructure(proof: Groth16Proof): boolean {
  try {
    return (
      proof.protocol === 'groth16' &&
      proof.curve === 'bn128' &&
      Array.isArray(proof.pi_a) &&
      proof.pi_a.length === 3 &&
      Array.isArray(proof.pi_b) &&
      proof.pi_b.length === 3 &&
      Array.isArray(proof.pi_c) &&
      proof.pi_c.length === 3 &&
      proof.pi_a.every((v) => typeof v === 'string' && v.length > 0) &&
      proof.pi_c.every((v) => typeof v === 'string' && v.length > 0)
    );
  } catch {
    return false;
  }
}
