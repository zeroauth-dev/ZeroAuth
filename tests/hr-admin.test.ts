/**
 * Request-level tests for /api/hr/* — the standalone attendance HR admin
 * portal API. Pins: signup/login mint a tenant-scoped HR session; the
 * roster provision returns a single-use invite; and — the security-load-
 * bearing one — the HR JWT is isolated from the console + /v1 surfaces by
 * its distinct issuer/audience.
 */

import crypto from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));

const createHrAdminMock = jest.fn();
const authenticateHrAdminMock = jest.fn();
const getHrAdminByIdMock = jest.fn();
const getHrAdminByEmailMock = jest.fn();
jest.mock('../src/services/hr-admins', () => {
  class HrAdminExistsError extends Error {}
  return {
    createHrAdmin: (...a: unknown[]) => createHrAdminMock(...a),
    authenticateHrAdmin: (...a: unknown[]) => authenticateHrAdminMock(...a),
    getHrAdminById: (...a: unknown[]) => getHrAdminByIdMock(...a),
    getHrAdminByEmail: (...a: unknown[]) => getHrAdminByEmailMock(...a),
    HrAdminExistsError,
  };
});

const createCompanyMock = jest.fn();
const getPrimaryCompanyMock = jest.fn();
const provisionMemberMock = jest.fn();
const listMembersMock = jest.fn();
jest.mock('../src/services/attendance-membership', () => {
  class AttendanceMembershipError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return {
    createCompany: (...a: unknown[]) => createCompanyMock(...a),
    getPrimaryCompanyForTenant: (...a: unknown[]) => getPrimaryCompanyMock(...a),
    provisionMember: (...a: unknown[]) => provisionMemberMock(...a),
    listMembers: (...a: unknown[]) => listMembersMock(...a),
    setMemberStatus: jest.fn(),
    updateCompanyWifi: jest.fn(),
    getCompanyById: jest.fn(),
    findClaimedMembership: jest.fn(),
    claimMembership: jest.fn(),
    resolveCompanyConfig: jest.fn(),
    AttendanceMembershipError,
  };
});

jest.mock('../src/services/tenants', () => ({
  createTenant: jest.fn().mockResolvedValue({ id: 'tenant-co-1', email: 'company@x', company_name: 'Anchor Corp' }),
  authenticateTenant: jest.fn(), getTenantById: jest.fn(), getTenantByEmail: jest.fn(),
  createTenantWithHash: jest.fn(), hashPassword: jest.fn(), verifyPassword: jest.fn(), updateTenantPlan: jest.fn(),
}));

const recordAuditEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/platform', () => {
  const actual = jest.requireActual('../src/services/platform');
  return { ...actual, recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) };
});
jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]), createApiKey: jest.fn(), revokeApiKey: jest.fn(), countActiveKeys: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-06' }), getUsageSummary: jest.fn(), getRecentCalls: jest.fn(), getCurrentMonthUsage: jest.fn(),
}));
jest.mock('../src/services/pending-signups', () => ({ createPendingSignup: jest.fn(), consumePendingSignup: jest.fn() }));
jest.mock('../src/services/email', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/email-templates', () => ({
  welcomeEmail: () => ({ subject: '', html: '', text: '' }),
  signupAttemptedNoticeEmail: () => ({ subject: '', html: '', text: '' }),
  verifySignupEmail: () => ({ subject: '', html: '', text: '' }),
}));

import { createApp } from '../src/app';
import { issueHrAdminToken } from '../src/services/jwt';

const app = createApp();
const COMPANY = { id: 'co-1', name: 'Anchor Corp', location: 'HQ', wifi: { ssidLabel: 'Office', bssids: [], minSignalPercent: 85 }, status: 'active' };

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
});

describe('POST /api/hr/signup', () => {
  it('201 mints an HR session + sets the zeroauth_hr_jwt cookie', async () => {
    getHrAdminByEmailMock.mockResolvedValue(null);
    createHrAdminMock.mockResolvedValue({ id: 'hr-1', email: 'hr@co.com', tenant_id: 'tenant-co-1' });
    createCompanyMock.mockResolvedValue(COMPANY);

    const res = await request(app).post('/api/hr/signup').send({ email: 'hr@co.com', password: 'secret123', companyName: 'Anchor Corp' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.hrAdmin.tenantId).toBe('tenant-co-1');
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(cookie).toMatch(/zeroauth_hr_jwt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/hr/i);
  });

  it('409 when the email is already an HR admin', async () => {
    getHrAdminByEmailMock.mockResolvedValue({ id: 'hr-x' });
    const res = await request(app).post('/api/hr/signup').send({ email: 'hr@co.com', password: 'secret123', companyName: 'X' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });
});

describe('POST /api/hr/login', () => {
  it('200 on valid credentials, 401 on invalid', async () => {
    authenticateHrAdminMock.mockResolvedValueOnce({ id: 'hr-1', email: 'hr@co.com', tenant_id: 'tenant-co-1' });
    const ok = await request(app).post('/api/hr/login').send({ email: 'hr@co.com', password: 'secret123' });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();

    authenticateHrAdminMock.mockResolvedValueOnce(null);
    const bad = await request(app).post('/api/hr/login').send({ email: 'hr@co.com', password: 'wrong' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('invalid_credentials');
  });
});

describe('authed surface', () => {
  const token = issueHrAdminToken('hr-1', 'tenant-co-1', 'hr@co.com');

  it('401 without a token', async () => {
    const res = await request(app).get('/api/hr/account');
    expect(res.status).toBe(401);
  });

  it('200 with a valid HR token', async () => {
    getHrAdminByIdMock.mockResolvedValue({ id: 'hr-1', email: 'hr@co.com', full_name: null, tenant_id: 'tenant-co-1' });
    getPrimaryCompanyMock.mockResolvedValue(COMPANY);
    const res = await request(app).get('/api/hr/account').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.hrAdmin.id).toBe('hr-1');
    expect(res.body.company.name).toBe('Anchor Corp');
  });

  it('provision returns a single-use invite + emp-claim deeplink', async () => {
    getPrimaryCompanyMock.mockResolvedValue(COMPANY);
    provisionMemberMock.mockResolvedValue({
      membership: { id: 'm-1', employee_id: 'E1', full_name: 'Asha', status: 'invited', invite_code_expires_at: '2026-06-19T00:00:00Z' },
      inviteCode: 'ZA-AB23-CD45',
    });
    const res = await request(app).post('/api/hr/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeId: 'E1', fullName: 'Asha' });
    expect(res.status).toBe(201);
    expect(res.body.invite.code).toBe('ZA-AB23-CD45');
    expect(res.body.invite.deeplink).toBe('zeroauth://emp-claim?company=co-1&code=ZA-AB23-CD45');
  });
});

describe('JWT surface isolation (security)', () => {
  it('an HR token is NOT accepted on /api/console (wrong audience)', async () => {
    const hrToken = issueHrAdminToken('hr-1', 'tenant-co-1', 'hr@co.com');
    const res = await request(app).get('/api/console/keys').set('Authorization', `Bearer ${hrToken}`);
    expect(res.status).toBe(401);
  });

  it('a console-audience token is NOT accepted on /api/hr', async () => {
    const consoleToken = jwt.sign(
      { tenantId: 'tenant-co-1', email: 'dev@x', type: 'console' },
      config.jwt.secret,
      { issuer: 'zeroauth-console', audience: 'zeroauth-console', jwtid: crypto.randomUUID() },
    );
    const res = await request(app).get('/api/hr/account').set('Authorization', `Bearer ${consoleToken}`);
    expect(res.status).toBe(401);
  });
});
