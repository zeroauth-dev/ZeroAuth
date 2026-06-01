/**
 * Request-level tests for /api/console/security-policy (ADR 0017).
 *
 * Pins the two console-JWT-authed endpoints that surface the
 * per-tenant blockchain-agnostic provider triple on the dashboard:
 *
 *   - GET  /api/console/security-policy → returns the normalised
 *     policy + defaults so the dashboard form can render with the
 *     same provider values the platform's gates resolve to.
 *   - POST /api/console/security-policy → merges a partial update
 *     onto the JSONB column, validates enum values, and writes an
 *     `audit_events` row through `appendAuditEvent` (the hash-chain
 *     entry point).
 *
 * Coverage:
 *   1. Happy-path GET returns defaults for a policy-less tenant.
 *   2. Happy-path POST merges a provider override + persists it via
 *      the pool + writes exactly one audit row carrying the resolved
 *      before/after triples.
 *   3. Unauthenticated requests (no Authorization / no cookie) 401.
 *   4. POST with an invalid `did_provider` enum 400s with the typed
 *      error code rather than silently routing to off-chain.
 *   5. The successful POST audit row carries `action =
 *      'security_policy.updated'` and the resolved provider diff in
 *      `metadata.before` / `metadata.after`.
 *
 * Scaffolding follows tests/central-api.test.ts: mock the external
 * services (tenants, audit, db) at module load, build the app once,
 * issue a real JWT signed with `config.jwt.secret` so the route's
 * own JWT verifier (mirrors console.ts) accepts it.
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';

const TENANT_ID = 'tenant-sec-policy-1';
const TENANT_EMAIL = 'sec@example.com';

function issueConsoleToken(tenantId = TENANT_ID, email = TENANT_EMAIL): string {
  return jwt.sign(
    { tenantId, email, type: 'console' },
    config.jwt.secret,
    {
      expiresIn: '1h',
      issuer: 'zeroauth-console',
      audience: 'zeroauth-console',
      jwtid: 'test-sec-jti-' + tenantId,
    },
  );
}

// ─── External service mocks ──────────────────────────────────────
//
// All four touch real IO in production: tenants reads pg, audit
// walks a hash-chain transaction, db.getPool returns a live pool,
// and platform's mock keeps the wider console surface importable.
// We replace each with a jest.fn so the route hits no network.

const getTenantById = jest.fn();
jest.mock('../src/services/tenants', () => ({
  getTenantById: (...args: unknown[]) => getTenantById(...args),
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  getTenantByEmail: jest.fn(),
  updateTenantPlan: jest.fn(),
}));

const appendAuditEvent = jest.fn();
jest.mock('../src/services/audit', () => ({
  appendAuditEvent: (...args: unknown[]) => appendAuditEvent(...args),
  GENESIS_PREVIOUS_HASH: 'genesis',
}));

const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
  initDb: jest.fn(),
  getPoolOrNull: () => ({ query: mockQuery }),
}));

// Console surface keeps importing these — stub to keep createApp() happy.
jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
}));

// `stripe` is an intentional ADR-pending dep — see src/services/billing.ts.
// In the test environment it isn't installed, so we stub the whole billing
// router module to keep the createApp() import chain importable without
// pulling in the real package.
jest.mock('../src/services/billing', () => ({
  StripeNotConfiguredError: class StripeNotConfiguredError extends Error {
    readonly code = 'stripe_not_configured';
  },
  PlanPriceMappingError: class PlanPriceMappingError extends Error {},
  createCustomer: jest.fn(),
  createSubscription: jest.fn(),
  reportUsage: jest.fn(),
}));

jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-06' }),
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
  getConsoleOverview: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createApp } = require('../src/app') as typeof import('../src/app');

const app = createApp();

function tenantRow(securityPolicy: Record<string, unknown> | null = null) {
  return {
    id: TENANT_ID,
    email: TENANT_EMAIL,
    password_hash: 'salt:hash',
    company_name: 'Anchor Bank',
    plan: 'pro',
    status: 'active',
    rate_limit: 100,
    monthly_quota: 10000,
    metadata: {},
    security_policy: securityPolicy,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('GET/POST /api/console/security-policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appendAuditEvent.mockResolvedValue({
      id: 'audit-1',
      previousHash: 'genesis',
      eventHash: 'h1',
    });
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  // ─── 1. Happy-path GET ─────────────────────────────────────────
  it('GET returns the defaults triple for a tenant with no security_policy', async () => {
    getTenantById.mockResolvedValue(tenantRow(null));

    const token = issueConsoleToken();
    const res = await request(app)
      .get('/api/console/security-policy')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.policy.did_provider).toBe('off-chain');
    expect(res.body.policy.verifier_provider).toBe('off-chain');
    expect(res.body.policy.audit_anchor_provider).toBe('none');
    expect(res.body.defaults).toEqual({
      did_provider: 'off-chain',
      verifier_provider: 'off-chain',
      audit_anchor_provider: 'none',
    });
    expect(getTenantById).toHaveBeenCalledWith(TENANT_ID);
  });

  // ─── 2. Happy-path POST ────────────────────────────────────────
  it('POST merges a provider override, persists via the pool, and writes one audit row', async () => {
    getTenantById.mockResolvedValue(
      tenantRow({ did_provider: 'off-chain', verifier_provider: 'off-chain' }),
    );

    const token = issueConsoleToken();
    const res = await request(app)
      .post('/api/console/security-policy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        did_provider: 'base-sepolia',
        base_rpc_url: 'https://sepolia.base.org',
      });

    expect(res.status).toBe(200);
    expect(res.body.policy.did_provider).toBe('base-sepolia');
    expect(res.body.policy.verifier_provider).toBe('off-chain');
    expect(res.body.policy.audit_anchor_provider).toBe('none');

    // Persisted exactly once with an UPDATE against tenants.security_policy.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE tenants/);
    expect(sql).toMatch(/security_policy = \$1::jsonb/);
    expect(params[1]).toBe(TENANT_ID);
    const persisted = JSON.parse(params[0]) as Record<string, unknown>;
    expect(persisted.did_provider).toBe('base-sepolia');
    expect(persisted.base_rpc_url).toBe('https://sepolia.base.org');

    expect(appendAuditEvent).toHaveBeenCalledTimes(1);
  });

  // ─── 3. Unauthenticated ────────────────────────────────────────
  it('rejects GET with no Authorization header or console cookie', async () => {
    const res = await request(app).get('/api/console/security-policy');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(getTenantById).not.toHaveBeenCalled();
  });

  it('rejects POST with no Authorization header or console cookie', async () => {
    const res = await request(app)
      .post('/api/console/security-policy')
      .send({ did_provider: 'base-sepolia' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  // ─── 4. Invalid provider value ────────────────────────────────
  it('POST 400s on an unknown did_provider rather than silently downgrading', async () => {
    getTenantById.mockResolvedValue(tenantRow(null));

    const token = issueConsoleToken();
    const res = await request(app)
      .post('/api/console/security-policy')
      .set('Authorization', `Bearer ${token}`)
      .send({ did_provider: 'base-sepolai' }); // typo

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_did_provider');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('POST 400s on an unknown audit_anchor_provider value', async () => {
    getTenantById.mockResolvedValue(tenantRow(null));

    const token = issueConsoleToken();
    const res = await request(app)
      .post('/api/console/security-policy')
      .set('Authorization', `Bearer ${token}`)
      .send({ audit_anchor_provider: 'ipfs' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_audit_anchor_provider');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  // ─── 5. Audit row carries the resolved diff ───────────────────
  it('POST writes a security_policy.updated audit row with resolved before/after triples', async () => {
    getTenantById.mockResolvedValue(
      tenantRow({
        did_provider: 'off-chain',
        verifier_provider: 'off-chain',
        audit_anchor_provider: 'none',
      }),
    );

    const token = issueConsoleToken();
    const res = await request(app)
      .post('/api/console/security-policy')
      .set('Authorization', `Bearer ${token}`)
      .send({
        did_provider: 'base-sepolia',
        verifier_provider: 'on-chain',
        audit_anchor_provider: 'base-sepolia',
      });

    expect(res.status).toBe(200);
    expect(appendAuditEvent).toHaveBeenCalledTimes(1);

    const auditPayload = appendAuditEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(auditPayload.tenant_id).toBe(TENANT_ID);
    expect(auditPayload.action).toBe('security_policy.updated');
    expect(auditPayload.entity_type).toBe('tenant');
    expect(auditPayload.entity_id).toBe(TENANT_ID);
    expect(auditPayload.status).toBe('success');
    expect(auditPayload.actor_type).toBe('console');

    const metadata = auditPayload.metadata as Record<string, unknown>;
    expect(metadata.actor_email).toBe(TENANT_EMAIL);
    expect(metadata.before).toEqual({
      did_provider: 'off-chain',
      verifier_provider: 'off-chain',
      audit_anchor_provider: 'none',
    });
    expect(metadata.after).toEqual({
      did_provider: 'base-sepolia',
      verifier_provider: 'on-chain',
      audit_anchor_provider: 'base-sepolia',
    });
  });
});
