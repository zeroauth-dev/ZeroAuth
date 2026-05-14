/**
 * Unit tests for src/services/usage.ts — usage logging + monthly quota
 * aggregation. Postgres is mocked.
 *
 * Key behaviors:
 *   - logApiCall is FIRE-AND-FORGET: never throws, never returns a Promise
 *     the caller needs to await
 *   - logApiCall routes to the right monthly counter (zkp_verifications,
 *     zkp_registrations, saml_auths, oidc_auths, or total_requests)
 *   - getCurrentMonthUsage returns 0 when no row exists
 *   - getUsageSummary respects months param via the date_trunc filter
 *   - checkQuota with monthlyQuota=-1 (unlimited) always allows
 *   - checkQuota with a numeric quota returns allowed/used/limit
 */

const mockQuery = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  logApiCall,
  getCurrentMonthUsage,
  getUsageSummary,
  getRecentCalls,
  checkQuota,
} from '../src/services/usage';

describe('services/usage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  describe('logApiCall', () => {
    it('fires off two queries: a usage_logs INSERT and a usage_monthly UPSERT', () => {
      logApiCall('t1', 'k1', '/v1/auth/zkp/verify', 'POST', 200, 12, '1.2.3.4', 'curl/8');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const insertSql = mockQuery.mock.calls[0][0] as string;
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      expect(insertSql).toMatch(/INSERT INTO usage_logs/);
      expect(upsertSql).toMatch(/INSERT INTO usage_monthly/);
      expect(upsertSql).toMatch(/ON CONFLICT/);
    });

    it('routes /zkp/verify to the zkp_verifications counter', () => {
      logApiCall('t', null, '/v1/auth/zkp/verify', 'POST', 200, 1, null, null);
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      expect(upsertSql).toMatch(/zkp_verifications/);
    });

    it('routes /zkp/register to the zkp_registrations counter', () => {
      logApiCall('t', null, '/v1/auth/zkp/register', 'POST', 200, 1, null, null);
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      expect(upsertSql).toMatch(/zkp_registrations/);
    });

    it('routes /saml/ to the saml_auths counter', () => {
      logApiCall('t', null, '/v1/auth/saml/callback', 'POST', 200, 1, null, null);
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      expect(upsertSql).toMatch(/saml_auths/);
    });

    it('routes /oidc/ to the oidc_auths counter', () => {
      logApiCall('t', null, '/v1/auth/oidc/callback', 'POST', 200, 1, null, null);
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      expect(upsertSql).toMatch(/oidc_auths/);
    });

    it('routes anything else to total_requests only', () => {
      logApiCall('t', null, '/v1/devices', 'GET', 200, 1, null, null);
      const upsertSql = mockQuery.mock.calls[1][0] as string;
      // The bucket column is always `total_requests` in this code path
      // (and total_requests is also incremented unconditionally).
      expect(upsertSql).toMatch(/total_requests/);
    });

    it('swallows query errors silently (fire-and-forget invariant)', async () => {
      mockQuery.mockRejectedValue(new Error('postgres down'));
      // logApiCall is `void`, must not throw
      expect(() => {
        logApiCall('t', null, '/v1/devices', 'GET', 500, 0, null, null);
      }).not.toThrow();
      // Wait a tick for the swallowed rejections to settle
      await new Promise(resolve => setImmediate(resolve));
    });
  });

  describe('getCurrentMonthUsage', () => {
    it('returns the total_requests value from the current month', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total_requests: 1234 }] });
      expect(await getCurrentMonthUsage('t1')).toBe(1234);
    });

    it('returns 0 when no row exists for the current month', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      expect(await getCurrentMonthUsage('t1')).toBe(0);
    });

    it('returns 0 when total_requests is null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total_requests: null }] });
      expect(await getCurrentMonthUsage('t1')).toBe(0);
    });
  });

  describe('getUsageSummary', () => {
    it('returns the array of rows ordered by month DESC', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { period: '2026-05', total_requests: 100 },
          { period: '2026-04', total_requests: 80 },
        ],
      });
      const summary = await getUsageSummary('t1', 6);
      expect(summary).toHaveLength(2);
      expect(summary[0].period).toBe('2026-05');
    });

    it('embeds the months parameter into the interval clause', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await getUsageSummary('t1', 12);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/interval '12 months'/);
    });
  });

  describe('getRecentCalls', () => {
    it('uses LIMIT $2 with the parameter', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ endpoint: '/v1/audit' }] });
      await getRecentCalls('t1', 25);
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params).toEqual(['t1', 25]);
    });
  });

  describe('checkQuota', () => {
    it('returns allowed:true for unlimited (-1) quota without hitting DB', async () => {
      const r = await checkQuota('t1', -1);
      expect(r).toEqual({ allowed: true, used: 0, limit: -1 });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns allowed:true when used < limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total_requests: 100 }] });
      const r = await checkQuota('t1', 1000);
      expect(r).toEqual({ allowed: true, used: 100, limit: 1000 });
    });

    it('returns allowed:false when used >= limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total_requests: 1000 }] });
      const r = await checkQuota('t1', 1000);
      expect(r.allowed).toBe(false);
      expect(r.used).toBe(1000);
    });
  });
});
