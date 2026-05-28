/**
 * Postgres-backed sliding-window rate-limit middleware.
 *
 * Phase 0 commit C-026, closes audit finding C-10 (no rate-limit on
 * /v1/zkp/verify or /api/console/login, trivially DoS-able). The
 * existing in-memory limiters in src/middleware/tenant-auth.ts and the
 * `express-rate-limit` wired in src/app.ts only protect a single
 * process; once we scale out behind a load balancer the counters
 * diverge and an attacker who hashes their requests across replicas
 * defeats the limit entirely.
 *
 * This middleware writes the counter to `rate_limit_buckets` so the
 * window is shared across every replica that talks to the same
 * Postgres. The bucket key encodes route + identity + window-start
 * floor so a single SQL INSERT ... ON CONFLICT ... DO UPDATE
 * RETURNING count gives us the post-increment counter atomically.
 *
 * Keying:
 *   - 'apiKey'        — requires authenticateTenantApiKey to have run
 *                       first; reads req.tenantContext.apiKey.id
 *   - 'ip'            — reads req.ip (Express trust-proxy aware)
 *   - 'apiKey+ip'     — joins both with '|'
 *
 * Threat model:
 *   - A-32 (DoS via floods on /v1/zkp/verify) — closed by the apiKey-
 *     keyed bucket on the verify route.
 *   - A-33 (credential stuffing on /api/console/login) — closed by
 *     the IP-keyed bucket on the login route.
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { TenantContext } from '../types';

export type RateLimitKeyBy = 'apiKey' | 'ip' | 'apiKey+ip';

export interface PgRateLimitOptions {
  /** Logical route label that prefixes the bucket key, e.g. 'zkp:verify'. */
  route: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed in the window before 429s. */
  max: number;
  /** How the bucket is keyed: by API key id, by IP, or both joined by '|'. */
  keyBy: RateLimitKeyBy;
}

/**
 * Resolve the per-request identity component of the bucket key.
 *
 * Returns null when the requested key cannot be resolved — e.g.
 * `keyBy: 'apiKey'` but no tenantContext has been attached. The
 * middleware treats null as "skip rate-limit, log a warning" so a
 * mis-wired pipeline fails open on rate-limit (we'd rather serve the
 * request than 500 the user). The mis-wire surfaces in logs and the
 * upstream auth layer still rejects unauthenticated requests.
 */
function resolveKey(req: Request, keyBy: RateLimitKeyBy): string | null {
  const ctx = (req as Request & { tenantContext?: TenantContext }).tenantContext;
  const apiKeyId = ctx?.apiKey?.id;
  const ip = req.ip;

  if (keyBy === 'apiKey') {
    return apiKeyId ?? null;
  }
  if (keyBy === 'ip') {
    return ip ?? null;
  }
  // 'apiKey+ip'
  if (!apiKeyId || !ip) return null;
  return `${apiKeyId}|${ip}`;
}

/**
 * Floor `nowMs` to the start of the current `windowMs` window. The
 * bucket key incorporates this floor so a new window naturally gets a
 * new row in `rate_limit_buckets` without any TTL juggling on the
 * read path.
 */
function windowStartFloor(nowMs: number, windowMs: number): number {
  return Math.floor(nowMs / windowMs) * windowMs;
}

/**
 * Build the composite bucket key. Format:
 *
 *   <route>:<identity>:<window-start-floor-ms>
 *
 * The window-start-floor is in milliseconds so two 1-minute windows
 * 60_000 ms apart get distinct keys; the leading `route` lets us
 * inspect a tenant's traffic on a single endpoint without scanning
 * the whole table.
 */
export function buildBucketKey(route: string, identity: string, nowMs: number, windowMs: number): string {
  return `${route}:${identity}:${windowStartFloor(nowMs, windowMs)}`;
}

/**
 * Factory returning the Express middleware. The middleware is
 * fail-open if the bucket cannot be resolved (mis-wire) or if the DB
 * is transiently unreachable — rate-limiting is a hardening layer,
 * not an authentication layer, and a Postgres outage shouldn't take
 * down /api/console/login.
 */
export function pgRateLimit(opts: PgRateLimitOptions): RequestHandler {
  const { route, windowMs, max, keyBy } = opts;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const nowMs = Date.now();
    const identity = resolveKey(req, keyBy);

    if (!identity) {
      logger.warn('pgRateLimit: identity unresolved; skipping rate-limit', { route, keyBy });
      next();
      return;
    }

    const bucketKey = buildBucketKey(route, identity, nowMs, windowMs);
    const expiresAt = new Date(windowStartFloor(nowMs, windowMs) + windowMs);

    let count: number;
    try {
      const result = await getPool().query<{ count: number }>(
        `INSERT INTO rate_limit_buckets (bucket_key, count, window_start, expires_at)
         VALUES ($1, 1, NOW(), $2)
         ON CONFLICT (bucket_key) DO UPDATE
           SET count = rate_limit_buckets.count + 1
         RETURNING count`,
        [bucketKey, expiresAt],
      );
      count = Number(result.rows[0]?.count ?? 0);
    } catch (err) {
      // Fail-open: log and continue. Production has a Postgres-watcher
      // on the rate-limit table that pages ops if the bucket count
      // diverges from the request log, so silent fail-open is
      // observable.
      logger.error('pgRateLimit: bucket UPSERT failed; failing open', {
        route,
        keyBy,
        error: (err as Error).message,
      });
      next();
      return;
    }

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - count)));
    res.set('X-RateLimit-Reset', String(Math.ceil(expiresAt.getTime() / 1000)));

    if (count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((expiresAt.getTime() - nowMs) / 1000));
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Try again later.',
        retry_after_seconds: retryAfterSec,
      });
      return;
    }

    next();
  };
}

/**
 * Periodic cleanup of expired buckets. Called from a setInterval
 * registered by initRateLimitCleanup(). Exported so the test suite
 * can invoke it directly with a mocked pool.
 */
export async function cleanupRateLimitBuckets(): Promise<void> {
  try {
    await getPool().query('DELETE FROM rate_limit_buckets WHERE expires_at < NOW()');
  } catch (err) {
    logger.error('cleanupRateLimitBuckets: DELETE failed', {
      error: (err as Error).message,
    });
  }
}

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Start the periodic cleanup task. Idempotent — repeated calls are a
 * no-op so server reloads don't stack timers. The interval is fixed
 * at 60_000 ms per the C-026 spec.
 */
export function initRateLimitCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void cleanupRateLimitBuckets();
  }, 60_000);
  // Don't keep the event loop alive just for the cleanup timer; the
  // server has its own keep-alive sockets.
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

/**
 * Stop the periodic cleanup task. Used by graceful shutdown + the
 * test suite.
 */
export function stopRateLimitCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
