/**
 * Per-tenant CORS origin check.
 *
 * Defence-in-depth on top of the global CORS middleware in `src/app.ts`.
 * The global layer enforces the platform-wide allowlist (config.corsOrigins)
 * and is non-wildcard in production. This middleware adds a second check
 * that fires AFTER `authenticateTenantApiKey` has populated
 * `req.tenantContext` — at which point we know which tenant the request
 * is for and can consult its `security_policy.allowed_origins`.
 *
 * Why two layers:
 *   - The global layer rejects requests from origins we as a platform
 *     have never allowed (basic CSRF / random-attacker defence).
 *   - The per-tenant layer rejects requests from origins THIS tenant
 *     has not authorised — e.g., Anchor Bank's API key being misused
 *     from a JS context running on attacker-controlled.com, even if
 *     attacker-controlled.com happens to be on the platform allowlist
 *     for a different tenant.
 *
 * Behaviour:
 *   - If the tenant has no `allowed_origins` set (the default), the
 *     middleware is a no-op. The global CORS allowlist remains in
 *     effect.
 *   - If the tenant has `allowed_origins` set and the request has an
 *     Origin header, the Origin MUST be in the per-tenant allowlist
 *     (case-insensitive exact match — no wildcards by design).
 *   - Server-to-server requests (no Origin header) are allowed
 *     through. The Authorization-header API key is the authn
 *     primitive on that path.
 *
 * The check returns 403 `origin_not_allowed` with a uniform message so
 * an attacker probing the allowlist can't distinguish "this Origin is
 * not on the tenant's list" from "this tenant has an empty list" from
 * "this tenant doesn't exist". (Tenant existence has already been
 * confirmed by the time this middleware runs, but the response shape
 * stays opaque.)
 *
 * Closes the per-tenant half of audit finding C-13 (the global half
 * was closed by `src/config/index.ts::parseCorsOrigins`).
 */

import { Request, Response, NextFunction } from 'express';
import { getTenantContext } from './tenant-auth';
import { logger } from '../services/logger';
import type { TenantSecurityPolicy } from '../types';

export function tenantCorsCheck(req: Request, res: Response, next: NextFunction): void {
  // No-op if tenant context isn't on the request — that means an
  // earlier middleware didn't run (e.g. a public route) and the
  // per-tenant check doesn't apply.
  let ctx: ReturnType<typeof getTenantContext>;
  try {
    ctx = getTenantContext(req);
  } catch {
    next();
    return;
  }

  const policy = ctx.tenant.security_policy as TenantSecurityPolicy | null;
  const allowed = policy?.allowed_origins;

  // No per-tenant allowlist → fall through. The global CORS layer
  // already enforced the platform-wide allowlist.
  if (!allowed || !Array.isArray(allowed) || allowed.length === 0) {
    next();
    return;
  }

  const origin = req.headers.origin;

  // Server-to-server requests (no Origin) pass. Authorization-header
  // API key is the authn primitive on that path; the Origin check is
  // a CSRF / cross-site defence that only meaningfully applies to
  // browser-originated requests.
  if (!origin) {
    next();
    return;
  }

  const lower = origin.toLowerCase();
  const match = allowed.some(o => o.toLowerCase() === lower);

  if (!match) {
    logger.warn('per-tenant CORS: origin not in tenant allowlist', {
      tenantId: ctx.tenant.id,
      origin,
      // Don't log the full allowlist — it can be large and the
      // server logs aren't the right surface for it. The dashboard
      // can show it to an admin who logs in.
      allowedCount: allowed.length,
    });
    res.status(403).json({
      error: 'origin_not_allowed',
      message: 'Request origin is not in the tenant allowlist.',
    });
    return;
  }

  next();
}
