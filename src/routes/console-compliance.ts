/**
 * Console: per-tenant compliance evidence pack endpoint.
 *
 *   GET /api/console/compliance/evidence-pack
 *       ?environment=live|test
 *       ?chain_limit=<int>
 *
 * Returns the JSON bundle assembled by `src/services/compliance-pack.ts`
 * (markdown cover letter, hash-chain snapshot, replay verdict, DPDP
 * §2(t) memo). Auth: `requireConsoleAuth` — developer-console JWT in
 * `Authorization: Bearer` or `zeroauth_console_jwt` cookie. The helper
 * is repeated inline (same pattern as the sibling console routers) to
 * avoid a circular import on console.ts.
 *
 * Audited: every render writes a `compliance.evidence_pack_rendered`
 * row to `audit_events` via `recordAuditEvent`. Failures (tenant
 * missing, render error) ALSO write a row with `status: 'failure'` so
 * probing is visible. Rate-limited at 12 calls/hour/tenant — a full
 * chain replay is O(seconds) on a long chain; the cap stops a runaway
 * dashboard from drowning the verifier. Skipped under NODE_ENV=test.
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../services/logger';
import { renderCompliancePack } from '../services/compliance-pack';
import { recordAuditEvent } from '../services/platform';
import type { ApiKeyEnvironment } from '../types';

// ─── JWT verification (mirrors console.ts) ────────────────────────
//
// `requireConsoleAuth` is not exported from console.ts; the cheaper
// move is to repeat the small verification shape here rather than
// introduce a circular import. The constants stay in lockstep with
// console.ts — same issuer, audience, cookie name, type marker.

const CONSOLE_JWT_ISSUER = 'zeroauth-console';
const CONSOLE_JWT_AUDIENCE = 'zeroauth-console';
const CONSOLE_JWT_COOKIE = 'zeroauth_console_jwt';

interface ConsolePrincipal {
  tenantId: string;
  email: string;
  jti?: string;
}

function verifyConsoleToken(token: string): ConsolePrincipal {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: CONSOLE_JWT_ISSUER,
    audience: CONSOLE_JWT_AUDIENCE,
  }) as { tenantId?: string; email?: string; type?: string; jti?: string };
  if (payload.type !== 'console' || !payload.tenantId || !payload.email) {
    throw new Error('Not a console token');
  }
  return { tenantId: payload.tenantId, email: payload.email, jti: payload.jti };
}

function requireConsoleAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (
    typeof (req as Request & { cookies?: Record<string, string> }).cookies?.[CONSOLE_JWT_COOKIE]
      === 'string'
  ) {
    token = (req as Request & { cookies: Record<string, string> }).cookies[CONSOLE_JWT_COOKIE];
  }

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Login required.' });
    return;
  }

  try {
    const payload = verifyConsoleToken(token);
    (req as Request & { console?: ConsolePrincipal }).console = payload;
    next();
  } catch {
    res.status(401).json({
      error: 'session_expired',
      message: 'Console session expired. Please login again.',
    });
  }
}

// ─── Rate limit ──────────────────────────────────────────────────
//
// Each pack render runs a full audit-chain replay. Pin the cap at
// 12 calls per hour per tenant — a human inspector pulls the pack
// once, and a dashboard auto-refresh at ~5-minute granularity stays
// well below the limit. Keyed on the principal so a stolen JWT
// cannot pierce the cap by IP rotation. Skipped under jest.

const evidencePackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ctx = (req as Request & { console?: ConsolePrincipal }).console;
    // express-rate-limit v8 refuses to start if a custom keyGenerator
    // returns req.ip without routing it through ipKeyGenerator — the
    // helper collapses IPv6 addresses to their /56 subnet so a single
    // attacker rotating through the lower 72 bits of a v6 block cannot
    // pierce the per-IP cap. tenantId-keyed requests bypass the helper
    // entirely; the IP fallback is the only branch that needs it.
    return ctx?.tenantId ?? (req.ip ? ipKeyGenerator(req.ip) : 'anonymous');
  },
  message: {
    error: 'compliance_rate_limited',
    message: 'Too many evidence-pack renders for this tenant in the last hour.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

const router = Router();

/** Mirrors `parseEnv` in the sibling console routers — default `live`. */
function parseEnv(value: unknown): ApiKeyEnvironment {
  return value === 'test' ? 'test' : 'live';
}

/**
 * Clamp `chain_limit` query param to [1, 1_000_000]. Returns `null`
 * when the param is absent (caller uses service default) or out of
 * range (caller 400s).
 */
function parseChainLimit(raw: unknown): { ok: true; value: number | undefined } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  const parsed = Number.parseInt(String(raw), 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 1_000_000) {
    return { ok: false, reason: 'chain_limit must be an integer between 1 and 1000000' };
  }
  return { ok: true, value: parsed };
}

/**
 * GET /api/console/compliance/evidence-pack
 *
 * Render and return the per-tenant evidence pack. Query parameters:
 *
 *   - `environment` — `live` (default) | `test`. Selects which slice
 *     of the tenant's data the pack covers. The audit chain is
 *     per-(tenant, environment), so the live and test packs are
 *     independent artefacts.
 *
 *   - `chain_limit` — integer, default 100_000, max 1_000_000. Caps
 *     how many `audit_events` rows the chain-replay step walks. A
 *     bank with millions of rows can split the replay into chunks
 *     through this knob; the default covers ~3 years of busy
 *     production traffic.
 *
 * Response: the JSON bundle defined by `EvidencePack` in
 * `src/services/compliance-pack.ts`. Content-Type stays
 * `application/json` — the markdown cover letter and DPDP memo body
 * are embedded as string fields, not separately negotiated.
 *
 * Status codes:
 *   - 200 — pack rendered (which is independent of whether the chain
 *     verdict is PASS or FAIL — a failing chain is still a valid
 *     pack, the integrity block just records the failure).
 *   - 400 — invalid query param.
 *   - 401 — missing / invalid console JWT (from requireConsoleAuth).
 *   - 404 — the tenant referenced by the JWT no longer exists.
 *   - 429 — rate-limit cap hit.
 *   - 500 — unexpected internal error.
 *
 * Cache-Control: `no-store` — the pack reflects live DB state and
 * must not be cached by intermediaries. The bank's GRC tool should
 * always re-fetch.
 */
router.get(
  '/compliance/evidence-pack',
  requireConsoleAuth,
  evidencePackLimiter,
  async (req: Request, res: Response) => {
    const { tenantId, email } = (req as Request & { console: ConsolePrincipal }).console;
    const environment = parseEnv(req.query.environment);
    const chainLimit = parseChainLimit(req.query.chain_limit);

    if (!chainLimit.ok) {
      res.status(400).json({ error: 'invalid_chain_limit', message: chainLimit.reason });
      return;
    }

    try {
      const pack = await renderCompliancePack(tenantId, environment, {
        chainLimit: chainLimit.value,
      });

      // Audit row — successful render. The metadata carries enough
      // context for a forensic replay to identify which pack the
      // inspector saw without needing to re-render it.
      void recordAuditEvent(tenantId, {
        environment,
        actorType: 'console',
        actorId: tenantId,
        action: 'compliance.evidence_pack_rendered',
        entityType: 'tenant',
        entityId: tenantId,
        status: 'success',
        summary: `Compliance evidence pack rendered for ${environment}`,
        metadata: {
          actor_email: email,
          schema_version: pack.schemaVersion,
          generated_at: pack.generatedAt,
          chain_head: pack.hashChainSnapshot.currentHead,
          chain_total_rows: pack.hashChainSnapshot.totalRows,
          integrity_ok: pack.integrity.ok,
          ...(pack.integrity.ok
            ? {}
            : {
                integrity_broken_at: pack.integrity.brokenAt ?? null,
                integrity_reason: pack.integrity.reason ?? null,
              }),
        },
      }).catch((auditErr) => {
        // Audit failure is logged but never propagated — the pack
        // is already on its way to the client, and surfacing the
        // failure would corrupt the response stream.
        logger.error('Console: compliance audit-log write failed', {
          tenantId,
          error: (auditErr as Error).message,
        });
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(pack);
    } catch (err) {
      const message = (err as Error).message;

      // The service throws `tenant_not_found: <id>` when the tenant
      // referenced by the JWT was deleted between login and pack
      // render. The 404 is audited so a stale-JWT probing pattern
      // is visible in the log even though the chain itself is empty.
      if (message.startsWith('tenant_not_found')) {
        void recordAuditEvent(tenantId, {
          environment,
          actorType: 'console',
          actorId: tenantId,
          action: 'compliance.evidence_pack_rendered',
          entityType: 'tenant',
          entityId: tenantId,
          status: 'failure',
          summary: 'Compliance evidence pack — tenant not found',
          metadata: { actor_email: email, reason: 'tenant_not_found' },
        }).catch(() => undefined);
        res.status(404).json({
          error: 'tenant_not_found',
          message: 'Tenant not found.',
        });
        return;
      }

      logger.error('Console: compliance evidence pack render failed', {
        tenantId,
        environment,
        error: message,
      });
      void recordAuditEvent(tenantId, {
        environment,
        actorType: 'console',
        actorId: tenantId,
        action: 'compliance.evidence_pack_rendered',
        entityType: 'tenant',
        entityId: tenantId,
        status: 'failure',
        summary: 'Compliance evidence pack render failed',
        metadata: { actor_email: email, reason: message.slice(0, 200) },
      }).catch(() => undefined);
      res.status(500).json({
        error: 'evidence_pack_render_failed',
        message: 'Failed to render compliance evidence pack.',
      });
    }
  },
);

export default router;
