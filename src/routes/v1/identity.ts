import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { pgRateLimit } from '../../middleware/rate-limit';
import { sessionStore } from '../../services/session-store';
import { issueTokens, verifyToken } from '../../services/jwt';
import { logger } from '../../services/logger';
import { recordAuditEvent } from '../../services/platform';
import {
  registerFaceFirstIdentity,
  IdentityValidationError,
  IdentityAlreadyExistsError,
} from '../../services/identity';

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
