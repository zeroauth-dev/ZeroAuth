/**
 * Unit tests for src/services/tenants.ts.
 *
 * Password hashing is the security-critical surface here. The service uses
 * scrypt (not bcrypt — `tenants.ts` notes "no bcrypt dependency needed").
 * We exercise the public createTenant + authenticateTenant + getter
 * functions but the real coverage is on the hash format + verify behaviour:
 *
 *   - hashed values are `<32-hex-salt>:<128-hex-key>` (16-byte salt +
 *     64-byte derived key, hex-encoded)
 *   - the same password produces DIFFERENT hashes (salted)
 *   - verifyPassword (exercised via authenticateTenant) returns null
 *     on wrong password, malformed stored hash, truncated hash, missing
 *     colon, missing salt, non-hex hash characters
 *   - email gets lower-cased + trimmed on signup and login lookup
 *   - PLAN_LIMITS is honoured on createTenant
 */

const mockQuery = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  createTenant,
  authenticateTenant,
  getTenantById,
  getTenantByEmail,
  updateTenantPlan,
} from '../src/services/tenants';
import { PLAN_LIMITS } from '../src/types';

describe('services/tenants', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('createTenant — password hashing', () => {
    it('stores a salted scrypt hash in the salt:hex format', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'tenant-A', email: 'a@x.com', password_hash: 'IGNORED', company_name: null, plan: 'free' }],
      });

      await createTenant('a@x.com', 'CorrectHorseBattery!');

      const params = mockQuery.mock.calls[0][1] as unknown[];
      const passwordHash = params[1] as string;
      // Format: <salt-hex>:<key-hex>. 16-byte salt → 32 hex chars. 64-byte
      // key → 128 hex chars.
      expect(passwordHash).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    });

    it('produces DIFFERENT hashes for the same password (the salt is random)', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 't', email: 'a@x.com', password_hash: '', company_name: null, plan: 'free' }],
      });

      await createTenant('a@x.com', 'SamePassword12!');
      await createTenant('a@x.com', 'SamePassword12!');

      const hash1 = (mockQuery.mock.calls[0][1] as unknown[])[1] as string;
      const hash2 = (mockQuery.mock.calls[1][1] as unknown[])[1] as string;
      expect(hash1).not.toBe(hash2);
    });

    it('lower-cases + trims the email', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', email: 'a@x.com', password_hash: '', company_name: null, plan: 'free' }],
      });

      await createTenant('  AlICE@EXAMPLE.COM  ', 'Test12345678!');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('alice@example.com');
    });

    it('applies PLAN_LIMITS to rate_limit + monthly_quota', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', email: 'a@x.com', password_hash: '', company_name: null, plan: 'starter' }],
      });

      await createTenant('a@x.com', 'P@ssw0rd1234', 'Acme', 'starter');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      // params: [email, hash, companyName, plan, rateLimit, monthlyQuota]
      expect(params[3]).toBe('starter');
      expect(params[4]).toBe(PLAN_LIMITS.starter.rateLimit);
      expect(params[5]).toBe(PLAN_LIMITS.starter.monthlyQuota);
    });

    it('defaults the plan to "free" when not provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', email: 'a@x.com', password_hash: '', company_name: null, plan: 'free' }],
      });
      await createTenant('a@x.com', 'TestPassword12!');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe('free');
    });

    it('passes null for company_name when whitespace-only or missing', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', email: 'a@x.com', password_hash: '', company_name: null, plan: 'free' }],
      });
      await createTenant('a@x.com', 'TestPassword12!', '   ');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[2]).toBeNull();
    });
  });

  describe('authenticateTenant — password verification', () => {
    /**
     * Helper: hash a password with the same scrypt parameters the service
     * uses, so we can stand up a "stored" hash without re-implementing
     * the algorithm.
     */
    async function hashFor(password: string): Promise<string> {
      // Round-trip through createTenant — captures the format. Faster than
      // duplicating crypto.scrypt here.
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', email: 'x@x.com', password_hash: '', company_name: null, plan: 'free' }],
      });
      await createTenant('x@x.com', password);
      const captured = (mockQuery.mock.calls[mockQuery.mock.calls.length - 1][1] as unknown[])[1] as string;
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      return captured;
    }

    it('returns the tenant when the password matches', async () => {
      const hash = await hashFor('CorrectPass12!');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: hash, status: 'active' }],
      });

      const tenant = await authenticateTenant('a@x.com', 'CorrectPass12!');
      expect(tenant?.id).toBe('t1');
    });

    it('returns null on wrong password (same email)', async () => {
      const hash = await hashFor('CorrectPass12!');
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: hash, status: 'active' }],
      });
      const tenant = await authenticateTenant('a@x.com', 'WrongPass12!');
      expect(tenant).toBeNull();
    });

    it('returns null when no tenant row matches the email', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const tenant = await authenticateTenant('nobody@x.com', 'anything');
      expect(tenant).toBeNull();
    });

    it('returns null on a malformed stored hash (no colon)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: 'just_a_string_no_colon_at_all', status: 'active' }],
      });
      const tenant = await authenticateTenant('a@x.com', 'TestPass12!');
      expect(tenant).toBeNull();
    });

    it('returns null on a stored hash with a missing salt', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: ':abc123', status: 'active' }],
      });
      expect(await authenticateTenant('a@x.com', 'whatever')).toBeNull();
    });

    it('returns null on a stored hash with non-hex characters', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: 'aabb:not-hex-content', status: 'active' }],
      });
      expect(await authenticateTenant('a@x.com', 'whatever')).toBeNull();
    });

    it('returns null on a truncated stored hash (odd hex length)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', email: 'a@x.com', password_hash: 'aabb:abc', status: 'active' }],
      });
      expect(await authenticateTenant('a@x.com', 'whatever')).toBeNull();
    });

    it('looks up by the lower-cased + trimmed email', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await authenticateTenant('  USER@EXAMPLE.COM  ', 'x');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('user@example.com');
    });
  });

  describe('getTenantById / getTenantByEmail', () => {
    it('getTenantById returns the row or null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', email: 'a@x.com' }] });
      expect(await getTenantById('t1')).toEqual({ id: 't1', email: 'a@x.com' });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await getTenantById('missing')).toBeNull();
    });

    it('getTenantByEmail lower-cases the lookup', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await getTenantByEmail('A@B.COM');
      expect((mockQuery.mock.calls[0][1] as unknown[])[0]).toBe('a@b.com');
    });
  });

  describe('updateTenantPlan', () => {
    it('updates plan + rate_limit + monthly_quota from PLAN_LIMITS', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't', plan: 'enterprise', rate_limit: PLAN_LIMITS.enterprise.rateLimit }],
      });
      await updateTenantPlan('t', 'enterprise');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe('enterprise');
      expect(params[1]).toBe(PLAN_LIMITS.enterprise.rateLimit);
      expect(params[2]).toBe(PLAN_LIMITS.enterprise.monthlyQuota);
    });

    it('returns null when the tenant doesn\'t exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await updateTenantPlan('nope', 'starter')).toBeNull();
    });
  });
});
