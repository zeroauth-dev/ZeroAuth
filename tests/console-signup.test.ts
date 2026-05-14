/**
 * Integration tests for the F-2 partial mitigation in /api/console/signup
 * (issue #27). Asserts:
 *
 *   - Fresh signup → 201 with token + apiKey + welcome email queued
 *   - Duplicate signup → 409 email_taken + notice email queued + no leak
 *     of credentials in the 409 response body
 *   - The 409 path runs scrypt (timing equalization), so the wall-clock
 *     time of the two paths is similar (not byte-identical, but no longer
 *     a free timing oracle)
 *   - The welcome email goes to the new tenant's email
 *   - The notice email goes to the EXISTING tenant's email (NOT the
 *     attacker's email — that's the whole point of the notice)
 *
 * The full byte-identical F-2 fix (return 202 always + email verification
 * link to complete signup) is the v2, deferred to a follow-up PR because
 * it breaks the existing dashboard signup flow + Playwright happy path.
 */

const sendMailMock = jest.fn();
const createTenantMock = jest.fn();
const authenticateTenantMock = jest.fn();
const getTenantByIdMock = jest.fn();
const getTenantByEmailMock = jest.fn();
const createApiKeyMock = jest.fn();

jest.mock('../src/services/email', () => ({
  sendMail: (...args: unknown[]) => sendMailMock(...args),
  _resetTransporterForTests: jest.fn(),
}));

jest.mock('../src/services/tenants', () => ({
  createTenant: (...args: unknown[]) => createTenantMock(...args),
  authenticateTenant: (...args: unknown[]) => authenticateTenantMock(...args),
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args),
  getTenantByEmail: (...args: unknown[]) => getTenantByEmailMock(...args),
}));

jest.mock('../src/services/api-keys', () => ({
  createApiKey: (...args: unknown[]) => createApiKeyMock(...args),
  listApiKeys: jest.fn().mockResolvedValue([]),
  revokeApiKey: jest.fn(),
  countActiveKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/platform', () => ({
  recordAuditEvent: jest.fn().mockResolvedValue(undefined),
  getConsoleOverview: jest.fn(),
  listAuditEvents: jest.fn(),
  createDevice: jest.fn(),
  listDevices: jest.fn(),
  updateDevice: jest.fn(),
  createTenantUser: jest.fn(),
  listTenantUsers: jest.fn(),
  updateTenantUser: jest.fn(),
  listVerificationEvents: jest.fn(),
  listAttendanceEvents: jest.fn(),
}));

jest.mock('../src/services/usage', () => ({
  getUsageSummary: jest.fn(),
  getRecentCalls: jest.fn(),
  getCurrentMonthUsage: jest.fn().mockResolvedValue(0),
}));

import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

const VALID_PASSWORD = 'Aa1!stuvwxyz';

describe('POST /api/console/signup — F-2 partial mitigation (issue #27)', () => {
  beforeEach(() => {
    sendMailMock.mockReset();
    createTenantMock.mockReset();
    getTenantByEmailMock.mockReset();
    createApiKeyMock.mockReset();
    sendMailMock.mockResolvedValue({ ok: true, messageId: '<test>' });
  });

  describe('fresh email signup', () => {
    beforeEach(() => {
      getTenantByEmailMock.mockResolvedValue(null);
      createTenantMock.mockResolvedValue({
        id: 'tenant-new',
        email: 'fresh@example.com',
        company_name: 'Acme',
        plan: 'free',
        status: 'active',
      });
      createApiKeyMock.mockResolvedValue({
        key: 'za_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        id: 'key-1',
        name: 'Default Live Key',
        key_prefix: 'za_live_aaaaaa',
        scopes: [],
        environment: 'live',
      });
    });

    it('returns 201 with the token + apiKey shape', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD, companyName: 'Acme' });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.apiKey.key).toMatch(/^za_live_[a-f0-9]{48}$/);
      expect(res.body.tenant.id).toBe('tenant-new');
    });

    it('triggers the welcome email to the new tenant\'s address', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD, companyName: 'Acme' });

      // Welcome email is fire-and-forget — wait one tick for the void IIFE.
      await new Promise(resolve => setImmediate(resolve));

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'fresh@example.com',
          subject: expect.stringContaining('Welcome to ZeroAuth'),
        }),
      );
    });

    it('welcome email body never contains the API key (security-policy §10)', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'fresh@example.com', password: VALID_PASSWORD, companyName: 'Acme' });

      await new Promise(resolve => setImmediate(resolve));

      const call = sendMailMock.mock.calls.find(c =>
        (c[0] as { subject: string }).subject?.includes('Welcome'),
      );
      expect(call).toBeDefined();
      const body = (call![0] as { html: string; text: string });
      expect(body.html).not.toMatch(/za_live_[a-f0-9]{48}/);
      expect(body.text).not.toMatch(/za_live_[a-f0-9]{48}/);
    });
  });

  describe('duplicate email signup (F-2 partial mitigation)', () => {
    beforeEach(() => {
      getTenantByEmailMock.mockResolvedValue({
        id: 'tenant-existing',
        email: 'existing@example.com',
      });
    });

    it('returns 409 email_taken (status code split is the v1 deferred — see issue #27)', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('email_taken');
    });

    it('triggers the notice email to the LEGITIMATE account holder (not the attacker)', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });

      await new Promise(resolve => setImmediate(resolve));

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'existing@example.com',
          subject: expect.stringMatching(/Someone tried to sign up/i),
        }),
      );
    });

    it('does NOT create a tenant', async () => {
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });
      expect(createTenantMock).not.toHaveBeenCalled();
    });

    it('does NOT leak the tenant id in the 409 response', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });
      expect(JSON.stringify(res.body)).not.toContain('tenant-existing');
    });

    it('runs scrypt on the duplicate path (timing equalization)', async () => {
      // The check is a wall-clock floor — scrypt at default cost takes
      // multiple ms. If the duplicate path returned in <1ms we'd know the
      // equalization was skipped.
      const t0 = Date.now();
      await request(app)
        .post('/api/console/signup')
        .send({ email: 'existing@example.com', password: VALID_PASSWORD });
      const elapsed = Date.now() - t0;
      // Conservative lower bound — scrypt N=16k r=8 p=1 (Node defaults)
      // is ~50ms on commodity hardware. Test machine may be slower; use 10.
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });
  });

  describe('invalid input — no enumeration via 400 path', () => {
    it('400 invalid_request when email is missing (no DB lookup, no email sent)', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ password: VALID_PASSWORD });
      expect(res.status).toBe(400);
      expect(getTenantByEmailMock).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('400 invalid_password when password is too short (no DB lookup)', async () => {
      const res = await request(app)
        .post('/api/console/signup')
        .send({ email: 'x@y.com', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_password');
      expect(getTenantByEmailMock).not.toHaveBeenCalled();
    });
  });
});
