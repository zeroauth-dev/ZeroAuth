/**
 * Tests for the RS256 path of `src/services/jwt.ts` and the
 * `GET /api/jwks.json` route (ADR 0021).
 *
 * Companion to `tests/jwt-rs256.test.ts`, which covers the legacy
 * `/.well-known/jwks.json` surface. This suite focuses on the
 * operator-facing `/api/jwks.json` surface — the surface the bank's
 * IdP runbook uses to distinguish HS256 (no public keys) from RS256
 * (live JWKS) with a single HTTP call.
 *
 * Coverage:
 *
 *   1. HS256 path unchanged when JWT_PRIVATE_KEY (and friends) are
 *      unset — `config.jwt.algorithm` resolves to HS256, issueTokens
 *      produces a header.alg = 'HS256' token, verifyToken roundtrips.
 *   2. RS256 sign + verify roundtrip when JWT_PRIVATE_KEY +
 *      JWT_PUBLIC_KEY are set — header.alg = 'RS256', the embedded
 *      `kid` is the configured key id, the in-service verifier
 *      roundtrips the payload, and an external verifier with only
 *      the public key can verify it too.
 *   3. `GET /api/jwks.json` returns 404 in HS256 mode — body carries
 *      the `jwks_not_available` error code so operator tooling can
 *      reason about the deployment.
 *   4. `GET /api/jwks.json` returns a valid RFC 7517 JWKS shape in
 *      RS256 mode — one key, RSA / sig / RS256, `kid` matches the
 *      configured key id, `n` is base64url, `e === 'AQAB'`, and the
 *      response is marked publicly cacheable for one hour.
 *
 * Each `it` block resets the module cache so `src/config/index.ts`
 * re-reads the env vars under test. Without the reset, the first
 * test's algorithm choice would leak into the rest of the suite.
 */

import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

/** Generate a fresh 2048-bit RSA keypair in PEM (SPKI + PKCS#8). */
function generateRsaKeypair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/** Decode a JWT header without verifying the signature. */
function decodeJwtHeader(token: string): Record<string, unknown> {
  const [headerB64] = token.split('.');
  return JSON.parse(Buffer.from(headerB64, 'base64url').toString());
}

// The /api/jwks.json tests below build a fresh Express app per case
// (via jest.resetModules() + require('../src/app')). The first
// createApp() call after a `--findRelatedTests` cold start exceeds
// jest's default 5s timeout on slower workers, so bump the suite
// timeout to 30s. Individual fast tests (HS256 path, sign/verify
// roundtrips) still finish in <100ms.
jest.setTimeout(30000);

describe('jwks-and-rs256 (ADR 0021)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Force every test to re-import the config + jwt service so the
    // env-var overrides below take effect. Without this, the first
    // test's algorithm choice is captured once and leaks into the
    // rest of the suite.
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── 1. HS256 path unchanged when no RS256 keys are configured ───
  describe('HS256 default path (no RS256 keys configured)', () => {
    beforeEach(() => {
      // Clear every var that could flip the algorithm to RS256.
      delete process.env.JWT_ALGORITHM;
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_RS256_PRIVATE_KEY;
      delete process.env.JWT_RS256_PUBLIC_KEY;
      delete process.env.JWT_KID;
      delete process.env.JWT_RS256_KID;
      process.env.JWT_SECRET = 'hs256-test-secret-please-change';
    });

    it('resolves config.jwt.algorithm to HS256 when no keypair is set', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { config } = require('../src/config');
      expect(config.jwt.algorithm).toBe('HS256');
      expect(config.jwt.privateKey).toBe('');
      expect(config.jwt.publicKey).toBe('');
    });

    it('issueTokens + verifyToken roundtrip with header.alg = HS256', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { issueTokens, verifyToken } = require('../src/services/jwt');

      const tokens = issueTokens({
        sub: 'hs256-user',
        provider: 'zkp',
        verified: true,
        sessionId: 'hs256-session',
      });

      const header = decodeJwtHeader(tokens.accessToken);
      expect(header.alg).toBe('HS256');
      // HS256 tokens carry no `kid` — the secret is implicit per deployment.
      expect(header.kid).toBeUndefined();

      const payload = verifyToken(tokens.accessToken);
      expect(payload.sub).toBe('hs256-user');
      expect(payload.sessionId).toBe('hs256-session');
      expect(payload.provider).toBe('zkp');
      expect(payload.verified).toBe(true);
    });

    it('rejects an HS256 token signed with the wrong secret', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { verifyToken } = require('../src/services/jwt');

      const forged = jwt.sign(
        { sub: 'attacker', provider: 'zkp', verified: true, sessionId: 's-x' },
        'wrong-secret',
        { algorithm: 'HS256', issuer: 'zeroauth' },
      );

      expect(() => verifyToken(forged)).toThrow();
    });
  });

  // ─── 2. RS256 sign + verify roundtrip ────────────────────────────
  describe('RS256 sign + verify roundtrip', () => {
    it('signs with the private key and verifies with the public key', () => {
      const kp = generateRsaKeypair();
      process.env.JWT_PRIVATE_KEY = kp.privateKey;
      process.env.JWT_PUBLIC_KEY = kp.publicKey;
      process.env.JWT_KID = 'rs256-roundtrip-kid';
      delete process.env.JWT_ALGORITHM; // alg flips implicitly via the keypair presence

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { config } = require('../src/config');
      expect(config.jwt.algorithm).toBe('RS256');

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { issueTokens, verifyToken } = require('../src/services/jwt');

      const tokens = issueTokens({
        sub: 'rs256-user',
        provider: 'zkp',
        verified: true,
        sessionId: 'rs256-session',
        email: 'rs256@example.com',
      });

      const header = decodeJwtHeader(tokens.accessToken);
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe('rs256-roundtrip-kid');

      // In-service roundtrip.
      const payload = verifyToken(tokens.accessToken);
      expect(payload.sub).toBe('rs256-user');
      expect(payload.sessionId).toBe('rs256-session');
      expect(payload.email).toBe('rs256@example.com');

      // External verifier (only the public key) — proves the published
      // JWKS is sufficient for an out-of-process verifier.
      const externalDecoded = jwt.verify(tokens.accessToken, kp.publicKey, {
        algorithms: ['RS256'],
        issuer: 'zeroauth',
      }) as { sub: string; provider: string };
      expect(externalDecoded.sub).toBe('rs256-user');
      expect(externalDecoded.provider).toBe('zkp');

      // The refresh token must also be RS256.
      const refreshHeader = decodeJwtHeader(tokens.refreshToken);
      expect(refreshHeader.alg).toBe('RS256');
      expect(refreshHeader.kid).toBe('rs256-roundtrip-kid');
    });

    it('throws when JWT_ALGORITHM=RS256 is set but JWT_PRIVATE_KEY is unset', () => {
      process.env.JWT_ALGORITHM = 'RS256';
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_RS256_PRIVATE_KEY;
      delete process.env.JWT_RS256_PUBLIC_KEY;

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { issueTokens } = require('../src/services/jwt');

      expect(() =>
        issueTokens({ sub: 'u', provider: 'zkp', verified: true, sessionId: 's' }),
      ).toThrow(/JWT_PRIVATE_KEY is unset/);
    });
  });

  // ─── 3. GET /api/jwks.json — 404 in HS256 mode ───────────────────
  describe('GET /api/jwks.json — HS256 mode', () => {
    it('returns 404 with the jwks_not_available error code', async () => {
      delete process.env.JWT_ALGORITHM;
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      delete process.env.JWT_RS256_PRIVATE_KEY;
      delete process.env.JWT_RS256_PUBLIC_KEY;
      process.env.JWT_SECRET = 'hs256-jwks-route-test';

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createApp } = require('../src/app');
      const app = createApp();

      const res = await request(app).get('/api/jwks.json');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        error: 'jwks_not_available',
        message: expect.stringMatching(/HS256/),
      });
      // No JWKS body in 404 — the empty-array distinction is reserved
      // for the well-known surface, not the /api one.
      expect(res.body.keys).toBeUndefined();
    });
  });

  // ─── 4. GET /api/jwks.json — valid JWKS in RS256 mode ────────────
  describe('GET /api/jwks.json — RS256 mode', () => {
    it('returns 200 with a valid RFC 7517 JWKS document', async () => {
      const kp = generateRsaKeypair();
      process.env.JWT_PRIVATE_KEY = kp.privateKey;
      process.env.JWT_PUBLIC_KEY = kp.publicKey;
      process.env.JWT_KID = 'api-jwks-test-kid';

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createApp } = require('../src/app');
      const app = createApp();

      const res = await request(app).get('/api/jwks.json');

      expect(res.status).toBe(200);
      // Top-level shape per RFC 7517 §5.
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body.keys).toHaveLength(1);

      const [key] = res.body.keys;
      expect(key.kty).toBe('RSA');
      expect(key.use).toBe('sig');
      expect(key.alg).toBe('RS256');
      expect(key.kid).toBe('api-jwks-test-kid');
      // `n` = modulus (base64url), `e` = exponent (65537 → 'AQAB').
      expect(typeof key.n).toBe('string');
      expect(key.n).toMatch(/^[A-Za-z0-9_-]+$/);
      // 2048-bit modulus → 256 raw bytes → ~342 base64url chars.
      expect(key.n.length).toBeGreaterThan(300);
      expect(key.e).toBe('AQAB');
      // No leaked private material.
      expect(key.d).toBeUndefined();
      expect(key.p).toBeUndefined();
      expect(key.q).toBeUndefined();

      // Public information; one-hour cache is the contract.
      expect(res.headers['cache-control']).toMatch(/public/);
      expect(res.headers['cache-control']).toMatch(/max-age=3600/);

      // Sanity — published `n` matches the JWK exported directly from
      // the source PEM. Mismatch would silently publish the wrong key.
      const directJwk = crypto.createPublicKey(kp.publicKey).export({ format: 'jwk' }) as {
        n: string;
        e: string;
      };
      expect(key.n).toBe(directJwk.n);
      expect(key.e).toBe(directJwk.e);
    });

    it('legacy JWT_RS256_* env aliases still publish a JWKS', async () => {
      // ADR 0021 keeps the legacy env names as fallbacks. Skipping
      // them here would let the new names accidentally replace —
      // rather than supplement — the older surface, breaking any
      // production env file that hasn't been renamed yet.
      const kp = generateRsaKeypair();
      delete process.env.JWT_PRIVATE_KEY;
      delete process.env.JWT_PUBLIC_KEY;
      process.env.JWT_RS256_PRIVATE_KEY = kp.privateKey;
      process.env.JWT_RS256_PUBLIC_KEY = kp.publicKey;
      process.env.JWT_RS256_KID = 'legacy-alias-kid';

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createApp } = require('../src/app');
      const app = createApp();

      const res = await request(app).get('/api/jwks.json');
      expect(res.status).toBe(200);
      expect(res.body.keys[0].kid).toBe('legacy-alias-kid');
      expect(res.body.keys[0].alg).toBe('RS256');
    });
  });
});
