import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { verifyBiometricProof, getCircuitInfo } from '../../services/zkp';
import { registerIdentity } from '../../services/identity';
import { issueTokens } from '../../services/jwt';
import { sessionStore } from '../../services/session-store';
import { logger } from '../../services/logger';
import { UserSession, ZKPVerificationRequest, RegistrationRequest } from '../../types';

const router = Router();

/**
 * POST /v1/auth/zkp/register
 *
 * Register a new identity from a biometric template.
 * Requires scope: zkp:register
 *
 * Request:
 *   Authorization: Bearer za_live_xxx
 *   { "biometricTemplate": "<base64>" }
 *
 * Response: 201
 *   { did, commitment, didHash, biometricSecret, salt, txHash, blockNumber, dataStored: false }
 */
router.post('/register',
  authenticateTenantApiKey(['zkp:register']),
  async (req: Request, res: Response) => {
    try {
      const { tenant } = getTenantContext(req);
      const { biometricTemplate } = req.body as RegistrationRequest;

      if (!biometricTemplate || typeof biometricTemplate !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Missing or invalid biometricTemplate (base64 string required)',
          dataStored: false,
        });
        return;
      }

      const templateBuffer = Buffer.from(biometricTemplate, 'base64');
      if (templateBuffer.length < 16) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'Biometric template too short (minimum 16 bytes)',
          dataStored: false,
        });
        return;
      }

      const result = await registerIdentity(templateBuffer);

      logger.info('v1: ZKP identity registered', {
        tenantId: tenant.id,
        did: result.did,
        txHash: result.txHash,
        dataStored: false,
      });

      res.status(201).json({
        did: result.did,
        commitment: result.commitment,
        didHash: result.didHash,
        biometricSecret: result.biometricSecret,
        salt: result.salt,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        dataStored: false,
        message: 'Identity registered. Store biometricSecret and salt securely on the client — they will not be sent again.',
      });
    } catch (err) {
      logger.error('v1: ZKP registration error', { error: (err as Error).message });
      res.status(500).json({ error: 'registration_failed', message: (err as Error).message });
    }
  },
);

/**
 * POST /v1/auth/zkp/verify
 *
 * Verify a Groth16 ZK proof and issue session tokens.
 * Requires scope: zkp:verify
 *
 * Request:
 *   Authorization: Bearer za_live_xxx
 *   { proof, publicSignals, nonce, timestamp }
 *
 * Response: 200
 *   { accessToken, refreshToken, tokenType, expiresIn, verified, sessionId, provider }
 */
router.post('/verify',
  authenticateTenantApiKey(['zkp:verify']),
  async (req: Request, res: Response) => {
    try {
      const { tenant } = getTenantContext(req);
      const { proof, publicSignals, nonce, timestamp } = req.body as ZKPVerificationRequest;

      const result = await verifyBiometricProof({ proof, publicSignals, nonce, timestamp });

      if (!result.verified) {
        res.status(401).json({
          verified: false,
          error: 'proof_verification_failed',
          message: 'Biometric proof verification failed',
          dataStored: false,
        });
        return;
      }

      const sessionId = result.sessionId;
      const userId = `${tenant.id.slice(0, 8)}-zkp-${uuidv4().slice(0, 8)}`;
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

      logger.info('v1: ZKP verification successful', {
        tenantId: tenant.id,
        userId,
        sessionId,
        dataStored: false,
      });

      res.json({
        ...tokens,
        verified: true,
        sessionId,
        provider: 'zkp',
        dataStorageConfirmation: {
          biometricDataStored: false,
          message: 'Zero biometric data stored. Ever.',
        },
      });
    } catch (err) {
      logger.error('v1: ZKP verification error', { error: (err as Error).message });
      res.status(500).json({ error: 'verification_failed' });
    }
  },
);

/**
 * GET /v1/auth/zkp/nonce
 *
 * Get a fresh nonce for client-side proof generation.
 * Requires scope: nonce:create
 */
router.get('/nonce',
  authenticateTenantApiKey(['nonce:create']),
  (_req: Request, res: Response) => {
    res.json({
      nonce: uuidv4(),
      timestamp: new Date().toISOString(),
      expiresIn: 300,
    });
  },
);

/**
 * GET /v1/auth/zkp/circuit-info
 *
 * Returns circuit metadata for client SDK integration.
 * Requires scope: zkp:verify (read-only)
 */
router.get('/circuit-info',
  authenticateTenantApiKey(['zkp:verify']),
  (_req: Request, res: Response) => {
    const info = getCircuitInfo();
    res.json({
      circuit: 'identity_proof',
      protocol: 'groth16',
      curve: 'bn128',
      ...info,
      publicInputs: ['commitment', 'didHash', 'identityBinding'],
      privateInputs: ['biometricSecret', 'salt'],
    });
  },
);

export default router;
