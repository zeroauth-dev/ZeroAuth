/**
 * Tests for the face-first POST /v1/identity/register endpoint
 * (ADR 0017). The endpoint accepts the on-device-computed (did,
 * commitment) tuple — never a biometric template. The route layer
 * delegates to registerFaceFirstIdentity() in src/services/identity.ts.
 *
 * Test surface:
 *   - Auth (tenant API key + zkp:register scope) required
 *   - Format validation on did + commitment
 *   - DID uniqueness per (tenant_id, environment, did)
 *   - Audit row written on success
 *   - No biometric template anywhere in the call shape
 */

import request from 'supertest';
import { createApp } from '../src/app';

// ─── Mock the platform's identity service so we can drive the
// underlying behaviour without a Postgres roundtrip.
const registerFaceFirstIdentityMock = jest.fn();
jest.mock('../src/services/identity', () => {
  const actual = jest.requireActual('../src/services/identity');
  return {
    ...actual,
    registerFaceFirstIdentity: (...args: unknown[]) => registerFaceFirstIdentityMock(...args),
  };
});

const recordAuditEventMock = jest.fn();
jest.mock('../src/services/platform', () => ({
  ...jest.requireActual('../src/services/platform'),
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));

// ─── Tenant + scope harness (matches tests/central-api.test.ts).
interface MockTenantContext {
  tenant: {
    id: string;
    email: string;
    password_hash: string;
    company_name: string;
    plan: string;
    status: string;
    rate_limit: number;
    monthly_quota: number;
    metadata: Record<string, unknown>;
    security_policy: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  };
  apiKey: {
    id: string;
    tenant_id: string;
    name: string;
    key_prefix: string;
    key_hash: string;
    scopes: string[];
    environment: string;
    status: string;
    last_used_at: Date | null;
    expires_at: Date | null;
    created_at: Date;
    revoked_at: Date | null;
  };
}

function makeContext(scopes: string[]): MockTenantContext {
  return {
    tenant: {
      id: 'tenant-A',
      email: 'dev@example.com',
      password_hash: 'salt:hash',
      company_name: 'Anchor Bank',
      plan: 'enterprise',
      status: 'active',
      rate_limit: 10_000,
      monthly_quota: -1,
      metadata: {},
      security_policy: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
    apiKey: {
      id: 'key-1',
      tenant_id: 'tenant-A',
      name: 'Default',
      key_prefix: 'za_live_abc123',
      key_hash: 'hash',
      scopes,
      environment: 'live',
      status: 'active',
      last_used_at: null,
      expires_at: null,
      created_at: new Date(),
      revoked_at: new Date('1970-01-01'),
    },
  };
}

jest.mock('../src/middleware/tenant-auth', () => {
  const actual = jest.requireActual('../src/middleware/tenant-auth');
  return {
    ...actual,
    authenticateTenantApiKey: (requiredScopes: string[] = []) =>
      (req: any, res: any, next: any) => {
        const presentedScopes = (req.headers['x-test-scopes'] ?? '').toString().split(',').filter(Boolean);
        if (requiredScopes.length > 0 && !requiredScopes.every((s: string) => presentedScopes.includes(s))) {
          return res.status(403).json({ error: 'scope_required', message: `Required: ${requiredScopes.join(',')}` });
        }
        req.tenantContext = makeContext(presentedScopes);
        next();
      },
  };
});

jest.mock('../src/middleware/rate-limit', () => ({
  pgRateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

const VALID_DID = 'did:zeroauth:face:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b9d2e4f6a';
const VALID_COMMITMENT = '0x' + 'a'.repeat(63) + '1';

describe('POST /v1/identity/register (face-first)', () => {
  const app = createApp();

  beforeEach(() => {
    registerFaceFirstIdentityMock.mockReset();
    recordAuditEventMock.mockReset();
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it('rejects requests without the zkp:register scope', async () => {
    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'identity:read')
      .send({ did: VALID_DID, commitment: VALID_COMMITMENT });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('scope_required');
  });

  it('201 on a clean enrollment', async () => {
    registerFaceFirstIdentityMock.mockResolvedValueOnce({
      userId: 'user-1',
      did: VALID_DID,
      commitment: VALID_COMMITMENT.slice(2),
      createdAt: '2026-05-28T06:00:00.000Z',
    });

    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({ did: VALID_DID, commitment: VALID_COMMITMENT });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      userId: 'user-1',
      did: VALID_DID,
      commitment: expect.stringMatching(/^[0-9a-f]+$/),
      createdAt: '2026-05-28T06:00:00.000Z',
    });
  });

  it('writes an audit row on success', async () => {
    registerFaceFirstIdentityMock.mockResolvedValueOnce({
      userId: 'user-1',
      did: VALID_DID,
      commitment: VALID_COMMITMENT.slice(2),
      createdAt: '2026-05-28T06:00:00.000Z',
    });

    await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({ did: VALID_DID, commitment: VALID_COMMITMENT });

    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    const args = recordAuditEventMock.mock.calls[0];
    expect(args[0]).toBe('tenant-A');
    expect(args[1].action).toBe('identity.register');
    expect(args[1].status).toBe('success');
    expect(args[1].entityType).toBe('tenant_user');
    expect(args[1].entityId).toBe('user-1');
    expect(args[1].metadata.did).toBe(VALID_DID);
  });

  it('400 invalid_did when DID is missing', async () => {
    const { IdentityValidationError } = jest.requireActual('../src/services/identity');
    registerFaceFirstIdentityMock.mockRejectedValueOnce(
      new IdentityValidationError('invalid_did', 'DID is required (string).'),
    );

    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({ commitment: VALID_COMMITMENT });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_did');
  });

  it('400 invalid_did_format on a malformed DID', async () => {
    const { IdentityValidationError } = jest.requireActual('../src/services/identity');
    registerFaceFirstIdentityMock.mockRejectedValueOnce(
      new IdentityValidationError('invalid_did_format', 'DID must match…'),
    );

    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({ did: 'not-a-did', commitment: VALID_COMMITMENT });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_did_format');
  });

  it('409 did_already_registered when DID exists for the tenant', async () => {
    const { IdentityAlreadyExistsError } = jest.requireActual('../src/services/identity');
    registerFaceFirstIdentityMock.mockRejectedValueOnce(new IdentityAlreadyExistsError(VALID_DID));

    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({ did: VALID_DID, commitment: VALID_COMMITMENT });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('did_already_registered');
  });

  it('rejects payloads carrying any biometric-like key', async () => {
    // Defence-in-depth: source-grep guard in
    // tests/biometric-rejection.test.ts catches handler reads; this
    // route-level test asserts the new endpoint does not read or
    // reflect any biometric key even if a client tries to slip one in.
    registerFaceFirstIdentityMock.mockResolvedValueOnce({
      userId: 'user-1',
      did: VALID_DID,
      commitment: VALID_COMMITMENT.slice(2),
      createdAt: '2026-05-28T06:00:00.000Z',
    });

    const res = await request(app)
      .post('/v1/identity/register')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:register')
      .send({
        did: VALID_DID,
        commitment: VALID_COMMITMENT,
        image: 'AAAA',
        template: 'AAAA',
        biometric_data: 'AAAA',
        face_template: 'AAAA',
      });

    // Endpoint completes the legitimate register, ignoring the
    // biometric-like extras (they never make it to the service).
    expect(res.status).toBe(201);
    // And the service-level call never received the forbidden keys —
    // the route handler only forwards { did, commitment, externalId,
    // attestation }, so even if a future bug widens the forward, the
    // service-level interface enforces the shape.
    const serviceArgs = registerFaceFirstIdentityMock.mock.calls[0][2];
    expect(serviceArgs.image).toBeUndefined();
    expect(serviceArgs.template).toBeUndefined();
    expect(serviceArgs.biometric_data).toBeUndefined();
    expect(serviceArgs.face_template).toBeUndefined();
  });
});
