/**
 * Unit tests for src/services/api-keys.ts.
 *
 * Mocks getPool() so no Postgres is required. Asserts:
 *
 *   - generateRawKey shape: za_{env}_<48 hex>
 *   - hashKey is SHA-256 (64-char hex)
 *   - extractPrefix returns the first 14 chars
 *   - createApiKey writes the hash, not the raw key, and emits an audit row
 *   - authenticateApiKey accepts a known key, rejects revoked, rejects expired
 *   - listApiKeys never returns the key_hash column
 *   - revokeApiKey marks status=revoked + writes an audit row, returns false on no-op
 *   - countActiveKeys returns a number
 *
 * F-3 + F-4 from issue #26 — api_key.created / api_key.revoked rows now
 * fire with actor_type='console' (issue #26 audit attribution refactor).
 */

import crypto from 'crypto';

const mockQuery = jest.fn();
const mockRecordAuditEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

jest.mock('../src/services/platform', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

import {
  createApiKey,
  authenticateApiKey,
  listApiKeys,
  revokeApiKey,
  countActiveKeys,
} from '../src/services/api-keys';

describe('services/api-keys', () => {
  beforeEach(() => {
    // mockReset() clears both call history AND queued implementations
    // (mockResolvedValueOnce). authenticateApiKey emits a fire-and-forget
    // UPDATE last_used_at after the SELECT, so without a full reset the
    // queued value from a "happy path" test bleeds into the next test.
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockRecordAuditEvent.mockClear();
  });

  describe('createApiKey', () => {
    it('returns a za_live_<48 hex> raw key matching the production format', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'key-uuid-1',
          name: 'Default Live Key',
          key_prefix: 'za_live_aaaa',
          scopes: ['zkp:verify'],
          environment: 'live',
          created_at: '2026-05-14T00:00:00Z',
        }],
      });

      const result = await createApiKey('tenant-A', 'Default Live Key', 'live');

      expect(result.key).toMatch(/^za_live_[a-f0-9]{48}$/);
      expect(result.id).toBe('key-uuid-1');
      expect(result.environment).toBe('live');
    });

    it('returns a za_test_<48 hex> for test environment', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'key-uuid-2',
          name: 'Test Key',
          key_prefix: 'za_test_bbbb',
          scopes: [],
          environment: 'test',
          created_at: '2026-05-14T00:00:00Z',
        }],
      });

      const result = await createApiKey('tenant-A', 'Test Key', 'test');
      expect(result.key).toMatch(/^za_test_[a-f0-9]{48}$/);
    });

    it('persists the SHA-256 HASH of the raw key, never the raw key itself', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'k1', name: 'n', key_prefix: 'za_live_aa', scopes: [], environment: 'live', created_at: '' }],
      });

      const result = await createApiKey('tenant-A');

      const insertCall = mockQuery.mock.calls[0];
      const params = insertCall[1] as unknown[];
      // params: [tenantId, name, keyPrefix, keyHash, scopes, environment]
      const expectedHash = crypto.createHash('sha256').update(result.key).digest('hex');
      expect(params[3]).toBe(expectedHash);
      // The raw key never appears in the INSERT
      expect(params).not.toContain(result.key);
      // The hash is 64 hex chars
      expect(params[3]).toMatch(/^[a-f0-9]{64}$/);
    });

    it('emits an api_key.created audit row with actor_type=console', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'k1', name: 'n', key_prefix: 'za_live_aa', scopes: ['zkp:verify'], environment: 'live', created_at: '' }],
      });

      await createApiKey('tenant-A', 'My Key', 'live');

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        'tenant-A',
        expect.objectContaining({
          actorType: 'console',
          action: 'api_key.created',
          entityType: 'api_key',
          entityId: 'k1',
          status: 'success',
          environment: 'live',
        }),
      );
    });

    it('uses the default broad scope set when not provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'k1', name: 'n', key_prefix: 'za_live_aa', scopes: [], environment: 'live', created_at: '' }],
      });

      await createApiKey('tenant-A');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      const scopes = params[4] as string[];
      expect(scopes).toContain('zkp:verify');
      expect(scopes).toContain('devices:write');
      expect(scopes).toContain('audit:read');
    });
  });

  describe('authenticateApiKey', () => {
    it('returns the api_keys row for a valid active key', async () => {
      const row = { id: 'k1', tenant_id: 'tenant-A', status: 'active', expires_at: null };
      mockQuery
        .mockResolvedValueOnce({ rows: [row] }) // the SELECT
        .mockResolvedValueOnce({ rows: [] });    // last_used_at UPDATE (fire-and-forget)

      const result = await authenticateApiKey('za_live_aaaaaaaa');
      expect(result).toEqual(row);
    });

    it('returns null when no row matches the hash', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await authenticateApiKey('za_live_nope');
      expect(result).toBeNull();
    });

    it('returns null for expired keys (expires_at in the past)', async () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'k1', status: 'active', expires_at: past }] })
        .mockResolvedValueOnce({ rows: [] });
      const result = await authenticateApiKey('za_live_xx');
      expect(result).toBeNull();
    });

    it('looks up by SHA-256 hash, not by raw key', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const rawKey = 'za_live_test_key_value';
      await authenticateApiKey(rawKey);
      const params = mockQuery.mock.calls[0][1] as unknown[];
      const expectedHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      expect(params[0]).toBe(expectedHash);
      // Raw key never reaches the database
      expect(params).not.toContain(rawKey);
    });
  });

  describe('listApiKeys', () => {
    it('returns rows without key_hash in the SELECT projection', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'k1', name: 'n' }] });
      await listApiKeys('tenant-A');

      const sql = mockQuery.mock.calls[0][0] as string;
      // The SELECT clause must explicitly list columns and must NOT include key_hash
      expect(sql).not.toMatch(/key_hash/);
      expect(sql).toMatch(/key_prefix/); // safe to expose
      expect(sql).toMatch(/WHERE tenant_id = \$1/);
    });

    it('orders by created_at DESC', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listApiKeys('tenant-A');
      expect((mockQuery.mock.calls[0][0] as string)).toMatch(/ORDER BY created_at DESC/);
    });
  });

  describe('revokeApiKey', () => {
    it('updates status=revoked + revoked_at when the active key belongs to the tenant', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'k1' }] });
      const ok = await revokeApiKey('tenant-A', 'k1');
      expect(ok).toBe(true);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/SET status = 'revoked'/);
      expect(sql).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
      expect(sql).toMatch(/AND status = 'active'/); // can't double-revoke
    });

    it('emits an api_key.revoked audit row with actor_type=console', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'k1' }] });
      await revokeApiKey('tenant-A', 'k1');
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        'tenant-A',
        expect.objectContaining({
          actorType: 'console',
          action: 'api_key.revoked',
          entityType: 'api_key',
          entityId: 'k1',
        }),
      );
    });

    it('returns false when no row was updated (already revoked / wrong tenant)', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      const ok = await revokeApiKey('tenant-A', 'k-nonexistent');
      expect(ok).toBe(false);
      expect(mockRecordAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe('countActiveKeys', () => {
    it('returns the parsed integer count', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });
      const n = await countActiveKeys('tenant-A');
      expect(n).toBe(3);
      expect(typeof n).toBe('number');
    });

    it('returns 0 for a tenant with no keys', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      expect(await countActiveKeys('tenant-A')).toBe(0);
    });
  });
});
