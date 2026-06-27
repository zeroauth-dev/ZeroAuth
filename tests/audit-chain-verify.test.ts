/**
 * AL-1 close-out: verifyAuditChain() must FAIL CLOSED when a row's hash
 * columns are NULL after the chain has started. The prior skip-and-restart
 * let a tamperer mutate a row's content and then NULL its previous_hash +
 * event_hash so verification silently resumed from the next row, hiding the
 * break. Leading legacy NULL rows (pre-ADR-0013) are still tolerated.
 *
 * verifyAuditChain is DB-backed, so we stub getPool().query with canned rows.
 */
const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));

import {
  verifyAuditChain,
  computeEventHash,
  GENESIS_PREVIOUS_HASH,
  type ChainedAuditPayload,
} from '../src/services/audit';

function payload(i: number): ChainedAuditPayload {
  return {
    tenant_id: 't1',
    environment: 'live',
    actor_type: 'api_key',
    actor_id: 'k1',
    action: 'thing.happened',
    entity_type: 'entity',
    entity_id: String(i),
    status: 'success',
    summary: `row ${i}`,
    metadata: { i },
  };
}

function row(i: number, prev: string) {
  const p = payload(i);
  return { id: String(i), ...p, previous_hash: prev, event_hash: computeEventHash(p, prev) };
}

const r1 = row(1, GENESIS_PREVIOUS_HASH);
const r2 = row(2, r1.event_hash);
const r3 = row(3, r2.event_hash);

beforeEach(() => jest.clearAllMocks());

describe('verifyAuditChain — AL-1 NULL-hash enforcement', () => {
  it('ok:true for an intact chain', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [r1, r2, r3] });
    expect(await verifyAuditChain('t1', 'live')).toEqual({ ok: true });
  });

  it('ok:false when a mid-chain row content is mutated (event_hash mismatch)', async () => {
    const tampered = { ...r2, summary: 'TAMPERED' }; // keeps the old event_hash
    mockQuery.mockResolvedValueOnce({ rows: [r1, tampered, r3] });
    const res = await verifyAuditChain('t1', 'live');
    expect(res.ok).toBe(false);
  });

  it('AL-1: ok:false when a mid-chain row hashes are NULLed (loophole closed)', async () => {
    const nulled = { ...r2, previous_hash: null, event_hash: null };
    mockQuery.mockResolvedValueOnce({ rows: [r1, nulled, r3] });
    const res = await verifyAuditChain('t1', 'live');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.brokenAt).toBe('2');
      expect(res.reason).toContain('null_hash_after_chain_start');
    }
  });

  it('tolerates LEADING legacy NULL rows (pre-chain) with an intact chain after', async () => {
    const legacy = { ...payload(0), id: '0', previous_hash: null, event_hash: null };
    mockQuery.mockResolvedValueOnce({ rows: [legacy, r1, r2, r3] });
    expect(await verifyAuditChain('t1', 'live')).toEqual({ ok: true });
  });
});
