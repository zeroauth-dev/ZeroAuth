/**
 * Integration tests for the dashboard-facing `/api/console/*` proxy endpoints
 * — devices, users, verifications, attendance.
 *
 * Console routes resolve the tenant from the JWT (never from the request
 * body or query), so these tests prove tenant scoping holds even when a
 * malicious request tries to name a different tenant. We mock the platform
 * service to assert that `tenantId` is forwarded exactly as it was in the
 * JWT, regardless of what the request body or query contains.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { createApp } from '../src/app';

function issueToken(tenantId: string, email = 'dev@example.com'): string {
  return jwt.sign(
    { tenantId, email, type: 'console' },
    config.jwt.secret,
    { expiresIn: '1h', issuer: 'zeroauth-console' },
  );
}

// Mock the tenants service (called by other console endpoints) so we never
// hit Postgres in this suite.
jest.mock('../src/services/tenants', () => ({
  createTenant: jest.fn(),
  authenticateTenant: jest.fn(),
  getTenantById: jest.fn().mockResolvedValue({
    id: 'tenant-A',
    email: 'a@example.com',
    company_name: 'A Co',
    plan: 'free',
    status: 'active',
    rate_limit: 100,
    monthly_quota: 1000,
    created_at: new Date(),
    updated_at: new Date(),
  }),
  getTenantByEmail: jest.fn(),
  updateTenantPlan: jest.fn(),
}));

const listDevices = jest.fn();
const createDevice = jest.fn();
const updateDevice = jest.fn();
const listTenantUsers = jest.fn();
const createTenantUser = jest.fn();
const updateTenantUser = jest.fn();
const listVerificationEvents = jest.fn();
const listAttendanceEvents = jest.fn();

jest.mock('../src/services/platform', () => ({
  listDevices: (...args: any[]) => listDevices(...args),
  createDevice: (...args: any[]) => createDevice(...args),
  updateDevice: (...args: any[]) => updateDevice(...args),
  listTenantUsers: (...args: any[]) => listTenantUsers(...args),
  createTenantUser: (...args: any[]) => createTenantUser(...args),
  updateTenantUser: (...args: any[]) => updateTenantUser(...args),
  listVerificationEvents: (...args: any[]) => listVerificationEvents(...args),
  listAttendanceEvents: (...args: any[]) => listAttendanceEvents(...args),
  // Other exports console.ts depends on at import time but we don't exercise.
  getConsoleOverview: jest.fn(),
  listAuditEvents: jest.fn(),
  recordAuditEvent: jest.fn(),
}));

const app = createApp();

describe('console proxy: /api/console/devices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/console/devices');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('rejects an invalid console JWT with 401 session_expired', async () => {
    const res = await request(app)
      .get('/api/console/devices')
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_expired');
  });

  it('lists devices scoped to the JWT tenant + chosen environment', async () => {
    listDevices.mockResolvedValueOnce([{ id: 'dev-1', name: 'A' }]);
    const res = await request(app)
      .get('/api/console/devices?environment=test&status=active&limit=10')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(200);
    expect(res.body.environment).toBe('test');
    expect(res.body.devices).toHaveLength(1);
    expect(listDevices).toHaveBeenCalledWith('tenant-A', 'test', { status: 'active', limit: 10 });
  });

  it('IGNORES a tenant_id in the request body and uses the JWT tenant (A-10)', async () => {
    createDevice.mockResolvedValueOnce({ id: 'dev-1', name: 'X', environment: 'live' });
    const tokenA = issueToken('tenant-A');
    const res = await request(app)
      .post('/api/console/devices')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'X', tenantId: 'tenant-B', tenant_id: 'tenant-B' });
    expect(res.status).toBe(201);
    expect(createDevice).toHaveBeenCalledWith('tenant-A', 'live', expect.objectContaining({ name: 'X' }));
  });

  it('validates batteryLevel range', async () => {
    const res = await request(app)
      .post('/api/console/devices')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`)
      .send({ name: 'X', batteryLevel: 150 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(createDevice).not.toHaveBeenCalled();
  });

  it('returns 409 device_external_id_taken when the platform service raises a duplicate-key error', async () => {
    createDevice.mockImplementationOnce(() => { throw new Error('duplicate key value violates unique constraint "devices_tenant_id_external_id_key"'); });
    const res = await request(app)
      .post('/api/console/devices')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`)
      .send({ name: 'X', externalId: 'dup' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('device_external_id_taken');
  });

  it('returns 404 device_not_found when PATCH targets an unknown id', async () => {
    updateDevice.mockResolvedValueOnce(null);
    const res = await request(app)
      .patch('/api/console/devices/no-such')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('device_not_found');
  });
});

describe('console proxy: /api/console/users', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('requires fullName on create and rejects with 400 otherwise', async () => {
    const res = await request(app)
      .post('/api/console/users')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`)
      .send({ email: 'x@y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(createTenantUser).not.toHaveBeenCalled();
  });

  it('forwards the JWT tenant even when the body names another', async () => {
    createTenantUser.mockResolvedValueOnce({ id: 'u-1', full_name: 'Alice' });
    const res = await request(app)
      .post('/api/console/users')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`)
      .send({ fullName: 'Alice', tenantId: 'tenant-B', environment: 'test' });
    expect(res.status).toBe(201);
    expect(createTenantUser).toHaveBeenCalledWith('tenant-A', 'test', expect.objectContaining({ fullName: 'Alice' }));
  });

  it('rejects an invalid status filter on list', async () => {
    const res = await request(app)
      .get('/api/console/users?status=banned')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status_filter');
    expect(listTenantUsers).not.toHaveBeenCalled();
  });
});

describe('console proxy: /api/console/verifications', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('lists verifications with method + result filters', async () => {
    listVerificationEvents.mockResolvedValueOnce([{ id: 'v-1', method: 'zkp', result: 'pass' }]);
    const res = await request(app)
      .get('/api/console/verifications?environment=live&method=zkp&result=pass&limit=5')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(200);
    expect(res.body.verifications).toHaveLength(1);
    expect(listVerificationEvents).toHaveBeenCalledWith('tenant-A', 'live', { method: 'zkp', result: 'pass', limit: 5 });
  });

  it('400s on an unknown method', async () => {
    const res = await request(app)
      .get('/api/console/verifications?method=telepathy')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_method_filter');
  });
});

describe('console proxy: /api/console/attendance', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('lists attendance with type + result filters', async () => {
    listAttendanceEvents.mockResolvedValueOnce([{ id: 'a-1', event_type: 'check_in', result: 'accepted' }]);
    const res = await request(app)
      .get('/api/console/attendance?type=check_in&result=accepted')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(200);
    expect(res.body.attendance).toHaveLength(1);
    expect(listAttendanceEvents).toHaveBeenCalledWith('tenant-A', 'live', { type: 'check_in', result: 'accepted', limit: undefined });
  });

  it('400s on an unknown type filter', async () => {
    const res = await request(app)
      .get('/api/console/attendance?type=teleport')
      .set('Authorization', `Bearer ${issueToken('tenant-A')}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_type_filter');
  });
});
