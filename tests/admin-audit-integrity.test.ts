/**
 * Tests for GET /api/admin/audit-integrity (Phase 0 commit C-014).
 *
 * The endpoint replays a tenant's hash chain and returns:
 *   - 200 { status: 'pass', ... } when the chain is intact
 *   - 200 { status: 'fail', brokenAt, reason } when a row is broken
 *
 * The chain replay logic is exercised by tests/audit-chain.test.ts.
 * Here we pin the HTTP surface: auth, parameter validation, status
 * codes, and self-audit row emission.
 */

import request from 'supertest';
import { createApp } from '../src/app';

jest.mock('../src/services/audit', () => ({
  verifyAuditChain: jest.fn(),
  appendAuditEvent: jest.fn().mockResolvedValue({
    id: '1',
    previousHash: 'genesis',
    eventHash: '0xabc',
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const auditMod = require('../src/services/audit') as {
  verifyAuditChain: jest.Mock;
  appendAuditEvent: jest.Mock;
};

const ADMIN_KEY = process.env.ADMIN_API_KEY ?? 'test-admin-key';
const TENANT = '11111111-1111-1111-1111-111111111111';

beforeAll(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

describe('GET /api/admin/audit-integrity', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    auditMod.verifyAuditChain.mockReset();
    auditMod.appendAuditEvent.mockReset();
    auditMod.appendAuditEvent.mockResolvedValue({
      id: '1',
      previousHash: 'genesis',
      eventHash: '0xabc',
    });
    app = createApp();
  });

  it('rejects request with no x-api-key', async () => {
    const res = await request(app).get(`/api/admin/audit-integrity?tenant_id=${TENANT}`);
    // The admin middleware returns 403 forbidden when the key is
    // missing or wrong; the route never runs.
    expect([401, 403]).toContain(res.status);
  });

  it('returns PASS for a clean chain', async () => {
    auditMod.verifyAuditChain.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .get(`/api/admin/audit-integrity?tenant_id=${TENANT}&environment=live`)
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pass');
    expect(res.body.tenantId).toBe(TENANT);
    expect(res.body.environment).toBe('live');
  });

  it('returns FAIL with broken_at row id for a tampered chain', async () => {
    auditMod.verifyAuditChain.mockResolvedValueOnce({
      ok: false,
      brokenAt: '12345',
      reason: 'event_hash mismatch',
    });
    const res = await request(app)
      .get(`/api/admin/audit-integrity?tenant_id=${TENANT}`)
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fail');
    expect(res.body.brokenAt).toBe('12345');
    expect(res.body.reason).toMatch(/event_hash/);
  });

  it('rejects invalid tenant_id', async () => {
    const res = await request(app)
      .get('/api/admin/audit-integrity?tenant_id=not-a-uuid')
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_tenant_id');
  });

  it('rejects out-of-range limit', async () => {
    const res = await request(app)
      .get(`/api/admin/audit-integrity?tenant_id=${TENANT}&limit=99999999`)
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_limit');
  });

  it('writes a self-audit row on PASS', async () => {
    auditMod.verifyAuditChain.mockResolvedValueOnce({ ok: true });
    const res = await request(app)
      .get(`/api/admin/audit-integrity?tenant_id=${TENANT}`)
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    // Allow the async self-audit promise to resolve.
    await new Promise(r => setImmediate(r));
    expect(auditMod.appendAuditEvent).toHaveBeenCalledTimes(1);
    const payload = auditMod.appendAuditEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe('audit.integrity_check');
    expect(payload.status).toBe('success');
  });

  it('writes a self-audit row on FAIL', async () => {
    auditMod.verifyAuditChain.mockResolvedValueOnce({
      ok: false,
      brokenAt: '99',
      reason: 'previous_hash mismatch',
    });
    const res = await request(app)
      .get(`/api/admin/audit-integrity?tenant_id=${TENANT}`)
      .set('x-api-key', ADMIN_KEY);
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(auditMod.appendAuditEvent).toHaveBeenCalledTimes(1);
    const payload = auditMod.appendAuditEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.action).toBe('audit.integrity_check');
    expect(payload.status).toBe('failure');
    expect((payload.metadata as Record<string, unknown>).brokenAt).toBe('99');
  });
});
