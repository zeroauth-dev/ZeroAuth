/**
 * Tests for src/middleware/tenant-cors.ts.
 *
 * The middleware is pure — given a request with a tenant context and
 * an Origin header, it decides 403 or next(). These tests cover:
 *
 *   1. No tenant context → no-op (next called)
 *   2. Tenant with no allowed_origins → no-op
 *   3. Tenant with allowed_origins, no Origin header → no-op (server-to-server)
 *   4. Tenant with allowed_origins, Origin on the list → next()
 *   5. Tenant with allowed_origins, Origin NOT on the list → 403
 *   6. Case-insensitive match
 *   7. Allowed-origins as empty array treated like absent (no-op)
 */

import { tenantCorsCheck } from '../src/middleware/tenant-cors';
import type { Request, Response, NextFunction } from 'express';

function mockReq(opts: {
  tenantContext?: any;
  origin?: string;
} = {}): Request {
  const headers: Record<string, any> = {};
  if (opts.origin) headers.origin = opts.origin;
  const req = {
    headers,
    tenantContext: opts.tenantContext,
  } as unknown as Request;
  return req;
}

interface MockRes {
  res: Response;
  /** Live mirror of the captured response — read after the middleware runs. */
  get statusCode(): number | null;
  get body(): any;
}

function mockRes(): MockRes {
  const captured = { statusCode: null as number | null, body: null as any };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    get statusCode() { return captured.statusCode; },
    get body() { return captured.body; },
  };
}

function makeTenantContext(allowed?: string[] | undefined) {
  return {
    tenant: {
      id: 'tenant-A',
      email: 'a@example.com',
      password_hash: '',
      company_name: 'Anchor Bank',
      plan: 'enterprise',
      status: 'active',
      rate_limit: 10000,
      monthly_quota: -1,
      metadata: {},
      security_policy: allowed === undefined ? null : { allowed_origins: allowed },
      created_at: new Date(),
      updated_at: new Date(),
    },
    apiKey: {
      id: 'k1', tenant_id: 'tenant-A', name: 'k', key_prefix: 'za_live_x', key_hash: 'h',
      scopes: [], environment: 'live', status: 'active', last_used_at: null,
      expires_at: null, created_at: new Date(), revoked_at: null,
    },
  };
}

describe('tenantCorsCheck', () => {
  it('passes through when no tenant context is attached', () => {
    const req = mockReq();
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('passes through when the tenant has no allowed_origins (null policy)', () => {
    const req = mockReq({ tenantContext: makeTenantContext(undefined), origin: 'https://attacker.example' });
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('passes through when allowed_origins is an empty array', () => {
    const req = mockReq({ tenantContext: makeTenantContext([]), origin: 'https://anything.example' });
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('passes through server-to-server requests (no Origin header)', () => {
    const req = mockReq({ tenantContext: makeTenantContext(['https://anchorbank.in']) });
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('passes when Origin matches an entry in allowed_origins', () => {
    const req = mockReq({
      tenantContext: makeTenantContext(['https://anchorbank.in', 'https://kiosk.anchorbank.in']),
      origin: 'https://kiosk.anchorbank.in',
    });
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('passes with case-insensitive Origin match', () => {
    const req = mockReq({
      tenantContext: makeTenantContext(['https://Kiosk.AnchorBank.in']),
      origin: 'https://kiosk.anchorbank.in',
    });
    const { res } = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, res, next);
    expect(calledNext).toBe(true);
  });

  it('returns 403 origin_not_allowed when Origin is not in the allowlist', () => {
    const req = mockReq({
      tenantContext: makeTenantContext(['https://anchorbank.in']),
      origin: 'https://attacker.example',
    });
    const captured = mockRes();
    let calledNext = false;
    const next: NextFunction = () => { calledNext = true; };
    tenantCorsCheck(req, captured.res, next);
    expect(calledNext).toBe(false);
    expect(captured.statusCode).toBe(403);
    expect(captured.body).toMatchObject({ error: 'origin_not_allowed' });
  });
});
