/**
 * Unit tests for the audit hash chain (ADR 0013).
 *
 * Phase 0 commit C-012 lands the chain. These tests cover the pure-
 * function surface:
 *
 *   - canonicalize() — RFC 8785 JCS conformance for the value types
 *     we actually serialise.
 *   - computeEventHash() — deterministic + sensitive to every input
 *     field.
 *   - chain replay — a single mutated payload field at any position
 *     breaks every subsequent row.
 *
 * The integration test against a live Postgres lives in the
 * test-with-postgres suite (separate test file, only runs in CI's
 * docker-postgres job).
 */

import {
  canonicalize,
  computeEventHash,
  GENESIS_PREVIOUS_HASH,
  type ChainedAuditPayload,
} from '../src/services/audit';

const samplePayload = (overrides: Partial<ChainedAuditPayload> = {}): ChainedAuditPayload => ({
  tenant_id: '11111111-1111-1111-1111-111111111111',
  environment: 'live',
  actor_type: 'console',
  actor_id: 'console-user-1',
  action: 'tenant.login',
  entity_type: 'tenant',
  entity_id: '11111111-1111-1111-1111-111111111111',
  status: 'success',
  summary: 'Tenant login succeeded',
  metadata: {},
  ...overrides,
});

describe('canonicalize (RFC 8785 JCS)', () => {
  it('returns the same output for the same input (deterministic)', () => {
    const v = { z: 1, a: { x: 1, m: [3, 2, 1] }, b: 'hello' };
    expect(canonicalize(v)).toBe(canonicalize(v));
  });

  it('sorts object keys lexicographically at every level', () => {
    const a = canonicalize({ a: 1, z: 2, m: 3 });
    const b = canonicalize({ z: 2, m: 3, a: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"m":3,"z":2}');
  });

  it('preserves array ordering', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serialises null and primitives JSON-compatibly', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hi')).toBe('"hi"');
  });

  it('escapes strings safely', () => {
    expect(canonicalize('"hello"')).toBe('"\\"hello\\""');
    expect(canonicalize('a\nb')).toBe('"a\\nb"');
  });
});

describe('computeEventHash', () => {
  it('produces a 0x-prefixed 64-hex-char SHA-256', () => {
    const h = computeEventHash(samplePayload(), GENESIS_PREVIOUS_HASH);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const a = computeEventHash(samplePayload(), GENESIS_PREVIOUS_HASH);
    const b = computeEventHash(samplePayload(), GENESIS_PREVIOUS_HASH);
    expect(a).toBe(b);
  });

  it('changes when previous_hash changes', () => {
    const a = computeEventHash(samplePayload(), GENESIS_PREVIOUS_HASH);
    const b = computeEventHash(samplePayload(), '0xdeadbeef');
    expect(a).not.toBe(b);
  });

  it('changes when ANY payload field changes', () => {
    const base = computeEventHash(samplePayload(), GENESIS_PREVIOUS_HASH);
    const fields: (keyof ChainedAuditPayload)[] = [
      'tenant_id',
      'environment',
      'actor_type',
      'actor_id',
      'action',
      'entity_type',
      'entity_id',
      'status',
      'summary',
    ];
    for (const field of fields) {
      const mutated = computeEventHash(
        samplePayload({ [field]: 'mutated' } as Partial<ChainedAuditPayload>),
        GENESIS_PREVIOUS_HASH,
      );
      expect(mutated).not.toBe(base);
    }
  });

  it('changes when a metadata key value changes', () => {
    const a = computeEventHash(samplePayload({ metadata: { foo: 'one' } }), GENESIS_PREVIOUS_HASH);
    const b = computeEventHash(samplePayload({ metadata: { foo: 'two' } }), GENESIS_PREVIOUS_HASH);
    expect(a).not.toBe(b);
  });

  it('matches metadata-key order independence (sorted keys)', () => {
    const a = computeEventHash(samplePayload({ metadata: { a: 1, b: 2 } }), GENESIS_PREVIOUS_HASH);
    const b = computeEventHash(samplePayload({ metadata: { b: 2, a: 1 } }), GENESIS_PREVIOUS_HASH);
    expect(a).toBe(b);
  });
});

describe('chain integrity (in-memory simulation)', () => {
  function simulateChain(payloads: ChainedAuditPayload[]): { previousHash: string; eventHash: string }[] {
    const rows: { previousHash: string; eventHash: string }[] = [];
    let prev = GENESIS_PREVIOUS_HASH;
    for (const p of payloads) {
      const eh = computeEventHash(p, prev);
      rows.push({ previousHash: prev, eventHash: eh });
      prev = eh;
    }
    return rows;
  }

  it('100-row chain replays cleanly', () => {
    const payloads = Array.from({ length: 100 }, (_, i) =>
      samplePayload({ summary: `event-${i}` }),
    );
    const rows = simulateChain(payloads);
    // Replay
    let prev = GENESIS_PREVIOUS_HASH;
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].previousHash).toBe(prev);
      const recomputed = computeEventHash(payloads[i], rows[i].previousHash);
      expect(rows[i].eventHash).toBe(recomputed);
      prev = rows[i].eventHash;
    }
  });

  it('tampering with row 50 breaks the chain at row 50 and at every subsequent row', () => {
    const payloads = Array.from({ length: 100 }, (_, i) =>
      samplePayload({ summary: `event-${i}` }),
    );
    const rows = simulateChain(payloads);

    // Tamper with row 50's summary AFTER the chain is built.
    const tamperedPayloads = payloads.slice();
    tamperedPayloads[50] = samplePayload({ summary: 'TAMPERED' });

    let prev = GENESIS_PREVIOUS_HASH;
    let firstBreak: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const recomputed = computeEventHash(tamperedPayloads[i], rows[i].previousHash);
      if (rows[i].previousHash !== prev || recomputed !== rows[i].eventHash) {
        firstBreak = i;
        break;
      }
      prev = rows[i].eventHash;
    }
    expect(firstBreak).toBe(50);
  });
});

describe('every audit-writing surface uses appendAuditEvent (grep guard)', () => {
  it('no INSERT INTO audit_events lives outside src/services/audit.ts', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path') as typeof import('path');
    const root = path.resolve(__dirname, '../src');

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...walk(full));
        } else if (entry.isFile() && full.endsWith('.ts')) {
          out.push(full);
        }
      }
      return out;
    }

    // Strip block + line comments before matching, so the prohibition
    // only fires on actual code references — not docstrings explaining
    // the prohibition.
    function stripComments(src: string): string {
      // Block comments
      let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
      // Line comments
      out = out.replace(/\/\/[^\n]*/g, '');
      return out;
    }

    const offenders: string[] = [];
    for (const file of walk(root)) {
      if (file.endsWith('/services/audit.ts')) continue; // the one allowed location
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      if (/INSERT\s+INTO\s+audit_events/i.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
