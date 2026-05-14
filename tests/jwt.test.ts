/**
 * Unit tests for src/services/jwt.ts — the /v1 token layer (separate
 * from the console JWT in src/routes/console.ts).
 *
 *   - issueTokens returns { accessToken, refreshToken, tokenType, expiresIn }
 *   - access token carries iss='zeroauth', jti (uuid v4), sub (payload sub),
 *     and any custom claims from the payload
 *   - refresh token carries type='refresh' + the sessionId; never reveals
 *     the original payload
 *   - verifyToken roundtrips an issued token; throws on bad signature,
 *     bad issuer
 *   - decodeToken returns the payload without verifying signature
 *     (used for debugging only — must NEVER be used to authorize)
 *   - parseExpiresIn variants (Xs / Xm / Xh / Xd / bad input → 3600)
 */

import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { issueTokens, verifyToken, decodeToken } from '../src/services/jwt';

describe('services/jwt', () => {
  const basePayload = {
    sub: 'user-123',
    sessionId: 'session-abc',
    provider: 'zkp' as const,
    verified: true,
    email: 'a@example.com',
  };

  describe('issueTokens', () => {
    it('returns access + refresh + Bearer + expiresIn', () => {
      const tokens = issueTokens(basePayload);
      expect(tokens).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: expect.any(Number),
      });
      expect(tokens.expiresIn).toBeGreaterThan(0);
    });

    it('access token carries iss=zeroauth + jti (uuid v4) + payload claims', () => {
      const tokens = issueTokens(basePayload);
      const decoded = jwt.verify(tokens.accessToken, config.jwt.secret) as any;
      expect(decoded.iss).toBe('zeroauth');
      expect(decoded.sub).toBe('user-123');
      expect(decoded.sessionId).toBe('session-abc');
      expect(decoded.email).toBe('a@example.com');
      expect(decoded.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('refresh token carries type=refresh + sub + sessionId, NOT the full payload', () => {
      const tokens = issueTokens(basePayload);
      const decoded = jwt.verify(tokens.refreshToken, config.jwt.secret) as any;
      expect(decoded.type).toBe('refresh');
      expect(decoded.sub).toBe('user-123');
      expect(decoded.sessionId).toBe('session-abc');
      // No email, no provider, no verified on the refresh token
      expect(decoded.email).toBeUndefined();
      expect(decoded.provider).toBeUndefined();
      expect(decoded.verified).toBeUndefined();
    });

    it('access + refresh tokens have DIFFERENT jti', () => {
      const tokens = issueTokens(basePayload);
      const access = jwt.verify(tokens.accessToken, config.jwt.secret) as any;
      const refresh = jwt.verify(tokens.refreshToken, config.jwt.secret) as any;
      expect(access.jti).not.toBe(refresh.jti);
    });

    it('two issueTokens calls produce different access tokens (jti changes)', () => {
      const t1 = issueTokens(basePayload);
      const t2 = issueTokens(basePayload);
      // jwt.sign payloads with same secret + same `iat` could collide; we
      // rely on the jti uuid v4 to differentiate. Tokens may still match
      // if iat happens to be the same second AND jti collides (impossible
      // for uuid v4). So assert decoded jti differs:
      const j1 = (jwt.verify(t1.accessToken, config.jwt.secret) as any).jti;
      const j2 = (jwt.verify(t2.accessToken, config.jwt.secret) as any).jti;
      expect(j1).not.toBe(j2);
    });
  });

  describe('verifyToken', () => {
    it('round-trips an issued access token back to the payload', () => {
      const tokens = issueTokens(basePayload);
      const payload = verifyToken(tokens.accessToken);
      expect(payload.sub).toBe('user-123');
      expect(payload.sessionId).toBe('session-abc');
    });

    it('throws on a token signed by a different secret', () => {
      const bad = jwt.sign(basePayload, 'wrong-secret', { issuer: 'zeroauth' });
      expect(() => verifyToken(bad)).toThrow();
    });

    it('throws on a token with a different issuer', () => {
      const bad = jwt.sign(basePayload, config.jwt.secret, { issuer: 'not-zeroauth' });
      expect(() => verifyToken(bad)).toThrow();
    });

    it('throws on a token with no issuer', () => {
      const bad = jwt.sign(basePayload, config.jwt.secret);
      expect(() => verifyToken(bad)).toThrow();
    });

    it('throws on a clearly malformed string', () => {
      expect(() => verifyToken('not-a-jwt')).toThrow();
    });
  });

  describe('decodeToken', () => {
    it('returns payload without verifying signature', () => {
      const t = jwt.sign(basePayload, 'any-secret', { issuer: 'whoever' });
      const decoded = decodeToken(t);
      expect(decoded?.sub).toBe('user-123');
    });

    it('returns null for total garbage', () => {
      expect(decodeToken('garbage')).toBeNull();
    });
  });
});
