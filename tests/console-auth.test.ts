/**
 * Tests for /api/console/* authentication.
 *
 * Phase 0 audit finding C-3 closure: the `?access_token=<jwt>` query
 * fallback that previously authenticated EventSource clients is
 * removed. The replacement is an HttpOnly `zeroauth_console_jwt`
 * cookie set at login + verify-signup, read in the auth middleware.
 *
 * These tests pin the new contract:
 *   1. Authorization: Bearer header still works.
 *   2. HttpOnly cookie also works.
 *   3. The `?access_token=` query string MUST be rejected.
 *   4. `/api/console/login` sets the HttpOnly cookie on success.
 *   5. The cookie has HttpOnly + SameSite=Strict + scoped path.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { createApp } from '../src/app';

function issueConsoleToken(tenantId: string, email = 'dev@example.com'): string {
  return jwt.sign(
    { tenantId, email, type: 'console' },
    config.jwt.secret,
    {
      expiresIn: '1h',
      issuer: 'zeroauth-console',
      audience: 'zeroauth-console',
      jwtid: 'test-jti-' + tenantId,
    },
  );
}

// Mock external deps so we don't hit Postgres.
jest.mock('../src/services/tenants', () => ({
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
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

jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
}));

jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-05' }),
}));

jest.mock('../src/services/platform', () => ({
  listDevices: jest.fn().mockResolvedValue([]),
  createDevice: jest.fn(),
  updateDevice: jest.fn(),
  listTenantUsers: jest.fn().mockResolvedValue([]),
  createTenantUser: jest.fn(),
  updateTenantUser: jest.fn(),
  listVerificationEvents: jest.fn().mockResolvedValue([]),
  listAttendanceEvents: jest.fn().mockResolvedValue([]),
  recordAuditEvent: jest.fn().mockResolvedValue(undefined),
  listAuditEvents: jest.fn().mockResolvedValue([]),
}));

describe('console auth', () => {
  const app = createApp();

  describe('header path', () => {
    it('accepts Authorization: Bearer', async () => {
      const token = issueConsoleToken('tenant-A');
      const res = await request(app)
        .get('/api/console/keys')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('401 unauthorized when nothing presented', async () => {
      const res = await request(app).get('/api/console/keys');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('401 session_expired on a malformed bearer token', async () => {
      const res = await request(app)
        .get('/api/console/keys')
        .set('Authorization', 'Bearer not-a-jwt');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('session_expired');
    });
  });

  describe('HttpOnly cookie path (replaces ?access_token=)', () => {
    it('accepts zeroauth_console_jwt cookie', async () => {
      const token = issueConsoleToken('tenant-A');
      const res = await request(app)
        .get('/api/console/keys')
        .set('Cookie', `zeroauth_console_jwt=${token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('query-string fallback removed (P0 audit finding C-3)', () => {
    it('rejects ?access_token=<jwt> with unauthorized', async () => {
      const token = issueConsoleToken('tenant-A');
      const res = await request(app)
        .get(`/api/console/keys?access_token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('rejects ?access_token=<jwt> on SSE endpoint too', async () => {
      const token = issueConsoleToken('tenant-A');
      const res = await request(app)
        .get(`/api/console/proof-pairing/sessions/some-id/stream?access_token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    it('source carries no req.query.access_token reference in console.ts', () => {
      // Future-proof: anyone re-introducing the query fallback will
      // also have to delete this guard.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      const path = require('path') as typeof import('path');
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/routes/console.ts'),
        'utf8',
      );
      expect(src).not.toMatch(/req\.query\.access_token/);
      expect(src).not.toMatch(/req\.query\[['"]access_token['"]\]/);
    });
  });

  describe('login sets HttpOnly cookie', () => {
    it('issues Set-Cookie zeroauth_console_jwt with HttpOnly + SameSite=Strict on successful login', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const tenants = require('../src/services/tenants') as {
        authenticateTenant: jest.Mock;
      };
      tenants.authenticateTenant.mockResolvedValue({
        id: 'tenant-A',
        email: 'a@example.com',
        company_name: 'A Co',
        plan: 'free',
        status: 'active',
        rate_limit: 100,
        monthly_quota: 1000,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const res = await request(app)
        .post('/api/console/login')
        .send({ email: 'a@example.com', password: 'pw' });
      expect(res.status).toBe(200);
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie as string];
      const jwtCookie = cookies.find((c: string) => c.startsWith('zeroauth_console_jwt='));
      expect(jwtCookie).toBeDefined();
      expect(jwtCookie).toMatch(/HttpOnly/i);
      expect(jwtCookie).toMatch(/SameSite=Strict/i);
      expect(jwtCookie).toMatch(/Path=\/api\/console/);
    });
  });
});
