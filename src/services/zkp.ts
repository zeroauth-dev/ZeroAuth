import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from './logger';
import { Groth16Proof, ZKPVerificationRequest, ZKPVerificationResponse } from '../types';
import { verifyProofOnChain } from './blockchain';

// snarkjs loaded dynamically
let snarkjs: any = null;
let verificationKey: any = null;

/**
 * Patent Module 216 — ZKP Verification
 *
 * Initialize the verification key at server startup.
 * The server ONLY verifies proofs — it never generates them.
 * Proof generation happens client-side using snarkjs in the browser.
 */
export async function initZKP(): Promise<void> {
  snarkjs = await import('snarkjs');

  const vkeyPath = path.resolve(process.cwd(), config.zkp.vkeyPath);
  if (fs.existsSync(vkeyPath)) {
    const vkeyData = fs.readFileSync(vkeyPath, 'utf-8');
    verificationKey = JSON.parse(vkeyData);
    logger.info('ZKP: Verification key loaded', { path: vkeyPath });
  } else {
    logger.warn('ZKP: Verification key not found — ZKP verification will use fallback mode', {
      path: vkeyPath,
    });
  }
}

/**
 * Verify a Groth16 proof off-chain (fast, free, ~10ms)
 *
 * Patent Claim 6: "verify the zero-knowledge proof by the server
 * without accessing the identity data"
 */
export async function verifyProofOffChain(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  if (!snarkjs || !verificationKey) {
    throw new Error('ZKP not initialized. Call initZKP() first.');
  }

  try {
    const result = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
    return result;
  } catch (err) {
    logger.error('ZKP: Off-chain verification error', { error: (err as Error).message });
    return false;
  }
}

/**
 * Full biometric proof verification flow
 *
 * CRITICAL INVARIANT: Zero biometric data stored. Ever.
 * The server receives only the mathematical proof and public signals.
 * No biometric template, no biometric hash, no secrets.
 */
export async function verifyBiometricProof(
  request: ZKPVerificationRequest,
): Promise<ZKPVerificationResponse> {
  const { proof, publicSignals, nonce, timestamp } = request;

  // Validate required fields
  if (!proof || !publicSignals || !nonce || !timestamp) {
    logger.warn('ZKP: Verification failed — missing required fields');
    return {
      verified: false,
      sessionId: uuidv4(),
      dataStored: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Validate timestamp window (5 minutes)
  const proofTime = new Date(timestamp).getTime();
  const now = Date.now();
  if (isNaN(proofTime) || Math.abs(now - proofTime) > 5 * 60 * 1000) {
    logger.warn('ZKP: Verification failed — proof timestamp out of range');
    return {
      verified: false,
      sessionId: uuidv4(),
      dataStored: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Validate nonce format (UUID v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(nonce)) {
    logger.warn('ZKP: Verification failed — invalid nonce format');
    return {
      verified: false,
      sessionId: uuidv4(),
      dataStored: false,
      timestamp: new Date().toISOString(),
    };
  }

  // Validate public signals format (3 elements for our circuit)
  if (!Array.isArray(publicSignals) || publicSignals.length !== 3) {
    logger.warn('ZKP: Verification failed — invalid publicSignals (expected 3 elements)');
    return {
      verified: false,
      sessionId: uuidv4(),
      dataStored: false,
      timestamp: new Date().toISOString(),
    };
  }

  let verified = false;
  let txHash: string | undefined;

  // Step 1: Off-chain verification (always performed, fast)
  if (snarkjs && verificationKey) {
    verified = await verifyProofOffChain(proof, publicSignals);
    logger.info(`ZKP: Off-chain Groth16 verification: ${verified ? 'PASS' : 'FAIL'}`);
  } else {
    // Fallback: if no verification key available (dev mode without compiled circuit)
    logger.warn('ZKP: No verification key — using structural proof validation');
    verified = isValidProofStructure(proof);
  }

  // Step 2: On-chain verification (optional, costs gas)
  if (verified && config.blockchain.verifyOnChain) {
    try {
      const pA: [string, string] = [proof.pi_a[0], proof.pi_a[1]];
      const pB: [[string, string], [string, string]] = [
        [proof.pi_b[0][1], proof.pi_b[0][0]],
        [proof.pi_b[1][1], proof.pi_b[1][0]],
      ];
      const pC: [string, string] = [proof.pi_c[0], proof.pi_c[1]];
      const onChainResult = await verifyProofOnChain(
        pA,
        pB,
        pC,
        publicSignals as [string, string, string],
      );
      if (!onChainResult) {
        logger.warn('ZKP: On-chain verification FAILED (off-chain passed)');
        verified = false;
      } else {
        logger.info('ZKP: On-chain Groth16 verification: PASS');
      }
    } catch (err) {
      logger.error('ZKP: On-chain verification error', { error: (err as Error).message });
      // Don't fail if on-chain verification has an error — off-chain is sufficient
    }
  }

  logger.info(`ZKP: Biometric verification: ${verified ? 'SUCCESS' : 'FAILURE'}`, {
    nonce,
    verified,
    dataStored: false,
  });

  return {
    verified,
    sessionId: uuidv4(),
    dataStored: false,
    timestamp: new Date().toISOString(),
    txHash,
  };
}

/**
 * Structural validation for Groth16 proof shape.
 * Used as fallback when verification key is not available.
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

export function getCircuitInfo(): {
  wasmPath: string;
  vkeyAvailable: boolean;
  verifyOnChain: boolean;
} {
  return {
    wasmPath: config.zkp.wasmPath,
    vkeyAvailable: verificationKey !== null,
    verifyOnChain: config.blockchain.verifyOnChain,
  };
}

export function isZKPReady(): boolean {
  return snarkjs !== null;
}
