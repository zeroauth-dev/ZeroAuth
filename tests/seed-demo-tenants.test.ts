/**
 * tests/seed-demo-tenants.test.ts — C-108
 *
 * Pins the contract of scripts/seed-demo-tenants.ts::seedAnchorBank:
 *
 *  1. First run: creates 1 tenant + 2 API keys (one live, one test) and
 *     stamps the tenant row with the demo overrides via the pool. The
 *     security policy carries `require_strong_integrity: true` and the
 *     tenant's company name is "Anchor Bank (Demo)".
 *  2. Idempotent re-run: when the tenant already exists, neither
 *     createTenant nor createApiKey is called and the function reports
 *     `created: false`.
 *
 * Mocking strategy follows the pattern in `tests/api-keys.test.ts` and
 * `tests/tenants.test.ts`: the DB pool is mocked so no Postgres is
 * required, and the service layer (tenants, api-keys) is mocked so we
 * can assert against the higher-level calls instead of re-deriving SQL.
 */

const mockQuery = jest.fn();
const mockCreateTenant = jest.fn();
const mockGetTenantByEmail = jest.fn();
const mockCreateApiKey = jest.fn();

jest.mock('../src/services/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  closeDb: jest.fn().mockResolvedValue(undefined),
  getPool: () => ({ query: mockQuery }),
}));

jest.mock('../src/services/tenants', () => ({
  createTenant: (...args: unknown[]) => mockCreateTenant(...args),
  getTenantByEmail: (...args: unknown[]) => mockGetTenantByEmail(...args),
}));

jest.mock('../src/services/api-keys', () => ({
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
}));

import { seedAnchorBank } from '../scripts/seed-demo-tenants';
import { TenantSecurityPolicy } from '../src/types';

describe('scripts/seed-demo-tenants', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockCreateTenant.mockReset();
    mockGetTenantByEmail.mockReset();
    mockCreateApiKey.mockReset();

    // Silence the seed-script chatter; we'll still inspect args on the
    // service mocks for the actual assertions. Use stderr-aware spy on
    // console.error too, so a future regression that swaps log paths
    // doesn't accidentally start spamming the test runner.
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('first-run path — anchor_bank tenant provisioned with right scopes', () => {
    beforeEach(() => {
      mockGetTenantByEmail.mockResolvedValue(null);
      mockCreateTenant.mockResolvedValue({
        id: 'tenant-anchor-bank',
        email: 'anchor-bank-demo@zeroauth.dev',
        company_name: 'Anchor Bank (Demo)',
        plan: 'enterprise',
      });
      mockCreateApiKey
        .mockResolvedValueOnce({
          key: 'za_live_' + 'a'.repeat(48),
          id: 'key-live-1',
          name: 'Anchor Bank Live Key',
          key_prefix: 'za_live_aaaaaa',
          scopes: [],
          environment: 'live',
          created_at: new Date(),
        })
        .mockResolvedValueOnce({
          key: 'za_test_' + 'b'.repeat(48),
          id: 'key-test-1',
          name: 'Anchor Bank Test Key',
          key_prefix: 'za_test_bbbbbb',
          scopes: [],
          environment: 'test',
          created_at: new Date(),
        });
    });

    it('creates exactly one tenant via createTenant', async () => {
      const result = await seedAnchorBank();
      expect(result.created).toBe(true);
      expect(mockCreateTenant).toHaveBeenCalledTimes(1);
    });

    it('passes the expected name "Anchor Bank (Demo)" on creation', async () => {
      await seedAnchorBank();
      const [, , companyName, plan] = mockCreateTenant.mock.calls[0];
      expect(companyName).toBe('Anchor Bank (Demo)');
      expect(plan).toBe('enterprise');
    });

    it('uses the canonical demo email anchor-bank-demo@zeroauth.dev', async () => {
      await seedAnchorBank();
      const [email] = mockCreateTenant.mock.calls[0];
      expect(email).toBe('anchor-bank-demo@zeroauth.dev');
    });

    it('mints exactly two API keys — one live and one test', async () => {
      await seedAnchorBank();
      expect(mockCreateApiKey).toHaveBeenCalledTimes(2);
      const environments = mockCreateApiKey.mock.calls.map((call) => call[2]);
      expect(environments).toEqual(expect.arrayContaining(['live', 'test']));
      expect(environments).toHaveLength(2);
    });

    it('issues every API key against the new tenant id', async () => {
      await seedAnchorBank();
      for (const call of mockCreateApiKey.mock.calls) {
        expect(call[0]).toBe('tenant-anchor-bank');
      }
    });

    it('writes the demo overrides UPDATE with require_strong_integrity=true in security_policy', async () => {
      await seedAnchorBank();
      // The UPDATE call is the only direct pool.query() in the seed
      // script (createTenant + createApiKey are mocked above so their
      // queries do not flow through this mock).
      expect(mockQuery).toHaveBeenCalled();
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/UPDATE tenants/i);
      expect(sql).toMatch(/security_policy/);

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // params layout: [tenantId, rate_limit, monthly_quota, status, security_policy(json)]
      expect(params[0]).toBe('tenant-anchor-bank');
      expect(params[1]).toBe(5000);
      expect(params[2]).toBe(1_000_000);
      expect(params[3]).toBe('active');

      const policy = JSON.parse(params[4] as string) as TenantSecurityPolicy;
      expect(policy.require_strong_integrity).toBe(true);
      expect(policy.allow_play_integrity_absent).toBe(false);
      // Origins for kiosk + dashboard demo surfaces.
      expect(Array.isArray(policy.allowed_origins)).toBe(true);
      expect((policy.allowed_origins ?? []).length).toBeGreaterThan(0);
    });

    it('prints the OPERATOR SAVE banner so the raw keys are captured', async () => {
      await seedAnchorBank();
      const printed = stdoutSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(printed).toMatch(/OPERATOR: SAVE THESE — NOT RECOVERABLE/);
      // The raw key strings (prefixed `za_live_` / `za_test_`) must
      // appear in stdout so the operator can capture them.
      expect(printed).toMatch(/za_live_/);
      expect(printed).toMatch(/za_test_/);
    });
  });

  describe('idempotent re-run path', () => {
    it('does NOT call createTenant when the tenant already exists', async () => {
      mockGetTenantByEmail.mockResolvedValue({
        id: 'tenant-anchor-bank',
        email: 'anchor-bank-demo@zeroauth.dev',
        company_name: 'Anchor Bank (Demo)',
        plan: 'enterprise',
      });

      const result = await seedAnchorBank();
      expect(result.created).toBe(false);
      expect(mockCreateTenant).not.toHaveBeenCalled();
    });

    it('does NOT call createApiKey when the tenant already exists', async () => {
      mockGetTenantByEmail.mockResolvedValue({
        id: 'tenant-anchor-bank',
        email: 'anchor-bank-demo@zeroauth.dev',
        company_name: 'Anchor Bank (Demo)',
        plan: 'enterprise',
      });

      await seedAnchorBank();
      expect(mockCreateApiKey).not.toHaveBeenCalled();
    });

    it('does NOT run the demo-overrides UPDATE when the tenant already exists', async () => {
      mockGetTenantByEmail.mockResolvedValue({
        id: 'tenant-anchor-bank',
        email: 'anchor-bank-demo@zeroauth.dev',
        company_name: 'Anchor Bank (Demo)',
        plan: 'enterprise',
      });

      await seedAnchorBank();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
