import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

/**
 * Verifier-local append-only audit log with hash chain (B02 design doc §4.3).
 *
 * Independent from the API's Postgres `audit_events` table. The point of
 * having BOTH is defense in depth: if the Postgres audit log is rewritten
 * (root-level DB compromise), the verifier's local SQLite copy is a
 * tamper-evident replica an auditor can reconcile against.
 *
 * Append-only is enforced two ways:
 *   1. SQL triggers blocking UPDATE + DELETE (the SQLite engine itself
 *      refuses the write)
 *   2. The hash chain — any row tampered after the fact will fail
 *      verifyChain() because its computed entry_hash won't match what's
 *      stored, AND every subsequent row's prev_hash points at the
 *      compromised row's stored entry_hash
 *
 * Hash chain construction per design doc §5:
 *   entry_hash = sha256(canonical_serialize(entry_without_entry_hash) || prev_hash)
 *
 * Canonical serialization: JSON with sorted keys, no whitespace, UTF-8.
 * Same input always produces the same hash — that's the load-bearing
 * property for chain verification.
 */

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verifier_events (
  id                TEXT PRIMARY KEY,         -- UUID v4
  sequence          INTEGER NOT NULL,         -- monotonic, starts at 0 (genesis)
  tenant_id         TEXT NOT NULL,            -- 'system' for the genesis row
  environment       TEXT NOT NULL,            -- 'live' | 'test' | 'system'
  circuit_version   TEXT NOT NULL,            -- 'v1', 'v2', ...
  correlation_id    TEXT NOT NULL,            -- traces back to caller's request
  verified          INTEGER NOT NULL,         -- 0 | 1
  structural_fallback INTEGER NOT NULL,       -- 0 | 1 (true when no vkey was loaded)
  proof_hash        TEXT NOT NULL,            -- sha256 of canonical(proof) — full proof never stored
  pub_signals_hash  TEXT NOT NULL,            -- sha256 of canonical(public_signals)
  latency_us        INTEGER NOT NULL,
  created_at        TEXT NOT NULL,            -- ISO 8601 UTC
  prev_hash         TEXT NOT NULL,            -- chain pointer; 64 hex chars
  entry_hash        TEXT NOT NULL UNIQUE      -- sha256(canonical(row excl entry_hash) || prev_hash)
);

CREATE INDEX IF NOT EXISTS idx_verifier_events_tenant_env_created
  ON verifier_events (tenant_id, environment, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_verifier_events_sequence
  ON verifier_events (sequence);

-- Append-only triggers. Once a row is written, it cannot be modified or
-- deleted via the SQLite engine. A direct file write could still tamper,
-- but the hash chain catches that on the next verifyChain() run.
CREATE TRIGGER IF NOT EXISTS verifier_events_no_update
  BEFORE UPDATE ON verifier_events
  BEGIN SELECT RAISE(ABORT, 'verifier_events is append-only — UPDATE refused'); END;

CREATE TRIGGER IF NOT EXISTS verifier_events_no_delete
  BEFORE DELETE ON verifier_events
  BEGIN SELECT RAISE(ABORT, 'verifier_events is append-only — DELETE refused'); END;
`;

const GENESIS_PREV_HASH = '0'.repeat(64);

let db: Database.Database | null = null;
let nextSequence = 0;
let lastEntryHash = GENESIS_PREV_HASH;

export interface AuditAppendInput {
  tenantId: string;
  environment: 'live' | 'test';
  circuitVersion: string;
  correlationId: string;
  verified: boolean;
  structuralFallback: boolean;
  proofHash: string;
  pubSignalsHash: string;
  latencyUs: number;
}

export interface AuditRow {
  id: string;
  sequence: number;
  tenant_id: string;
  environment: string;
  circuit_version: string;
  correlation_id: string;
  verified: number;
  structural_fallback: number;
  proof_hash: string;
  pub_signals_hash: string;
  latency_us: number;
  created_at: string;
  prev_hash: string;
  entry_hash: string;
}

/**
 * Initialize the audit log database. Idempotent — safe to call multiple
 * times. Creates the file + schema + genesis row on first run.
 *
 * `dbPath` is the path to the SQLite file. In production this lives on
 * a docker volume so it survives container restarts. In dev it lives
 * under `verifier/data/` (gitignored). In tests we pass `:memory:`.
 */
export function initAuditLog(dbPath: string): void {
  if (db) {
    logger.warn('Audit log: already initialized, ignoring re-init', { dbPath });
    return;
  }

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  db = new Database(dbPath);
  db.exec(SCHEMA);

  const row = db.prepare('SELECT COUNT(*) AS count, MAX(sequence) AS max_seq FROM verifier_events').get() as {
    count: number;
    max_seq: number | null;
  };

  if (row.count === 0) {
    insertGenesisRow();
  } else {
    nextSequence = (row.max_seq ?? -1) + 1;
    const lastRow = db.prepare(
      'SELECT entry_hash FROM verifier_events ORDER BY sequence DESC LIMIT 1',
    ).get() as { entry_hash: string } | undefined;
    lastEntryHash = lastRow?.entry_hash ?? GENESIS_PREV_HASH;
  }

  logger.info('Audit log: initialized', {
    dbPath,
    rowCount: row.count,
    nextSequence,
    lastEntryHashPrefix: lastEntryHash.slice(0, 16),
  });
}

function insertGenesisRow(): void {
  if (!db) throw new Error('Audit log: not initialized');

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const partialRow = {
    id,
    sequence: 0,
    tenant_id: 'system',
    environment: 'system',
    circuit_version: 'genesis',
    correlation_id: id,
    verified: 1,
    structural_fallback: 0,
    proof_hash: GENESIS_PREV_HASH,
    pub_signals_hash: GENESIS_PREV_HASH,
    latency_us: 0,
    created_at: createdAt,
    prev_hash: GENESIS_PREV_HASH,
  };
  const entryHash = computeEntryHash(partialRow, GENESIS_PREV_HASH);
  insertRow({ ...partialRow, entry_hash: entryHash });
  nextSequence = 1;
  lastEntryHash = entryHash;
  logger.info('Audit log: genesis row written', { id, entryHash });
}

/**
 * Append a verification event. Returns the row id (== verifierAuditId
 * surfaced to callers).
 */
export function appendEvent(input: AuditAppendInput): string {
  if (!db) throw new Error('Audit log: not initialized');

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const partialRow = {
    id,
    sequence: nextSequence,
    tenant_id: input.tenantId,
    environment: input.environment,
    circuit_version: input.circuitVersion,
    correlation_id: input.correlationId,
    verified: input.verified ? 1 : 0,
    structural_fallback: input.structuralFallback ? 1 : 0,
    proof_hash: input.proofHash,
    pub_signals_hash: input.pubSignalsHash,
    latency_us: input.latencyUs,
    created_at: createdAt,
    prev_hash: lastEntryHash,
  };
  const entryHash = computeEntryHash(partialRow, lastEntryHash);
  insertRow({ ...partialRow, entry_hash: entryHash });
  nextSequence += 1;
  lastEntryHash = entryHash;
  return id;
}

function insertRow(row: AuditRow): void {
  if (!db) throw new Error('Audit log: not initialized');
  const stmt = db.prepare(`
    INSERT INTO verifier_events
      (id, sequence, tenant_id, environment, circuit_version, correlation_id,
       verified, structural_fallback, proof_hash, pub_signals_hash, latency_us,
       created_at, prev_hash, entry_hash)
    VALUES
      (@id, @sequence, @tenant_id, @environment, @circuit_version, @correlation_id,
       @verified, @structural_fallback, @proof_hash, @pub_signals_hash, @latency_us,
       @created_at, @prev_hash, @entry_hash)
  `);
  stmt.run(row);
}

/**
 * Canonical serialization for hash-chain input. JSON with sorted keys,
 * no whitespace, UTF-8. Excludes entry_hash itself (that's what we're
 * computing). Then we concatenate with prev_hash.
 *
 * The same row must always produce the same string. If serialization
 * changes (even whitespace), the chain breaks. Don't touch this without
 * a migration plan.
 */
function canonicalSerialize(row: Omit<AuditRow, 'entry_hash'>): string {
  const sortedKeys = Object.keys(row).sort() as Array<keyof typeof row>;
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sorted[k] = row[k];
  }
  return JSON.stringify(sorted);
}

function computeEntryHash(row: Omit<AuditRow, 'entry_hash'>, prevHash: string): string {
  const canonical = canonicalSerialize(row);
  return createHash('sha256').update(canonical + prevHash).digest('hex');
}

export interface ChainVerificationResult {
  ok: boolean;
  rowsChecked: number;
  firstBadSequence?: number;
  firstBadReason?: string;
}

/**
 * Walk the chain from sequence 0 and verify each row's entry_hash matches
 * a recomputation from (canonical(row_without_entry_hash) || prev_hash),
 * AND each row's prev_hash matches the previous row's stored entry_hash.
 *
 * O(N) over the whole table. Acceptable for periodic audit runs (daily
 * cron / pre-evidence-pack-publish); not for every request. Surfaces the
 * first failing sequence so operators can investigate.
 */
export function verifyChain(): ChainVerificationResult {
  if (!db) throw new Error('Audit log: not initialized');

  const rows = db.prepare(
    'SELECT * FROM verifier_events ORDER BY sequence ASC',
  ).all() as AuditRow[];

  let prevHash = GENESIS_PREV_HASH;
  let checked = 0;

  for (const row of rows) {
    if (row.prev_hash !== prevHash) {
      return {
        ok: false,
        rowsChecked: checked,
        firstBadSequence: row.sequence,
        firstBadReason: `prev_hash mismatch: row claims prev=${row.prev_hash.slice(0, 12)} but chain has prev=${prevHash.slice(0, 12)}`,
      };
    }

    const { entry_hash: stored, ...rest } = row;
    const computed = computeEntryHash(rest, prevHash);
    if (computed !== stored) {
      return {
        ok: false,
        rowsChecked: checked,
        firstBadSequence: row.sequence,
        firstBadReason: `entry_hash mismatch: stored=${stored.slice(0, 12)} computed=${computed.slice(0, 12)}`,
      };
    }

    prevHash = stored;
    checked += 1;
  }

  return { ok: true, rowsChecked: checked };
}

/**
 * Test helpers / introspection. Not for production code paths.
 */
export function _getDatabaseForTests(): Database.Database | null {
  return db;
}

export function _resetForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
  nextSequence = 0;
  lastEntryHash = GENESIS_PREV_HASH;
}

export function getStats(): { rowCount: number; nextSequence: number; lastEntryHashPrefix: string } {
  if (!db) {
    return { rowCount: 0, nextSequence: 0, lastEntryHashPrefix: '' };
  }
  const row = db.prepare('SELECT COUNT(*) AS count FROM verifier_events').get() as { count: number };
  return {
    rowCount: row.count,
    nextSequence,
    lastEntryHashPrefix: lastEntryHash.slice(0, 16),
  };
}

/**
 * Hash a proof or public-signals payload for storage. We never store the
 * full proof in the audit log — just its SHA-256. That's enough to prove
 * "this exact proof was verified at this time" without bloating the table
 * (proofs are ~1KB each; multiplied by millions of verifications = real
 * storage).
 */
export function hashPayload(payload: unknown): string {
  const canonical = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHash('sha256').update(canonical).digest('hex');
}
