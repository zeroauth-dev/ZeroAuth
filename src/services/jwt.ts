import jwt, { SignOptions, VerifyOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthToken, JWTPayload } from '../types';

/**
 * JWT service (ADR 0021).
 *
 * Supports two signing algorithms via `config.jwt.algorithm`:
 *
 *  - **HS256** (default; legacy).
 *    Single `JWT_SECRET` symmetric key. Every service that verifies
 *    a token needs the same secret — key rotation requires
 *    simultaneous redeploy across the fleet, which is the C-11 audit
 *    finding's headline pain point.
 *
 *  - **RS256** (the migration target).
 *    Asymmetric. Signer holds `JWT_RS256_PRIVATE_KEY`; verifiers hold
 *    only `JWT_RS256_PUBLIC_KEY` (and can be entirely external,
 *    consuming `/.well-known/jwks.json`). Key rotation is an
 *    add-new-public-key + flip-private-key operation, not a fleet-wide
 *    redeploy.
 *
 * During the rollover window the verifier accepts BOTH HS256 (with
 * the legacy secret) AND RS256 (with the public key) so previously-
 * issued HS256 tokens stay valid until they expire naturally. Once
 * the longest-lived issued HS256 token has expired (24 h after the
 * cutover by default), the operator unsets `JWT_SECRET` and only
 * RS256 is honoured. Documented in
 * `docs/operations/jwt-key-rotation-playbook.md`.
 *
 * Issuance always uses whichever algorithm `config.jwt.algorithm`
 * selects. There is intentionally no "issue both forms" mode — the
 * old form drains out as tokens expire.
 */

function parseExpiresIn(value: string): number {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return 3600; // default 1h
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return 3600;
  }
}

/** Returns the signing key + sign options for the current algorithm. */
function getSigningContext(): { key: string; algorithm: 'HS256' | 'RS256'; keyid?: string } {
  if (config.jwt.algorithm === 'RS256') {
    if (!config.jwt.privateKey) {
      throw new Error(
        'JWT_ALGORITHM=RS256 but JWT_RS256_PRIVATE_KEY is unset. ' +
          'Generate with `npm run jwt:rotate` or unset JWT_ALGORITHM to use HS256.',
      );
    }
    return {
      key: config.jwt.privateKey,
      algorithm: 'RS256',
      keyid: config.jwt.keyId,
    };
  }
  return { key: config.jwt.secret, algorithm: 'HS256' };
}

export function issueTokens(payload: Omit<JWTPayload, 'iat' | 'exp'>): AuthToken {
  const accessExpiresIn = parseExpiresIn(config.jwt.expiresIn);
  const refreshExpiresIn = parseExpiresIn(config.jwt.refreshExpiresIn);
  const ctx = getSigningContext();

  const accessOpts: SignOptions = {
    expiresIn: accessExpiresIn,
    issuer: 'zeroauth',
    jwtid: uuidv4(),
    algorithm: ctx.algorithm,
    ...(ctx.keyid ? { keyid: ctx.keyid } : {}),
  };
  const accessToken = jwt.sign(payload as object, ctx.key, accessOpts);

  const refreshOpts: SignOptions = {
    expiresIn: refreshExpiresIn,
    issuer: 'zeroauth',
    jwtid: uuidv4(),
    algorithm: ctx.algorithm,
    ...(ctx.keyid ? { keyid: ctx.keyid } : {}),
  };
  const refreshToken = jwt.sign(
    { sub: payload.sub, type: 'refresh', sessionId: payload.sessionId },
    ctx.key,
    refreshOpts,
  );

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessExpiresIn,
  };
}

/**
 * Dual-issuer verifier. Tries RS256 first (when the public key is
 * present), falls back to HS256. The first successful verification
 * wins; if both fail, the RS256 error is surfaced (more informative
 * stack trace for production debugging).
 */
export function verifyToken(token: string): JWTPayload {
  const verifyOpts: VerifyOptions = { issuer: 'zeroauth' };

  // RS256 path — present when JWT_RS256_PUBLIC_KEY is configured.
  if (config.jwt.publicKey) {
    try {
      return jwt.verify(token, config.jwt.publicKey, {
        ...verifyOpts,
        algorithms: ['RS256'],
      }) as JWTPayload;
    } catch (rsErr) {
      // Fall through to HS256 only if we still have the legacy
      // secret. Otherwise the RS256 error is the real verdict.
      if (!config.jwt.secret || config.jwt.secret === 'dev-secret-change-me') {
        throw rsErr;
      }
    }
  }

  // HS256 path (legacy, default).
  return jwt.verify(token, config.jwt.secret, {
    ...verifyOpts,
    algorithms: ['HS256'],
  }) as JWTPayload;
}

export function decodeToken(token: string): JWTPayload | null {
  return jwt.decode(token) as JWTPayload | null;
}

// ─── JWKS support (ADR 0021) ────────────────────────────────────────
//
// Exposes the RS256 public key in JSON Web Key Set format at
// `/.well-known/jwks.json`. External verifiers (bank's IdP, an
// out-of-process verifier service) fetch this once and cache the
// public key for as long as they want — the `kid` claim in the JWT
// header lets them pick the right key during a rotation window
// (multiple keys can be published simultaneously).

import crypto from 'crypto';

interface Jwk {
  kty: 'RSA';
  use: 'sig';
  alg: 'RS256';
  kid: string;
  n: string;
  e: string;
}

/**
 * Returns the RS256 public key as a JWK, or null if RS256 isn't
 * configured. The JWKS endpoint at `/.well-known/jwks.json` wraps
 * this in `{ keys: [...] }`.
 */
export function getRs256Jwk(): Jwk | null {
  if (!config.jwt.publicKey) return null;

  try {
    const keyObject = crypto.createPublicKey(config.jwt.publicKey);
    const jwk = keyObject.export({ format: 'jwk' }) as { n?: string; e?: string; kty?: string };
    if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return null;
    return {
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: config.jwt.keyId,
      n: jwk.n,
      e: jwk.e,
    };
  } catch {
    return null;
  }
}
