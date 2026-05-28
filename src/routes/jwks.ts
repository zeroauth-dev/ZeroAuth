/**
 * JSON Web Key Set endpoint (ADR 0021).
 *
 * Mounted at `/.well-known/jwks.json` on the public API surface so any
 * out-of-process verifier (the bank's IdP, a customer's gateway, a
 * future load-balanced verifier pod) can fetch ZeroAuth's RS256
 * public key and verify access tokens without ever holding a shared
 * secret with us.
 *
 * Behaviour:
 *   - When `JWT_ALGORITHM=RS256` is set + `JWT_RS256_PUBLIC_KEY` is a
 *     valid PEM-encoded RSA public key, returns the canonical JWKS:
 *       { "keys": [ { kty, use, alg, kid, n, e } ] }
 *   - When RS256 isn't configured, returns `{ keys: [] }` with a 200.
 *     An empty JWKS lets a future RS256 rollout be a one-line change
 *     (just set the env var); no client-visible API surface flips.
 *
 * The endpoint is unauthenticated by design — the JWKS is public
 * information. Cache-Control headers ask intermediaries to cache for
 * one hour; rotation invalidations are out-of-band (operators bump
 * the key + alert downstreams).
 */

import { Router, Request, Response } from 'express';
import { getRs256Jwk } from '../services/jwt';

const router = Router();

router.get('/jwks.json', (_req: Request, res: Response) => {
  const jwk = getRs256Jwk();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ keys: jwk ? [jwk] : [] });
});

export default router;
