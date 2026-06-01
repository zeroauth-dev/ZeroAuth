/**
 * Tenant webhook management — console-facing CRUD.
 *
 * Mounted at `/api/console/webhooks`. Auth is `requireConsoleAuth` —
 * developer-dashboard JWT in the `Authorization: Bearer …` header or
 * HttpOnly `zeroauth_console_jwt` cookie, same as `src/routes/console.ts`.
 *
 * A webhook is a tenant-registered outbound delivery destination. The
 * platform's delivery worker POSTs canonical JSON to `url`, signed with
 * `HMAC-SHA256(secret, raw_body)` in `X-ZeroAuth-Signature: sha256=<hex>`
 * — the Stripe/GitHub convention. This router only manages the registry;
 * delivery lives in `webhook-delivery.ts`. Secret rotation is v1-deferred
 * (DELETE + POST a new row). Sub-tenant RBAC is a separate roadmap item.
 *
 * Audit: every mutation writes `webhook.created` or `webhook.deleted` to
 * `audit_events` via `recordAuditEvent` with `metadata.actor_email` set
 * (issue #26 F-3). The secret is NEVER logged. Per-tenant isolation: every
 * query carries `(tenant_id, environment)` in WHERE; tenantId comes from
 * the JWT, so cross-tenant probing is impossible.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { recordAuditEvent } from '../services/platform';
import { ApiKeyEnvironment } from '../types';

const router = Router();

// ─── JWT verification (mirrors console.ts) ────────────────────────
// `requireConsoleAuth` is not exported from console.ts; repeating the
// small verification shape here avoids a circular import. Same pattern
// as `src/routes/console-security-policy.ts`. Constants stay in
// lockstep with console.ts.

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
  } else if (typeof (req as Request & { cookies?: Record<string, string> }).cookies?.[CONSOLE_JWT_COOKIE] === 'string') {
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
    res.status(401).json({ error: 'session_expired', message: 'Console session expired. Please login again.' });
  }
}

/**
 * Per-tenant rate limit on write endpoints (POST, DELETE). Keyed on
 * the console.tenantId so a stolen JWT cannot pierce the cap by IP
 * switching. Reads (GET) are not capped beyond the global app limiter.
 * Skipped under NODE_ENV=test so jest is not throttled.
 */
const webhookWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
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
    error: 'tenant_write_rate_limited',
    message: 'Too many webhook mutations for this tenant in the last 15 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Constants ────────────────────────────────────────────────────
const SECRET_BYTES = 32;           // 256 bits — matches GitHub's webhook secret strength.
const MAX_WEBHOOKS_PER_ENV = 10;   // Per (tenant, environment); raise via ADR if needed.
const MAX_URL_LENGTH = 2048;       // Application-side cap on URL column length.
/**
 * Allowed action-filter shape: `*` sentinel, dotted identifier, or
 * dotted identifier with `.*` suffix (e.g. `verification.*`,
 * `device.enrolled`). Rejects whitespace and double-wildcards.
 */
const EVENT_FILTER_PATTERN = /^(\*|[a-z][a-z0-9_]*(\.[a-z0-9_]+)*(\.\*)?)$/;

// ─── Helpers ──────────────────────────────────────────────────────

/** Mirrors `parseEnv` in console.ts — default to `live`. */
function parseEnv(value: unknown): ApiKeyEnvironment {
  return value === 'test' ? 'test' : 'live';
}

/**
 * URL safety gate. Refuses non-HTTP(S) schemes and obvious loopback /
 * RFC-1918 / metadata-endpoint hosts. DNS-rebind resistance is the
 * delivery worker's job — it filters egress at request time.
 */
function isAllowedWebhookUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return { ok: false, reason: 'url is not a valid absolute URL' }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'url must use http or https scheme' };
  }
  const host = parsed.hostname.toLowerCase();
  const blockedExact = new Set(['localhost', '0.0.0.0', '127.0.0.1', '169.254.169.254', '::1', 'metadata.google.internal']);
  if (blockedExact.has(host)) return { ok: false, reason: 'url host is not allowed (loopback/metadata)' };
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) {
    return { ok: false, reason: 'url host is RFC 1918 private space' };
  }
  return { ok: true };
}

/**
 * Validate an event_filter array. Returns `null` when acceptable.
 * Empty arrays are rejected — callers must pass `['*']` for all events.
 */
function validateEventFilter(input: unknown): string | null {
  if (!Array.isArray(input)) return 'event_filter must be an array of action patterns';
  if (input.length === 0) return 'event_filter must contain at least one pattern (use ["*"] for all)';
  if (input.length > 32) return 'event_filter may contain at most 32 patterns';
  for (const entry of input) {
    if (typeof entry !== 'string') return 'event_filter entries must be strings';
    if (!EVENT_FILTER_PATTERN.test(entry)) {
      return `event_filter entry ${JSON.stringify(entry)} is not a valid pattern`;
    }
  }
  return null;
}

/** `whsec_<base64url>` HMAC-SHA256 signing secret — Stripe convention. */
function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(SECRET_BYTES).toString('base64url')}`;
}

interface WebhookRow {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  url: string;
  secret: string;
  event_filter: string[];
  enabled: boolean;
  description: string | null;
  last_delivery_at: Date | null;
  last_delivery_status: 'success' | 'failure' | null;
  consecutive_failures: number;
  created_at: Date;
  updated_at: Date;
}

/** Strip the bearer-grade `secret` before sending a row over the wire. */
function redactWebhook(row: WebhookRow): Omit<WebhookRow, 'secret'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secret, ...safe } = row;
  return safe;
}

/**
 * Audit-write failure handler. Logged but never propagated — the
 * webhook row is already committed and surfacing the failure would
 * confuse the operator (see audit chain notes in src/services/audit.ts).
 */
function logAuditFailure(webhookId: string, auditErr: unknown): void {
  logger.error('Console: webhook audit-log write failed', {
    webhookId,
    error: (auditErr as Error).message,
  });
}

/**
 * GET /api/console/webhooks
 *
 * List webhooks for the authenticated tenant. Query: `environment` =
 * `live` (default) | `test`. Returns rows sorted newest-first with
 * `secret` elided. No mutation, so no audit row is written.
 */
router.get('/webhooks', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as Request & { console: ConsolePrincipal }).console;
    const environment = parseEnv(req.query.environment);
    const pool = getPool();
    const result = await pool.query<WebhookRow>(
      `SELECT *
         FROM tenant_webhooks
        WHERE tenant_id = $1 AND environment = $2
        ORDER BY created_at DESC
        LIMIT 100`,
      [tenantId, environment],
    );
    res.json({ environment, webhooks: result.rows.map(redactWebhook) });
  } catch (err) {
    logger.error('Console: webhook list failed', { error: (err as Error).message });
    res.status(500).json({ error: 'webhook_list_failed', message: 'Failed to list webhooks.' });
  }
});

/**
 * POST /api/console/webhooks
 *
 * Register a new webhook destination. Body: `url` (required HTTPS),
 * `event_filter` (required string[]; use `["*"]` for all),
 * `environment` (default `live`), `enabled` (default true),
 * `description` (optional ≤ 255 chars).
 *
 * Response 201 returns the row plus the plaintext `secret` — shown
 * EXACTLY ONCE. The body carries a `warning` field so the dashboard
 * can render the copy-now banner. Audit row `webhook.created` is
 * written with URL + filter + id; secret is never in the metadata.
 */
router.post('/webhooks', requireConsoleAuth, webhookWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as Request & { console: ConsolePrincipal }).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const { url, event_filter, enabled, description } = req.body ?? {};

    // Input validation
    if (typeof url !== 'string' || url.trim().length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'url is required' });
      return;
    }
    if (url.length > MAX_URL_LENGTH) {
      res.status(400).json({ error: 'invalid_url', message: `url must be ${MAX_URL_LENGTH} chars or fewer` });
      return;
    }
    const urlCheck = isAllowedWebhookUrl(url.trim());
    if (!urlCheck.ok) {
      res.status(400).json({ error: 'invalid_url', message: urlCheck.reason });
      return;
    }
    const filterError = validateEventFilter(event_filter);
    if (filterError) {
      res.status(400).json({ error: 'invalid_event_filter', message: filterError });
      return;
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'invalid_request', message: 'enabled must be a boolean' });
      return;
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 255)) {
      res.status(400).json({ error: 'invalid_request', message: 'description must be a string up to 255 chars' });
      return;
    }

    // Quota check — stops fan-out from blowing up the delivery worker.
    const pool = getPool();
    const countResult = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM tenant_webhooks WHERE tenant_id = $1 AND environment = $2`,
      [tenantId, environment],
    );
    const current = parseInt(countResult.rows[0]?.n ?? '0', 10);
    if (current >= MAX_WEBHOOKS_PER_ENV) {
      res.status(400).json({
        error: 'webhook_limit_reached',
        message: `Maximum ${MAX_WEBHOOKS_PER_ENV} webhooks per environment. Delete unused destinations first.`,
      });
      return;
    }

    const secret = generateWebhookSecret();
    const insertResult = await pool.query<WebhookRow>(
      `INSERT INTO tenant_webhooks
         (tenant_id, environment, url, secret, event_filter, enabled, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        tenantId,
        environment,
        url.trim(),
        secret,
        event_filter,
        enabled === undefined ? true : enabled,
        typeof description === 'string' ? description.trim() : null,
      ],
    );
    const row = insertResult.rows[0];

    // Audit — fire-and-forget; failure is logged, never propagated.
    void recordAuditEvent(tenantId, {
      environment,
      actorType: 'console',
      actorId: tenantId,
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: row.id,
      status: 'success',
      summary: `Registered webhook for ${row.url}`.slice(0, 255),
      metadata: { actor_email: email, url: row.url, event_filter: row.event_filter, enabled: row.enabled },
    }).catch((auditErr) => logAuditFailure(row.id, auditErr));

    res.status(201).json({
      ...redactWebhook(row),
      secret,
      warning: 'Copy this signing secret now — it will never be shown again.',
    });
  } catch (err) {
    logger.error('Console: webhook create failed', { error: (err as Error).message });
    res.status(500).json({ error: 'webhook_create_failed', message: 'Failed to create webhook.' });
  }
});

/**
 * DELETE /api/console/webhooks/:id
 *
 * Permanently delete a webhook (hard delete). Past `audit_events`
 * rows that reference the id remain — `entity_id` is TEXT and does
 * not FK to `tenant_webhooks.id`, so the historical trail survives.
 *
 * `:id` matches on `(id, tenant_id, environment)` so an operator for
 * tenant A cannot delete tenant B's webhook by guessing the UUID.
 * Audit rows are written for both success (`webhook.deleted`) and the
 * 404 "not found / wrong tenant" path so probing attempts are visible.
 */
router.delete('/webhooks/:id', requireConsoleAuth, webhookWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as Request & { console: ConsolePrincipal }).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const { id } = req.params;

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      res.status(400).json({ error: 'invalid_webhook_id', message: 'Webhook id is not a valid UUID.' });
      return;
    }

    const pool = getPool();
    const result = await pool.query<WebhookRow>(
      `DELETE FROM tenant_webhooks
        WHERE id = $1 AND tenant_id = $2 AND environment = $3
        RETURNING *`,
      [id, tenantId, environment],
    );

    if (result.rowCount === 0) {
      void recordAuditEvent(tenantId, {
        environment,
        actorType: 'console',
        actorId: tenantId,
        action: 'webhook.deleted',
        entityType: 'webhook',
        entityId: id,
        status: 'failure',
        summary: `Webhook not found or wrong tenant: ${id}`.slice(0, 255),
        metadata: { actor_email: email, requested_id: id },
      }).catch(() => undefined);
      res.status(404).json({ error: 'webhook_not_found', message: 'Webhook not found.' });
      return;
    }

    const row = result.rows[0];
    void recordAuditEvent(tenantId, {
      environment,
      actorType: 'console',
      actorId: tenantId,
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: row.id,
      status: 'success',
      summary: `Deleted webhook for ${row.url}`.slice(0, 255),
      metadata: { actor_email: email, url: row.url, event_filter: row.event_filter, was_enabled: row.enabled },
    }).catch((auditErr) => logAuditFailure(row.id, auditErr));

    res.status(200).json({ message: 'Webhook deleted.', webhook: redactWebhook(row) });
  } catch (err) {
    logger.error('Console: webhook delete failed', { error: (err as Error).message });
    res.status(500).json({ error: 'webhook_delete_failed', message: 'Failed to delete webhook.' });
  }
});

export default router;
