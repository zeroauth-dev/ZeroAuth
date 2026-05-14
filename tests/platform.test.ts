/**
 * Direct unit tests for src/services/platform.ts.
 *
 * The route-level tests (tests/console-proxy.test.ts +
 * tests/central-api.test.ts) verify the WIRING of these functions to
 * the HTTP layer. This suite verifies the SERVICE-LAYER contract:
 *
 *   - recordAuditEvent emits the right shape with the right
 *     environment/actor_type/actor_id/metadata
 *   - createDevice/updateDevice/createTenantUser/updateTenantUser thread
 *     the AuditActor into the audit row (issue #26 F-3)
 *   - actor_email lands in metadata.actor_email when set
 *   - When actor is undefined, actor_type defaults to 'api_key' with
 *     actor_id=null (transitional behavior — explicit code path)
 *   - Tenant scoping: every WHERE clause includes tenant_id AND
 *     environment (A-01 holds at the service layer)
 *   - listDevices applies the limit + status filter to the query
 *   - sanitizeLimit + sanitizeMetadata are exercised indirectly
 */

const mockQuery = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  recordAuditEvent,
  createDevice,
  updateDevice,
  createTenantUser,
  updateTenantUser,
  listDevices,
  listTenantUsers,
  listAuditEvents,
} from '../src/services/platform';

describe('services/platform', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  describe('recordAuditEvent', () => {
    it('inserts a row with the full set of columns', async () => {
      await recordAuditEvent('tenant-A', {
        environment: 'live',
        actorType: 'console',
        actorId: 'tenant-A',
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: 'tenant-A',
        status: 'success',
        summary: 'Created tenant',
        metadata: { plan: 'free' },
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0] as string;
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(sql).toMatch(/INSERT INTO audit_events/);
      expect(params).toEqual([
        'tenant-A', 'live', 'console', 'tenant-A',
        'tenant.created', 'tenant', 'tenant-A',
        'success', 'Created tenant', { plan: 'free' },
      ]);
    });

    it('defaults environment / actor_id / metadata to null/{} when omitted', async () => {
      await recordAuditEvent('t1', {
        actorType: 'system',
        action: 'cleanup.ran',
        entityType: 'system',
        status: 'success',
        summary: 'OK',
      });

      const params = mockQuery.mock.calls[0][1] as unknown[];
      // [tenant, environment, actorType, actorId, action, entityType, entityId, status, summary, metadata]
      expect(params[1]).toBeNull(); // environment
      expect(params[3]).toBeNull(); // actor_id
      expect(params[6]).toBeNull(); // entity_id
      expect(params[9]).toEqual({}); // metadata
    });

    it('sanitizes a non-object metadata to {}', async () => {
      await recordAuditEvent('t1', {
        actorType: 'system',
        action: 'x',
        entityType: 'y',
        status: 'success',
        summary: 's',
        metadata: 'not-an-object' as any,
      });
      expect((mockQuery.mock.calls[0][1] as unknown[])[9]).toEqual({});
    });
  });

  describe('createDevice — AuditActor plumbing (issue #26 F-3)', () => {
    beforeEach(() => {
      // Default: every INSERT succeeds with a stub row, audit INSERT
      // returns {rows:[]}.
      mockQuery.mockResolvedValue({
        rows: [{ id: 'dev-1', tenant_id: 't1', environment: 'live', external_id: 'd-1', name: 'D', location_id: null }],
        rowCount: 1,
      });
    });

    it('writes audit row with actorType=console + actor_email when called from console', async () => {
      await createDevice(
        't1', 'live',
        { name: 'My Device' },
        { type: 'console', id: 't1', email: 'op@example.com' },
      );

      // Second call is the recordAuditEvent INSERT
      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('console');     // actor_type
      expect(auditParams[3]).toBe('t1');          // actor_id
      const metadata = auditParams[9] as Record<string, unknown>;
      expect(metadata.actor_email).toBe('op@example.com');
    });

    it('writes audit row with actorType=api_key + no actor_email when called from v1', async () => {
      await createDevice(
        't1', 'live',
        { name: 'My Device' },
        { type: 'api_key', id: 'key-uuid-123' },
      );
      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('api_key');
      expect(auditParams[3]).toBe('key-uuid-123');
      const metadata = auditParams[9] as Record<string, unknown>;
      expect(metadata.actor_email).toBeUndefined();
    });

    it('defaults to actorType=api_key + actor_id=null when no actor is provided', async () => {
      await createDevice('t1', 'live', { name: 'D' });
      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('api_key');
      expect(auditParams[3]).toBeNull();
    });
  });

  describe('updateDevice', () => {
    it('returns null when no row matches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const r = await updateDevice('t1', 'live', 'dev-x', { status: 'inactive' });
      expect(r).toBeNull();
    });

    it('threads the AuditActor through to the audit row on success', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'dev-1', tenant_id: 't1', environment: 'live', external_id: 'd-1', status: 'inactive' }],
        rowCount: 1,
      });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // audit insert

      await updateDevice('t1', 'live', 'dev-1', { status: 'inactive' }, {
        type: 'console', id: 't1', email: 'op@example.com',
      });

      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('console');
      expect((auditParams[9] as Record<string, unknown>).actor_email).toBe('op@example.com');
    });
  });

  describe('createTenantUser', () => {
    it('threads AuditActor through user.created audit row', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'u-1', tenant_id: 't1', environment: 'live', external_id: 'emp-001', full_name: 'Alice' }],
        rowCount: 1,
      });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await createTenantUser('t1', 'live', { fullName: 'Alice' }, {
        type: 'console', id: 't1', email: 'op@example.com',
      });

      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('console');
      expect(auditParams[4]).toBe('user.created');
      expect((auditParams[9] as Record<string, unknown>).actor_email).toBe('op@example.com');
    });

    it('lower-cases the email field on insert', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'u-1', tenant_id: 't1', environment: 'live', external_id: 'emp-002', full_name: 'Bob' }],
        rowCount: 1,
      });

      await createTenantUser('t1', 'live', { fullName: 'Bob', email: 'BOB@EXAMPLE.COM' });
      const insertParams = mockQuery.mock.calls[0][1] as unknown[];
      // [tenantId, environment, externalId, fullName, email, phone, employeeCode, primaryDeviceId, metadata]
      expect(insertParams[4]).toBe('bob@example.com');
    });
  });

  describe('updateTenantUser', () => {
    it('returns null when no row matches', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const r = await updateTenantUser('t1', 'live', 'u-x', { status: 'inactive' });
      expect(r).toBeNull();
    });

    it('threads actor to the audit row on success', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'u-1', tenant_id: 't1', environment: 'live', external_id: 'emp-001', full_name: 'Alice', status: 'inactive' }],
        rowCount: 1,
      });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await updateTenantUser('t1', 'live', 'u-1', { status: 'inactive' }, {
        type: 'console', id: 't1', email: 'op@example.com',
      });

      const auditParams = mockQuery.mock.calls[1][1] as unknown[];
      expect(auditParams[2]).toBe('console');
      expect((auditParams[9] as Record<string, unknown>).actor_email).toBe('op@example.com');
    });
  });

  describe('tenant scoping (A-01)', () => {
    it('listDevices scopes by tenant_id + environment', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listDevices('t1', 'live');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/WHERE tenant_id = \$1 AND environment = \$2/);
    });

    it('listTenantUsers scopes by tenant_id + environment', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listTenantUsers('t1', 'live');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/WHERE tenant_id = \$1 AND environment = \$2/);
    });

    it('listAuditEvents scopes by tenant_id + environment', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listAuditEvents('t1', 'live');
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/WHERE tenant_id = \$1 AND environment = \$2/);
    });
  });

  describe('sanitizeLimit boundaries', () => {
    it('listDevices clamps the limit to [1,100]', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listDevices('t1', 'live', { limit: 10000 });
      const params = mockQuery.mock.calls[0][1] as unknown[];
      // The last param is the limit
      expect(params[params.length - 1]).toBe(100);
    });

    it('listDevices defaults the limit to 50 when omitted / NaN', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listDevices('t1', 'live');
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(50);
    });

    it('listDevices clamps a negative limit to 1', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      await listDevices('t1', 'live', { limit: -5 });
      const params = mockQuery.mock.calls[0][1] as unknown[];
      expect(params[params.length - 1]).toBe(1);
    });
  });
});
