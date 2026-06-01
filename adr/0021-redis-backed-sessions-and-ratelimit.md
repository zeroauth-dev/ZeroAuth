# ADR 0021 — Redis-backed sessions and rate-limit buckets

- **Status:** Proposed
- **Date:** 2026-06-01
- **Phase:** Phase 1, sprint 4 (scale-out enabler; no audit finding directly closed, but unblocks horizontal scaling for the Anchor Bank pilot)
- **Related:** ADR 0001 (express-rate-limit as a direct dep — currently single-process), ADR 0013 (audit chain — unaffected), ADR 0017 (blockchain-agnostic posture — unaffected). Touches `src/services/session-store.ts` and `src/middleware/rate-limit.ts`.

## Context

Two stateful components of the ZeroAuth API currently live in **process-local memory + Postgres write-through**:

1. **`src/services/session-store.ts`** — issued user sessions (the result of a successful `/v1/auth/zkp/verify` or `/v1/identity/verify` mint). The store is a `Map<sessionId, UserSession>` populated at boot by replaying non-expired rows from the `user_sessions` Postgres table. Mutations are write-through (cache first, then `INSERT ... ON CONFLICT ... DO UPDATE` fire-and-forget). The docstring in `session-store.ts` explicitly flags the limitation: "Horizontal scale-out (sessions readable across pods in real time) requires read-through cache invalidation and is deferred until we actually need multiple API pods."

2. **`src/middleware/rate-limit.ts`** — the `pgRateLimit` middleware that closed audit finding C-10. The bucket counter lives in `rate_limit_buckets` (Postgres) and is updated by a single `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING count` round-trip per request. This already works across replicas — every replica hits the same Postgres — but it costs **one Postgres write per request on every rate-limited route**. On `/v1/zkp/verify` (target 500 RPS in Phase 2) and `/api/console/login`, that's a hot write path against the same database that holds tenants, users, verification events, and audit rows. Postgres is the wrong substrate for a counter that ticks at request rate.

We are about to take on three workloads that make the present design untenable:

- **Multi-instance scale-out for the Anchor Bank pilot.** The pilot's volume target is 500 sustained RPS on `/v1/zkp/verify` with 10× burst. A single Node process tops out at ~200 RPS on the verify path (snarkjs is the bottleneck; the verifier service helps but the API process still does the signature work, the audit append, the rate-limit hit, and the session mint). We need at least 3 API pods behind the load balancer to hit the burst target with headroom.

- **Blue/green deploys with zero session loss.** Today, when we deploy, every active session on the old pod is dropped at shutdown — the in-memory `Map` evaporates. The Postgres backing keeps the row alive, but the new pod doesn't see it until either (a) its boot hydration runs (which happens before the load balancer flips traffic, so the cutover window itself is fine) or (b) the user re-authenticates. Cross-pod traffic during the cutover means a user's next request can land on a pod that has not seen the session yet — write-through Postgres rescues us, but only at the cost of a `SELECT` on every cache-miss, and the docstring is explicit that we do not currently read-through. Either way the operator experience is "deploys cost some users a re-login," which is acceptable for the demo era and unacceptable for the BFSI pilot.

- **Rate-limit honoured across instances.** The Postgres-backed bucket *does* satisfy this today, but at a Postgres-write-per-request cost. As we scale, the cost is unsustainable — and we already have a Redis container in `docker-compose.yml` (configured for all three profiles: `dev`, `test`, `prod`) doing nothing.

The Redis dependency story is the bizarre part: `docker-compose.yml` defines a healthy Redis service that all three profiles depend on with `service_healthy` gates. The `zeroauth-prod` and `zeroauth-dev` services both set `USE_REDIS_SESSIONS=true` and `REDIS_URL=redis://redis:6379` in their environment. `ioredis` is grandfathered in via ADR 0000. **But no code path in the repo connects to Redis or reads the `USE_REDIS_SESSIONS` flag.** The infrastructure is provisioned, the env vars are set, the dependency is in `package.json`, and the application does not use any of it.

This ADR proposes finishing what `docker-compose.yml` started.

## Decision

Adopt **Redis as the backing store for both sessions and rate-limit buckets**, gated behind the existing `USE_REDIS_SESSIONS` flag plus a new `USE_REDIS_RATELIMIT` flag. Postgres remains the durable audit-of-record for sessions; Redis is a fast shared cache, not the system of record. Rate-limit buckets move entirely to Redis (no Postgres backing) because they are operationally ephemeral — losing a rate-limit window is a hardening-layer hiccup, not a data-loss event.

### Session store layering — Postgres remains system-of-record, Redis is the shared hot cache

```
┌──────────────────────────────────────────────────────────────┐
│  API pod 1   │  API pod 2   │  API pod 3   │  …              │
│      │              │              │                          │
│      └─────── Redis (shared session cache, TTL = expiresAt) ──┤
│                     │                                          │
│              Postgres (system of record, durable, audit)       │
└──────────────────────────────────────────────────────────────┘
```

Mutation flow inside `session-store.ts`:

- `create(session)` writes to Redis (`SET sess:<sessionId> <json> PX <ttl-ms>`) and to Postgres (existing fire-and-forget `INSERT ... ON CONFLICT`). Both writes happen in parallel; the synchronous ack to the caller returns when Redis confirms. If Redis is down we fall back to writing only to Postgres + the in-process `Map` (degraded mode, logged at WARN).
- `get(sessionId)` reads from Redis first. On cache miss, falls back to the in-process `Map` (current behaviour for warm sessions on the same pod), then to a Postgres `SELECT` on a final miss. A row found in Postgres but not Redis is back-filled into Redis with the remaining TTL.
- `delete(sessionId)` `DEL`s the Redis key, deletes the in-process cache row, and fires the Postgres `DELETE` (existing).
- `init()` no longer hydrates the in-process `Map` from Postgres on boot — that hydration becomes unnecessary because Redis is shared. The in-process `Map` remains as a single-request hot-path optimisation (avoids a Redis round-trip when the same pod serves consecutive requests on the same session) but is no longer the source of truth. The boot path checks Redis connectivity and logs if Redis is unreachable but lets the process continue (degraded fall-back to Postgres-only).

The existing `UserSession` interface, the existing `(sessionId) => UserSession | undefined` shape, and the existing route-layer call sites do not change. The change is entirely internal to `session-store.ts` plus a new `src/services/redis-client.ts` that owns the singleton `ioredis` connection.

### Session-store pseudocode (Redis path)

The proposed shape of `session-store.ts` once the flag is `true`. The Postgres write-through stays exactly as it is today; only the layering of the read path and the up-front Redis write are new.

```typescript
async create(session: UserSession): Promise<void> {
  this.sessions.set(session.sessionId, session);
  this.verificationCount[session.provider]++;

  const ttlMs = new Date(session.expiresAt).getTime() - Date.now();
  if (ttlMs > 0 && this.redisEnabled) {
    try {
      await redis().set(
        `sess:${session.sessionId}`,
        JSON.stringify(session),
        'PX',
        ttlMs,
      );
    } catch (err) {
      logger.warn('SessionStore: redis write failed; degraded', {
        sessionId: session.sessionId, error: (err as Error).message,
      });
    }
  }

  // Existing Postgres write-through stays untouched.
  void this.persistCreate(session).catch(/* … */);
}

async get(sessionId: string): Promise<UserSession | undefined> {
  // Local hot-path: this pod just minted or read this session.
  const local = this.sessions.get(sessionId);
  if (local) return this.expiryCheck(local);

  if (this.redisEnabled) {
    try {
      const raw = await redis().get(`sess:${sessionId}`);
      if (raw) {
        const session = JSON.parse(raw) as UserSession;
        this.sessions.set(sessionId, session); // back-fill local
        return this.expiryCheck(session);
      }
    } catch (err) {
      logger.warn('SessionStore: redis read failed; falling back', {
        sessionId, error: (err as Error).message,
      });
    }
  }

  // Last resort: Postgres. Back-fills both Redis (with remaining TTL) and
  // the in-process map.
  return this.hydrateFromPostgres(sessionId);
}
```

The `get` signature becomes `async` — a small but visible change for the route layer (every caller must `await`). The existing callers already live in async handlers, so the change is mechanical.

### Rate-limit buckets — move entirely to Redis

Replace the Postgres `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING count` in `pgRateLimit` (`src/middleware/rate-limit.ts`) with a Redis `INCR` + `EXPIRE`. The new code path is two Redis commands per request, pipelined:

```
MULTI
  INCR <bucket_key>
  PEXPIRE <bucket_key> <window_ms_remaining> NX
EXEC
```

The `PEXPIRE NX` only sets the TTL when the key was just created — subsequent `INCR`s in the same window don't reset the expiry. This matches the current `windowStartFloor` semantics exactly: the bucket lives for one window from first request, then expires naturally.

The `rate_limit_buckets` Postgres table can be dropped *after* the Redis path has been the production code path for one quarter and we are confident there is no regression we want to roll back to.

A new wrapper function `redisRateLimit(opts)` replaces `pgRateLimit(opts)` at the route-mount call sites in `src/app.ts`. The old `pgRateLimit` function is retained as a fallback (selected when `USE_REDIS_RATELIMIT=false`) for the rollback window. The `initRateLimitCleanup` / `stopRateLimitCleanup` / `cleanupRateLimitBuckets` helpers become no-ops in Redis mode (Redis TTLs do the cleanup for us).

### Rate-limit pseudocode (Redis path)

```typescript
export function redisRateLimit(opts: PgRateLimitOptions): RequestHandler {
  const { route, windowMs, max, keyBy } = opts;

  return async (req, res, next) => {
    const nowMs = Date.now();
    const identity = resolveKey(req, keyBy);
    if (!identity) { /* unchanged: log + fail-open */ return next(); }

    const bucketKey = buildBucketKey(route, identity, nowMs, windowMs);
    const windowEnd = windowStartFloor(nowMs, windowMs) + windowMs;
    const ttlMs = windowEnd - nowMs;

    let count: number;
    try {
      // Pipelined two-command transaction; second command is a no-op on
      // subsequent increments inside the same window because of `NX`.
      const result = await redis()
        .multi()
        .incr(bucketKey)
        .pexpire(bucketKey, ttlMs, 'NX')
        .exec();
      count = Number(result?.[0]?.[1] ?? 0);
    } catch (err) {
      logger.error('redisRateLimit: bucket INCR failed; failing open', {
        route, keyBy, error: (err as Error).message,
      });
      return next();
    }

    // Header + 429 emission is identical to the Postgres path.
    /* …unchanged… */
  };
}
```

The `buildBucketKey` and `windowStartFloor` helpers are exported from `rate-limit.ts` already; the Redis variant reuses them verbatim so the bucket-key format is identical across modes. This matters during the rollback window: a request that hashes to the same bucket-key in Postgres and in Redis gets the same window boundaries, so a mid-flight switch does not gift any attacker a fresh window.

### Feature flags

- `USE_REDIS_SESSIONS` (already defined in `docker-compose.yml`, currently unread by code) — when `true`, `session-store.ts` uses the Redis-backed layering above. When `false` or unset, behaviour is the current Postgres-write-through-Map model. Default: `false` in test, `true` in dev and prod.
- `USE_REDIS_RATELIMIT` (new) — when `true`, `pgRateLimit` route mounts use the Redis bucket variant. Default: `false` until the feature ships; flip to `true` in prod once the Phase-1 integration test pack is green.
- `REDIS_URL` (already defined) — `ioredis` connection string. No change to the env-var contract.

The flags are independent. We can ship Redis sessions first, validate, then ship Redis rate-limit, or vice versa.

### Connection management

A single `src/services/redis-client.ts` owns the `ioredis` connection. Connection pool size = 1 (ioredis multiplexes; one TCP connection handles concurrent commands). Retry strategy: exponential back-off with a max of 30 s between retries; on connection loss the session-store + rate-limit code paths fall back to their Postgres mode and log. Boot does **not** block on Redis being reachable — same posture as ADR 0017 for the blockchain providers: optional infrastructure, degraded mode if unavailable.

### What this does NOT do

- It does NOT make Postgres optional for sessions. Postgres remains the durable audit-of-record. A Redis flush loses cached sessions but not historical rows.
- It does NOT introduce a new dependency. `ioredis` is already in `package.json` and grandfathered in via ADR 0000.
- It does NOT change the `UserSession` type, the `/v1/auth/zkp/verify` response shape, or any route signature. The change is internal to the two files named in this ADR plus the new `redis-client.ts` and the route-mount edits in `src/app.ts`.
- It does NOT add cluster-mode Redis. Single-instance Redis is sufficient for the Phase-1 pilot volume; Redis Cluster / Redis Sentinel is a Phase-2 decision if a customer asks for sub-second failover.
- It does NOT remove the `rate_limit_buckets` Postgres table in this commit. The table is retained for one quarter as a rollback target.

## Consequences

**Positive**

- **Multi-instance scale-out is unblocked.** Three pods behind the load balancer share a single session view; a user's request landing on any pod sees their session immediately, not after a Postgres `SELECT` round-trip.
- **Blue/green deploys preserve sessions.** When the new pod fleet comes up, Redis already holds the active sessions. No re-login at cutover. The old pod fleet drains cleanly; no data is in the old pods' RAM only.
- **Rate-limit cost drops from one Postgres write per request to one Redis `INCR`.** Redis sustains ~100k ops/sec on a single instance; Postgres tops out at ~5k writes/sec on our current instance class. The hot login + verify paths stop competing for Postgres write capacity with tenants, users, and audit rows.
- **The `docker-compose.yml` infrastructure investment pays off.** Redis has been provisioned and healthy in all three profiles for months without being used. This commit lights it up.
- **Reduces Postgres write amplification on hot paths.** Every login no longer writes one rate-limit row; every verify no longer writes one rate-limit row. At 500 RPS that's a meaningful saving on WAL volume and on autovacuum pressure on `rate_limit_buckets`.

**Negative**

- **One more piece of infrastructure on the critical path.** Today, Postgres being up is necessary and sufficient. After this ADR, Redis being up is *desirable* (degraded fall-back exists) but failure modes proliferate. Mitigation: the fall-back to Postgres-only mode is explicit, tested, and logged.
- **Cache-coherency edge cases.** A session deleted on pod A could be served stale from pod B's in-process `Map` for the request that's already in flight. Mitigation: the in-process `Map` becomes a single-request hot-path cache only (cleared aggressively on `delete`), and `get` checks Redis before trusting the local cache.
- **Operational complexity at deploy time.** Operators have to know to provision Redis (already automatic via `docker-compose.yml`) and to set `USE_REDIS_SESSIONS=true` (already set in the prod profile). A customer who runs the API outside our docker compose needs the runbook updated.
- **Memory cost.** A Redis instance holding 100k active sessions at ~1 KB each is ~100 MB — trivial on the current VPS, but worth tracking in the capacity-planning doc.

## Observability

Both code paths emit structured Winston logs at the existing keys, so the dashboards do not need to change for the basic on/off signal. New metrics that should land alongside the implementation commit:

- `session_store.redis.hit` / `session_store.redis.miss` / `session_store.redis.fallback_pg` / `session_store.redis.fallback_map` — counters for the three branches of the `get` path. Healthy steady-state is `hit >> miss >> fallback_*`.
- `session_store.redis.write_latency_ms` — histogram of the `SET` latency on `create`. Alert at p99 > 50 ms (Redis on the same host should be sub-ms; sustained 50 ms means GC pause, network blip, or memory pressure).
- `rate_limit.redis.incr_count` — counter of bucket increments. Compared against the old `rate_limit.pg.write_count` during the rollout window, the two should track 1:1 within ±2 % of request rate. A divergence flags a key-format bug.
- `rate_limit.redis.fail_open_count` — counter of the fail-open branch. Should be near-zero in production; any sustained non-zero is a Redis health alert.
- `redis.connection.up` — gauge (0/1) from the `ioredis` `ready` event. Drives the on-call alert.

The audit-log surface is untouched. Sessions still write an audit row on mint (today's `appendAuditEvent` call in the verify route) and on delete (today's call in the logout route). Redis is invisible to the audit chain — that is correct, because Redis is a cache, not a system of record, and ADR 0013's tamper-evidence is rooted in Postgres.

## Security review

A standalone `security-reviewer` pass is mandatory before this lands (per CLAUDE.md standing instruction #4 — auth + session boundaries). The substantive concerns:

- **Session theft via Redis access.** Anyone with `redis-cli` access on the API host can read every active session JSON and impersonate any user. Same threat exists today for Postgres (`psql` access = full session table). Mitigation: Redis is bound to `127.0.0.1` only (see `docker-compose.yml` line 7); ops access is gated by SSH to the API host; no horizontal escalation from Redis to Postgres because the credentials are different.
- **Cache poisoning.** A pod with a stale or corrupted session in its in-process `Map` could serve a session that has been revoked elsewhere. Mitigation: the in-process `Map` is a single-pod hot-path cache; on every `get` it is checked against Redis (when Redis is up). On Redis-down we explicitly accept a brief revocation-staleness window in exchange for availability, and log every fall-back.
- **Rate-limit bypass via Redis-down.** When Redis is unreachable the limiter fails open by design (parity with the current Postgres fail-open). An attacker who can knock out Redis can therefore burst past the limit. Mitigation: Redis fail-open emits a P1 page; the attack window is bounded by ops response time; the upstream auth layer still authenticates every request.
- **No new secret material.** The Redis URL contains no credentials in the default `redis://redis:6379` form. If a future deployment uses an auth'd Redis (`redis://:password@host:port`), the URL becomes a secret and joins the standard secret-manager rotation.
- **No PII in cache.** A `UserSession` JSON contains `sessionId`, `userId`, `provider`, `verified` flag, timestamps, and an optional `did`. No biometric material, no commitment, no key material. Cache eviction is safe.

## Rollout sequencing

The rollout is two flag-flips with a soak between, not a big-bang switch:

1. **Land the code change with both flags default-`false`.** Behaviour identical to today. CI green on existing tests; new Redis tests run under `npm run test:redis` only.
2. **Flip `USE_REDIS_SESSIONS=true` in dev.** Soak for one week. Watch the new metrics. The dev environment is already configured for it (`docker-compose.yml` sets the env var; we just begin reading it).
3. **Flip `USE_REDIS_SESSIONS=true` in prod.** Soak for one week. The blue/green deploy test (forced kill of one pod mid-traffic) should land in the integration suite before this flip.
4. **Flip `USE_REDIS_RATELIMIT=true` in dev.** Soak one week.
5. **Flip `USE_REDIS_RATELIMIT=true` in prod.** Soak one week.
6. **Drop the `rate_limit_buckets` Postgres table.** Separate ADR-tracked migration once we are confident no rollback is needed.

Each flip has a one-line rollback (toggle the flag back). The old code paths stay in the binary across all soaks; the only durable change is dropping the Postgres rate-limit table at step 6.

## Test impact

- `tests/session-store.test.ts` — existing tests stay green (default flag is `false`). New file `tests/session-store-redis.test.ts` covers: write-through to Redis, read-through from Redis, fall-back to Postgres on Redis miss, fall-back to in-process map on Redis-down, cross-pod simulation (two store instances pointing at the same Redis).
- `tests/rate-limit.test.ts` — existing Postgres-bucket tests stay green (default flag is `false`). New file `tests/rate-limit-redis.test.ts` covers: `INCR` increments, `PEXPIRE NX` does not reset on subsequent increments, the 429 response shape is identical to the Postgres path, fall-back to Postgres bucket on Redis-down.
- `tests/redis-client.test.ts` — new. Smoke-tests the connection wrapper: connect, get, set, delete, disconnect, reconnect-after-loss.
- A new integration test `tests/multi-pod-session.test.ts` spawns two API instances against a shared Redis and asserts a session minted on instance A is verifiable on instance B.

The full test suite stays at the current 50/50 pass count behind the default flags; the new tests run only when the flags are flipped on (under `npm run test:redis` — a new package script).

## Migration path for existing deployments

The `zeroauth.dev` production deployment runs the prod compose profile, which already sets `USE_REDIS_SESSIONS=true` and `REDIS_URL=redis://redis:6379`. After this ADR ships:

1. Deploy the code change. Behaviour is unchanged at runtime because `USE_REDIS_SESSIONS=true` now actually does something.
2. Monitor the session-store metrics dashboard for one week — Redis hit rate, fall-back-to-Postgres count, fall-back-to-map count.
3. Flip `USE_REDIS_RATELIMIT=true` in the prod env. Monitor for one week — Redis bucket `INCR` count vs the previous Postgres bucket write count, 429 rate before / after.
4. After one quarter of stable Redis-only rate-limit operation, drop the `rate_limit_buckets` Postgres table in a separate ADR-tracked migration.

A customer running the API outside our docker compose (a self-hosted bank tenant in Phase 2+) gets a runbook entry: set `USE_REDIS_SESSIONS=false` and `USE_REDIS_RATELIMIT=false` if they cannot operate a Redis. The code paths support both modes indefinitely; we do not force Redis adoption on tenants who don't want it.

## Alternatives considered

- **Stay on Postgres for both, scale Postgres instead.** Vertical-scaling Postgres buys us another factor of 2–3 in write throughput. The rate-limit write rate at 500 RPS sustained is ~500 writes/sec just for the limiter — within Postgres's range but it competes with audit, user, verification writes. Cost: a bigger Postgres VPS. Rejected because the Redis container is already running and unused; the cheaper move is to use it.
- **Postgres for sessions, in-memory for rate-limit (the pre-C-10 design).** Rejected — re-opens audit finding C-10 (per-process limiter is trivially defeated by hashing requests across replicas).
- **Memcached instead of Redis.** Memcached has no persistence and no TTL-on-counter semantics as ergonomic as Redis's `EXPIRE NX`. We already have Redis provisioned. Rejected on infra-overlap grounds.
- **Add a sticky-session ingress (load balancer pins a user's IP to a pod).** Solves the session-coherency problem without Redis. Rejected because (a) it does not solve the rate-limit-across-replicas problem, (b) it makes blue/green deploys worse not better (existing sessions are pinned to draining pods), (c) it makes the pod-failure recovery story worse (the user's pod dies, their session disappears).
- **Use the existing `express-session` middleware with `connect-redis`.** That's the standard library route, but our session store is not a typical Express session (no cookie, no `req.session.foo` mutation pattern; it's an explicit minting service called from the verify handlers). Replacing the bespoke store with `connect-redis` would be a larger refactor than the proposed change, with no clear win.

## References

- `src/services/session-store.ts` — current implementation; the docstring at lines 4–33 explicitly flags scale-out as deferred.
- `src/middleware/rate-limit.ts` — current implementation; the docstring at lines 1–29 explicitly notes "once we scale out behind a load balancer the counters diverge" — and resolves that with Postgres, which this ADR proposes moving to Redis.
- `docker-compose.yml` — Redis service definition (lines 3–16) plus the `USE_REDIS_SESSIONS=true` / `REDIS_URL=redis://redis:6379` env vars on `zeroauth-dev` and `zeroauth-prod`.
- ADR 0000 — `ioredis` is grandfathered.
- ADR 0001 — `express-rate-limit` is in use today; this ADR does not remove it (it stays as the unauthenticated-route limiter; only the `pgRateLimit` middleware moves).
- ADR 0017 — set the precedent for the "optional infrastructure with degraded fall-back" pattern this ADR adopts for Redis.
- Audit finding C-10 (`docs/security/audit-findings.md`) — closed by the existing `pgRateLimit`; this ADR preserves the closure (the Redis variant satisfies the same cross-replica property).

## Open questions deferred

- **Redis persistence policy.** AOF is enabled in `docker-compose.yml` (`--appendonly yes`). For sessions this is fine; for rate-limit buckets it is wasted I/O. A Phase-2 commit can split the Redis instance into two logical DBs (DB 0 for sessions with AOF, DB 1 for rate-limit with no AOF) or move rate-limit to a second Redis container with `--save ""`.
- **Redis cluster / Sentinel for HA.** A single-instance Redis is a single point of failure for the hot path. The degraded fall-back to Postgres rescues us from total loss, but cache-cold cutover after a Redis restart costs every active session a re-login. Phase 2 if the pilot demands sub-second failover.
- **TLS to Redis.** The current compose binds Redis on `127.0.0.1:6379` (localhost only). Production posture is "Redis is on the same host as the API". When we split Redis off-host (Phase 2 multi-host) we need `tls://` URLs + `rediss://` support in `ioredis` — already supported, just unconfigured today.
- **Session revocation propagation.** A `delete` on pod A clears Redis immediately, but pod B's in-process `Map` could still hold the session for one more request. Currently the in-process `Map` is a TTL-checked cache; we can tighten this by making `get` always do a Redis round-trip in Redis mode (cost: one Redis hop per session-checked request, ~0.5 ms). Tracked for the implementation commit.

LAST_UPDATED: 2026-06-01
OWNER: Agent #22 (Mid DevOps — CI/CD + observability) + Agent #6 (Senior Backend — sessions + rate-limit)
