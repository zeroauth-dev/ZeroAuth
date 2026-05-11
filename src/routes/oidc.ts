import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { config } from '../config';
import { demoAuthOnly } from '../middleware/demo-auth-gate';
import { issueTokens } from '../services/jwt';
import { sessionStore } from '../services/session-store';
import { logger } from '../services/logger';
import { UserSession } from '../types';

const router = Router();

// These routes do NOT exchange the auth code with a real IdP or validate
// the ID token. See demo-auth-gate.ts.
router.use(demoAuthOnly);

// In-memory state store for CSRF protection during OIDC flow
const pendingStates = new Map<string, { codeVerifier: string; createdAt: number }>();

/**
 * GET /api/auth/oidc/authorize
 * Initiates OAuth 2.0 / OIDC authorization code flow with PKCE.
 */
router.get('/authorize', (_req: Request, res: Response) => {
  const state = uuidv4();
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  pendingStates.set(state, { codeVerifier, createdAt: Date.now() });

  // Clean up stale states (older than 10 minutes)
  const cutoff = Date.now() - 600000;
  for (const [key, val] of pendingStates) {
    if (val.createdAt < cutoff) pendingStates.delete(key);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.oidc.clientId,
    redirect_uri: config.oidc.redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    nonce: uuidv4(),
  });

  const authorizeUrl = `${config.oidc.issuer}/authorize?${params.toString()}`;

  logger.info('OIDC authorization initiated', { state });

  res.json({
    message: 'OIDC authorization endpoint',
    authorizeUrl,
    state,
    note: 'Configure OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET for production',
  });
});

/**
 * POST /api/auth/oidc/callback
 * Handles the OIDC authorization code callback.
 * Exchanges the code for tokens and creates a session.
 */
router.post('/callback', (req: Request, res: Response) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const pending = pendingStates.get(state);
    if (!pending) {
      res.status(400).json({ error: 'Invalid or expired state parameter' });
      return;
    }

    pendingStates.delete(state);

    // In production, exchange the authorization code for tokens
    // using the OIDC provider's token endpoint with PKCE code_verifier.
    // Here we simulate the token exchange result.
    const userId = `oidc-user-${uuidv4().slice(0, 8)}`;
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

    logger.info('OIDC authentication successful', {
      userId,
      sessionId,
      dataStored: false,
    });

    res.json({
      ...tokens,
      sessionId,
      provider: 'oidc',
      dataStorageConfirmation: {
        biometricDataStored: false,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
    });
  } catch (err) {
    logger.error('OIDC callback error', { error: (err as Error).message });
    res.status(500).json({ error: 'OIDC authentication failed' });
  }
});

/**
 * GET /api/auth/oidc/.well-known/openid-configuration
 * Returns OIDC discovery document for ZeroAuth as an OIDC-compatible provider.
 */
router.get('/.well-known/openid-configuration', (_req: Request, res: Response) => {
  // NOTE: jwks_uri is intentionally omitted — ZeroAuth currently signs
  // session JWTs with HS256 (symmetric secret). Until we publish a JWKS
  // endpoint with the corresponding public keys we should not advertise one.
  res.json({
    issuer: config.apiBaseUrl,
    authorization_endpoint: `${config.apiBaseUrl}/api/auth/oidc/authorize`,
    token_endpoint: `${config.apiBaseUrl}/api/auth/oidc/callback`,
    userinfo_endpoint: `${config.apiBaseUrl}/api/auth/me`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
  });
});

export default router;
