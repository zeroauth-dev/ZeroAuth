/**
 * Request-level tests for /api/demo-portal/* — the investor-demo
 * bridge in front of the production /v1/proof-pairing/* service.
 *
 *   POST  /api/demo-portal/init-login          — open a pairing session
 *   GET   /api/demo-portal/me                  — read the session cookie
 *   POST  /api/demo-portal/logout              — clear the cookie
 *   GET   /api/demo-portal/sessions/:id/events — SSE stream + cookie set
 *
 * Six acceptance criteria pinned, one per request from the task brief:
 *
 *   1. POST /init-login returns a session_id + qr_payload.
 *   2. GET /me without a cookie returns 401.
 *   3. GET /me with a valid HMAC'd cookie returns the demo user info.
 *   4. POST /logout clears the cookie via Set-Cookie Max-Age=0.
 *   5. The SSE stream emits an `authenticated` event once the underlying
 *      pairing row transitions to `consumed`.
 *   6. Cross-tenant: a pairing session owned by another tenant is
 *      invisible — the SSE auth-gate returns 404 (A-25 uniform with
 *      "doesn't exist").
 *
 * Patterns reused from tests/proof-pairing.test.ts (service mocking,
 * route-level coverage) and tests/central-api.test.ts (tenant
 * isolation).
 */

import crypto from 'crypto';
import request from 'supertest';
import { config } from '../src/config';

// ─── Mocks ─────────────────────────────────────────────────────────────
// Demo-portal hits Postgres (getPool().query) for tenant_users +
// proof_pairing_sessions reads, plus the tenants service for tenant
// lookup. Everything is stubbed; we never touch a live DB.

const mockQuery = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

const DEMO_TENANT_ID = '67ef58b3-683b-4033-83be-0b90d6dee38c';
const getTenantByIdMock = jest.fn();
const getTenantByEmailMock = jest.fn();

jest.mock('../src/services/tenants', () => ({
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args),
  getTenantByEmail: (...args: unknown[]) => getTenantByEmailMock(...args),
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  updateTenantPlan: jest.fn(),
}));

// proof-pairing.createSession is the only function the route calls.
// Error classes are re-exported as real ES classes so the
// `err instanceof TooManyPendingSessions` check in the route catch
// block still fires.
const pairingCreateSessionMock = jest.fn();

jest.mock('../src/services/proof-pairing', () => {
  class PairingSessionNotFound extends Error { code = 'pairing_session_not_found'; }
  class PairingSessionBindMismatch extends Error { code = 'pairing_session_bind_mismatch'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  return {
    createSession: (...args: unknown[]) => pairingCreateSessionMock(...args),
    PairingSessionNotFound,
    PairingSessionBindMismatch,
    TooManyPendingSessions,
    // No-op stubs for the rest of the surface the app's import graph
    // pulls in via the v1 router.
    submitProof: jest.fn(),
    getSession: jest.fn(),
    getSessionPublicMinimal: jest.fn(),
    subscribeStream: jest.fn(),
    expireOverdueSessions: jest.fn(),
    streamHeartbeatMs: 15000,
  };
});

// Console-surface services app.ts pulls at import — no-op stubs so
// createApp() doesn't reach for live state.
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
jest.mock('../src/services/pending-signups', () => ({ createPendingSignup: jest.fn(), consumePendingSignup: jest.fn() }));
jest.mock('../src/services/email', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/email-templates', () => ({
  welcomeEmail: () => ({ subject: '', html: '', text: '' }),
  signupAttemptedNoticeEmail: () => ({ subject: '', html: '', text: '' }),
  verifySignupEmail: () => ({ subject: '', html: '', text: '' }),
}));

import { createApp } from '../src/app';

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Replicate src/routes/demo-portal.ts encodeCookie() so a test can
 * synthesise a "valid logged-in" cookie without walking the SSE flow.
 * Key derivation: sha256("demo-portal::" || config.jwt.secret); wire
 * format: base64url(json) + "." + base64url(hmac).
 */
function makeDemoCookie(payload: {
  userId: string;
  pairingSessionId: string;
  startedAtMs: number;
}): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const key = crypto.createHash('sha256')
    .update(`demo-portal::${config.jwt.secret}`)
    .digest();
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function makeTenantRow(id: string) {
  return {
    id, email: 'demo-portal@zeroauth.dev', company_name: 'NeoBank Demo Portal',
    plan: 'free', status: 'active', rate_limit: 100, monthly_quota: 1000,
    metadata: {}, created_at: new Date(), updated_at: new Date(),
  };
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  // Happy path: the demo-portal tenant resolves on the deterministic id.
  getTenantByIdMock.mockResolvedValue(makeTenantRow(DEMO_TENANT_ID));
  getTenantByEmailMock.mockResolvedValue(null);
});

// ─── (1) POST /init-login → session_id + qr_payload ───────────────────

describe('POST /api/demo-portal/init-login', () => {
  it('201 returns a session_id + qr_payload (with camelCase aliases)', async () => {
    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(31).toString('hex');
    const qrPayload = `za:pair:1:${id}:${nonce}:zeroauth.dev:abcd`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    pairingCreateSessionMock.mockResolvedValueOnce({
      id, nonce, sessionBindToken: 'unused-by-spa', expiresAt, qrPayload,
    });

    const res = await request(app).post('/api/demo-portal/init-login').send({});

    expect(res.status).toBe(201);
    // Snake-case (demo-portal/src/lib/api.ts) + camelCase (SignIn.tsx).
    expect(res.body.session_id).toBe(id);
    expect(res.body.qr_payload).toBe(qrPayload);
    expect(res.body.sessionId).toBe(id);
    expect(res.body.qrPayload).toBe(qrPayload);
    expect(res.body.expires_at).toBe(expiresAt);
    // Android custom-scheme deeplink wraps the QR payload.
    expect(res.body.deeplink).toMatch(/^zeroauth:\/\/pair\?p=/);

    // Pairing service called with demo-portal tenant + locked `test` env.
    // api-key-id is null because the SPA holds no API key.
    expect(pairingCreateSessionMock).toHaveBeenCalledTimes(1);
    const callArgs = pairingCreateSessionMock.mock.calls[0];
    expect(callArgs[0]).toBe(DEMO_TENANT_ID);
    expect(callArgs[1]).toBe('test');
    expect(callArgs[2]).toBeNull();
  });
});

// ─── (2) GET /me without cookie → 401 ─────────────────────────────────
// ─── (3) GET /me with valid cookie → user info ────────────────────────

describe('GET /api/demo-portal/me', () => {
  it('401 not_authenticated when no cookie is present', async () => {
    const res = await request(app).get('/api/demo-portal/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not_authenticated');
    // No PII leaks — uniform body regardless of cookie absence vs mac
    // mismatch (A-25 enumeration defence).
    expect(res.body.message).toBe('No demo session.');
  });

  it('200 returns demo user info when cookie is valid and user row exists', async () => {
    const userId = '33333333-3333-3333-3333-333333333333';
    const did = 'did:zeroauth:base:0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
    const startedAtMs = Date.UTC(2026, 4, 28, 10, 0, 0);
    const cookie = makeDemoCookie({
      userId,
      pairingSessionId: '44444444-4444-4444-4444-444444444444',
      startedAtMs,
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: userId, external_id: 'demo-user-1', full_name: 'Asha Demo', did,
      }],
    });

    const res = await request(app)
      .get('/api/demo-portal/me')
      .set('Cookie', `demo_portal_session=${cookie}`);

    expect(res.status).toBe(200);
    // Both wire shapes — snake_case (api.ts contract) + camelCase
    // (SignIn.tsx reducer). The route emits both so neither client
    // has to rename mid-demo.
    expect(res.body.user_id).toBe(userId);
    expect(res.body.userId).toBe(userId);
    expect(res.body.did).toBe(did);
    expect(res.body.name).toBe('Asha Demo');
    expect(res.body.session_started_at).toBe(new Date(startedAtMs).toISOString());
    // NeoBank dashboard payload.
    expect(res.body.user.id).toBe(userId);
    expect(res.body.accounts).toHaveLength(3);
    expect(res.body.accounts[0]).toMatchObject({
      kind: 'savings',
      maskedNumber: expect.stringMatching(/^•••• /),
    });

    // SQL is scoped to (id, demo_portal_tenant_id, 'test').
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([userId, DEMO_TENANT_ID, 'test']);
  });
});

// ─── (4) POST /logout clears the cookie ───────────────────────────────

describe('POST /api/demo-portal/logout', () => {
  it('200 {ok:true} and emits a Max-Age=0 Set-Cookie header', async () => {
    const res = await request(app).post('/api/demo-portal/logout').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    // Clearing cookie: same name, Max-Age=0, scoped path, HttpOnly.
    expect(cookieStr).toMatch(/demo_portal_session=;/);
    expect(cookieStr).toMatch(/Max-Age=0/i);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Path=\/api\/demo-portal/i);
  });
});

// ─── (5) SSE emits `authenticated` once the pairing row consumes ──────
//
// The route's Phase 1 fast path polls the row up to 2 s after open. If
// the row is already `consumed`, the response carries Set-Cookie in
// the initial headers, emits `session_bound` + `authenticated`, and
// closes. We seed the first lookup as consumed so the route skips the
// poll loop and exercises the cookie-on-initial-headers path.

describe('GET /api/demo-portal/sessions/:id/events — SSE', () => {
  it('emits `authenticated` when the pairing row is already consumed', async () => {
    const sessionId = '77777777-7777-7777-7777-777777777777';
    const userId = '88888888-8888-8888-8888-888888888888';
    const did = 'did:zeroauth:base:0xdeadbeefcafebabe0123456789abcdef01234567';
    const consumedAt = new Date('2026-05-28T14:22:31.000Z');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    mockQuery.mockImplementation(async (sql: string) => {
      if (/FROM proof_pairing_sessions/i.test(sql)) {
        return {
          rows: [{
            id: sessionId,
            state: 'consumed',
            consumed_user_id: userId,
            consumed_at: consumedAt,
            expires_at: expiresAt,
            last_error_code: null,
            tenant_id: DEMO_TENANT_ID,
          }],
        };
      }
      if (/FROM tenant_users/i.test(sql)) {
        return { rows: [{ id: userId, external_id: 'demo-user-1', full_name: 'Asha Demo', did }] };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/demo-portal/sessions/${sessionId}/events`)
      .buffer(true);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);

    // Set-Cookie lands on the initial headers (Phase 1 fast path) so
    // the SPA's follow-up /me call can authenticate.
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(cookieStr).toMatch(/demo_portal_session=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Path=\/api\/demo-portal/i);

    // SSE body — snapshot + bound + terminal `authenticated`.
    expect(res.text).toContain('event: session_created');
    expect(res.text).toContain('event: session_bound');
    expect(res.text).toContain('event: authenticated');
    expect(res.text).toContain(`"userId":"${userId}"`);
    expect(res.text).toContain(`"did":"${did}"`);
    expect(res.text).toContain('"type":"authenticated"');
  });
});

// ─── (6) Cross-tenant — another tenant's session is invisible ─────────
//
// The route locks every DB lookup to (id, demo_portal_tenant_id,
// 'test'). A session created by ANY other tenant returns zero rows and
// the route surfaces 404 — same body as the "doesn't exist" branch
// (A-25 enumeration defence).

describe('cross-tenant isolation', () => {
  it('404 pairing_session_not_found for a session owned by a different tenant', async () => {
    const otherTenantSessionId = '99999999-9999-9999-9999-999999999999';

    // The route MUST scope the query to the demo-portal tenant id —
    // never an unscoped query, never the attacker's tenant id.
    mockQuery.mockImplementation(async (_sql: string, params: unknown[]) => {
      const [, tenantId] = params as [string, string];
      expect(tenantId).toBe(DEMO_TENANT_ID);
      return { rows: [] };
    });

    const res = await request(app)
      .get(`/api/demo-portal/sessions/${otherTenantSessionId}/events`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('pairing_session_not_found');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([otherTenantSessionId, DEMO_TENANT_ID, 'test']);
  });
});
