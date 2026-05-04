import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { verifyBiometricProof, getCircuitInfo } from '../services/zkp';
import { registerIdentity } from '../services/identity';
import { issueTokens } from '../services/jwt';
import { sessionStore } from '../services/session-store';
import { logger } from '../services/logger';
import { UserSession, ZKPVerificationRequest, RegistrationRequest } from '../types';

const router = Router();

/**
 * POST /api/auth/zkp/register
 * Patent Module 212+214 — Data Acquisition + Identity Generation
 *
 * Accepts base64-encoded biometric template, generates:
 * - SHA-256 biometric hash (biometricID)
 * - DID (did:zeroauth:base:...)
 * - Poseidon commitment + didHash
 * - On-chain biometricID→DID mapping
 *
 * Returns client secrets needed for proof generation.
 * CRITICAL: Biometric template is discarded after processing.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { biometricTemplate } = req.body as RegistrationRequest;

    if (!biometricTemplate || typeof biometricTemplate !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid biometricTemplate (base64 string required)',
        dataStored: false,
      });
      return;
    }

    // Decode base64 biometric template
    const templateBuffer = Buffer.from(biometricTemplate, 'base64');
    if (templateBuffer.length < 16) {
      res.status(400).json({
        error: 'Biometric template too short (minimum 16 bytes)',
        dataStored: false,
      });
      return;
    }

    // Patent Module 214: Generate identity
    const result = await registerIdentity(templateBuffer);

    logger.info('ZKP: Identity registered', {
      did: result.did,
      txHash: result.txHash,
      dataStored: false,
    });

    // Return everything the client needs for future proof generation.
    // biometricSecret and salt must be stored securely by the client.
    res.status(201).json({
      did: result.did,
      commitment: result.commitment,
      didHash: result.didHash,
      biometricSecret: result.biometricSecret,
      salt: result.salt,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      dataStored: false,
      message: 'Identity registered. Store biometricSecret and salt securely — they will not be sent again. Zero biometric data stored on server.',
    });
  } catch (err) {
    logger.error('ZKP: Registration error', { error: (err as Error).message });
    res.status(500).json({ error: 'Registration failed', details: (err as Error).message });
  }
});

/**
 * POST /api/auth/zkp/verify
 * Patent Module 216 — ZKP Verification
 *
 * Accepts a pre-generated Groth16 proof + public signals from the client.
 * The server ONLY verifies the proof — it never sees biometric data.
 * Issues JWT tokens on successful verification.
 *
 * CRITICAL: No biometric data is stored. The proof is verified
 * mathematically and discarded immediately after verification.
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { proof, publicSignals, nonce, timestamp } = req.body as ZKPVerificationRequest;

    const result = await verifyBiometricProof({ proof, publicSignals, nonce, timestamp });

    if (!result.verified) {
      res.status(401).json({
        verified: false,
        error: 'Biometric proof verification failed',
        dataStored: false,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      });
      return;
    }

    const sessionId = result.sessionId;
    const userId = `zkp-user-${uuidv4().slice(0, 8)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3600000);

    const session: UserSession = {
      sessionId,
      userId,
      provider: 'zkp',
      verified: true,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    sessionStore.create(session);

    const tokens = issueTokens({
      sub: userId,
      provider: 'zkp',
      verified: true,
      sessionId,
    });

    logger.info('ZKP: Biometric verification successful', {
      userId,
      sessionId,
      dataStored: false,
    });

    res.json({
      ...tokens,
      verified: true,
      sessionId,
      provider: 'zkp',
      txHash: result.txHash,
      dataStorageConfirmation: {
        biometricDataStored: false,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
    });
  } catch (err) {
    logger.error('ZKP: Verification error', { error: (err as Error).message });
    res.status(500).json({ error: 'ZKP verification failed' });
  }
});

/**
 * GET /api/auth/zkp/nonce
 * Generates a fresh nonce for client-side proof generation.
 */
router.get('/nonce', (_req: Request, res: Response) => {
  res.json({
    nonce: uuidv4(),
    timestamp: new Date().toISOString(),
    expiresIn: 300,
  });
});

/**
 * GET /api/auth/zkp/circuit-info
 * Returns circuit metadata for client SDK integration.
 * Clients use this to know where to download WASM + verification key
 * for client-side proof generation.
 */
router.get('/circuit-info', (_req: Request, res: Response) => {
  const info = getCircuitInfo();
  res.json({
    circuit: 'identity_proof',
    protocol: 'groth16',
    curve: 'bn128',
    ...info,
    publicInputs: ['commitment', 'didHash', 'identityBinding'],
    privateInputs: ['biometricSecret', 'salt'],
  });
});

export default router;
