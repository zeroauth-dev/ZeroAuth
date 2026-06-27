/**
 * Tests for POST /v1/identity/challenge + POST /v1/identity/verify
 * (face-first, ADR 0017) — now replay-safe via the proof-pairing converge
 * (A-02 close-out).
 *
 * /verify delegates to proof-pairing's verifyIdentityProof, which binds the
 * proof to a single-use /challenge nonce (publicSignals[1] = Poseidon(didHash,
 * nonce)) and consumes the challenge atomically — so a captured proof cannot
 * be replayed. We mock that verifier + createSession and assert the route's
 * plumbing + error mapping.
 */
import request from 'supertest';

const createSessionMock = jest.fn();
const verifyIdentityProofMock = jest.fn();
const recordAuditEventMock = jest.fn();

jest.mock('../src/services/proof-pairing', () => {
  class PairingSessionNotFound extends Error { code = 'pairing_session_not_found'; }
  class PairingSessionExpired extends Error { code = 'pairing_session_expired'; }
  class PairingSessionAlreadyBound extends Error { code = 'pairing_session_already_bound'; }
  class PairingSessionLocked extends Error { code = 'pairing_session_locked'; }
  class PairingNonceMismatch extends Error { code = 'pairing_nonce_mismatch'; }
  class PairingDidUnknown extends Error { code = 'pairing_did_unknown'; }
  class PairingProofInvalid extends Error { code = 'pairing_proof_invalid'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  return {
    createSession: (...a: unknown[]) => createSessionMock(...a),
    verifyIdentityProof: (...a: unknown[]) => verifyIdentityProofMock(...a),
    PairingSessionNotFound, PairingSessionExpired, PairingSessionAlreadyBound,
    PairingSessionLocked, PairingNonceMismatch, PairingDidUnknown,
    PairingProofInvalid, TooManyPendingSessions,
  };
});

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
            id: 'tenant-A', email: 'a@example.com', password_hash: 's:h',
            company_name: 'Anchor Bank', plan: 'enterprise', status: 'active',
            rate_limit: 10_000, monthly_quota: -1, metadata: {}, security_policy: null,
            created_at: new Date(), updated_at: new Date(),
          },
          apiKey: {
            id: 'key-1', tenant_id: 'tenant-A', name: 'Default', key_prefix: 'za_live_xxx',
            key_hash: 'hash', scopes: presentedScopes, environment: 'live', status: 'active',
            last_used_at: null, expires_at: null, created_at: new Date(), revoked_at: null,
          },
        };
        next();
      },
  };
});

jest.mock('../src/middleware/rate-limit', () => ({
  pgRateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

import { createApp } from '../src/app';

const pp = jest.requireMock('../src/services/proof-pairing');
const VALID_DID = 'did:zeroauth:face:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b9d2e4f6a';
const VALID_PROOF = {
  pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'],
  protocol: 'groth16', curve: 'bn128',
};
const VALID_SIGNALS = ['123', '456', '789'];

function verifyBody(extra: Record<string, unknown> = {}) {
  return { did: VALID_DID, challengeId: 'chal-1', proof: VALID_PROOF, publicSignals: VALID_SIGNALS, ...extra };
}

describe('POST /v1/identity/challenge + /verify (face-first, A-02 replay-safe)', () => {
  const app = createApp();

  beforeEach(() => {
    createSessionMock.mockReset();
    verifyIdentityProofMock.mockReset();
    recordAuditEventMock.mockReset().mockResolvedValue(undefined);
  });

  // ─── /challenge ────────────────────────────────────────────────────
  it('POST /challenge -> 201 with challengeId + nonce + expiresAt', async () => {
    createSessionMock.mockResolvedValueOnce({
      id: 'chal-1', nonce: 'a'.repeat(62), sessionBindToken: 'tok',
      expiresAt: '2030-01-01T00:00:00.000Z', qrPayload: 'x',
    });
    const res = await request(app).post('/v1/identity/challenge').set('x-test-scopes', 'zkp:verify').send({});
    expect(res.status).toBe(201);
    expect(res.body.challengeId).toBe('chal-1');
    expect(res.body.nonce).toBe('a'.repeat(62));
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('POST /challenge requires the zkp:verify scope', async () => {
    const res = await request(app).post('/v1/identity/challenge').set('x-test-scopes', 'identity:read').send({});
    expect(res.status).toBe(403);
  });

  // ─── /verify shape guards ──────────────────────────────────────────
  it('rejects /verify without the zkp:verify scope', async () => {
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'identity:read').send(verifyBody());
    expect(res.status).toBe(403);
  });

  it('400 invalid_did when DID missing', async () => {
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody({ did: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_did');
  });

  it('400 invalid_request when challengeId missing (A-02: nonce binding is mandatory)', async () => {
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody({ challengeId: undefined }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(verifyIdentityProofMock).not.toHaveBeenCalled();
  });

  it('400 invalid_request when publicSignals is not a 3-element array', async () => {
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody({ publicSignals: ['only-one'] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  // ─── /verify outcomes (mapped from verifyIdentityProof) ────────────
  it('401 verification_failed (uniform) when the DID is unknown', async () => {
    verifyIdentityProofMock.mockRejectedValueOnce(new pp.PairingDidUnknown());
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
    const audit = recordAuditEventMock.mock.calls[0];
    expect(audit[1].action).toBe('identity.verify');
    expect(audit[1].status).toBe('failure');
  });

  it('401 verification_failed when the proof is rejected', async () => {
    verifyIdentityProofMock.mockRejectedValueOnce(new pp.PairingProofInvalid());
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
  });

  it('A-02: 401 verification_failed when the proof is bound to a different/stale challenge nonce', async () => {
    verifyIdentityProofMock.mockRejectedValueOnce(new pp.PairingNonceMismatch());
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('verification_failed');
  });

  it('A-02: 409 challenge_already_used on a replayed (already-consumed) challenge', async () => {
    verifyIdentityProofMock.mockRejectedValueOnce(new pp.PairingSessionAlreadyBound());
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('challenge_already_used');
  });

  it('410 challenge_expired on an expired challenge', async () => {
    verifyIdentityProofMock.mockRejectedValueOnce(new pp.PairingSessionExpired());
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('challenge_expired');
  });

  it('200 + tokens on a clean verify', async () => {
    verifyIdentityProofMock.mockResolvedValueOnce({ userId: 'user-1', did: VALID_DID });
    const res = await request(app).post('/v1/identity/verify').set('x-test-scopes', 'zkp:verify').send(verifyBody());
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.did).toBe(VALID_DID);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.tokenType).toBe('Bearer');
    const success = recordAuditEventMock.mock.calls.find((c) => c[1]?.status === 'success');
    expect(success?.[1].action).toBe('identity.verify');
  });
});
