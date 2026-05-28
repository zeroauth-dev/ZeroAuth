/**
 * Unit tests for src/services/anchor-job.ts (Phase 0 commit C-015).
 *
 * The anchor job is the OFF-CHAIN half of ADR 0014: it computes the
 * per-tenant daily terminal hash and stages a `recordAnchor(...)` tx
 * the signer worker broadcasts to `contracts/AuditAnchor.sol`
 * (commit d6c6a4e). The tests cover:
 *
 *   1. `computeDailyAnchorPayload` returns null when the day has no rows.
 *   2. `computeDailyAnchorPayload` returns the terminal hash + count for
 *      a single-row window.
 *   3. `computeDailyAnchorPayload` returns the LAST row's hash for a
 *      multi-row window (the chain head as of the day boundary).
 *   4. `runDailyAnchorJob` scans every active tenant.
 *   5. `runDailyAnchorJob` skips tenants with zero events that day.
 *   6. `runDailyAnchorJob` skips tenants already in `audit_anchors`.
 *   7. `runDailyAnchorJob` stages a tx whose `data` decodes back to the
 *      original `recordAnchor(...)` args.
 *   8. `runDailyAnchorJob` writes one `audit.anchor.staged` self-audit
 *      row per staged tenant.
 *
 * The pool is mocked via `jest.mock('../src/services/db', …)` so the
 * suite runs without a live Postgres — matches the pattern in
 * `tests/platform.test.ts`.
 */

import { ethers } from 'ethers';

interface MockQueryCall {
  text: string;
  values: unknown[];
}

interface MockQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number;
}

const queryCalls: MockQueryCall[] = [];
let queryResponder: (call: MockQueryCall) => MockQueryResult;

const mockQuery = jest.fn(async (text: string, values: unknown[] = []) => {
  const call: MockQueryCall = { text, values };
  queryCalls.push(call);
  return queryResponder(call);
});

const mockAppendAuditEvent = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

jest.mock('../src/services/audit', () => ({
  appendAuditEvent: (...args: unknown[]) => mockAppendAuditEvent(...args),
}));

import {
  computeDailyAnchorPayload,
  computeTenantIdHash,
  dayUtcAsYYYYMMDD,
  encodeRecordAnchorCall,
  runDailyAnchorJob,
  AUDIT_ANCHOR_ABI,
} from '../src/services/anchor-job';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const TENANT_C = '33333333-3333-3333-3333-333333333333';

const DAY = new Date('2026-05-27T00:00:00.000Z');
const SAMPLE_HASH_1 = '0x' + 'a'.repeat(64);
const SAMPLE_HASH_2 = '0x' + 'b'.repeat(64);
const SAMPLE_HASH_3 = '0x' + 'c'.repeat(64);

beforeEach(() => {
  queryCalls.length = 0;
  mockQuery.mockClear();
  mockAppendAuditEvent.mockReset();
  mockAppendAuditEvent.mockResolvedValue({
    id: '1',
    previousHash: 'genesis',
    eventHash: '0xdeadbeef',
  });
});

// Classify a query into a route by what the SQL looks like — we cannot
// rely on identity, only on shape. The route ID lets each test wire up
// the right responder per call.
function classify(text: string): 'list_tenants' | 'terminal' | 'has_anchor' | 'unknown' {
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (/SELECT id FROM tenants WHERE status = 'active'/i.test(normalised)) {
    return 'list_tenants';
  }
  if (/FROM audit_events/i.test(normalised) && /event_hash/i.test(normalised)) {
    return 'terminal';
  }
  if (/audit_anchors/i.test(normalised) && /EXISTS/i.test(normalised)) {
    return 'has_anchor';
  }
  return 'unknown';
}

describe('computeDailyAnchorPayload', () => {
  it('returns null when the day window has zero rows', async () => {
    queryResponder = call => {
      expect(classify(call.text)).toBe('terminal');
      return { rows: [] };
    };

    const out = await computeDailyAnchorPayload(TENANT_A, 'live', DAY);
    expect(out).toBeNull();
  });

  it('returns terminal hash + count for a single-row window', async () => {
    queryResponder = () => ({
      rows: [{ event_hash: SAMPLE_HASH_1, total: '1' }],
    });

    const out = await computeDailyAnchorPayload(TENANT_A, 'live', DAY);
    expect(out).not.toBeNull();
    expect(out!.tenantId).toBe(TENANT_A);
    expect(out!.terminalHash).toBe(SAMPLE_HASH_1);
    expect(out!.rowCountAtAnchor).toBe(1n);
    expect(out!.dayUtc).toBe(20260527n);
    expect(out!.tenantIdHash).toBe(computeTenantIdHash(TENANT_A, 'live'));
  });

  it('returns the LAST row hash for a multi-row window (chain head at day boundary)', async () => {
    // The SQL projects the row whose ROW_NUMBER() OVER (ORDER BY id DESC) = 1,
    // which is the last inserted row. We feed back that exact row.
    queryResponder = () => ({
      rows: [{ event_hash: SAMPLE_HASH_3, total: '42' }],
    });

    const out = await computeDailyAnchorPayload(TENANT_A, 'live', DAY);
    expect(out!.terminalHash).toBe(SAMPLE_HASH_3);
    expect(out!.rowCountAtAnchor).toBe(42n);

    // And the query *should* have been ORDER BY id DESC — assert on the SQL text
    // so a future refactor that flips it to ASC breaks this test.
    const call = queryCalls[queryCalls.length - 1];
    expect(call.text).toMatch(/ORDER BY id DESC/i);
    // And the window predicate must use IS NOT DISTINCT FROM for env so
    // null-env tenants are correctly matched.
    expect(call.text).toMatch(/environment IS NOT DISTINCT FROM/i);
  });
});

describe('runDailyAnchorJob', () => {
  it('scans every active tenant', async () => {
    // Three tenants, none have rows that day. We expect 6 terminal queries
    // (3 tenants × 2 envs) and 0 anchor checks (the empty windows short-circuit).
    queryResponder = call => {
      switch (classify(call.text)) {
        case 'list_tenants':
          return { rows: [{ id: TENANT_A }, { id: TENANT_B }, { id: TENANT_C }] };
        case 'terminal':
          return { rows: [] };
        case 'has_anchor':
          return { rows: [{ exists: false }] };
        default:
          throw new Error(`unclassified query: ${call.text}`);
      }
    };

    const report = await runDailyAnchorJob(DAY);

    expect(report.tenantsScanned).toBe(3);
    expect(report.tenantsToAnchor).toBe(0);
    expect(report.staged).toEqual([]);
    expect(report.errors).toEqual([]);

    const terminalCalls = queryCalls.filter(c => classify(c.text) === 'terminal');
    expect(terminalCalls).toHaveLength(6);
  });

  it("skips tenants with zero events on the target day", async () => {
    queryResponder = call => {
      switch (classify(call.text)) {
        case 'list_tenants':
          return { rows: [{ id: TENANT_A }, { id: TENANT_B }] };
        case 'terminal':
          // tenant A has rows on live, everyone else is empty
          if (call.values[0] === TENANT_A && call.values[1] === 'live') {
            return { rows: [{ event_hash: SAMPLE_HASH_1, total: '5' }] };
          }
          return { rows: [] };
        case 'has_anchor':
          return { rows: [{ exists: false }] };
        default:
          throw new Error(`unclassified query: ${call.text}`);
      }
    };

    const report = await runDailyAnchorJob(DAY);
    expect(report.tenantsToAnchor).toBe(1);
    expect(report.staged).toHaveLength(1);
    expect(report.staged[0].tenantId).toBe(TENANT_A);
    expect(report.staged[0].environment).toBe('live');
  });

  it("skips tenants that are already anchored for the day", async () => {
    queryResponder = call => {
      switch (classify(call.text)) {
        case 'list_tenants':
          return { rows: [{ id: TENANT_A }] };
        case 'terminal':
          return { rows: [{ event_hash: SAMPLE_HASH_1, total: '7' }] };
        case 'has_anchor':
          // Both env sweeps for tenant A are "already anchored".
          return { rows: [{ exists: true }] };
        default:
          throw new Error(`unclassified query: ${call.text}`);
      }
    };

    const report = await runDailyAnchorJob(DAY);
    expect(report.tenantsToAnchor).toBe(0);
    expect(report.staged).toEqual([]);
    // And `appendAuditEvent` should NOT have been called — no self-audit
    // for a skipped tenant.
    expect(mockAppendAuditEvent).not.toHaveBeenCalled();
  });

  it("stages a tx whose data encodes recordAnchor(tenantIdHash, day, terminalHash, rowCount)", async () => {
    queryResponder = call => {
      switch (classify(call.text)) {
        case 'list_tenants':
          return { rows: [{ id: TENANT_A }] };
        case 'terminal':
          if (call.values[1] === 'live') {
            return { rows: [{ event_hash: SAMPLE_HASH_2, total: '99' }] };
          }
          return { rows: [] };
        case 'has_anchor':
          return { rows: [{ exists: false }] };
        default:
          throw new Error(`unclassified query: ${call.text}`);
      }
    };

    const report = await runDailyAnchorJob(DAY);
    expect(report.staged).toHaveLength(1);

    const tx = report.staged[0];
    expect(tx.value).toBe(0);
    expect(tx.data.startsWith('0x')).toBe(true);

    // Decode the call data with a fresh Interface — round-trip proves
    // both that the selector matches and that the args land in the
    // right slots.
    const iface = new ethers.Interface(AUDIT_ANCHOR_ABI);
    const decoded = iface.decodeFunctionData('recordAnchor', tx.data);

    const expectedTenantIdHash = computeTenantIdHash(TENANT_A, 'live');
    expect(decoded[0]).toBe(expectedTenantIdHash);
    expect(decoded[1]).toBe(dayUtcAsYYYYMMDD(DAY));
    expect(decoded[2]).toBe(SAMPLE_HASH_2);
    expect(decoded[3]).toBe(99n);

    // And the staged tx should also match the encoded form computed
    // directly from the payload.
    expect(tx.data).toBe(encodeRecordAnchorCall(tx.payload));
  });

  it("writes one audit.anchor.staged self-audit row per staged tenant", async () => {
    // TENANT_A has rows on BOTH envs; TENANT_B has rows on live only.
    queryResponder = call => {
      switch (classify(call.text)) {
        case 'list_tenants':
          return { rows: [{ id: TENANT_A }, { id: TENANT_B }] };
        case 'terminal':
          if (call.values[0] === TENANT_A) {
            // Both envs present
            return {
              rows: [
                {
                  event_hash: call.values[1] === 'live' ? SAMPLE_HASH_1 : SAMPLE_HASH_2,
                  total: '3',
                },
              ],
            };
          }
          if (call.values[0] === TENANT_B && call.values[1] === 'live') {
            return { rows: [{ event_hash: SAMPLE_HASH_3, total: '11' }] };
          }
          return { rows: [] };
        case 'has_anchor':
          return { rows: [{ exists: false }] };
        default:
          throw new Error(`unclassified query: ${call.text}`);
      }
    };

    const report = await runDailyAnchorJob(DAY);
    // 2 staged for TENANT_A (live + test) + 1 staged for TENANT_B (live).
    expect(report.staged).toHaveLength(3);
    expect(mockAppendAuditEvent).toHaveBeenCalledTimes(3);

    for (const call of mockAppendAuditEvent.mock.calls) {
      const payload = call[0] as Record<string, unknown>;
      expect(payload.actor_type).toBe('system');
      expect(payload.actor_id).toBe('anchor-job');
      expect(payload.action).toBe('audit.anchor.staged');
      expect(payload.entity_type).toBe('audit_anchor');
      expect(payload.status).toBe('success');
      const metadata = payload.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({
        day_utc: dayUtcAsYYYYMMDD(DAY).toString(),
        row_count: expect.any(String),
        terminal_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/i),
        tx_data: expect.stringMatching(/^0x/),
      });
    }
  });
});
