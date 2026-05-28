/**
 * Tests for RS256 JWT signing + JWKS endpoint (ADR 0021, audit C-11).
 *
 * The default config uses HS256, so these tests generate a fresh
 * RS256 keypair at suite startup, override the relevant env vars,
 * reset the module cache, and reload the jwt service to pick up
 * the new config.
 *
 * Six cases:
 *   1. HS256 (default) still works — sanity check that the
 *      migration didn't break the legacy path.
 *   2. issueTokens() under RS256 produces tokens whose header.alg
 *      is "RS256" and which verify against the public key.
 *   3. verifyToken() under RS256 rejects tokens signed with a
 *      different RSA key.
 *   4. Dual-issuer mode (both JWT_SECRET + JWT_RS256_PUBLIC_KEY) —
 *      accepts both HS256-signed and RS256-signed tokens.
 *   5. /.well-known/jwks.json returns the configured RS256 public
 *      key in JWK format with the right `kid`.
 *   6. /.well-known/jwks.json returns { keys: [] } when RS256 is
 *      not configured.
 */

import * as crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';

function gen() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('RS256 JWT migration (ADR 0021)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('HS256 (default) still signs and verifies', () => {
    delete process.env.JWT_ALGORITHM;
    delete process.env.JWT_RS256_PRIVATE_KEY;
    delete process.env.JWT_RS256_PUBLIC_KEY;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { issueTokens, verifyToken } = require('../src/services/jwt');
    const out = issueTokens({ sub: 'u1', provider: 'zkp', verified: true, sessionId: 's1' });
    const payload = verifyToken(out.accessToken);
    expect(payload.sub).toBe('u1');
    expect(payload.provider).toBe('zkp');
  });

  it('RS256 signs tokens whose header.alg is RS256 and which verify against the public key', () => {
    const kp = gen();
    process.env.JWT_ALGORITHM = 'RS256';
    process.env.JWT_RS256_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_RS256_PUBLIC_KEY = kp.publicKey;
    process.env.JWT_RS256_KID = 'test-key-1';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { issueTokens } = require('../src/services/jwt');
    const out = issueTokens({ sub: 'u2', provider: 'zkp', verified: true, sessionId: 's2' });

    // Decode the header without verifying — we want to inspect alg.
    const [headerB64] = out.accessToken.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe('test-key-1');

    // Verify externally (independent of our service) using the public key.
    const decoded = jwt.verify(out.accessToken, kp.publicKey, { algorithms: ['RS256'] }) as { sub: string };
    expect(decoded.sub).toBe('u2');
  });

  it('RS256 verifyToken() rejects a token signed by a different RSA key', () => {
    const us = gen();
    const them = gen();
    process.env.JWT_ALGORITHM = 'RS256';
    process.env.JWT_RS256_PRIVATE_KEY = us.privateKey;
    process.env.JWT_RS256_PUBLIC_KEY = us.publicKey;
    delete process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'dev-secret-change-me'; // disables HS256 fallback per src/services/jwt.ts

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { verifyToken } = require('../src/services/jwt');

    // Forge a token signed by the wrong private key.
    const forged = jwt.sign(
      { sub: 'attacker', provider: 'zkp', verified: true, sessionId: 's-x' },
      them.privateKey,
      { algorithm: 'RS256', issuer: 'zeroauth' },
    );

    expect(() => verifyToken(forged)).toThrow();
  });

  it('dual-issuer mode accepts both HS256- and RS256-signed tokens', () => {
    const kp = gen();
    process.env.JWT_ALGORITHM = 'HS256'; // sign HS256 first
    process.env.JWT_SECRET = 'a-real-shared-secret-for-this-test';
    process.env.JWT_RS256_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_RS256_PUBLIC_KEY = kp.publicKey;
    process.env.JWT_RS256_KID = 'dual-test';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jwtSvc = require('../src/services/jwt');

    const hs256Token = jwtSvc.issueTokens({ sub: 'u-hs', provider: 'zkp', verified: true, sessionId: 's-hs' }).accessToken;

    // Now flip to RS256 and reissue. The dual-issuer verifier must
    // accept both. We don't reset modules — config is read once at
    // import — so we sign RS256 ourselves using jsonwebtoken.
    const rs256Token = jwt.sign(
      { sub: 'u-rs', provider: 'zkp', verified: true, sessionId: 's-rs' },
      kp.privateKey,
      { algorithm: 'RS256', issuer: 'zeroauth' },
    );

    const hsPayload = jwtSvc.verifyToken(hs256Token);
    const rsPayload = jwtSvc.verifyToken(rs256Token);
    expect(hsPayload.sub).toBe('u-hs');
    expect(rsPayload.sub).toBe('u-rs');
  });

  it('/.well-known/jwks.json returns the configured RS256 public key', async () => {
    const kp = gen();
    process.env.JWT_ALGORITHM = 'RS256';
    process.env.JWT_RS256_PRIVATE_KEY = kp.privateKey;
    process.env.JWT_RS256_PUBLIC_KEY = kp.publicKey;
    process.env.JWT_RS256_KID = 'jwks-test-key';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.keys).toHaveLength(1);
    expect(res.body.keys[0].kty).toBe('RSA');
    expect(res.body.keys[0].alg).toBe('RS256');
    expect(res.body.keys[0].use).toBe('sig');
    expect(res.body.keys[0].kid).toBe('jwks-test-key');
    expect(res.body.keys[0].n).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.body.keys[0].e).toBe('AQAB');
    expect(res.headers['cache-control']).toMatch(/max-age=3600/);
  });

  it('/.well-known/jwks.json returns empty keys array when RS256 not configured', async () => {
    delete process.env.JWT_ALGORITHM;
    delete process.env.JWT_RS256_PRIVATE_KEY;
    delete process.env.JWT_RS256_PUBLIC_KEY;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createApp } = require('../src/app');
    const app = createApp();

    const res = await request(app).get('/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body.keys).toEqual([]);
  });
});
