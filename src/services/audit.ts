/**
 * Audit-log hash chain (ADR 0013).
 *
 * Every row in `audit_events` is chained per-tenant: each row's
 * `event_hash` is `SHA-256(canonical_json(event_data) || previous_hash)`
 * where `previous_hash` is the prior row's `event_hash` for the same
 * (tenant_id, environment). The first row of a chain carries the
 * literal string `'genesis'` as its `previous_hash`.
 *
 * The chain construction has the following properties:
 *
 *   - **Append-only.** Mutating an existing row breaks the chain at
 *     that row and at every row after it. The integrity check at
 *     `/api/admin/audit-integrity` (C-014) replays the chain.
 *
 *   - **Per-tenant.** No global serialisation point. Two tenants
 *     writing concurrently do not contend on a single chain head.
 *
 *   - **Deterministic.** Canonical JSON serialisation per RFC 8785
 *     JCS — same input → same hash on any platform.
 *
 *   - **Replayable from a DB dump.** Verification does not require
 *     calling any ZeroAuth process. The bank's auditor can replay
 *     the chain against a Postgres backup + the published on-chain
 *     anchor (ADR 0014).
 *
 * Concurrency model: writes are serialised per (tenant_id, environment)
 * by an advisory lock — without it, two concurrent inserts could each
 * read the same `previous_hash` and write the same chain position,
 * leaving the chain forked. The advisory lock is the smallest such
 * unit that does not contend across tenants.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from './db';
import {
  emitVerificationEvent,
  isVerificationAction,
  type VerificationEventPayload,
} from './verification-events';

/**
 * The literal previous_hash for the first row of a tenant's chain.
 */
export const GENESIS_PREVIOUS_HASH = 'genesis';

/**
 * Fields that contribute to the event_hash. Anything not listed here
 * (e.g. `created_at` if it is server-clock-set, or `id` which is
 * server-side BIGSERIAL) is excluded so the hash is reproducible
 * client-side and immune to clock skew.
 */
export interface ChainedAuditPayload {
  tenant_id: string;
  environment: string | null;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  status: string;
  summary: string;
  metadata: Record<string, unknown>;
}

/**
 * Canonicalise an object per RFC 8785 (JCS). Implementation note:
 * RFC 8785 requires lexicographic key ordering at every nested level,
 * UTF-8 string escaping per RFC 8259, and JSON Number serialisation
 * per ES2017 number-to-string. JS `JSON.stringify` with sorted keys
 * meets the contract for the value types we actually use (strings,
 * numbers, booleans, null, plain objects, plain arrays).
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]))
      .join(',') +
    '}'
  );
}

/**
 * Compute the event_hash for a payload + previous_hash.
 */
export function computeEventHash(
  payload: ChainedAuditPayload,
  previousHash: string,
): string {
  const h = crypto.createHash('sha256');
  h.update(canonicalize(payload), 'utf8');
  h.update('|', 'utf8'); // domain separator between payload and previous_hash
  h.update(previousHash, 'utf8');
  return '0x' + h.digest('hex');
}

/**
 * Fetch the most recent event_hash for a (tenant, environment).
 * Returns GENESIS_PREVIOUS_HASH if no prior row exists.
 */
export async function fetchPreviousHash(
  client: PoolClient,
  tenantId: string,
  environment: string | null,
): Promise<string> {
  const result = await client.query<{ event_hash: string | null }>(
    `SELECT event_hash
       FROM audit_events
      WHERE tenant_id = $1 AND environment IS NOT DISTINCT FROM $2
        AND event_hash IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    [tenantId, environment],
  );
  return result.rows[0]?.event_hash ?? GENESIS_PREVIOUS_HASH;
}

/**
 * Append an audit event with hash-chain linkage.
 *
 * Uses a Postgres advisory lock keyed on (tenant_id) to serialise
 * writes within a single tenant's chain. Different tenants never
 * block each other. The lock is held only for the duration of the
 * fetch+insert pair, then released by transaction commit.
 *
 * The function is structured as a self-contained transaction so a
 * caller that fails to await it leaves the chain in a recoverable
 * state — the lock releases, the row either committed or didn't,
 * and the next call refetches the head.
 */
export async function appendAuditEvent(
  payload: ChainedAuditPayload,
): Promise<{ id: string; previousHash: string; eventHash: string }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Advisory lock keyed on tenant_id UUID; uses hashtext to fit into
    // the lock's int8 key space. Collisions across tenants are
    // possible but harmless — at worst two tenants briefly block each
    // other on contended writes.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
      payload.tenant_id,
    ]);

    const previousHash = await fetchPreviousHash(
      client,
      payload.tenant_id,
      payload.environment,
    );
    const eventHash = computeEventHash(payload, previousHash);

    const result = await client.query<{ id: string }>(
      `INSERT INTO audit_events
         (tenant_id, environment, actor_type, actor_id, action,
          entity_type, entity_id, status, summary, metadata,
          previous_hash, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id::text AS id`,
      [
        payload.tenant_id,
        payload.environment,
        payload.actor_type,
        payload.actor_id,
        payload.action,
        payload.entity_type,
        payload.entity_id,
        payload.status,
        payload.summary,
        JSON.stringify(payload.metadata),
        previousHash,
        eventHash,
      ],
    );

    await client.query('COMMIT');

    // ─── Verification-events fan-out ─────────────────────────────
    //
    // For verification-class actions (verification.recorded, the W3
    // verify_success/failure variants, the legacy auth.verify_*),
    // emit a live event on the per-tenant in-process emitter. The
    // dashboard's `/dashboard/tenant/verifications` view subscribes
    // through the `/api/console/verifications/stream` SSE route.
    //
    // The emit MUST happen AFTER the commit so a subscriber never
    // sees an event that did not also land in audit_events. The
    // emit is fire-and-forget — a bad listener does not propagate
    // back to the audit caller (see verification-events.ts).
    //
    // Multi-instance scale-out (a second API pod) requires a Redis
    // pub/sub backing to fan events out across processes; that's
    // tracked as the v2 roadmap item in verification-events.ts.
    if (isVerificationAction(payload.action)) {
      const meta = payload.metadata ?? {};
      const verificationPayload: VerificationEventPayload = {
        tenant_id: payload.tenant_id,
        audit_id: result.rows[0].id,
        environment: payload.environment === 'live' || payload.environment === 'test'
          ? payload.environment
          : null,
        action: payload.action,
        status: payload.status === 'failure' ? 'failure' : 'success',
        created_at: new Date().toISOString(),
        did: typeof meta.did === 'string' ? meta.did : null,
        latency_ms: typeof meta.latency_ms === 'number'
          ? meta.latency_ms
          : typeof meta.latencyMs === 'number'
            ? meta.latencyMs
            : null,
        proof_hash: typeof meta.proof_hash === 'string'
          ? meta.proof_hash
          : typeof meta.proofHash === 'string'
            ? meta.proofHash
            : null,
        reason: typeof meta.reason === 'string' ? meta.reason : null,
      };
      emitVerificationEvent(verificationPayload);
    }

    return { id: result.rows[0].id, previousHash, eventHash };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Replay a tenant's chain from `id = startId` to current head, asserting
 * each row's event_hash matches `SHA-256(canonical_json(payload) || previous_hash)`
 * and each row's `previous_hash` matches the prior row's `event_hash`.
 *
 * Returns the first broken row id, or `null` if the chain is intact.
 */
export async function verifyAuditChain(
  tenantId: string,
  environment: string | null,
  options: { startId?: string; limit?: number } = {},
): Promise<{ ok: true } | { ok: false; brokenAt: string; reason: string }> {
  const pool = getPool();
  const startId = options.startId ?? '0';
  const limit = options.limit ?? 100_000;

  const result = await pool.query<{
    id: string;
    tenant_id: string;
    environment: string | null;
    actor_type: string;
    actor_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    status: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    previous_hash: string | null;
    event_hash: string | null;
  }>(
    `SELECT id::text AS id, tenant_id, environment, actor_type, actor_id, action,
            entity_type, entity_id, status, summary, metadata,
            previous_hash, event_hash
       FROM audit_events
      WHERE tenant_id = $1 AND environment IS NOT DISTINCT FROM $2
        AND id::bigint >= $3::bigint
      ORDER BY id ASC
      LIMIT $4`,
    [tenantId, environment, startId, limit],
  );

  let expectedPreviousHash: string | null = null;
  let chainStarted = false;

  for (const row of result.rows) {
    // A NULL-hash row is only legitimate as a LEADING legacy row that
    // predates the hash chain (ADR 0013 / the C-121 backfill window). A
    // NULL appearing AFTER the chain has started means the hashes were
    // cleared to hide a mutation — fail CLOSED (AL-1). The prior
    // skip-and-restart let an attacker tamper with a row's content and
    // then NULL its two hash columns to make verification silently
    // resume from the next row, hiding the break.
    if (row.previous_hash === null || row.event_hash === null) {
      if (chainStarted) {
        return {
          ok: false,
          brokenAt: row.id,
          reason: 'null_hash_after_chain_start: audit row hashes cleared (tamper or corruption)',
        };
      }
      continue;
    }
    chainStarted = true;
    if (expectedPreviousHash !== null && row.previous_hash !== expectedPreviousHash) {
      return {
        ok: false,
        brokenAt: row.id,
        reason: `previous_hash mismatch: row says ${row.previous_hash}, expected ${expectedPreviousHash}`,
      };
    }
    const payload: ChainedAuditPayload = {
      tenant_id: row.tenant_id,
      environment: row.environment,
      actor_type: row.actor_type,
      actor_id: row.actor_id,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      status: row.status,
      summary: row.summary,
      metadata: row.metadata ?? {},
    };
    const recomputed = computeEventHash(payload, row.previous_hash);
    if (recomputed !== row.event_hash) {
      return {
        ok: false,
        brokenAt: row.id,
        reason: `event_hash mismatch: row says ${row.event_hash}, recomputed ${recomputed}`,
      };
    }
    expectedPreviousHash = row.event_hash;
  }

  return { ok: true };
}
