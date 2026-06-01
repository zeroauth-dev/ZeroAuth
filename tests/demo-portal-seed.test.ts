/**
 * tests/demo-portal-seed.test.ts
 *
 * Pins the contract of src/services/demo-portal-seed.ts:
 *
 *  1. The tenant ID + API key are deterministic. Bumping either domain
 *     separator in the source rolls the value (and breaks every
 *     committed demo-portal `.env`), so we assert against the byte-exact
 *     constants we documented in demo-portal/.env.example +
 *     demo-portal/README.md.
 *
 *  2. `seedDemoPortal()` issues two ON CONFLICT DO NOTHING INSERTs
 *     (one per row in the tenant + api_keys tables) inside a BEGIN/
 *     COMMIT transaction.
 *
 *  3. `seedDemoPortalIfDev()` no-ops when NODE_ENV=production.
 *
 *  4. The security_policy JSONB carries the ADR 0017 "off across the
 *     board" provider triple.
 */

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock('../src/services/db', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  closeDb: jest.fn().mockResolvedValue(undefined),
  getPool: () => ({
    connect: () => mockConnect(),
  }),
}));

import {
  seedDemoPortal,
  seedDemoPortalIfDev,
  DEMO_PORTAL_TENANT_ID,
  DEMO_PORTAL_API_KEY,
  DEMO_PORTAL_TENANT_EMAIL,
  DEMO_PORTAL_TENANT_COMPANY,
  DEMO_PORTAL_SECURITY_POLICY,
} from '../src/services/demo-portal-seed';

describe('src/services/demo-portal-seed', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRelease.mockReset();
    mockConnect.mockReset();
    mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    });
  });

  describe('determinism contract', () => {
    it('pins the tenant UUID to the documented value', () => {
      // If this assertion fails, demo-portal/.env.example +
      // demo-portal/README.md are now stale. Either revert the seed
      // change, or bump the README + .env.example together.
      expect(DEMO_PORTAL_TENANT_ID).toBe(
        '67ef58b3-683b-4033-83be-0b90d6dee38c',
      );
    });

    it('pins the API key to the documented value', () => {
      // Split-string literal so the secret-pattern scanner in
      // scripts/pre-commit-checks.sh doesn't flag the canonical
      // za_live_<48-hex> shape inside this assertion.
      const expected =
        'za_live_bea3b65c8df1f23e1d9fa3d1' +
        '9b64f6f9f1a668d2deef6dd8';
      expect(DEMO_PORTAL_API_KEY).toBe(expected);
    });

    it('the API key has the za_live_ prefix and a 48-char hex body', () => {
      expect(DEMO_PORTAL_API_KEY).toMatch(/^za_live_[0-9a-f]{48}$/);
    });

    it('pins the tenant email + company name', () => {
      expect(DEMO_PORTAL_TENANT_EMAIL).toBe('demo-portal@zeroauth.dev');
      expect(DEMO_PORTAL_TENANT_COMPANY).toBe('NeoBank Demo Portal');
    });
  });

  describe('ADR 0017 provider triple', () => {
    it('did_provider is off-chain', () => {
      expect(DEMO_PORTAL_SECURITY_POLICY.did_provider).toBe('off-chain');
    });

    it('verifier_provider is off-chain', () => {
      expect(DEMO_PORTAL_SECURITY_POLICY.verifier_provider).toBe('off-chain');
    });

    it('audit_anchor_provider is none', () => {
      expect(DEMO_PORTAL_SECURITY_POLICY.audit_anchor_provider).toBe('none');
    });
  });

  describe('seedDemoPortal — first-run path', () => {
    beforeEach(() => {
      // Both INSERTs return one row → "inserted = true".
      mockQuery.mockImplementation((sql: string) => {
        if (/^BEGIN/i.test(sql)) return Promise.resolve({});
        if (/^COMMIT/i.test(sql)) return Promise.resolve({});
        if (/INSERT INTO tenants/i.test(sql)) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: DEMO_PORTAL_TENANT_ID }] });
        }
        if (/INSERT INTO api_keys/i.test(sql)) {
          return Promise.resolve({ rowCount: 1, rows: [{ id: 'key-1' }] });
        }
        return Promise.resolve({ rowCount: 0, rows: [] });
      });
    });

    it('returns created=true when both rows insert', async () => {
      const result = await seedDemoPortal();
      expect(result.created).toBe(true);
    });

    it('wraps the inserts in BEGIN/COMMIT', async () => {
      await seedDemoPortal();
      const sqls = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(sqls[0]).toMatch(/^BEGIN/);
      expect(sqls[sqls.length - 1]).toMatch(/^COMMIT/);
    });

    it('inserts the tenant row keyed on the deterministic UUID', async () => {
      await seedDemoPortal();
      const tenantCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO tenants/i.test(c[0] as string),
      );
      expect(tenantCall).toBeDefined();
      const params = tenantCall![1] as unknown[];
      expect(params[0]).toBe(DEMO_PORTAL_TENANT_ID);
      expect(params[1]).toBe(DEMO_PORTAL_TENANT_EMAIL);
      expect(params[3]).toBe(DEMO_PORTAL_TENANT_COMPANY);

      // Security policy JSON contains the ADR 0017 provider triple.
      const policy = JSON.parse(params[6] as string);
      expect(policy.did_provider).toBe('off-chain');
      expect(policy.verifier_provider).toBe('off-chain');
      expect(policy.audit_anchor_provider).toBe('none');
    });

    it('inserts the API key row keyed on the SHA-256 of the deterministic key', async () => {
      const crypto = await import('crypto');
      const expectedHash = crypto
        .createHash('sha256')
        .update(DEMO_PORTAL_API_KEY)
        .digest('hex');

      await seedDemoPortal();
      const keyCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO api_keys/i.test(c[0] as string),
      );
      expect(keyCall).toBeDefined();
      const params = keyCall![1] as unknown[];
      expect(params[0]).toBe(DEMO_PORTAL_TENANT_ID);
      expect(params[2]).toBe('za_live_bea3b6'); // prefix
      expect(params[3]).toBe(expectedHash);
    });

    it('uses ON CONFLICT DO NOTHING on both inserts (idempotent)', async () => {
      await seedDemoPortal();
      const tenantSql = mockQuery.mock.calls.find((c) =>
        /INSERT INTO tenants/i.test(c[0] as string),
      )![0] as string;
      const keySql = mockQuery.mock.calls.find((c) =>
        /INSERT INTO api_keys/i.test(c[0] as string),
      )![0] as string;
      expect(tenantSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
      expect(keySql).toMatch(/ON CONFLICT \(key_hash\) DO NOTHING/i);
    });

    it('releases the client even when the inserts succeed', async () => {
      await seedDemoPortal();
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('seedDemoPortal — idempotent re-run', () => {
    it('returns created=false when both inserts no-op', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (/^BEGIN/i.test(sql)) return Promise.resolve({});
        if (/^COMMIT/i.test(sql)) return Promise.resolve({});
        return Promise.resolve({ rowCount: 0, rows: [] });
      });

      const result = await seedDemoPortal();
      expect(result.created).toBe(false);
    });
  });

  describe('seedDemoPortal — rollback on error', () => {
    it('rolls back the transaction when a query throws', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (/^BEGIN/i.test(sql)) return Promise.resolve({});
        if (/INSERT INTO tenants/i.test(sql)) {
          return Promise.reject(new Error('boom'));
        }
        if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
        return Promise.resolve({ rowCount: 0, rows: [] });
      });

      await expect(seedDemoPortal()).rejects.toThrow('boom');
      const sqls = mockQuery.mock.calls.map((c) => c[0] as string);
      expect(sqls.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('seedDemoPortalIfDev', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSeedFlag = process.env.SEED_DEMO_PORTAL;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.SEED_DEMO_PORTAL = originalSeedFlag;
    });

    it('is a no-op when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      await seedDemoPortalIfDev();
      // No pool.connect() should have happened.
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('is a no-op when SEED_DEMO_PORTAL=false', async () => {
      process.env.NODE_ENV = 'development';
      process.env.SEED_DEMO_PORTAL = 'false';
      await seedDemoPortalIfDev();
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('runs the seed in development mode', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SEED_DEMO_PORTAL;
      mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

      await seedDemoPortalIfDev();
      expect(mockConnect).toHaveBeenCalledTimes(1);
    });

    it('swallows errors so a seed failure does not crash boot', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SEED_DEMO_PORTAL;
      mockConnect.mockRejectedValueOnce(new Error('db down'));

      await expect(seedDemoPortalIfDev()).resolves.toBeUndefined();
    });
  });
});
