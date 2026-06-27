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
  IdentityValidationError,
  IdentityAlreadyExistsError,
} from '../../services/identity';
import {
  createSession as createPairingChallenge,
  verifyIdentityProof,
  PairingSessionNotFound,
  PairingSessionExpired,
  PairingSessionAlreadyBound,
  PairingSessionLocked,
  PairingNonceMismatch,
  PairingDidUnknown,
  PairingProofInvalid,
  TooManyPendingSessions,
} from '../../services/proof-pairing';
import type { UserSession } from '../../types';

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

/** Map a verifyIdentityProof failure onto the documented HTTP status. The
 *  enumeration-defended cases (unknown DID, commitment mismatch, wrong-nonce,
 *  invalid proof) collapse to a uniform 401 verification_failed. */
function mapVerifyError(err: unknown): { status: number; code: string; reason: string } {
  if (err instanceof PairingDidUnknown
      || err instanceof PairingNonceMismatch
      || err instanceof PairingProofInvalid) {
    return { status: 401, code: 'verification_failed', reason: (err as { code?: string }).code ?? 'verification_failed' };
  }
  if (err instanceof PairingSessionNotFound) return { status: 404, code: 'challenge_not_found', reason: 'challenge_not_found' };
  if (err instanceof PairingSessionExpired) return { status: 410, code: 'challenge_expired', reason: 'challenge_expired' };
  if (err instanceof PairingSessionAlreadyBound) return { status: 409, code: 'challenge_already_used', reason: 'challenge_already_used' };
  if (err instanceof PairingSessionLocked) return { status: 423, code: 'challenge_locked', reason: 'challenge_locked' };
  return { status: 500, code: 'verify_failed', reason: 'internal_error' };
}

function verifyMessage(code: string): string {
  switch (code) {
    case 'verification_failed': return 'Identity verification failed.';
    case 'challenge_not_found': return 'Challenge not found. Request a new one from /v1/identity/challenge.';
    case 'challenge_expired': return 'Challenge expired. Request a new one.';
    case 'challenge_already_used': return 'Challenge already used. Request a new one.';
    case 'challenge_locked': return 'Challenge locked after repeated failures. Request a new one.';
    default: return 'Verification could not be completed.';
  }
}

/**
 * POST /v1/identity/challenge
 *
 * Issue a single-use, time-boxed challenge for /v1/identity/verify (A-02
 * close-out). Returns a server-minted nonce the on-device prover folds into
 * the proof as `publicSignals[1] = Poseidon(didHash, nonce)`. The challenge is
 * consumed atomically on verify, so a captured proof cannot be replayed.
 *
 * The challenge reuses the proof-pairing session row + state machine; the
 * tenant API key authenticates the call, so no session_bind cookie is needed.
 *
 * Request:  Authorization: Bearer za_live_xxx
 * Response: 201 { challengeId, nonce, expiresAt }
 *
 * Requires scope: zkp:verify
 */
router.post('/challenge',
  authenticateTenantApiKey(['zkp:verify']),
  pgRateLimit({ route: 'identity:challenge', windowMs: 60_000, max: 60, keyBy: 'apiKey' }),
  async (req: Request, res: Response) => {
    const { tenant, apiKey } = getTenantContext(req);
    const environment = (apiKey.environment === 'live' || apiKey.environment === 'test')
      ? apiKey.environment
      : 'live';
    try {
      const challenge = await createPairingChallenge(
        tenant.id,
        environment,
        apiKey.id,
        req.ip ?? null,
        (req.headers['user-agent'] as string | undefined) ?? null,
      );
      res.status(201).json({
        challengeId: challenge.id,
        nonce: challenge.nonce,
        expiresAt: challenge.expiresAt,
      });
    } catch (err) {
      if (err instanceof TooManyPendingSessions) {
        res.status(429).json({
          error: 'too_many_pending_challenges',
          message: 'Too many open identity challenges. Retry shortly.',
        });
        return;
      }
      logger.error('v1: identity challenge error', { error: (err as Error).message });
      res.status(500).json({ error: 'challenge_failed' });
    }
  },
);

/**
 * POST /v1/identity/verify
 *
 * Face-first identity verification (ADR 0017) — now replay-safe (A-02). The
 * client first calls POST /v1/identity/challenge for a fresh nonce, binds the
 * on-device Groth16 proof to it (`publicSignals[1] = Poseidon(didHash, nonce)`),
 * then submits `{ did, challengeId, proof, publicSignals }`. The server reuses
 * the hardened proof-pairing verifier (`verifyIdentityProof`): it looks up the
 * user, constant-time-compares the stored commitment, re-derives and compares
 * the nonce binding, runs the Groth16 verifier, and consumes the challenge
 * single-use — so a captured proof cannot be replayed.
 *
 * Request:
 *   Authorization: Bearer za_live_xxx
 *   { did, challengeId, proof, publicSignals }
 *
 * Responses:
 *   200 { accessToken, refreshToken, tokenType, expiresIn, sessionId, did }
 *   400 invalid_did / invalid_request
 *   401 verification_failed (uniform: did_unknown / commitment / nonce / proof)
 *   404 challenge_not_found · 409 challenge_already_used · 410 challenge_expired
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

    const { did, challengeId, proof, publicSignals } = req.body ?? {};

    // Format guards.
    if (typeof did !== 'string' || did.length === 0) {
      res.status(400).json({ error: 'invalid_did', message: 'did is required (string).' });
      return;
    }
    if (typeof challengeId !== 'string' || challengeId.length === 0) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'challengeId from POST /v1/identity/challenge is required.',
      });
      return;
    }
    if (!Array.isArray(publicSignals) || publicSignals.length !== 3
        || publicSignals.some((s) => typeof s !== 'string')) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'publicSignals must be a 3-element string array.',
      });
      return;
    }
    if (!proof || typeof proof !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'proof is required (object).' });
      return;
    }

    try {
      // The hardened proof-pairing verifier: commitment CT-compare + nonce
      // binding (publicSignals[1]) + Groth16 verify + single-use consume of
      // the challenge. A captured proof bound to a spent/other challenge fails.
      const result = await verifyIdentityProof(
        challengeId,
        tenant.id,
        environment,
        did,
        proof as never,
        publicSignals as string[],
      );

      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3600000);
      const session: UserSession = {
        sessionId,
        userId: result.userId,
        provider: 'zkp',
        verified: true,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      sessionStore.create(session);
      const tokens = issueTokens({
        sub: result.userId,
        provider: 'zkp',
        verified: true,
        sessionId,
        did,
      });

      await recordAuditEvent(tenant.id, {
        environment,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'identity.verify',
        entityType: 'tenant_user',
        entityId: result.userId,
        status: 'success',
        summary: `Face-first verification succeeded for DID ${did}`,
        metadata: { did, sessionId },
      });

      logger.info('v1: face-first identity verified', {
        tenantId: tenant.id, environment, did, userId: result.userId, sessionId,
      });

      res.json({ ...tokens, verified: true, sessionId, did, provider: 'zkp' });
    } catch (err) {
      const { status, code, reason } = mapVerifyError(err);
      await recordAuditEvent(tenant.id, {
        environment,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'identity.verify',
        entityType: 'tenant_user',
        entityId: null,
        status: 'failure',
        summary: `verify: ${reason}`,
        metadata: { did, reason },
      }).catch(() => undefined);
      if (status >= 500) {
        logger.error('v1: face-first identity verify error', { error: (err as Error).message });
      }
      res.status(status).json({ error: code, message: verifyMessage(code) });
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
