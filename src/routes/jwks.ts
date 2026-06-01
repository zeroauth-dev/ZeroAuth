/**
 * JSON Web Key Set endpoints (ADR 0021).
 *
 * Two routers are exported from this file:
 *
 *  - `default` (legacy well-known router) — mounted at `/.well-known`
 *    in `src/app.ts`, exposes `GET /.well-known/jwks.json` per RFC
 *    8615. Always responds 200 with either the live JWKS or
 *    `{ keys: [] }` when RS256 is not configured. The empty-array
 *    behaviour lets external systems hard-code the well-known URL
 *    across a future RS256 rollout without flipping any API surface.
 *
 *  - `apiJwksRouter` — mounted at the root in `src/app.ts`, exposes
 *    `GET /api/jwks.json`. Returns 200 + the JWKS object when RS256
 *    is configured, 404 otherwise. The 404 semantics make
 *    "is this deployment publishing keys?" a single HTTP call for
 *    operator tooling (the bank's IdP runbook prefers it over a
 *    `keys === [] ? hs256 : rs256` heuristic on the well-known URL).
 *
 * Both routes are unauthenticated by design — the JWKS is public
 * information. Cache-Control asks intermediaries to cache for one
 * hour; rotation invalidations are out-of-band (operators bump the
 * key + alert downstreams).
 */

import { Router, Request, Response } from 'express';
import { exportPublicJwks, getRs256Jwk } from '../services/jwt';

const wellKnownRouter = Router();

wellKnownRouter.get('/jwks.json', (_req: Request, res: Response) => {
  const jwk = getRs256Jwk();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ keys: jwk ? [jwk] : [] });
});

/**
 * `/api/jwks.json` — returns the JWKS object when RS256 is
 * configured, 404 otherwise. This is the surface the bank's IdP
 * runbook expects.
 */
export const apiJwksRouter = Router();

apiJwksRouter.get('/jwks.json', (_req: Request, res: Response) => {
  const jwks = exportPublicJwks();
  if (!jwks) {
    res.status(404).json({
      error: 'jwks_not_available',
      message:
        'This deployment is signing tokens with HS256 (symmetric). ' +
        'JWKS is only published when JWT_PRIVATE_KEY + JWT_PUBLIC_KEY ' +
        'are configured (RS256).',
    });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(jwks);
});

export default wellKnownRouter;
