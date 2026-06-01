/**
 * Tests for src/services/compliance-pack.ts — the service-layer
 * contract for the bank's compliance evidence pack (pulled via
 * GET /api/console/compliance/evidence-pack). Coverage:
 *
 *   - pack shape matches the `EvidencePack` schema.
 *   - audit-chain snapshot (head + tail + currentHead) is embedded.
 *   - tenant DID-provider triple + `tenant_users` (commitment) count
 *     are surfaced — each row in `tenant_users` carries the
 *     (did, commitment) tuple per ADR 0017.
 *   - cross-tenant isolation: every COUNT/SELECT is gated by
 *     `tenant_id = $1 AND environment = $2`, and rendering for tenant
 *     B never sees tenant A's data.
 *
 * Chain replay itself is exercised by audit-chain.test.ts; here we
 * mock `verifyAuditChain` to control the integrity field.
 */
import { ApiKeyEnvironment, Tenant } from '../src/types';

const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));
const mockGetTenantById = jest.fn();
jest.mock('../src/services/tenants', () => ({
  getTenantById: (...a: unknown[]) => mockGetTenantById(...a),
}));
const mockVerifyAuditChain = jest.fn();
jest.mock('../src/services/audit', () => ({
  verifyAuditChain: (...a: unknown[]) => mockVerifyAuditChain(...a),
}));

import { renderCompliancePack, EVIDENCE_PACK_VERSION } from '../src/services/compliance-pack';

const TENANT_A: Tenant = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'anchor-bank@example.com',
  password_hash: 'salt:hash',
  company_name: 'Anchor Bank',
  plan: 'enterprise',
  status: 'active',
  rate_limit: 10_000, monthly_quota: -1, metadata: {},
  security_policy: {
    did_provider: 'base-sepolia',
    verifier_provider: 'off-chain',
    audit_anchor_provider: 'base-sepolia',
    did_registry_address: '0xDEAD',
  },
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-05-01T00:00:00Z'),
};
const TENANT_B: Tenant = {
  ...TENANT_A,
  id: '22222222-2222-2222-2222-222222222222',
  email: 'rival-bank@example.com',
  company_name: 'Rival Bank',
  security_policy: null,
};

/**
 * Route each `pool.query(sql, args)` to a fixture row set keyed on
 * the SQL. A new table referenced in compliance-pack.ts will surface
 * as `{ rows: [] }`, breaking a test rather than silently returning
 * empty data. When `tenantB` is passed, queries carrying tenant B's
 * id return zero rows — proves the WHERE-clause parameter is the
 * sole isolation gate.
 */
function installDispatcher(commitments: number, auditRows: number, isolate?: { tenantB: string }) {
  mockQuery.mockImplementation((sql: string, args: unknown[]) => {
    const tenantId = args[0] as string;
    if (isolate && tenantId === isolate.tenantB) {
      return Promise.resolve({ rows: sql.includes('COUNT(*)') ? [{ n: '0' }] : [] });
    }
    if (sql.includes('COUNT(*)') && sql.includes('audit_events')) return Promise.resolve({ rows: [{ n: String(auditRows) }] });
    if (sql.includes('COUNT(*)') && sql.includes('verification_events')) return Promise.resolve({ rows: [{ n: '7' }] });
    if (sql.includes('COUNT(*)') && sql.includes('devices')) return Promise.resolve({ rows: [{ n: '3' }] });
    if (sql.includes('COUNT(*)') && sql.includes('tenant_users')) return Promise.resolve({ rows: [{ n: String(commitments) }] });
    if (sql.includes('FROM audit_events')) {
      const head = sql.includes('ORDER BY id ASC');
      const rows = Array.from({ length: Math.min(auditRows, 3) }, (_, i) => ({
        id: String((head ? 1 : auditRows - 2) + i),
        created_at: new Date(`2026-01-0${i + 1}T00:00:00Z`),
        action: head ? 'tenant.login' : 'identity.register',
        status: 'success' as const, entity_type: 'tenant', entity_id: tenantId,
        summary: head ? `genesis-${i}` : `tail-${i}`,
        previous_hash: i === 0 && head ? 'genesis' : `0x${'a'.repeat(64)}`,
        event_hash: `0x${(i + (head ? 0 : 9)).toString().padStart(64, 'b')}`,
      }));
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetTenantById.mockReset();
  mockVerifyAuditChain.mockReset().mockResolvedValue({ ok: true });
  mockGetTenantById.mockImplementation(async (id: string) =>
    id === TENANT_A.id ? TENANT_A : id === TENANT_B.id ? TENANT_B : null,
  );
});

describe('renderCompliancePack — pack shape matches schema', () => {
  it('returns every advertised field with the right type', async () => {
    installDispatcher(12, 25);
    const pack = await renderCompliancePack(TENANT_A.id, 'live' as ApiKeyEnvironment);
    expect(pack.schemaVersion).toBe(EVIDENCE_PACK_VERSION);
    expect(pack.environment).toBe('live');
    expect(new Date(pack.generatedAt).toString()).not.toBe('Invalid Date');
    expect(pack.tenant).toEqual(expect.objectContaining({
      id: TENANT_A.id, email: TENANT_A.email, companyName: TENANT_A.company_name,
      plan: TENANT_A.plan, status: TENANT_A.status,
    }));
    expect(pack.counts).toEqual(expect.objectContaining({
      auditEvents: expect.any(Number), verificationEvents: expect.any(Number),
      devices: expect.any(Number), users: expect.any(Number),
    }));
    expect(pack.hashChainSnapshot.totalRows).toBe(25);
    expect(pack.integrity.ok).toBe(true);
    expect(typeof pack.markdown).toBe('string');
    expect(typeof pack.dpdp2tMemo).toBe('string');
  });

  it('throws tenant_not_found when the tenant is missing', async () => {
    mockGetTenantById.mockResolvedValueOnce(null);
    await expect(renderCompliancePack('00000000-0000-0000-0000-000000000000', 'live'))
      .rejects.toThrow(/tenant_not_found/);
  });

  it('degrades to integrity.ok=false when chain replay throws', async () => {
    installDispatcher(0, 5);
    mockVerifyAuditChain.mockRejectedValueOnce(new Error('db blew up'));
    const pack = await renderCompliancePack(TENANT_A.id, 'live');
    expect(pack.integrity.ok).toBe(false);
    expect(pack.integrity.reason).toMatch(/replay_error|db blew up/);
  });
});

describe('renderCompliancePack — audit hash chain snapshot', () => {
  it('embeds head + tail rows plus currentHead event_hash', async () => {
    installDispatcher(4, 42);
    const snap = (await renderCompliancePack(TENANT_A.id, 'live')).hashChainSnapshot;
    expect(snap.totalRows).toBe(42);
    expect(snap.head.length).toBeGreaterThan(0);
    expect(snap.tail.length).toBeGreaterThan(0);
    for (const row of [...snap.head, ...snap.tail]) {
      expect(row).toEqual(expect.objectContaining({
        id: expect.any(String), created_at: expect.any(String),
        action: expect.any(String), status: expect.stringMatching(/success|failure/),
      }));
    }
    expect(snap.currentHead).toBe(snap.tail[snap.tail.length - 1]?.event_hash ?? null);
  });

  it('returns an empty snapshot for a tenant with zero audit rows', async () => {
    installDispatcher(0, 0);
    const snap = (await renderCompliancePack(TENANT_A.id, 'live')).hashChainSnapshot;
    expect(snap).toEqual({ totalRows: 0, head: [], tail: [], currentHead: null });
  });
});

describe('renderCompliancePack — DID provider + commitment count', () => {
  it('surfaces resolved DID provider + tenant_users (commitment) count', async () => {
    installDispatcher(17, 8);
    const pack = await renderCompliancePack(TENANT_A.id, 'live');
    expect(pack.providers.didProvider).toBe('base-sepolia');
    expect(pack.providers.didRegistryAddress).toBe('0xDEAD');
    expect(pack.counts.users).toBe(17);
    expect(pack.markdown).toContain(TENANT_A.id);
    expect(pack.markdown).toMatch(/DID provider.*base-sepolia/);
  });

  it('falls back to off-chain defaults when security_policy is null', async () => {
    installDispatcher(0, 0);
    const { providers } = await renderCompliancePack(TENANT_B.id, 'live');
    expect(providers.didProvider).toBe('off-chain');
    expect(providers.verifierProvider).toBe('off-chain');
    expect(providers.auditAnchorProvider).toBe('none');
    expect(providers.didRegistryAddress).toBeNull();
  });
});

describe('renderCompliancePack — cross-tenant isolation', () => {
  it('binds tenant_id + environment on every tenant-scoped query', async () => {
    installDispatcher(5, 5);
    await renderCompliancePack(TENANT_A.id, 'live');
    for (const [sql, args] of mockQuery.mock.calls as [string, unknown[]][]) {
      if (/FROM (audit_events|verification_events|devices|tenant_users)/.test(sql)) {
        expect(sql).toMatch(/tenant_id\s*=\s*\$1/);
        expect(sql).toMatch(/environment\s*=\s*\$2/);
        expect(args[0]).toBe(TENANT_A.id);
        expect(args[1]).toBe('live');
      }
    }
  });

  it('returns zero rows for tenant B when the dispatcher would serve tenant A data', async () => {
    installDispatcher(99, 99, { tenantB: TENANT_B.id });
    const packA = await renderCompliancePack(TENANT_A.id, 'live');
    const packB = await renderCompliancePack(TENANT_B.id, 'live');
    expect(packA.counts.users).toBe(99);
    expect(packB.tenant.id).toBe(TENANT_B.id);
    expect(packB.counts.users).toBe(0);
    expect(packB.hashChainSnapshot.totalRows).toBe(0);
    expect(packA.markdown).not.toContain(TENANT_B.id);
  });

  it('threads the environment selector (live vs test) through every query', async () => {
    installDispatcher(2, 2);
    await renderCompliancePack(TENANT_A.id, 'test');
    const envs = mockQuery.mock.calls.map(c => (c[1] as unknown[])[1]);
    expect(envs.every(e => e === 'test')).toBe(true);
  });
});
