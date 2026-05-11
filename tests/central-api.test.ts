import request from 'supertest';
import { createApp } from '../src/app';

const mockTenantContext = {
  tenant: {
    id: 'tenant-123',
    email: 'dev@example.com',
    password_hash: 'salt:hash',
    company_name: 'Acme Corp',
    plan: 'free',
    status: 'active',
    rate_limit: 100,
    monthly_quota: 1000,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
  },
  apiKey: {
    id: 'key-123',
    tenant_id: 'tenant-123',
    name: 'Default',
    key_prefix: 'za_live_abc123',
    key_hash: 'hash',
    scopes: ['devices:write'],
    environment: 'live',
    status: 'active',
    last_used_at: null,
    expires_at: null,
    created_at: new Date(),
    revoked_at: null,
  },
};

jest.mock('../src/middleware/tenant-auth', () => ({
  authenticateTenantApiKey: () => (req: any, _res: any, next: any) => {
    req.tenantContext = mockTenantContext;
    next();
  },
  getTenantContext: (req: any) => req.tenantContext,
}));

const createDevice = jest.fn();
const listTenantUsers = jest.fn();
const createVerificationEvent = jest.fn();
const createAttendanceEvent = jest.fn();
const listAuditEvents = jest.fn();

jest.mock('../src/services/platform', () => ({
  createDevice: (...args: any[]) => createDevice(...args),
  listDevices: jest.fn(),
  updateDevice: jest.fn(),
  createTenantUser: jest.fn(),
  listTenantUsers: (...args: any[]) => listTenantUsers(...args),
  updateTenantUser: jest.fn(),
  createVerificationEvent: (...args: any[]) => createVerificationEvent(...args),
  listVerificationEvents: jest.fn(),
  createAttendanceEvent: (...args: any[]) => createAttendanceEvent(...args),
  listAttendanceEvents: jest.fn(),
  listAuditEvents: (...args: any[]) => listAuditEvents(...args),
  getConsoleOverview: jest.fn(),
  recordAuditEvent: jest.fn(),
}));

const app = createApp();

describe('Central API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a device via POST /v1/devices', async () => {
    createDevice.mockResolvedValue({
      id: 'device-1',
      external_id: 'device_001',
      name: 'Front Desk Sensor',
      environment: 'live',
    });

    const res = await request(app)
      .post('/v1/devices')
      .send({
        name: 'Front Desk Sensor',
        locationId: 'blr-hq',
        batteryLevel: 92,
      });

    expect(res.status).toBe(201);
    expect(res.body.device.id).toBe('device-1');
    expect(createDevice).toHaveBeenCalledWith(
      'tenant-123',
      'live',
      expect.objectContaining({
        name: 'Front Desk Sensor',
        locationId: 'blr-hq',
        batteryLevel: 92,
      }),
      'key-123',
    );
  });

  it('lists users via GET /v1/users', async () => {
    listTenantUsers.mockResolvedValue([
      { id: 'user-1', external_id: 'emp-001', full_name: 'Alice Example' },
    ]);

    const res = await request(app).get('/v1/users?status=active&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.environment).toBe('live');
    expect(res.body.users).toHaveLength(1);
    expect(listTenantUsers).toHaveBeenCalledWith('tenant-123', 'live', { status: 'active', limit: 5 });
  });

  it('records a verification via POST /v1/verifications', async () => {
    createVerificationEvent.mockResolvedValue({
      id: 'ver-1',
      method: 'fingerprint',
      result: 'pass',
    });

    const res = await request(app)
      .post('/v1/verifications')
      .send({
        userId: 'user-1',
        deviceId: 'device-1',
        method: 'fingerprint',
        result: 'pass',
        reason: 'matched-template',
      });

    expect(res.status).toBe(201);
    expect(res.body.verification.id).toBe('ver-1');
    expect(createVerificationEvent).toHaveBeenCalledWith(
      'tenant-123',
      'live',
      'key-123',
      expect.objectContaining({
        userId: 'user-1',
        deviceId: 'device-1',
        method: 'fingerprint',
        result: 'pass',
      }),
    );
  });

  it('records an attendance event via POST /v1/attendance', async () => {
    createAttendanceEvent.mockResolvedValue({
      id: 'att-1',
      event_type: 'check_in',
      result: 'accepted',
    });

    const res = await request(app)
      .post('/v1/attendance')
      .send({
        userId: 'user-1',
        deviceId: 'device-1',
        verificationId: 'ver-1',
        type: 'check_in',
      });

    expect(res.status).toBe(201);
    expect(res.body.attendance.id).toBe('att-1');
    expect(createAttendanceEvent).toHaveBeenCalledWith(
      'tenant-123',
      'live',
      'key-123',
      expect.objectContaining({
        userId: 'user-1',
        deviceId: 'device-1',
        verificationId: 'ver-1',
        type: 'check_in',
      }),
    );
  });

  it('returns audit events via GET /v1/audit', async () => {
    listAuditEvents.mockResolvedValue([
      { id: 1, action: 'attendance.recorded', status: 'success' },
    ]);

    const res = await request(app).get('/v1/audit?status=success&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(listAuditEvents).toHaveBeenCalledWith('tenant-123', 'live', {
      action: undefined,
      status: 'success',
      limit: 10,
    });
  });
});
