import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { authenticateJWT } from '../../middleware/auth';
import { sessionStore } from '../../services/session-store';
import { verifyToken } from '../../services/jwt';
import { logger } from '../../services/logger';

const router = Router();

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

      const { issueTokens } = require('../../services/jwt');
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
