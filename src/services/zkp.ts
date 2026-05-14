import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { logger } from './logger';
import { Groth16Proof, ZKPVerificationRequest, ZKPVerificationResponse } from '../types';
import { verifyProofOnChain } from './blockchain';

/**
 * Patent Module 216 — ZKP Verification
 *
 * Two execution modes, selected by config:
 *
 *   1. **Verifier service (preferred).** When `config.zkp.verifierUrl` is
 *      set, this module is a thin HTTP client to the loopback verifier
 *      service ([verifier/README.md](../../verifier/README.md)). The
 *      verifier loads snarkjs, holds the verification key, and runs the
 *      Groth16 verify; this module remains responsible for replay
 *      defense (nonce + timestamp window + signal shape) and for the
 *      optional on-chain re-verification.
 *
 *   2. **Inline fallback (legacy / dev).** When `verifierUrl` is unset
 *      this module loads snarkjs + the vkey itself, the way it always
 *      did. Marked for removal once the verifier service ships to
 *      production (Friday Day 5 work) — DO NOT lean on this for new
 *      features.
 *
 * Either way, the server **only verifies** proofs — it never generates
 * them. Proof generation happens client-side using snarkjs in the
 * browser or on the IoT terminal.
 *
 * The split is documented in [docs/design/verifier-service-split.md](../../docs/design/verifier-service-split.md).
 */

// ─── Inline fallback state ───────────────────────────────────────────
// Populated only when VERIFIER_URL is unset. Module-level singleton; one
// load per process per the v0 behavior.

let snarkjs: any = null;
let verificationKey: any = null;
let verifierServiceReady = false;

function useVerifierService(): boolean {
  return Boolean(config.zkp.verifierUrl);
}

/**
 * Startup hook. Wires whichever mode is active.
 */
export async function initZKP(): Promise<void> {
  if (useVerifierService()) {
    // Probe the verifier's /health endpoint at startup so a misconfigured
    // VERIFIER_URL fails loud and early instead of on the first proof.
    try {
      const res = await fetch(`${config.zkp.verifierUrl}/health`, {
        signal: AbortSignal.timeout(config.zkp.verifierTimeoutMs),
      });
      if (!res.ok) throw new Error(`verifier health returned ${res.status}`);
      const body = await res.json() as { status: string; vkeyAvailable: boolean; version: string };
      verifierServiceReady = true;
      logger.info('ZKP: verifier service reachable', {
        url: config.zkp.verifierUrl,
        verifierStatus: body.status,
        verifierVkeyAvailable: body.vkeyAvailable,
        verifierVersion: body.version,
      });
    } catch (err) {
      verifierServiceReady = false;
      logger.error('ZKP: verifier service unreachable at startup — proofs will fail until restored', {
        url: config.zkp.verifierUrl,
        error: (err as Error).message,
      });
    }
    return;
  }

  // Inline fallback path
  snarkjs = await import('snarkjs');
  const vkeyPath = path.resolve(process.cwd(), config.zkp.vkeyPath);
  if (fs.existsSync(vkeyPath)) {
    const vkeyData = fs.readFileSync(vkeyPath, 'utf-8');
    verificationKey = JSON.parse(vkeyData);
    logger.info('ZKP: verification key loaded (inline fallback)', { path: vkeyPath });
  } else {
    logger.warn('ZKP: verification key not found — inline fallback will use structural validation only', {
      path: vkeyPath,
    });
  }
}

/**
 * Full biometric proof verification flow.
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
    logger.warn('ZKP: verification failed — missing required fields');
    return rejected();
  }

  // Validate timestamp window (5 minutes). Note: nonce-binding to an
  // issued-nonces table is still an open A-02 finding; this window is
  // necessary-but-not-sufficient.
  const proofTime = new Date(timestamp).getTime();
  const now = Date.now();
  if (isNaN(proofTime) || Math.abs(now - proofTime) > 5 * 60 * 1000) {
    logger.warn('ZKP: verification failed — proof timestamp out of range');
    return rejected();
  }

  // Validate nonce format (UUID v4)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(nonce)) {
    logger.warn('ZKP: verification failed — invalid nonce format');
    return rejected();
  }

  // Validate public signals shape (3 elements for our circuit)
  if (!Array.isArray(publicSignals) || publicSignals.length !== 3) {
    logger.warn('ZKP: verification failed — invalid publicSignals (expected 3 elements)');
    return rejected();
  }

  // ─── Step 1: Off-chain verification ─────────────────────────────
  const verified = useVerifierService()
    ? await verifyViaService(proof, publicSignals, nonce)
    : await verifyInline(proof, publicSignals);

  let txHash: string | undefined;

  // ─── Step 2: Optional on-chain re-verification ──────────────────
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
        logger.warn('ZKP: on-chain verification FAILED (off-chain passed)');
        return rejected();
      }
      logger.info('ZKP: on-chain Groth16 verification: PASS');
    } catch (err) {
      // Off-chain pass is sufficient; log the on-chain error and move on.
      logger.error('ZKP: on-chain verification error', { error: (err as Error).message });
    }
  }

  logger.info(`ZKP: biometric verification: ${verified ? 'SUCCESS' : 'FAILURE'}`, {
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

// ─── Verifier-service path ───────────────────────────────────────────

async function verifyViaService(
  proof: Groth16Proof,
  publicSignals: string[],
  correlationId: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${config.zkp.verifierUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof,
        publicSignals,
        circuitVersion: 'v1',
        correlationId,
      }),
      signal: AbortSignal.timeout(config.zkp.verifierTimeoutMs),
    });
    if (!res.ok) {
      logger.error('ZKP: verifier service responded non-2xx', { status: res.status });
      return false;
    }
    const body = (await res.json()) as {
      verified: boolean;
      structuralFallback: boolean;
      verifierAuditId: string;
      latencyMs: number;
    };
    logger.info(`ZKP: verifier service: ${body.verified ? 'PASS' : 'FAIL'}`, {
      verifierAuditId: body.verifierAuditId,
      latencyMs: body.latencyMs,
      structuralFallback: body.structuralFallback,
    });
    return body.verified;
  } catch (err) {
    logger.error('ZKP: verifier service call failed', { error: (err as Error).message });
    return false;
  }
}

// ─── Inline fallback path (legacy) ───────────────────────────────────

async function verifyInline(proof: Groth16Proof, publicSignals: string[]): Promise<boolean> {
  if (snarkjs && verificationKey) {
    try {
      const result = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
      logger.info(`ZKP: inline Groth16: ${result ? 'PASS' : 'FAIL'}`);
      return result;
    } catch (err) {
      logger.error('ZKP: inline verification error', { error: (err as Error).message });
      return false;
    }
  }
  // No vkey + inline mode → fall back to structural shape check.
  logger.warn('ZKP: no verification key — using structural proof validation');
  return isValidProofStructure(proof);
}

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

// ─── Helpers ─────────────────────────────────────────────────────────

function rejected(): ZKPVerificationResponse {
  return {
    verified: false,
    sessionId: uuidv4(),
    dataStored: false,
    timestamp: new Date().toISOString(),
  };
}

export function getCircuitInfo(): {
  wasmPath: string;
  vkeyAvailable: boolean;
  verifyOnChain: boolean;
  verifierMode: 'service' | 'inline';
  verifierUrl: string | null;
} {
  return {
    wasmPath: config.zkp.wasmPath,
    // In service mode the API can't directly know the vkey state; report
    // the last observed health signal (set in initZKP).
    vkeyAvailable: useVerifierService() ? verifierServiceReady : verificationKey !== null,
    verifyOnChain: config.blockchain.verifyOnChain,
    verifierMode: useVerifierService() ? 'service' : 'inline',
    verifierUrl: useVerifierService() ? config.zkp.verifierUrl : null,
  };
}

export function isZKPReady(): boolean {
  return useVerifierService() ? verifierServiceReady : snarkjs !== null;
}

/**
 * Exposed only for tests that need to verify the off-chain path without
 * going through `verifyBiometricProof`'s validation chain. Production
 * code should always use `verifyBiometricProof`.
 */
export async function verifyProofOffChain(
  proof: Groth16Proof,
  publicSignals: string[],
): Promise<boolean> {
  return useVerifierService()
    ? verifyViaService(proof, publicSignals, uuidv4())
    : verifyInline(proof, publicSignals);
}
