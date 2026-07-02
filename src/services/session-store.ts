import { UserSession, AdminStats } from '../types';
import { logger } from './logger';
import { getPool } from './db';

/**
 * SessionStore — write-through cache backed by Postgres (C-9), with
 * an opt-in Redis backend for multi-pod horizontal scale-out.
 *
 * The default `InMemorySessionStore` keeps the sync API the route
 * layer expects and writes through to `user_sessions` so sessions
 * survive process restart. The opt-in `RedisSessionStore` (selected
 * when `REDIS_URL` is set) makes sessions visible across pods after
 * one cache miss + a Redis round-trip. Both classes satisfy the
 * `SessionStore` interface so callers in `src/routes/` never change.
 *
 * Writes return synchronously; the Postgres / Redis write is
 * fire-and-forget. The hourly cleanup interval and Redis TTL handle
 * expiry. The provider-breakdown counter is process-local — for a
 * cluster-wide reading, query `usage_monthly` instead.
 */

// ─── Shared interface ──────────────────────────────────────────────

/** Contract every backend implements. Selected by `createSessionStore()`. */
export interface SessionStore {
  init(): Promise<void>;
  stop(): void;
  create(session: UserSession): void;
  get(sessionId: string): UserSession | undefined;
  delete(sessionId: string): boolean;
  getStats(): AdminStats;
}

// ─── In-memory + Postgres backend (default) ────────────────────────

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, UserSession>();
  private verificationCount = { saml: 0, oidc: 0, zkp: 0 };
  private startTime = Date.now();
  private hydrated = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Hydrate cache from Postgres + start hourly cleanup. Idempotent. */
  async init(): Promise<void> {
    if (this.hydrated) return;
    try {
      const pool = getPool();
      const result = await pool.query<{
        session_id: string;
        user_id: string;
        provider: 'saml' | 'oidc' | 'zkp';
        verified: boolean;
        created_at: Date;
        expires_at: Date;
        did: string | null;
      }>(
        `SELECT session_id, user_id, provider, verified, created_at, expires_at, did
           FROM user_sessions
          WHERE expires_at > NOW()`,
      );

      for (const row of result.rows) {
        this.sessions.set(row.session_id, {
          sessionId: row.session_id,
          userId: row.user_id,
          provider: row.provider,
          verified: row.verified,
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
        });
      }
      this.hydrated = true;
      logger.info('SessionStore: hydrated from Postgres', { count: result.rows.length });
    } catch (err) {
      // Boot must not block on DB; prod wires initDb() before init().
      this.hydrated = true;
      logger.warn('SessionStore: hydration failed, continuing with empty cache', {
        error: (err as Error).message,
      });
    }

    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanupExpired().catch(err => logger.warn(
          'SessionStore: cleanup failed', { error: (err as Error).message },
        ));
      }, 60 * 60 * 1000);
      this.cleanupInterval.unref?.();
    }
  }

  /** Tear down the cleanup interval (graceful shutdown + tests). */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  create(session: UserSession): void {
    this.sessions.set(session.sessionId, session);
    this.verificationCount[session.provider]++;
    // Fire-and-forget Postgres write; cache holds the row until expiry.
    void this.persistCreate(session).catch(err => logger.warn(
      'SessionStore: persist failed', { sessionId: session.sessionId, error: (err as Error).message },
    ));
  }

  get(sessionId: string): UserSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && new Date(session.expiresAt) < new Date()) {
      this.delete(sessionId);
      return undefined;
    }
    return session;
  }

  delete(sessionId: string): boolean {
    const had = this.sessions.delete(sessionId);
    void this.persistDelete(sessionId).catch(err => logger.warn(
      'SessionStore: persist-delete failed', { sessionId, error: (err as Error).message },
    ));
    return had;
  }

  getStats(): AdminStats {
    const now = new Date();
    for (const [id, session] of this.sessions) {
      if (new Date(session.expiresAt) < now) {
        this.sessions.delete(id);
      }
    }

    const total =
      this.verificationCount.saml +
      this.verificationCount.oidc +
      this.verificationCount.zkp;

    return {
      totalVerifications: total,
      activeSessionCount: this.sessions.size,
      providerBreakdown: { ...this.verificationCount },
      dataStorageConfirmation: {
        biometricDataStored: false as const,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  // ─── Private: Postgres write paths ───────────────────────────────

  private async persistCreate(session: UserSession): Promise<void> {
    // Skip in tests where the DB isn't initialised.
    let pool;
    try { pool = getPool(); } catch { return; }
    await pool.query(
      `INSERT INTO user_sessions
         (session_id, user_id, provider, verified, created_at, expires_at, did)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         provider = EXCLUDED.provider,
         verified = EXCLUDED.verified,
         expires_at = EXCLUDED.expires_at,
         did = EXCLUDED.did`,
      [
        session.sessionId,
        session.userId,
        session.provider,
        session.verified,
        session.createdAt,
        session.expiresAt,
        (session as UserSession & { did?: string }).did ?? null,
      ],
    );
  }

  private async persistDelete(sessionId: string): Promise<void> {
    let pool;
    try { pool = getPool(); } catch { return; }
    await pool.query(`DELETE FROM user_sessions WHERE session_id = $1`, [sessionId]);
  }

  private async cleanupExpired(): Promise<void> {
    let pool;
    try { pool = getPool(); } catch { return; }
    const result = await pool.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM user_sessions WHERE expires_at <= NOW() RETURNING session_id
       ) SELECT COUNT(*)::text AS count FROM deleted`,
    );
    const deleted = parseInt(result.rows[0]?.count ?? '0', 10);
    if (deleted > 0) {
      logger.info('SessionStore: cleanup pruned expired rows', { deleted });
    }
  }
}

// ─── Redis backend (opt-in via REDIS_URL) ──────────────────────────

/**
 * Minimal shape of `ioredis`. Declared structurally so this file
 * typechecks before the `dep-add` for ioredis lands; the dynamic
 * import only runs when `REDIS_URL` is set.
 */
interface IoRedisClient {
  set(key: string, value: string, mode: 'PX', ms: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  quit(): Promise<unknown>;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

const REDIS_KEY_PREFIX = 'zeroauth:session:';

class RedisSessionStore implements SessionStore {
  private client: IoRedisClient | null = null;
  private url: string;
  private cache = new Map<string, UserSession>();
  private verificationCount = { saml: 0, oidc: 0, zkp: 0 };
  private startTime = Date.now();
  private initialised = false;

  constructor(url: string) {
    this.url = url;
  }

  async init(): Promise<void> {
    if (this.initialised) return;
    try {
      // Dynamic import so the bundle skips ioredis on the default path.
      const mod = await import('ioredis');
      const Redis = (mod as { default?: new (url: string) => IoRedisClient }).default
        ?? (mod as unknown as new (url: string) => IoRedisClient);
      this.client = new Redis(this.url);
      this.client.on('error', err => logger.warn(
        'RedisSessionStore: client error', { error: (err as Error).message },
      ));
      this.initialised = true;
      logger.info('RedisSessionStore: connected', { url: this.redactedUrl() });
    } catch (err) {
      // Boot must not block if ioredis is missing or Redis is unreachable.
      // get/create/delete paths all guard on `this.client`.
      this.initialised = true;
      this.client = null;
      logger.warn('RedisSessionStore: init failed, falling back to in-memory cache only', {
        error: (err as Error).message,
      });
    }
  }

  stop(): void {
    if (this.client) {
      this.client.quit().catch(() => { /* swallow */ });
      this.client = null;
    }
  }

  create(session: UserSession): void {
    this.cache.set(session.sessionId, session);
    this.verificationCount[session.provider]++;
    void this.persistCreate(session).catch(err => logger.warn(
      'RedisSessionStore: persist failed', { sessionId: session.sessionId, error: (err as Error).message },
    ));
  }

  get(sessionId: string): UserSession | undefined {
    const cached = this.cache.get(sessionId);
    if (cached) {
      if (new Date(cached.expiresAt) < new Date()) {
        this.delete(sessionId);
        return undefined;
      }
      return cached;
    }
    // Sync API + async Redis → cross-pod read costs one cache miss.
    // Background hydrate populates the cache so the next call sees it.
    void this.hydrateOne(sessionId).catch(err => logger.warn(
      'RedisSessionStore: hydrate-one failed', { sessionId, error: (err as Error).message },
    ));
    return undefined;
  }

  delete(sessionId: string): boolean {
    const had = this.cache.delete(sessionId);
    void this.persistDelete(sessionId).catch(err => logger.warn(
      'RedisSessionStore: persist-delete failed', { sessionId, error: (err as Error).message },
    ));
    return had;
  }

  getStats(): AdminStats {
    const now = new Date();
    for (const [id, session] of this.cache) {
      if (new Date(session.expiresAt) < now) {
        this.cache.delete(id);
      }
    }

    const total =
      this.verificationCount.saml +
      this.verificationCount.oidc +
      this.verificationCount.zkp;

    return {
      totalVerifications: total,
      // Local-pod cache size, not cluster-wide. A SCAN over the prefix
      // would hammer Redis on every stats poll; skip it by design.
      activeSessionCount: this.cache.size,
      providerBreakdown: { ...this.verificationCount },
      dataStorageConfirmation: {
        biometricDataStored: false as const,
        message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
      },
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  // ─── Private: Redis write paths ──────────────────────────────────

  private redisKey(sessionId: string): string {
    return `${REDIS_KEY_PREFIX}${sessionId}`;
  }

  private redactedUrl(): string {
    try {
      const u = new URL(this.url);
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return '<redis>';
    }
  }

  private async persistCreate(session: UserSession): Promise<void> {
    if (!this.client) return;
    const ttlMs = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
    if (ttlMs <= 0) return; // already expired
    await this.client.set(this.redisKey(session.sessionId), JSON.stringify(session), 'PX', ttlMs);
  }

  private async persistDelete(sessionId: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(this.redisKey(sessionId));
  }

  private async hydrateOne(sessionId: string): Promise<void> {
    if (!this.client) return;
    const raw = await this.client.get(this.redisKey(sessionId));
    if (!raw) return;
    try {
      const session = JSON.parse(raw) as UserSession;
      if (new Date(session.expiresAt) >= new Date()) {
        this.cache.set(sessionId, session);
      }
    } catch {
      // Corrupt JSON — drop so the next call doesn't loop.
      await this.client.del(this.redisKey(sessionId)).catch(() => { /* swallow */ });
    }
  }
}

// ─── Factory + module singleton ────────────────────────────────────

/**
 * Choose a backend based on env. The Redis path activates only when
 * `REDIS_URL` is set; the existing project convention also gates on
 * `USE_REDIS_SESSIONS=true` so that deployments which already have
 * `REDIS_URL` in `.env` for the Redis service (but haven't opted into
 * shared sessions) keep the current in-memory + Postgres write-through
 * behaviour. Both must be set to switch — matches `config.redis` in
 * `src/config/index.ts`.
 *
 * Called once at module load; `src/server.ts` then calls
 * `sessionStore.init()` like before.
 */
function createSessionStore(): SessionStore {
  const url = process.env.REDIS_URL;
  const enabled = process.env.USE_REDIS_SESSIONS === 'true';
  if (enabled && url && url.length > 0) {
    logger.info('SessionStore: REDIS_URL + USE_REDIS_SESSIONS set, using RedisSessionStore');
    return new RedisSessionStore(url);
  }
  return new InMemorySessionStore();
}

export const sessionStore: SessionStore = createSessionStore();
