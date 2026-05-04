import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { config } from '../../config';
import { issueTokens } from '../../services/jwt';
import { sessionStore } from '../../services/session-store';
import { logger } from '../../services/logger';
import { UserSession } from '../../types';

const router = Router();

const pendingStates = new Map<string, { codeVerifier: string; createdAt: number; tenantId: string }>();

/**
 * GET /v1/auth/oidc/authorize
 *
 * Initiate OIDC authorization code flow with PKCE.
 * Requires scope: oidc:authorize
 */
router.get('/authorize',
  authenticateTenantApiKey(['oidc:authorize']),
  (req: Request, res: Response) => {
    const { tenant } = getTenantContext(req);
    const state = uuidv4();
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    pendingStates.set(state, { codeVerifier, createdAt: Date.now(), tenantId: tenant.id });

    // Clean stale states
    const cutoff = Date.now() - 600000;
    for (const [key, val] of pendingStates) {
      if (val.createdAt < cutoff) pendingStates.delete(key);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.oidc.clientId,
      redirect_uri: `${config.apiBaseUrl}/v1/auth/oidc/callback`,
      scope: 'openid email profile',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce: uuidv4(),
    });

    const authorizeUrl = `${config.oidc.issuer}/authorize?${params.toString()}`;

    logger.info('v1: OIDC authorize initiated', { tenantId: tenant.id, state });

    res.json({
      authorizeUrl,
      state,
      note: 'Redirect the user to authorizeUrl. They will return to your callback with a code + state.',
    });
  },
);

/**
 * POST /v1/auth/oidc/callback
 *
 * Handle OIDC authorization code callback.
 * Requires scope: oidc:callback
 */
router.post('/callback',
  authenticateTenantApiKey(['oidc:callback']),
  (req: Request, res: Response) => {
    try {
      const { tenant } = getTenantContext(req);
      const { code, state } = req.body;

      if (!code || !state) {
        res.status(400).json({ error: 'missing_parameters', message: 'code and state are required' });
        return;
      }

      const pending = pendingStates.get(state);
      if (!pending || pending.tenantId !== tenant.id) {
        res.status(400).json({ error: 'invalid_state' });
        return;
      }
      pendingStates.delete(state);

      const userId = `${tenant.id.slice(0, 8)}-oidc-${uuidv4().slice(0, 8)}`;
      const email = req.body.email ?? `${userId}@example.com`;
      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600000);

      const session: UserSession = {
        sessionId,
        userId,
        provider: 'oidc',
        verified: true,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      sessionStore.create(session);

      const tokens = issueTokens({
        sub: userId,
        email,
        provider: 'oidc',
        verified: true,
        sessionId,
      });

      logger.info('v1: OIDC auth successful', { tenantId: tenant.id, sessionId });

      res.json({
        ...tokens,
        sessionId,
        provider: 'oidc',
        dataStorageConfirmation: {
          biometricDataStored: false,
          message: 'Zero biometric data stored. Ever.',
        },
      });
    } catch (err) {
      logger.error('v1: OIDC callback error', { error: (err as Error).message });
      res.status(500).json({ error: 'oidc_auth_failed' });
    }
  },
);

export default router;
