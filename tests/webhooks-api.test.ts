/**
 * Request-level tests for the tenant-webhooks console surface
 * (src/routes/console-webhooks.ts).
 *
 *   GET    /api/console/webhooks
 *   POST   /api/console/webhooks
 *   DELETE /api/console/webhooks/:id
 *
 * Postgres is stubbed via `jest.mock('../src/services/db')` so the suite
 * runs without a live database; `getPool().query` is a jest.fn whose
 * `mockResolvedValueOnce` queue feeds the router's SQL calls in order.
 * `recordAuditEvent` is also mocked since the route fires fire-and-forget
 * audit writes that would otherwise hit the audit hash chain machinery.
 *
 * Three guarantees pinned here:
 *
 *   1. Happy path — POST creates a row, GET lists it, DELETE removes it.
 *   2. Secret-once invariant — POST returns the plaintext `secret` +
 *      `warning` field, but GET / DELETE responses MUST NOT include it.
 *   3. Cross-tenant isolation — a webhook owned by tenant B is invisible
 *      to tenant A, and tenant A cannot DELETE it even by guessing the
 *      UUID. The route gates every query on `(id, tenant_id, environment)`.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';

const mockQuery = jest.fn();
const mockRecordAuditEvent = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

jest.mock('../src/services/platform', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

// Console-surface dependencies that app.ts pulls in at import time.
jest.mock('../src/services/tenants', () => ({
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  getTenantById: jest.fn().mockResolvedValue(null),
  getTenantByEmail: jest.fn(),
  updateTenantPlan: jest.fn(),
}));
jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  countActiveKeys: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-05' }),
  getUsageSummary: jest.fn(),
  getRecentCalls: jest.fn(),
  getCurrentMonthUsage: jest.fn(),
}));
jest.mock('../src/services/pending-signups', () => ({
  createPendingSignup: jest.fn(),
  consumePendingSignup: jest.fn(),
}));
jest.mock('../src/services/email', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/email-templates', () => ({
  welcomeEmail: () => ({ subject: '', html: '', text: '' }),
  signupAttemptedNoticeEmail: () => ({ subject: '', html: '', text: '' }),
  verifySignupEmail: () => ({ subject: '', html: '', text: '' }),
}));

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

/** Build a synthetic `tenant_webhooks` row. */
function fakeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: 'tenant-A',
    environment: 'live',
    url: 'https://hooks.example.com/zeroauth',
    secret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    event_filter: ['*'],
    enabled: true,
    description: null,
    last_delivery_at: null,
    last_delivery_status: null,
    consecutive_failures: 0,
    created_at: new Date('2026-05-30T00:00:00Z'),
    updated_at: new Date('2026-05-30T00:00:00Z'),
    ...overrides,
  };
}

describe('POST/GET/DELETE /api/console/webhooks', () => {
  const app = createApp();

  beforeEach(() => {
    mockQuery.mockReset();
    mockRecordAuditEvent.mockClear();
  });

  // ── Happy path — create + list + delete ───────────────────────

  describe('happy path', () => {
    it('POST creates a webhook, GET lists it, DELETE removes it', async () => {
      const tokenA = issueConsoleToken('tenant-A');

      // POST — first the quota count (0/10), then the INSERT.
      mockQuery
        .mockResolvedValueOnce({ rows: [{ n: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });

      const createRes = await request(app)
        .post('/api/console/webhooks')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          url: 'https://hooks.example.com/zeroauth',
          event_filter: ['*'],
          environment: 'live',
        });
      expect(createRes.status).toBe(201);
      expect(createRes.body.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(createRes.body.url).toBe('https://hooks.example.com/zeroauth');
      expect(createRes.body.environment).toBe('live');
      expect(createRes.body.enabled).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // GET — single SELECT returning the same row.
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });
      const listRes = await request(app)
        .get('/api/console/webhooks?environment=live')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.environment).toBe('live');
      expect(listRes.body.webhooks).toHaveLength(1);
      expect(listRes.body.webhooks[0].id).toBe('11111111-1111-1111-1111-111111111111');

      // DELETE — single DELETE returning the row that was removed.
      mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });
      const delRes = await request(app)
        .delete('/api/console/webhooks/11111111-1111-1111-1111-111111111111?environment=live')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.message).toMatch(/deleted/i);
      expect(delRes.body.webhook.id).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('rejects unauthenticated requests with 401 on every verb', async () => {
      const getRes = await request(app).get('/api/console/webhooks');
      expect(getRes.status).toBe(401);
      const postRes = await request(app)
        .post('/api/console/webhooks')
        .send({ url: 'https://hooks.example.com/h', event_filter: ['*'] });
      expect(postRes.status).toBe(401);
      const delRes = await request(app)
        .delete('/api/console/webhooks/11111111-1111-1111-1111-111111111111');
      expect(delRes.status).toBe(401);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── Secret-once invariant ────────────────────────────────────

  describe('secret-once invariant', () => {
    it('POST returns the plaintext secret + warning EXACTLY once', async () => {
      const tokenA = issueConsoleToken('tenant-A');
      // The router generates `secret` server-side via crypto.randomBytes
      // and passes it as the INSERT $4 param. The wire-format secret is
      // that exact value — we capture it from the SQL call and compare.
      mockQuery
        .mockResolvedValueOnce({ rows: [{ n: '0' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });

      const res = await request(app)
        .post('/api/console/webhooks')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          url: 'https://hooks.example.com/zeroauth',
          event_filter: ['verification.*'],
        });
      expect(res.status).toBe(201);
      expect(typeof res.body.secret).toBe('string');
      expect(res.body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{40,}$/);
      // The secret in the body is the exact value passed into the INSERT.
      const insertedSecret = mockQuery.mock.calls[1][1][3];
      expect(res.body.secret).toBe(insertedSecret);
      expect(res.body.warning).toMatch(/never be shown again/i);
    });

    it('GET listing NEVER exposes the secret column', async () => {
      const tokenA = issueConsoleToken('tenant-A');
      const row = fakeRow({
        secret: 'whsec_TESTSECRET_THAT_MUST_NOT_LEAK_zzzzzzzzzzzz',
      });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await request(app)
        .get('/api/console/webhooks')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.webhooks).toHaveLength(1);
      expect(res.body.webhooks[0]).not.toHaveProperty('secret');
      expect(JSON.stringify(res.body)).not.toContain('whsec_TESTSECRET');
    });

    it('DELETE response NEVER includes the secret', async () => {
      const tokenA = issueConsoleToken('tenant-A');
      const row = fakeRow({
        secret: 'whsec_DELETEPATH_SHOULDNT_LEAK_zzzzzzzzzzzzzzzz',
      });
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const res = await request(app)
        .delete('/api/console/webhooks/11111111-1111-1111-1111-111111111111?environment=live')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.webhook).not.toHaveProperty('secret');
      expect(JSON.stringify(res.body)).not.toContain('whsec_DELETEPATH');
    });
  });

  // ── Cross-tenant isolation ──────────────────────────────────

  describe('cross-tenant isolation', () => {
    it('tenant A cannot see tenant B webhooks via GET', async () => {
      const tokenA = issueConsoleToken('tenant-A');
      // The real router scopes the SELECT on `tenant_id = $1` from the
      // JWT — so the DB returns no rows for tenant A.
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const res = await request(app)
        .get('/api/console/webhooks?environment=live')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.webhooks).toEqual([]);

      // The SELECT was parameterised on tenant-A — not on any tenant id
      // the client could have supplied via header/body.
      const sqlCall = mockQuery.mock.calls[0];
      expect(sqlCall[0]).toMatch(/FROM tenant_webhooks/);
      expect(sqlCall[1]).toEqual(['tenant-A', 'live']);
      expect(sqlCall[1]).not.toContain('tenant-B');
    });

    it('tenant A cannot DELETE a tenant B webhook even by guessing the UUID', async () => {
      const tokenA = issueConsoleToken('tenant-A');
      // The DELETE is gated by `WHERE id = $1 AND tenant_id = $2 AND
      // environment = $3` — so passing tenant B's UUID with tenant A's
      // JWT returns rowCount=0 and the router emits 404 + a failure
      // audit row.
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const tenantBWebhookId = '22222222-2222-2222-2222-222222222222';
      const res = await request(app)
        .delete(`/api/console/webhooks/${tenantBWebhookId}?environment=live`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('webhook_not_found');

      // The DELETE parameter list MUST include tenant-A — even though
      // the URL referenced tenant B's webhook id. This is the
      // cross-tenant probe the WHERE-clause defends against.
      const sqlCall = mockQuery.mock.calls[0];
      expect(sqlCall[0]).toMatch(/DELETE FROM tenant_webhooks/);
      expect(sqlCall[1]).toEqual([tenantBWebhookId, 'tenant-A', 'live']);

      // The failure audit row was recorded against tenant-A's id —
      // never tenant-B's — for forensic visibility of probing attempts.
      expect(mockRecordAuditEvent).toHaveBeenCalledTimes(1);
      const auditCall = mockRecordAuditEvent.mock.calls[0];
      expect(auditCall[0]).toBe('tenant-A');
      expect(auditCall[1]).toMatchObject({
        action: 'webhook.deleted',
        status: 'failure',
        entityType: 'webhook',
        entityId: tenantBWebhookId,
      });
    });

    it('tenant B sees + deletes its own webhook (isolation is symmetric)', async () => {
      const tokenB = issueConsoleToken('tenant-B', 'b@example.com');
      const rowB = fakeRow({
        id: '22222222-2222-2222-2222-222222222222',
        tenant_id: 'tenant-B',
        url: 'https://hooks.b.example.com/zeroauth',
      });

      // GET for tenant B returns tenant B's row, gated on `tenant-B`.
      mockQuery.mockResolvedValueOnce({ rows: [rowB], rowCount: 1 });
      const listRes = await request(app)
        .get('/api/console/webhooks')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.webhooks).toHaveLength(1);
      expect(listRes.body.webhooks[0].tenant_id).toBe('tenant-B');
      expect(mockQuery.mock.calls[0][1]).toEqual(['tenant-B', 'live']);

      // DELETE for tenant B's own row succeeds.
      mockQuery.mockResolvedValueOnce({ rows: [rowB], rowCount: 1 });
      const delRes = await request(app)
        .delete('/api/console/webhooks/22222222-2222-2222-2222-222222222222?environment=live')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(delRes.status).toBe(200);
      expect(mockQuery.mock.calls[1][1]).toEqual([
        '22222222-2222-2222-2222-222222222222',
        'tenant-B',
        'live',
      ]);

      // The success audit row was attributed to tenant-B.
      const successAudit = mockRecordAuditEvent.mock.calls.find(
        (c) => (c[1] as { status: string }).status === 'success',
      );
      expect(successAudit).toBeDefined();
      expect(successAudit?.[0]).toBe('tenant-B');
    });
  });
});
