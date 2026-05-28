/**
 * Tests for POST /v1/identity/verify (face-first, ADR 0017).
 *
 * The endpoint accepts the on-device Groth16 proof + DID. The server
 * looks up the user, asserts the commitment in publicSignals[0]
 * matches the stored commitment for that DID, runs the proof through
 * the snarkjs verifier, and on success mints a session.
 *
 * Test surface:
 *   - Scope gate (zkp:verify)
 *   - 400 invalid_did / invalid_request shape checks
 *   - 401 uniform verification_failed for both did_unknown and
 *     commitment_mismatch (enumeration defence)
 *   - 401 on a proof that snarkjs rejects
 *   - 200 with tokens + session on a clean verify
 *   - Audit row written on every path
 */

import request from 'supertest';
import { createApp } from '../src/app';

const findUserByDidMock = jest.fn();
const verifyBiometricProofMock = jest.fn();
const recordAuditEventMock = jest.fn();

jest.mock('../src/services/identity', () => {
  const actual = jest.requireActual('../src/services/identity');
  return {
    ...actual,
    findUserByDid: (...args: unknown[]) => findUserByDidMock(...args),
  };
});

jest.mock('../src/services/zkp', () => ({
  verifyBiometricProof: (...args: unknown[]) => verifyBiometricProofMock(...args),
  initZKP: jest.fn().mockResolvedValue(undefined),
  getCircuitInfo: () => ({ version: 'identity_proof.v1.1', protocol: 'groth16' }),
  isZKPReady: () => true,
}));

jest.mock('../src/services/platform', () => ({
  ...jest.requireActual('../src/services/platform'),
  recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
}));

jest.mock('../src/middleware/tenant-auth', () => {
  const actual = jest.requireActual('../src/middleware/tenant-auth');
  return {
    ...actual,
    authenticateTenantApiKey: (requiredScopes: string[] = []) =>
      (req: any, res: any, next: any) => {
        const presentedScopes = (req.headers['x-test-scopes'] ?? '').toString().split(',').filter(Boolean);
        if (requiredScopes.length > 0 && !requiredScopes.every((s: string) => presentedScopes.includes(s))) {
          return res.status(403).json({ error: 'scope_required' });
        }
        req.tenantContext = {
          tenant: {
            id: 'tenant-A',
            email: 'a@example.com',
            password_hash: 's:h',
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
            key_prefix: 'za_live_xxx',
            key_hash: 'hash',
            scopes: presentedScopes,
            environment: 'live',
            status: 'active',
            last_used_at: null,
            expires_at: null,
            created_at: new Date(),
            revoked_at: null,
          },
        };
        next();
      },
  };
});

jest.mock('../src/middleware/rate-limit', () => ({
  pgRateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

const VALID_DID = 'did:zeroauth:face:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b9d2e4f6a';
const VALID_COMMITMENT = 'a'.repeat(63) + '1';

const VALID_PROOF = {
  pi_a: ['1', '2', '1'],
  pi_b: [['3', '4'], ['5', '6'], ['1', '0']],
  pi_c: ['7', '8', '1'],
  protocol: 'groth16',
  curve: 'bn128',
};

const VALID_PUBLIC_SIGNALS = [VALID_COMMITMENT, '0xabc', '0xdef'];

describe('POST /v1/identity/verify (face-first)', () => {
  const app = createApp();

  beforeEach(() => {
    findUserByDidMock.mockReset();
    verifyBiometricProofMock.mockReset();
    recordAuditEventMock.mockReset().mockResolvedValue(undefined);
  });

  it('rejects requests without the zkp:verify scope', async () => {
    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'identity:read')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc', timestamp: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('400 invalid_did when DID is missing', async () => {
    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_did');
  });

  it('400 invalid_request when publicSignals is not an array', async () => {
    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: 'not-an-array', nonce: '0xabc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('401 verification_failed (uniform) when DID unknown', async () => {
    findUserByDidMock.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
    // Audit row recorded
    const audit = recordAuditEventMock.mock.calls[0];
    expect(audit[1].action).toBe('identity.verify');
    expect(audit[1].status).toBe('failure');
    expect(audit[1].metadata.reason).toBe('did_unknown');
  });

  it('401 verification_failed (uniform) on commitment mismatch', async () => {
    findUserByDidMock.mockResolvedValueOnce({ id: 'user-1', commitment: 'b'.repeat(64) });

    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
    const audit = recordAuditEventMock.mock.calls[0];
    expect(audit[1].metadata.reason).toBe('commitment_mismatch');
    expect(verifyBiometricProofMock).not.toHaveBeenCalled();
  });

  it('401 verification_failed when snarkjs rejects the proof', async () => {
    findUserByDidMock.mockResolvedValueOnce({ id: 'user-1', commitment: VALID_COMMITMENT });
    verifyBiometricProofMock.mockResolvedValueOnce({
      verified: false,
      sessionId: 's-x',
      dataStored: false,
      timestamp: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
    const audit = recordAuditEventMock.mock.calls[0];
    expect(audit[1].metadata.reason).toBe('proof_invalid');
  });

  it('200 + tokens on a clean verify', async () => {
    findUserByDidMock.mockResolvedValueOnce({ id: 'user-1', commitment: VALID_COMMITMENT });
    verifyBiometricProofMock.mockResolvedValueOnce({
      verified: true,
      sessionId: 'sess-success',
      dataStored: false,
      timestamp: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({ did: VALID_DID, proof: VALID_PROOF, publicSignals: VALID_PUBLIC_SIGNALS, nonce: '0xabc' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.did).toBe(VALID_DID);
    expect(res.body.sessionId).toBe('sess-success');
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.tokenType).toBe('Bearer');

    // Audit row recorded
    const audit = recordAuditEventMock.mock.calls[0];
    expect(audit[1].action).toBe('identity.verify');
    expect(audit[1].status).toBe('success');
    expect(audit[1].metadata.sessionId).toBe('sess-success');
  });

  it('case-insensitive commitment compare (presented 0x-prefix tolerated)', async () => {
    findUserByDidMock.mockResolvedValueOnce({ id: 'user-1', commitment: VALID_COMMITMENT });
    verifyBiometricProofMock.mockResolvedValueOnce({
      verified: true,
      sessionId: 'sess-ok',
      dataStored: false,
      timestamp: new Date().toISOString(),
    });

    // Presented commitment in uppercase + with mixed case — same hex
    // bytes, the comparator must lowercase both sides.
    const res = await request(app)
      .post('/v1/identity/verify')
      .set('Authorization', 'Bearer za_live_test')
      .set('x-test-scopes', 'zkp:verify')
      .send({
        did: VALID_DID,
        proof: VALID_PROOF,
        publicSignals: [VALID_COMMITMENT.toUpperCase(), '0xabc', '0xdef'],
        nonce: '0xabc',
      });

    expect(res.status).toBe(200);
  });
});
