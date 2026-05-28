/**
 * Tests for the live verifications SSE endpoint.
 *
 *   GET /api/console/verifications/stream
 *
 * Three assertion blocks (the spec calls for two; we add a third
 * for the heartbeat invariant because the operator-facing kiosk
 * stays connected for hours and the heartbeat is the only thing
 * that keeps middleboxes from idling the socket out):
 *
 *   1. Auth — an unauthenticated request gets 401 before the
 *      socket is upgraded.
 *
 *   2. Subscribe — an authenticated subscriber receives a
 *      `verification` event within 1 second of an
 *      `appendAuditEvent` write for a verification-class action.
 *
 *   3. Two-tenant isolation — a subscriber on tenant A NEVER sees
 *      a verification written for tenant B. The audit row commits
 *      for both, but the emitter key is the tenant id, so the
 *      tenant A consumer's transcript contains zero references to
 *      tenant B.
 *
 *   4. Heartbeat — the route writes a `: connected` comment frame
 *      immediately on subscribe so the client transitions out of
 *      CONNECTING without waiting on the 25 s heartbeat tick.
 *
 * The SSE flow uses Node's raw http module so we can hold the
 * connection open and inspect the streamed bytes; supertest's
 * `.buffer(true)` works for streams that end on their own, but
 * the verifications stream is open-ended and we need to close it
 * explicitly from the test side after observing the event.
 */

import http from 'http';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'net';
import { config } from '../src/config';
import { createApp } from '../src/app';

// We want the real audit service to fire the emitter, but we don't
// want it actually writing to Postgres. Replace `appendAuditEvent`
// inline at the spot that emits — by mocking only the DB layer and
// letting the audit service run end-to-end.

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
const mockPool = {
  connect: jest.fn().mockResolvedValue(mockClient),
  query: jest.fn(),
};

jest.mock('../src/services/db', () => ({
  getPool: () => mockPool,
}));

// Console-auth dependencies — same shape as `tests/console-auth.test.ts`.
// We don't exercise login here; the stream just needs the JWT to pass.
jest.mock('../src/services/tenants', () => ({
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  getTenantById: jest.fn().mockResolvedValue({
    id: 'tenant-A',
    email: 'a@example.com',
    company_name: 'A Co',
    plan: 'free',
    status: 'active',
  }),
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
  getUsageSummary: jest.fn(),
  getRecentCalls: jest.fn(),
  getCurrentMonthUsage: jest.fn(),
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
  getConsoleOverview: jest.fn().mockResolvedValue({}),
}));

// pending-signups + email shouldn't fire in these tests but the route
// module imports them at top.
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

// Run the audit module's logic end-to-end. The audit module's INSERT
// goes through the mocked `getPool` → `connect()` → `client.query`
// chain. We seed query() to return a synthetic id so the emit fires.
//
// Plumbing:
//   BEGIN                                  →  return ok
//   SELECT pg_advisory_xact_lock(...)      →  return ok
//   SELECT event_hash FROM audit_events …  →  return { rows: [] } (genesis)
//   INSERT INTO audit_events …             →  return { rows: [{ id: '42' }] }
//   COMMIT                                 →  return ok
import {
  appendAuditEvent,
} from '../src/services/audit';
import {
  __resetVerificationEmitterForTests,
} from '../src/services/verification-events';

function seedClientForOneInsert(returnedId: string): void {
  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })       // BEGIN
    .mockResolvedValueOnce({ rows: [] })       // advisory lock
    .mockResolvedValueOnce({ rows: [] })       // fetchPreviousHash
    .mockResolvedValueOnce({ rows: [{ id: returnedId }] }) // INSERT
    .mockResolvedValueOnce({ rows: [] });      // COMMIT
}

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

// ─── Helpers ────────────────────────────────────────────────────

interface SseClientHandle {
  socket: http.IncomingMessage;
  buffer: string;
  events: Array<{ event: string; data: string }>;
  raw: string[];
  close: () => void;
  /** Resolves once the next `event: verification` frame lands. */
  nextVerification: (timeoutMs?: number) => Promise<{ event: string; data: string }>;
}

function parseSseChunks(buffer: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const blocks = buffer.split(/\n\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (block.startsWith(':')) continue; // comment frame
    let event = 'message';
    let data = '';
    for (const line of block.split(/\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data = line.slice(5).trim();
    }
    if (event !== 'message' || data) events.push({ event, data });
  }
  return events;
}

async function openSseClient(
  port: number,
  path: string,
  token: string | null,
): Promise<SseClientHandle> {
  return new Promise<SseClientHandle>((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({ port, path, method: 'GET', headers }, (res) => {
      const handle: SseClientHandle = {
        socket: res,
        buffer: '',
        events: [],
        raw: [],
        close: () => {
          req.destroy();
          res.destroy();
        },
        nextVerification: (timeoutMs = 1000) =>
          new Promise<{ event: string; data: string }>((resolveEv, rejectEv) => {
            const start = Date.now();
            const tick = setInterval(() => {
              const v = handle.events.find((e) => e.event === 'verification');
              if (v) {
                clearInterval(tick);
                resolveEv(v);
                return;
              }
              if (Date.now() - start > timeoutMs) {
                clearInterval(tick);
                rejectEv(new Error(`Timed out waiting for verification event after ${timeoutMs} ms`));
              }
            }, 10);
          }),
      };
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        handle.buffer += chunk;
        handle.raw.push(chunk);
        handle.events = parseSseChunks(handle.buffer);
      });
      res.on('error', () => { /* ignore — test closes the socket */ });
      res.on('end', () => { /* socket closed */ });
      // Hand the handle back once headers land.
      resolve(handle);
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GET /api/console/verifications/stream', () => {
  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    const app = createApp();
    server = http.createServer(app);
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  beforeEach(() => {
    __resetVerificationEmitterForTests();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
  });

  // ── Assertion 1 — auth ──────────────────────────────────────

  it('rejects unauthenticated requests with 401 before opening the stream', (done) => {
    const req = http.request({ port, path: '/api/console/verifications/stream', method: 'GET' }, (res) => {
      expect(res.statusCode).toBe(401);
      // We don't necessarily get an event-stream content-type on a
      // 401; just confirm the body identifies the error code.
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        expect(body).toContain('unauthorized');
        done();
      });
    });
    req.on('error', done);
    req.end();
  });

  // ── Assertion 2 — subscribe + receive ───────────────────────

  it('delivers a verification.verify_success audit row to a subscribed consumer within 1 s', async () => {
    const token = issueConsoleToken('tenant-A');
    const client = await openSseClient(port, '/api/console/verifications/stream', token);

    try {
      // The route writes ': connected' first. The audit emit happens
      // after a small await chain — give the route a tick to register
      // the listener.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now drive a verification audit row through appendAuditEvent.
      seedClientForOneInsert('1001');
      await appendAuditEvent({
        tenant_id: 'tenant-A',
        environment: 'live',
        actor_type: 'api_key',
        actor_id: 'key-1',
        action: 'verification.verify_success',
        entity_type: 'verification',
        entity_id: 'ver-1',
        status: 'success',
        summary: 'zkp verification succeeded',
        metadata: {
          did: 'did:zeroauth:base:0x1234',
          latency_ms: 1234,
          proof_hash: '0xabcd',
        },
      });

      const event = await client.nextVerification(1000);
      expect(event.event).toBe('verification');
      const payload = JSON.parse(event.data) as Record<string, unknown>;
      expect(payload.tenant_id).toBe('tenant-A');
      expect(payload.audit_id).toBe('1001');
      expect(payload.action).toBe('verification.verify_success');
      expect(payload.status).toBe('success');
      expect(payload.did).toBe('did:zeroauth:base:0x1234');
      expect(payload.latency_ms).toBe(1234);
      expect(payload.proof_hash).toBe('0xabcd');
      expect(payload.environment).toBe('live');
    } finally {
      client.close();
    }
  });

  // ── Assertion 3 — two-tenant isolation ──────────────────────

  it('a tenant A subscriber never sees a tenant B verification', async () => {
    const tokenA = issueConsoleToken('tenant-A');
    const tokenB = issueConsoleToken('tenant-B');
    const clientA = await openSseClient(port, '/api/console/verifications/stream', tokenA);
    const clientB = await openSseClient(port, '/api/console/verifications/stream', tokenB);

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Drive a verification for tenant B only.
      seedClientForOneInsert('2002');
      await appendAuditEvent({
        tenant_id: 'tenant-B',
        environment: 'live',
        actor_type: 'api_key',
        actor_id: 'key-B',
        action: 'verification.verify_success',
        entity_type: 'verification',
        entity_id: 'ver-B',
        status: 'success',
        summary: 'B verification',
        metadata: { did: 'did:zeroauth:base:0xBBB' },
      });

      // Tenant B sees its own event.
      const eventB = await clientB.nextVerification(1000);
      expect(JSON.parse(eventB.data).tenant_id).toBe('tenant-B');

      // Tenant A sees NOTHING — wait the full 250 ms then assert
      // its transcript is clean. 250 ms is well over the event-loop
      // round-trip; if the isolation were broken, the event would
      // have landed by now.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const aHasAny = clientA.events.some((e) => e.event === 'verification');
      expect(aHasAny).toBe(false);
      // And the raw text never contained tenant-B.
      expect(clientA.buffer).not.toContain('tenant-B');
      expect(clientA.buffer).not.toContain('did:zeroauth:base:0xBBB');
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  // ── Assertion 4 — heartbeat / opening comment ───────────────

  it('writes a `: connected` comment frame immediately so EventSource transitions to OPEN', async () => {
    const token = issueConsoleToken('tenant-A');
    const client = await openSseClient(port, '/api/console/verifications/stream', token);

    try {
      // Allow one tick for the route to call res.write(': connected').
      await new Promise((resolve) => setTimeout(resolve, 50));
      // The buffer should contain the opening comment frame.
      expect(client.buffer).toContain(': connected');
    } finally {
      client.close();
    }
  });

  // ── Assertion 5 — non-verification actions DO NOT fan out ───

  it('emits NO event when a non-verification audit row is written', async () => {
    const token = issueConsoleToken('tenant-A');
    const client = await openSseClient(port, '/api/console/verifications/stream', token);

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));

      // device.created is NOT in the verification-action allowlist.
      seedClientForOneInsert('3003');
      await appendAuditEvent({
        tenant_id: 'tenant-A',
        environment: 'live',
        actor_type: 'api_key',
        actor_id: 'key-1',
        action: 'device.created',
        entity_type: 'device',
        entity_id: 'dev-1',
        status: 'success',
        summary: 'device created',
        metadata: {},
      });

      // Wait for the fan-out window; nothing should land.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const anyVerification = client.events.some((e) => e.event === 'verification');
      expect(anyVerification).toBe(false);
    } finally {
      client.close();
    }
  });
});
