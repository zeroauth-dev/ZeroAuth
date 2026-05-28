import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { pgRateLimit } from '../../middleware/rate-limit';
import { sessionStore } from '../../services/session-store';
import { issueTokens, verifyToken } from '../../services/jwt';
import { logger } from '../../services/logger';
import { recordAuditEvent } from '../../services/platform';
import { v4 as uuidv4 } from 'uuid';
import {
  registerFaceFirstIdentity,
  findUserByDid,
  IdentityValidationError,
  IdentityAlreadyExistsError,
} from '../../services/identity';
import { verifyBiometricProof } from '../../services/zkp';
import type { UserSession, ZKPVerificationRequest } from '../../types';

const router = Router();

/**
 * POST /v1/identity/register
 *
 * Face-first identity registration (ADR 0017).
 *
 * The platform receives the (did, commitment) tuple computed
 * on-device by the mobile/biometric pipeline. No biometric template,
 * no image, no embedding ever crosses the wire — those live and die
 * on the customer's phone. The server validates format, asserts
 * uniqueness per (tenant_id, environment, did), persists the row,
 * audits the action, and optionally queues an async chain
 * registration when the tenant's `security_policy.did_provider`
 * opts in.
 *
 * The legacy `/v1/auth/zkp/register` endpoint that accepts a base64
 * biometricTemplate is retained for the W3 demo client + existing
 * test fixtures, but is deprecated for new integrations.
 *
 * Request:
 *   Authorization: Bearer za_live_xxx
 *   Content-Type: application/json
 *   { did, commitment, externalId?, attestation? }
 *
 * Responses:
 *   201 { userId, did, commitment, createdAt }
 *   400 invalid_did / invalid_commitment / etc
 *   409 did_already_registered
 *
 * Requires scope: zkp:register
 */
router.post('/register',
  authenticateTenantApiKey(['zkp:register']),
  pgRateLimit({ route: 'identity:register-face', windowMs: 60_000, max: 30, keyBy: 'apiKey' }),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { did, commitment, externalId, attestation } = req.body ?? {};

      const environment = (apiKey.environment === 'live' || apiKey.environment === 'test')
        ? apiKey.environment
        : 'live';

      const result = await registerFaceFirstIdentity(
        tenant.id,
        environment,
        { did, commitment, externalId, attestation },
        tenant.security_policy,
      );

      await recordAuditEvent(tenant.id, {
        environment,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'identity.register',
        entityType: 'tenant_user',
        entityId: result.userId,
        status: 'success',
        summary: `Face-first identity registered for DID ${result.did}`,
        metadata: {
          did: result.did,
          commitment_prefix: result.commitment.slice(0, 16),
        },
      });

      logger.info('v1: face-first identity registered', {
        tenantId: tenant.id,
        environment,
        did: result.did,
        userId: result.userId,
      });

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof IdentityValidationError) {
        res.status(400).json({ error: err.code, message: err.message });
        return;
      }
      if (err instanceof IdentityAlreadyExistsError) {
        res.status(409).json({
          error: 'did_already_registered',
          message: err.message,
        });
        return;
      }
      logger.error('v1: face-first identity register error', { error: (err as Error).message });
      res.status(500).json({ error: 'register_failed' });
    }
  },
);

/**
 * POST /v1/identity/verify
 *
 * Face-first identity verification (ADR 0017). The client produces a
 * Groth16 proof on-device using `mobile/prover` with the actual
 * commitment + secret + nonce as inputs. The server:
 *
 *   1. Looks up the enrolled user by DID.
 *   2. Asserts publicSignals[0] (the commitment) matches the stored
 *      commitment for that DID — same-DID-different-face attacks are
 *      blocked here, not downstream.
 *   3. Calls verifyBiometricProof() which runs snarkjs.groth16.verify
 *      against the platform's pinned verification key (ADR 0015).
 *   4. On success: creates a session, issues access + refresh tokens,
 *      writes an audit row.
 *   5. On failure: writes an audit row with the failure reason and
 *      returns 401.
 *
 * Request:
 *   Authorization: Bearer za_live_xxx
 *   { did, proof, publicSignals, nonce, timestamp }
 *
 * Responses:
 *   200 { accessToken, refreshToken, tokenType, expiresIn, sessionId, did }
 *   400 invalid_did / invalid_request
 *   401 verification_failed / commitment_mismatch / did_unknown
 *
 * Requires scope: zkp:verify
 */
router.post('/verify',
  authenticateTenantApiKey(['zkp:verify']),
  pgRateLimit({ route: 'identity:verify', windowMs: 60_000, max: 30, keyBy: 'apiKey' }),
  async (req: Request, res: Response) => {
    const { tenant, apiKey } = getTenantContext(req);
    const environment = (apiKey.environment === 'live' || apiKey.environment === 'test')
      ? apiKey.environment
      : 'live';

    const { did, proof, publicSignals, nonce, timestamp } = req.body ?? {};

    // Format guards.
    if (typeof did !== 'string' || did.length === 0) {
      res.status(400).json({ error: 'invalid_did', message: 'did is required (string).' });
      return;
    }
    if (!Array.isArray(publicSignals) || publicSignals.length === 0) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'publicSignals is required (array).',
      });
      return;
    }
    if (!proof || typeof proof !== 'object') {
      res.status(400).json({
        error: 'invalid_request',
        message: 'proof is required (object).',
      });
      return;
    }

    try {
      // Step 1: look up user.
      const user = await findUserByDid(tenant.id, environment, did);
      if (!user) {
        // Uniform error for enumeration defence — same response for
        // unknown DID and commitment-mismatch (Step 2 below).
        await recordAuditEvent(tenant.id, {
          environment,
          actorType: 'api_key',
          actorId: apiKey.id,
          action: 'identity.verify',
          entityType: 'tenant_user',
          entityId: null,
          status: 'failure',
          summary: 'verify: did unknown',
          metadata: { did, reason: 'did_unknown' },
        });
        res.status(401).json({ error: 'verification_failed', message: 'Identity verification failed.' });
        return;
      }

      // Step 2: assert commitment match. publicSignals[0] is the
      // commitment per the circuit's wire layout.
      const presentedCommitment = String(publicSignals[0] ?? '').toLowerCase();
      const storedCommitment = (user.commitment ?? '').toLowerCase();
      if (storedCommitment.length === 0 || presentedCommitment !== storedCommitment) {
        await recordAuditEvent(tenant.id, {
          environment,
          actorType: 'api_key',
          actorId: apiKey.id,
          action: 'identity.verify',
          entityType: 'tenant_user',
          entityId: user.id,
          status: 'failure',
          summary: 'verify: commitment mismatch',
          metadata: { did, reason: 'commitment_mismatch' },
        });
        // Uniform error — see Step 1.
        res.status(401).json({ error: 'verification_failed', message: 'Identity verification failed.' });
        return;
      }

      // Step 3: snarkjs.groth16.verify.
      const verifyResult = await verifyBiometricProof({
        proof,
        publicSignals,
        nonce,
        timestamp,
      } as ZKPVerificationRequest);

      if (!verifyResult.verified) {
        await recordAuditEvent(tenant.id, {
          environment,
          actorType: 'api_key',
          actorId: apiKey.id,
          action: 'identity.verify',
          entityType: 'tenant_user',
          entityId: user.id,
          status: 'failure',
          summary: 'verify: groth16 proof invalid',
          metadata: { did, reason: 'proof_invalid' },
        });
        res.status(401).json({ error: 'verification_failed', message: 'Identity verification failed.' });
        return;
      }

      // Step 4: mint session + tokens.
      const sessionId = verifyResult.sessionId;
      const userId = user.id;
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
        did,
      });

      // Step 5: audit row.
      await recordAuditEvent(tenant.id, {
        environment,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'identity.verify',
        entityType: 'tenant_user',
        entityId: userId,
        status: 'success',
        summary: `Face-first verification succeeded for DID ${did}`,
        metadata: { did, sessionId },
      });

      logger.info('v1: face-first identity verified', {
        tenantId: tenant.id,
        environment,
        did,
        userId,
        sessionId,
      });

      res.json({
        ...tokens,
        verified: true,
        sessionId,
        did,
        provider: 'zkp',
      });
    } catch (err) {
      logger.error('v1: face-first identity verify error', { error: (err as Error).message });
      // Audit even the unexpected-error path so a verifier outage is
      // attributable.
      await recordAuditEvent(tenant.id, {
        environment,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'identity.verify',
        entityType: 'tenant_user',
        entityId: null,
        status: 'failure',
        summary: 'verify: internal error',
        metadata: { did, reason: 'internal_error', error: (err as Error).message },
      }).catch(() => undefined);
      res.status(500).json({ error: 'verify_failed' });
    }
  },
);

/**
 * GET /v1/identity/me
 *
 * Returns the authenticated user's profile from a session token.
 * Requires: Authorization: Bearer <access_token> + X-API-Key: za_live_xxx
 */
router.get('/me',
  authenticateTenantApiKey(['identity:read']),
  (req: Request, res: Response) => {
    // Extract the user's session token from a separate header or query param
    const sessionToken = req.headers['x-session-token'] as string;
    if (!sessionToken) {
      res.status(400).json({
        error: 'missing_session_token',
        message: 'Provide the user session token via X-Session-Token header.',
      });
      return;
    }

    try {
      const payload = verifyToken(sessionToken);
      const session = sessionStore.get(payload.sessionId);

      if (!session) {
        res.status(401).json({ error: 'session_expired', message: 'Session has expired.' });
        return;
      }

      res.json({
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        provider: payload.provider || session.provider,
        verified: session.verified,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        dataStorageConfirmation: {
          biometricDataStored: false,
          message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
        },
      });
    } catch (err) {
      res.status(401).json({ error: 'invalid_session_token', message: 'Session token is invalid or expired.' });
    }
  },
);

/**
 * POST /v1/identity/logout
 *
 * Invalidates a user session.
 */
router.post('/logout',
  authenticateTenantApiKey(['identity:read']),
  (req: Request, res: Response) => {
    const sessionToken = req.headers['x-session-token'] as string;
    if (!sessionToken) {
      res.status(400).json({ error: 'missing_session_token' });
      return;
    }

    try {
      const payload = verifyToken(sessionToken);
      sessionStore.delete(payload.sessionId);
      logger.info('v1: User session invalidated', { sessionId: payload.sessionId });
      res.json({ message: 'Session invalidated successfully.' });
    } catch {
      res.status(401).json({ error: 'invalid_session_token' });
    }
  },
);

/**
 * POST /v1/identity/refresh
 *
 * Refresh a user's session tokens.
 */
router.post('/refresh',
  authenticateTenantApiKey(['identity:read']),
  (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: 'missing_refresh_token' });
      return;
    }

    try {
      const payload = verifyToken(refreshToken);
      if ((payload as any).type !== 'refresh') {
        res.status(400).json({ error: 'invalid_token_type' });
        return;
      }

      const session = sessionStore.get(payload.sessionId);
      if (!session) {
        res.status(401).json({ error: 'session_expired' });
        return;
      }

      const tokens = issueTokens({
        sub: payload.sub,
        email: payload.email,
        provider: session.provider,
        verified: session.verified,
        sessionId: session.sessionId,
      });

      res.json(tokens);
    } catch {
      res.status(401).json({ error: 'invalid_refresh_token' });
    }
  },
);

export default router;
