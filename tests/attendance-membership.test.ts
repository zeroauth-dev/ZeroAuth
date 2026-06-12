/**
 * Request-level tests for the slice-2 attendance bridge additions:
 *   - POST /api/attendance/claim (provision-then-claim, single-use invite)
 *   - company-scoped /record gated on a claimed membership.
 * Harness mirrors tests/attendance-bridge.test.ts (services mocked, no DB).
 */

import crypto from 'crypto';
import request from 'supertest';

const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));

jest.mock('../src/services/tenants', () => ({
  getTenantById: jest.fn().mockResolvedValue({ id: '67ef58b3-683b-4033-83be-0b90d6dee38c' }),
  getTenantByEmail: jest.fn().mockResolvedValue(null),
  authenticateTenant: jest.fn(), createTenant: jest.fn(), createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(), verifyPassword: jest.fn(), updateTenantPlan: jest.fn(),
}));

const pairingCreateSessionMock = jest.fn();
const pairingSubmitProofMock = jest.fn();
jest.mock('../src/services/proof-pairing', () => {
  class PairingDidUnknown extends Error { code = 'pairing_did_unknown'; }
  class PairingProofInvalid extends Error { code = 'pairing_proof_invalid'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  return {
    createSession: (...a: unknown[]) => pairingCreateSessionMock(...a),
    submitProof: (...a: unknown[]) => pairingSubmitProofMock(...a),
    verifyAndConsumeForClaim: jest.fn().mockResolvedValue(undefined),
    getSession: jest.fn(), getSessionPublicMinimal: jest.fn(), subscribeStream: jest.fn(),
    expireOverdueSessions: jest.fn(), streamHeartbeatMs: 15000,
    PairingSessionNotFound: class extends Error {}, PairingSessionExpired: class extends Error {},
    PairingSessionAlreadyBound: class extends Error {}, PairingSessionLocked: class extends Error {},
    PairingSessionBindMismatch: class extends Error {}, PairingNonceMismatch: class extends Error {},
    PairingDidUnknown, PairingProofInvalid, TooManyPendingSessions,
    PlayIntegrityRequired: class extends Error {}, PlayIntegrityInsufficient: class extends Error {},
  };
});

const getCompanyByIdMock = jest.fn();
const findClaimedMembershipMock = jest.fn();
const claimMembershipMock = jest.fn();
jest.mock('../src/services/attendance-membership', () => {
  class AttendanceMembershipError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return {
    getCompanyById: (...a: unknown[]) => getCompanyByIdMock(...a),
    findClaimedMembership: (...a: unknown[]) => findClaimedMembershipMock(...a),
    claimMembership: (...a: unknown[]) => claimMembershipMock(...a),
    AttendanceMembershipError,
  };
});

const createAttendanceEventMock = jest.fn();
jest.mock('../src/services/platform', () => {
  const actual = jest.requireActual('../src/services/platform');
  return {
    ...actual,
    createAttendanceEvent: (...a: unknown[]) => createAttendanceEventMock(...a),
    recordAuditEvent: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('../src/services/api-keys', () => ({ listApiKeys: jest.fn().mockResolvedValue([]), createApiKey: jest.fn(), revokeApiKey: jest.fn(), countActiveKeys: jest.fn().mockResolvedValue(0) }));
jest.mock('../src/services/usage', () => ({ getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-06' }), getUsageSummary: jest.fn(), getRecentCalls: jest.fn(), getCurrentMonthUsage: jest.fn() }));
jest.mock('../src/services/pending-signups', () => ({ createPendingSignup: jest.fn(), consumePendingSignup: jest.fn() }));
jest.mock('../src/services/email', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/email-templates', () => ({ welcomeEmail: () => ({ subject: '', html: '', text: '' }), signupAttemptedNoticeEmail: () => ({ subject: '', html: '', text: '' }), verifySignupEmail: () => ({ subject: '', html: '', text: '' }) }));

import { createApp } from '../src/app';

const DID = 'did:zeroauth:face:9f71801e57db9f337204933063586d3b95d27a11';
const COMPANY_BSSID = 'aa:bb:cc:dd:ee:ff';

function proofBody(extra: Record<string, unknown> = {}) {
  return {
    proof: { pi_a: ['1', '2', '3'], pi_b: [['1', '2'], ['3', '4'], ['5', '6']], pi_c: ['1', '2', '3'], protocol: 'groth16', curve: 'bn128' },
    publicSignals: ['111', '222', '333'],
    ...extra,
  };
}

const app = createApp();
beforeEach(() => { jest.clearAllMocks(); mockQuery.mockResolvedValue({ rows: [] }); });

// ─── /claim ─────────────────────────────────────────────────────────────

describe('POST /api/attendance/claim', () => {
  const companyRow = {
    id: 'co-1', tenant_id: 'tenant-co-1', environment: 'live', name: 'Anchor Corp', location: 'HQ',
    status: 'active', wifi: { ssidLabel: 'Office', bssids: [COMPANY_BSSID], minSignalPercent: 85 },
  };

  // The claim is nonce-bound: the phone must first open a session via /init
  // (which stashes the single-use bind token server-side). Mirror that here.
  async function initForClaim(): Promise<string> {
    const id = crypto.randomUUID();
    getCompanyByIdMock.mockResolvedValue(companyRow);
    pairingCreateSessionMock.mockResolvedValueOnce({ id, nonce: 'a'.repeat(62), sessionBindToken: 'tok', expiresAt: new Date(Date.now() + 3e5).toISOString(), qrPayload: 'za:pair:1:x' });
    const res = await request(app).post('/api/attendance/init').send({ companyId: 'co-1' });
    expect(res.status).toBe(201);
    return res.body.sessionId;
  }

  it('200 binds the membership on a valid claim, scoped to the company tenant', async () => {
    const sessionId = await initForClaim();
    claimMembershipMock.mockResolvedValueOnce({ membership: { id: 'm-1', employee_id: 'E1', full_name: 'Asha' }, userId: 'u-1' });
    const res = await request(app).post('/api/attendance/claim').send({
      companyId: 'co-1', sessionId, inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', ...proofBody(),
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.employee.employeeId).toBe('E1');
    expect(claimMembershipMock.mock.calls[0][0]).toMatchObject({ companyId: 'co-1', inviteCode: 'ZA-AB23-CD45' });
  });

  it('410 when the invite is missing/used/expired', async () => {
    const sessionId = await initForClaim();
    const { AttendanceMembershipError } = jest.requireMock('../src/services/attendance-membership');
    claimMembershipMock.mockRejectedValueOnce(new AttendanceMembershipError('invite_not_found_or_expired', 'gone'));
    const res = await request(app).post('/api/attendance/claim').send({ companyId: 'co-1', sessionId, inviteCode: 'ZA-XXXX-YYYY', did: DID, commitment: '111', ...proofBody() });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('invite_not_found_or_expired');
  });

  it('401 when the proof fails', async () => {
    const sessionId = await initForClaim();
    const { AttendanceMembershipError } = jest.requireMock('../src/services/attendance-membership');
    claimMembershipMock.mockRejectedValueOnce(new AttendanceMembershipError('proof_verification_failed', 'bad'));
    const res = await request(app).post('/api/attendance/claim').send({ companyId: 'co-1', sessionId, inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', ...proofBody() });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('proof_verification_failed');
  });

  it('400 when sessionId is absent — the claim must be nonce-bound via /init', async () => {
    const res = await request(app).post('/api/attendance/claim').send({ companyId: 'co-1', inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', ...proofBody() });
    expect(res.status).toBe(400);
    expect(claimMembershipMock).not.toHaveBeenCalled();
  });

  it('400 on missing fields', async () => {
    const res = await request(app).post('/api/attendance/claim').send({ companyId: 'co-1' });
    expect(res.status).toBe(400);
    expect(claimMembershipMock).not.toHaveBeenCalled();
  });
});

// ─── company-scoped /record (membership gate) ───────────────────────────

describe('company-scoped /record', () => {
  const companyRow = {
    id: 'co-1', tenant_id: 'tenant-co-1', environment: 'live', name: 'Anchor Corp', location: 'HQ',
    status: 'active', wifi: { ssidLabel: 'Office', bssids: [COMPANY_BSSID], minSignalPercent: 85 },
  };

  async function initForCompany(): Promise<string> {
    const id = crypto.randomUUID();
    getCompanyByIdMock.mockResolvedValue(companyRow);
    pairingCreateSessionMock.mockResolvedValueOnce({ id, nonce: 'a'.repeat(62), sessionBindToken: 'tok', expiresAt: new Date(Date.now() + 3e5).toISOString(), qrPayload: 'za:pair:1:x' });
    const res = await request(app).post('/api/attendance/init').send({ companyId: 'co-1' });
    expect(res.status).toBe(201);
    expect(pairingCreateSessionMock.mock.calls[0][0]).toBe('tenant-co-1'); // company's tenant, not demo
    return res.body.sessionId;
  }

  it('201 for a claimed member on the office network', async () => {
    const sessionId = await initForCompany();
    pairingSubmitProofMock.mockResolvedValueOnce({ session: { userId: 'u-1', did: DID }, verification: { id: 'v' }, tokens: {} });
    findClaimedMembershipMock.mockResolvedValueOnce({ id: 'm-1', user_id: 'u-1' });
    createAttendanceEventMock.mockResolvedValueOnce({ id: 'e-1', event_type: 'check_in', result: 'accepted', occurred_at: new Date() });

    const res = await request(app).post('/api/attendance/record').send({
      companyId: 'co-1', sessionId, type: 'check_in', did: DID, wifi: { bssid: COMPANY_BSSID, signal: 92 }, ...proofBody(),
    });
    expect(res.status).toBe(201);
    expect(res.body.result).toBe('accepted');
    expect(pairingSubmitProofMock.mock.calls[0][1]).toBe('tenant-co-1');
  });

  it('403 not_a_member when the verified DID is not a claimed member', async () => {
    const sessionId = await initForCompany();
    pairingSubmitProofMock.mockResolvedValueOnce({ session: { userId: 'u-9', did: DID }, verification: { id: 'v' }, tokens: {} });
    findClaimedMembershipMock.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/attendance/record').send({
      companyId: 'co-1', sessionId, type: 'check_in', did: DID, wifi: { bssid: COMPANY_BSSID, signal: 92 }, ...proofBody(),
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_a_member');
    expect(createAttendanceEventMock).not.toHaveBeenCalled();
  });
});
