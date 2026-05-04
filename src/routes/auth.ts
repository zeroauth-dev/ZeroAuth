import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { issueTokens, verifyToken } from '../services/jwt';
import { sessionStore } from '../services/session-store';
import { logger } from '../services/logger';

const router = Router();

/**
 * GET /api/auth/me
 * Returns the current authenticated user's profile.
 */
router.get('/me', authenticateJWT, (req: Request, res: Response) => {
  const user = (req as any).user;
  res.json({
    sub: user.sub,
    email: user.email,
    name: user.name,
    provider: user.provider,
    verified: user.verified,
    sessionId: user.sessionId,
    dataStorageConfirmation: {
      biometricDataStored: false,
      message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
    },
  });
});

/**
 * POST /api/auth/refresh
 * Exchanges a valid refresh token for new access + refresh tokens.
 */
router.post('/refresh', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ error: 'Missing refresh token' });
      return;
    }

    const payload = verifyToken(refreshToken);

    if ((payload as any).type !== 'refresh') {
      res.status(400).json({ error: 'Invalid token type' });
      return;
    }

    const session = sessionStore.get(payload.sessionId);
    if (!session) {
      res.status(401).json({ error: 'Session expired or invalid' });
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
  } catch (err) {
    logger.warn('Token refresh failed', { error: (err as Error).message });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

/**
 * POST /api/auth/logout
 * Invalidates the current session.
 */
router.post('/logout', authenticateJWT, (req: Request, res: Response) => {
  const user = (req as any).user;
  sessionStore.delete(user.sessionId);
  logger.info('User logged out', { sessionId: user.sessionId });
  res.json({ message: 'Logged out successfully' });
});

export default router;
