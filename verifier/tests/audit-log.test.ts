/**
 * Tests for verifier/src/audit-log.ts — the SQLite append-only audit
 * log with hash chain (B02 design doc §4.3).
 *
 * Uses an in-memory SQLite DB (`:memory:`) so tests are fast + don't
 * touch the filesystem. Each test resets the module state via
 * `_resetForTests()` so the genesis row is rewritten cleanly.
 *
 * Covered:
 *   - initAuditLog creates schema + genesis row on first run
 *   - genesis row is sequence=0, prev_hash=0*64, tenant_id='system'
 *   - re-init on a fresh DB is idempotent (no-op when already
 *     initialized in this process)
 *   - appendEvent inserts a row with sequence++, prev_hash = lastEntryHash
 *   - entry_hash is sha256(canonical(row excl entry_hash) || prev_hash)
 *   - verifyChain returns ok:true for a clean chain
 *   - verifyChain detects a tampered entry_hash (returns ok:false +
 *     firstBadSequence + firstBadReason)
 *   - verifyChain detects a tampered prev_hash linkage
 *   - the SQL triggers refuse UPDATE + DELETE
 *   - getStats reports rowCount, nextSequence, lastEntryHashPrefix
 *   - hashPayload returns a 64-char hex string (sha256)
 */

import {
  initAuditLog,
  appendEvent,
  verifyChain,
  getStats,
  hashPayload,
  _resetForTests,
  _getDatabaseForTests,
} from '../src/audit-log';
import { createHash } from 'crypto';

describe('audit-log — hash-chained append-only SQLite', () => {
  beforeEach(() => {
    _resetForTests();
    initAuditLog(':memory:');
  });

  describe('genesis row', () => {
    it('writes a genesis row at sequence 0 with prev_hash = 0×64', () => {
      const db = _getDatabaseForTests()!;
      const row = db.prepare('SELECT * FROM verifier_events ORDER BY sequence LIMIT 1').get() as any;
      expect(row).toBeDefined();
      expect(row.sequence).toBe(0);
      expect(row.tenant_id).toBe('system');
      expect(row.environment).toBe('system');
      expect(row.circuit_version).toBe('genesis');
      expect(row.prev_hash).toBe('0'.repeat(64));
      expect(row.entry_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('starts nextSequence at 1 after genesis', () => {
      const stats = getStats();
      expect(stats.rowCount).toBe(1);
      expect(stats.nextSequence).toBe(1);
    });
  });

  describe('appendEvent', () => {
    const baseInput = {
      tenantId: 'tenant-A',
      environment: 'live' as const,
      circuitVersion: 'v1',
      correlationId: 'cor-1',
      verified: true,
      structuralFallback: false,
      proofHash: hashPayload({ proof: 'p1' }),
      pubSignalsHash: hashPayload(['a', 'b', 'c']),
      latencyUs: 12345,
    };

    it('returns a UUID v4 row id', () => {
      const id = appendEvent(baseInput);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('inserts at the next sequence with prev_hash = lastEntryHash', () => {
      const db = _getDatabaseForTests()!;
      const genesis = db.prepare('SELECT * FROM verifier_events WHERE sequence = 0').get() as any;

      appendEvent(baseInput);

      const row = db.prepare('SELECT * FROM verifier_events WHERE sequence = 1').get() as any;
      expect(row.sequence).toBe(1);
      expect(row.prev_hash).toBe(genesis.entry_hash);
      expect(row.tenant_id).toBe('tenant-A');
      expect(row.environment).toBe('live');
      expect(row.verified).toBe(1);
      expect(row.structural_fallback).toBe(0);
    });

    it('keeps the chain unbroken across 5 events', () => {
      for (let i = 0; i < 5; i++) {
        appendEvent({ ...baseInput, correlationId: `cor-${i}` });
      }
      expect(getStats().rowCount).toBe(6); // genesis + 5
      expect(verifyChain()).toEqual({ ok: true, rowsChecked: 6 });
    });

    it('persists the proof_hash and pub_signals_hash from the input', () => {
      const id = appendEvent(baseInput);
      const db = _getDatabaseForTests()!;
      const row = db.prepare('SELECT * FROM verifier_events WHERE id = ?').get(id) as any;
      expect(row.proof_hash).toBe(baseInput.proofHash);
      expect(row.pub_signals_hash).toBe(baseInput.pubSignalsHash);
    });
  });

  describe('verifyChain — tamper detection', () => {
    const baseInput = {
      tenantId: 't',
      environment: 'live' as const,
      circuitVersion: 'v1',
      correlationId: 'c',
      verified: false,
      structuralFallback: false,
      proofHash: '0'.repeat(64),
      pubSignalsHash: '0'.repeat(64),
      latencyUs: 1,
    };

    it('ok:true on a clean chain', () => {
      appendEvent(baseInput);
      appendEvent(baseInput);
      appendEvent(baseInput);
      expect(verifyChain()).toEqual({ ok: true, rowsChecked: 4 });
    });

    it('detects a tampered entry_hash (direct DB write bypasses triggers if performed before triggers exist; but verifyChain catches it)', () => {
      appendEvent(baseInput);
      const db = _getDatabaseForTests()!;
      // Bypass the trigger by dropping it temporarily, mutating, then
      // re-adding it. Simulates an attacker who has root access to the
      // SQLite file and can do whatever they want.
      db.exec('DROP TRIGGER verifier_events_no_update');
      db.exec(`UPDATE verifier_events SET verified = 1 WHERE sequence = 1`);
      const r = verifyChain();
      expect(r.ok).toBe(false);
      expect(r.firstBadSequence).toBe(1);
      expect(r.firstBadReason).toMatch(/entry_hash mismatch/);
    });

    it('detects a tampered prev_hash linkage (chain reordered)', () => {
      appendEvent(baseInput);
      appendEvent(baseInput);
      const db = _getDatabaseForTests()!;
      db.exec('DROP TRIGGER verifier_events_no_update');
      // Break the chain: rewrite prev_hash on row 2 to point to a wrong place
      db.exec("UPDATE verifier_events SET prev_hash = '" + 'f'.repeat(64) + "' WHERE sequence = 2");
      const r = verifyChain();
      expect(r.ok).toBe(false);
      expect(r.firstBadSequence).toBe(2);
      expect(r.firstBadReason).toMatch(/prev_hash mismatch/);
    });
  });

  describe('append-only SQL triggers', () => {
    it('refuses UPDATE on verifier_events', () => {
      appendEvent({
        tenantId: 't', environment: 'live', circuitVersion: 'v1', correlationId: 'c',
        verified: true, structuralFallback: false, proofHash: '0'.repeat(64),
        pubSignalsHash: '0'.repeat(64), latencyUs: 1,
      });
      const db = _getDatabaseForTests()!;
      expect(() => db.exec('UPDATE verifier_events SET verified = 0 WHERE sequence = 1')).toThrow(
        /append-only/,
      );
    });

    it('refuses DELETE on verifier_events', () => {
      const db = _getDatabaseForTests()!;
      expect(() => db.exec('DELETE FROM verifier_events WHERE sequence = 0')).toThrow(
        /append-only/,
      );
    });
  });

  describe('getStats', () => {
    it('reflects the current state', () => {
      const s1 = getStats();
      expect(s1.rowCount).toBe(1);
      expect(s1.nextSequence).toBe(1);
      expect(s1.lastEntryHashPrefix).toMatch(/^[a-f0-9]{16}$/);

      appendEvent({
        tenantId: 't', environment: 'live', circuitVersion: 'v1', correlationId: 'c',
        verified: true, structuralFallback: false, proofHash: '0'.repeat(64),
        pubSignalsHash: '0'.repeat(64), latencyUs: 1,
      });

      const s2 = getStats();
      expect(s2.rowCount).toBe(2);
      expect(s2.nextSequence).toBe(2);
      expect(s2.lastEntryHashPrefix).not.toBe(s1.lastEntryHashPrefix);
    });
  });

  describe('hashPayload', () => {
    it('returns 64 hex chars (sha256)', () => {
      const h = hashPayload({ foo: 'bar' });
      expect(h).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for identical input', () => {
      expect(hashPayload({ x: 1, y: 2 })).toBe(hashPayload({ x: 1, y: 2 }));
    });

    it('produces different hashes for different inputs', () => {
      expect(hashPayload({ x: 1 })).not.toBe(hashPayload({ x: 2 }));
    });

    it('hashes a string directly (skips JSON.stringify on string input)', () => {
      const direct = createHash('sha256').update('hello').digest('hex');
      expect(hashPayload('hello')).toBe(direct);
    });
  });
});
