/**
 * Daily on-chain anchor job for the audit-event hash chain (ADR 0014).
 *
 * Phase 0 commit C-015 — the OFF-CHAIN half. The on-chain contract
 * surface (`contracts/AuditAnchor.sol`, C-016, commit d6c6a4e) is the
 * write target; this service computes the daily terminal hash per
 * tenant and STAGES a transaction object the signer can broadcast.
 *
 * The signer wallet (and Base Sepolia RPC keys) live outside the API
 * container — see ADR 0014 § "Failure recovery". This module therefore
 * stops at building `{to, data, value: 0}` and a `recordAnchor` call
 * encoding; the actual `sendTransaction` happens in a separate worker
 * holding the chain-of-custody-controlled key.
 *
 * High-level flow for `runDailyAnchorJob`:
 *
 *   1. Enumerate active tenants (`SELECT id FROM tenants WHERE status='active'`).
 *   2. For each (tenant × environment ∈ {live, test}):
 *      a. `computeDailyAnchorPayload` → terminal hash + row count for the
 *         (tenant, env, dayUtc) window.
 *      b. Skip if no rows that day.
 *      c. Skip if `audit_anchors` already has a row for that key (idempotent
 *         restarts; ADR 0014 anchor-key uniqueness is mirrored on chain).
 *      d. Encode `recordAnchor(bytes32, uint64, bytes32, uint64)` call data.
 *      e. Append a self-audit row (`action='audit.anchor.staged'`) so the
 *         anchor process itself is logged into the chain it anchors —
 *         this row will be picked up by the NEXT day's anchor and so on.
 *
 * The job never blocks audit writes. Failure paths return errors in the
 * report rather than throwing, so a single tenant's RPC blip cannot stop
 * the others from anchoring.
 */

import { ethers } from 'ethers';
import { getPool } from './db';
import { appendAuditEvent } from './audit';
import { logger } from './logger';
import { resolveProviders } from './tenant-providers';
import type { TenantSecurityPolicy } from '../types';

/**
 * ABI fragment for the contract method we stage. Mirrors the signature
 * in `contracts/AuditAnchor.sol` (commit d6c6a4e):
 *
 *     function recordAnchor(bytes32, uint64, bytes32, uint64) external onlyOwner;
 *
 * Kept hand-rolled (not imported from a Hardhat artefact) so this
 * service has zero build-time dependency on the contracts/ folder —
 * the off-chain surface needs only the four-arg signature to encode
 * call data.
 */
export const AUDIT_ANCHOR_ABI = [
  'function recordAnchor(bytes32 tenantIdHash, uint64 dayUtc, bytes32 terminalHash, uint64 rowCountAtAnchor)',
] as const;

const auditAnchorInterface = new ethers.Interface(AUDIT_ANCHOR_ABI);

/**
 * The computed-for-a-day payload, before encoding. `tenantIdHash` is
 * `keccak256("<tenantId>:<environment ?? ''>")`. `dayUtc` is YYYYMMDD
 * as a `bigint` so it round-trips through ethers without lossy Number
 * coercion (it fits in uint53 but the contract types it uint64).
 */
export interface AnchorPayload {
  tenantId: string;
  tenantIdHash: string;
  dayUtc: bigint;
  terminalHash: string;
  rowCountAtAnchor: bigint;
}

/**
 * Staged transaction ready for an external signer. The signer adds
 * `from`, `nonce`, gas params, signs, and broadcasts. `to` is the
 * `AuditAnchor` contract address resolved from
 * `contracts/deployed-addresses.json` at signer-startup time, not
 * baked in here — keeps the off-chain service deployable to any env.
 */
export interface AnchorTx {
  tenantId: string;
  environment: 'live' | 'test' | null;
  dayUtc: bigint;
  payload: AnchorPayload;
  /** `0x`-prefixed hex encoding of the `recordAnchor(...)` call. */
  data: string;
  /** Always 0 — `recordAnchor` is non-payable. */
  value: 0;
}

/**
 * Per-run report consumed by the cron supervisor. `staged` is the list
 * of transactions the signer must broadcast; `errors` collects per-
 * tenant failures so a single bad row can't blackhole the rest.
 */
export interface AnchorJobReport {
  dayUtc: Date;
  tenantsScanned: number;
  tenantsToAnchor: number;
  staged: AnchorTx[];
  errors: { tenantId: string; environment: 'live' | 'test' | null; error: string }[];
}

/**
 * The two environments we sweep on each run. `null` (= environment-
 * agnostic audit rows) is NOT included here — those rows always belong
 * to a tenant + the platform actor, and the test env's anchor sweep
 * covers operator-scoped rows during the demo cadence.
 */
const ENVIRONMENTS: ('live' | 'test')[] = ['live', 'test'];

/**
 * Convert a `Date` to a UTC YYYYMMDD integer.
 *
 * The choice of YYYYMMDD (vs. epoch days) matches ADR 0014 and the
 * AuditAnchor contract `dayUtc uint64` field, where it lets a human
 * read the anchor key on Basescan without a date library. The Date is
 * interpreted in UTC; the caller is responsible for picking a midnight
 * boundary they want anchored.
 */
export function dayUtcAsYYYYMMDD(d: Date): bigint {
  const yyyy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  return BigInt(yyyy * 10000 + mm * 100 + dd);
}

/**
 * Return a `Date` whose UTC components are "today at 00:00:00.000"
 * relative to the input. Used to normalise the window boundary before
 * passing it to the query — Postgres `created_at >= $3::date` casts
 * the timestamp to a `date` discarding sub-day precision, but we keep
 * the floor here so the YYYYMMDD encoding matches the SQL window.
 */
function floorToUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The yesterday-UTC default for `runDailyAnchorJob`. At 00:30 IST
 * (19:00 UTC the day before per ADR 0014) "yesterday in UTC" is the
 * 24 h block that just closed.
 */
function yesterdayUtc(): Date {
  const now = new Date();
  const utcMidnight = floorToUtcMidnight(now);
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() - 1);
  return utcMidnight;
}

/**
 * Build the canonical `tenantIdHash` for a (tenantId, environment)
 * pair. ADR 0014 specifies `keccak256(tenant_id || environment)`; we
 * use `:` as a domain separator to make it unambiguous when the env
 * is the empty string (a `null` environment in the DB).
 */
export function computeTenantIdHash(tenantId: string, environment: 'live' | 'test' | null): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`${tenantId}:${environment ?? ''}`));
}

/**
 * Compute the daily anchor payload for one (tenant, environment, day)
 * triple. Returns `null` if there are no events in the window — that
 * day simply isn't anchored (ADR 0014: only anchor days with activity).
 *
 * The query is intentionally written with `IS NOT DISTINCT FROM` so a
 * `null` environment compares to a `null` column value (regular `=`
 * would return NULL and exclude the row).
 *
 * The terminal hash is the `event_hash` of the *last* row in the day's
 * window — i.e. the chain head as of midnight-the-next-day. Anyone
 * replaying the chain from genesis through that row gets the same
 * hash; the anchor proves "this chain existed and ended HERE on day
 * D" without exposing any of the underlying rows.
 */
export async function computeDailyAnchorPayload(
  tenantId: string,
  environment: 'live' | 'test' | null,
  dayUtc: Date,
): Promise<AnchorPayload | null> {
  const pool = getPool();
  const day = floorToUtcMidnight(dayUtc);
  const result = await pool.query<{ event_hash: string | null; total: string }>(
    `SELECT event_hash, total
       FROM (
         SELECT event_hash,
                COUNT(*) OVER () AS total,
                ROW_NUMBER() OVER (ORDER BY id DESC) AS rn
           FROM audit_events
          WHERE tenant_id = $1
            AND environment IS NOT DISTINCT FROM $2
            AND created_at >= $3::date
            AND created_at < ($3::date + '1 day'::interval)
       ) t
      WHERE rn = 1`,
    [tenantId, environment, day],
  );

  if (result.rows.length === 0) {
    return null;
  }
  const row = result.rows[0];
  if (!row.event_hash) {
    // Defensive: a row exists but the hash columns are NULL — this
    // happens during the ADR 0013 backfill window. Skip rather than
    // anchor a null.
    return null;
  }

  return {
    tenantId,
    tenantIdHash: computeTenantIdHash(tenantId, environment),
    dayUtc: dayUtcAsYYYYMMDD(day),
    terminalHash: row.event_hash,
    rowCountAtAnchor: BigInt(row.total),
  };
}

/**
 * Encode the `recordAnchor` call for a payload. Exported so the
 * test layer can assert the encoded bytes against a known-good
 * vector instead of round-tripping through the job harness.
 *
 * The `terminalHash` is already `0x`-prefixed (it comes from
 * `crypto.createHash('sha256')` in `src/services/audit.ts`), so the
 * AbiCoder accepts it as `bytes32` directly.
 */
export function encodeRecordAnchorCall(payload: AnchorPayload): string {
  return auditAnchorInterface.encodeFunctionData('recordAnchor', [
    payload.tenantIdHash,
    payload.dayUtc,
    payload.terminalHash,
    payload.rowCountAtAnchor,
  ]);
}

/**
 * Has this (tenant, env, day) been anchored before? Used to make the
 * job idempotent: a cron that fires twice on the same calendar day
 * (e.g. after a restart) must not stage a second tx for the same key
 * — the contract would revert with `AlreadyAnchored`, but we catch it
 * here so the staged report is clean.
 */
async function hasExistingAnchor(
  tenantId: string,
  environment: 'live' | 'test' | null,
  dayUtc: Date,
): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM audit_anchors
        WHERE tenant_id = $1
          AND environment IS NOT DISTINCT FROM $2
          AND day_utc = $3::date
     ) AS exists`,
    [tenantId, environment, floorToUtcMidnight(dayUtc)],
  );
  return result.rows[0]?.exists ?? false;
}

/**
 * Run the daily anchor job once. The DEFAULT day is yesterday-in-UTC,
 * matching the ADR 0014 cadence (00:30 IST = 19:00 UTC prior day; we
 * close the 24 h block that just ended).
 *
 * The function does NOT call `sendTransaction`. The returned report
 * lists the staged tx objects; the signer worker reads them, applies
 * gas + nonce, broadcasts, and on success writes the `tx_hash` +
 * `block_number` into the `audit_anchors` row inserted by C-015's
 * Phase 1 follow-on (the broadcaster commit; not in scope here).
 */
export async function runDailyAnchorJob(dayUtc?: Date): Promise<AnchorJobReport> {
  const day = floorToUtcMidnight(dayUtc ?? yesterdayUtc());
  const pool = getPool();

  // ADR 0017 — load security_policy alongside the id so we can skip
  // tenants whose resolved `audit_anchor_provider` is `none`. Default
  // tenants (the platform default) never reach the on-chain anchor
  // path; the hash chain itself is the tamper-evidence primitive and
  // does not need a chain anchor to be auditable.
  const tenantsResult = await pool.query<{
    id: string;
    security_policy: TenantSecurityPolicy | null;
  }>(
    `SELECT id, security_policy FROM tenants WHERE status = 'active'`,
  );
  const tenants = tenantsResult.rows;

  const staged: AnchorTx[] = [];
  const errors: AnchorJobReport['errors'] = [];

  for (const { id: tenantId, security_policy } of tenants) {
    const providers = resolveProviders(security_policy);
    if (providers.auditAnchorProvider === 'none') {
      // Default + signed-transcript-only tenants are NOT anchored on
      // chain. (Signed-transcript shows up here only when its provider
      // value lands; today the resolver maps it to a non-'none' value
      // and a future commit teaches this loop how to stage the signed
      // transcript instead of a chain tx.) For 'none', skip outright.
      logger.debug('anchor-job: skipping tenant with audit_anchor_provider=none', {
        tenantId,
      });
      continue;
    }
    for (const environment of ENVIRONMENTS) {
      try {
        const payload = await computeDailyAnchorPayload(tenantId, environment, day);
        if (!payload) {
          continue;
        }

        const alreadyAnchored = await hasExistingAnchor(tenantId, environment, day);
        if (alreadyAnchored) {
          continue;
        }

        const data = encodeRecordAnchorCall(payload);
        staged.push({
          tenantId,
          environment,
          dayUtc: payload.dayUtc,
          payload,
          data,
          value: 0,
        });

        // Self-audit row: every staged anchor leaves a footprint inside
        // the chain it just summarised. The NEXT day's anchor will then
        // include this row in its terminal hash, giving us a recursive
        // "the anchor process ran and we know when" property.
        await appendAuditEvent({
          tenant_id: tenantId,
          environment,
          actor_type: 'system',
          actor_id: 'anchor-job',
          action: 'audit.anchor.staged',
          entity_type: 'audit_anchor',
          entity_id: `${tenantId}:${environment}:${payload.dayUtc.toString()}`,
          status: 'success',
          summary: `Staged daily anchor for ${day.toISOString().slice(0, 10)}`,
          metadata: {
            day_utc: payload.dayUtc.toString(),
            terminal_hash: payload.terminalHash,
            row_count: payload.rowCountAtAnchor.toString(),
            tx_data: data,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('anchor-job: tenant failed', {
          tenantId,
          environment,
          day: day.toISOString().slice(0, 10),
          error: message,
        });
        errors.push({ tenantId, environment, error: message });
      }
    }
  }

  return {
    dayUtc: day,
    tenantsScanned: tenants.length,
    tenantsToAnchor: staged.length,
    staged,
    errors,
  };
}
