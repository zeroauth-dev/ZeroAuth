/**
 * Request-level tests for the NeoBank "ZeroAuth as bank verification
 * layer" endpoints on the demo-portal bridge:
 *
 *   POST /api/demo-portal/bank/signup      — bank account + enrollment start
 *   GET  /api/demo-portal/bank/signup/:id  — ceremony poll + DID auto-bind
 *   POST /api/demo-portal/bank/login       — password check → PINNED session
 *   POST /api/demo-portal/device/pending   — the app's approval inbox poll
 *
 * The load-bearing assertion is the PINNING one: a successful password
 * login must open the pairing session WITH the account's bound DID as
 * the expectedDid argument, so only that identity's proof can consume
 * it (enforced service-side; see tests/pinned-pairing.test.ts).
 *
 * Harness mirrors tests/demo-portal.test.ts (route-level, services
 * mocked, no live DB).
 */

import request from 'supertest';

const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));

const DEMO_TENANT_ID = '67ef58b3-683b-4033-83be-0b90d6dee38c';
const getTenantByIdMock = jest.fn();
jest.mock('../src/services/tenants', () => ({
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args),
  getTenantByEmail: jest.fn(),
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

const pairingCreateSessionMock = jest.fn();
const listPinnedPendingSessionsMock = jest.fn();
jest.mock('../src/services/proof-pairing', () => {
  class PairingSessionNotFound extends Error { code = 'pairing_session_not_found'; }
  class PairingSessionBindMismatch extends Error { code = 'pairing_session_bind_mismatch'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  return {
    createSession: (...args: unknown[]) => pairingCreateSessionMock(...args),
    listPinnedPendingSessions: (...args: unknown[]) => listPinnedPendingSessionsMock(...args),
    PairingSessionNotFound,
    PairingSessionBindMismatch,
    TooManyPendingSessions,
    submitProof: jest.fn(),
    getSession: jest.fn(),
    getSessionPublicMinimal: jest.fn(),
    subscribeStream: jest.fn(),
    expireOverdueSessions: jest.fn(),
    verifyIdentityProof: jest.fn(),
    streamHeartbeatMs: 15000,
  };
});

const startRegistrationMock = jest.fn();
const getRegistrationSessionMock = jest.fn();
jest.mock('../src/services/registration', () => ({
  startRegistration: (...args: unknown[]) => startRegistrationMock(...args),
  getRegistrationSession: (...args: unknown[]) => getRegistrationSessionMock(...args),
  peekPendingDemoCode: jest.fn().mockReturnValue(null),
  shouldCacheDemoCode: jest.fn().mockReturnValue(false),
  pairDeviceForRegistration: jest.fn(),
  submitCommitmentForRegistration: jest.fn(),
  completeRegistration: jest.fn(),
  abandonRegistration: jest.fn(),
}));

const createBankAccountMock = jest.fn();
const bindEnrollmentMock = jest.fn();
const verifyBankLoginMock = jest.fn();
jest.mock('../src/services/demo-bank', () => {
  class BankCustomerIdTaken extends Error { code = 'customer_id_taken'; }
  class BankInvalidCredentials extends Error { code = 'invalid_credentials'; }
  class BankEnrollmentPending extends Error { code = 'enrollment_pending'; }
  class BankAccountLocked extends Error { code = 'account_locked'; }
  return {
    createBankAccount: (...args: unknown[]) => createBankAccountMock(...args),
    bindEnrollment: (...args: unknown[]) => bindEnrollmentMock(...args),
    verifyBankLogin: (...args: unknown[]) => verifyBankLoginMock(...args),
    BankCustomerIdTaken, BankInvalidCredentials, BankEnrollmentPending, BankAccountLocked,
  };
});

const recordAuditEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/platform', () => {
  const actual = jest.requireActual('../src/services/platform');
  return { ...actual, recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args) };
});
jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  countActiveKeys: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn(),
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
import {
  BankInvalidCredentials,
  BankEnrollmentPending,
  BankAccountLocked,
  BankCustomerIdTaken,
} from '../src/services/demo-bank';

const app = createApp();
const DID = 'did:zeroauth:face:' + 'a1'.repeat(20);

function seedTenant() {
  getTenantByIdMock.mockResolvedValue({
    id: DEMO_TENANT_ID, email: 'demo-portal@zeroauth.dev', status: 'active',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  seedTenant();
});

// ─── POST /bank/signup ─────────────────────────────────────────────────

describe('POST /api/demo-portal/bank/signup', () => {
  const good = { name: 'Asha Rao', customerId: 'asha@example.com', password: 'S3cure-pass' };

  it('400 when password is too weak (short / no digit)', async () => {
    for (const password of ['short1', 'nodigitshere']) {
      const res = await request(app).post('/api/demo-portal/bank/signup').send({ ...good, password });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('weak_password');
    }
    expect(createBankAccountMock).not.toHaveBeenCalled();
  });

  it('400 when customerId is not email-shaped', async () => {
    const res = await request(app).post('/api/demo-portal/bank/signup').send({ ...good, customerId: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('409 customer_id_taken when the account already exists', async () => {
    startRegistrationMock.mockResolvedValue({
      session: { id: 'reg-1' }, pairCode: 'pc', pairDeeplink: 'zeroauth://reg?x', pairCodeExpiresAt: 'ts',
    });
    createBankAccountMock.mockRejectedValue(new BankCustomerIdTaken());
    const res = await request(app).post('/api/demo-portal/bank/signup').send(good);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('customer_id_taken');
  });

  it('201 opens the enrollment ceremony + creates the pending bank account', async () => {
    startRegistrationMock.mockResolvedValue({
      session: { id: 'reg-1' }, pairCode: 'pc', pairDeeplink: 'zeroauth://reg?p=abc', pairCodeExpiresAt: '2030-01-01T00:00:00Z',
    });
    createBankAccountMock.mockResolvedValue({ id: 'bank-1', status: 'pending_enrollment' });

    const res = await request(app).post('/api/demo-portal/bank/signup').send(good);

    expect(res.status).toBe(201);
    expect(res.body.signupId).toBe('reg-1');
    expect(res.body.pairDeeplink).toContain('zeroauth://');
    // account row created against the demo tenant with the ceremony id
    const args = createBankAccountMock.mock.calls[0][0];
    expect(args.tenantId).toBe(DEMO_TENANT_ID);
    expect(args.customerId).toBe('asha@example.com');
    expect(args.registrationSessionId).toBe('reg-1');
    // the password itself is passed for hashing, never logged — presence only
    expect(args.password).toBe(good.password);
  });
});

// ─── GET /bank/signup/:id ──────────────────────────────────────────────

describe('GET /api/demo-portal/bank/signup/:id', () => {
  it('404 for an unknown ceremony', async () => {
    getRegistrationSessionMock.mockResolvedValue(null);
    const res = await request(app).get('/api/demo-portal/bank/signup/reg-x');
    expect(res.status).toBe(404);
  });

  it('mid-ceremony: returns state, does NOT bind', async () => {
    getRegistrationSessionMock.mockResolvedValue({ state: 'awaiting_commitment' });
    const res = await request(app).get('/api/demo-portal/bank/signup/reg-1');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('awaiting_commitment');
    expect(bindEnrollmentMock).not.toHaveBeenCalled();
  });

  it('completed: auto-binds the DID onto the bank account', async () => {
    getRegistrationSessionMock.mockResolvedValue({ state: 'completed' });
    bindEnrollmentMock.mockResolvedValue({ status: 'active', did: DID });
    const res = await request(app).get('/api/demo-portal/bank/signup/reg-1');
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('completed');
    expect(res.body.accountStatus).toBe('active');
    expect(bindEnrollmentMock).toHaveBeenCalledWith(DEMO_TENANT_ID, 'live', 'reg-1');
  });
});

// ─── POST /bank/login ──────────────────────────────────────────────────

describe('POST /api/demo-portal/bank/login', () => {
  const creds = { customerId: 'asha@example.com', password: 'S3cure-pass' };

  it('401 invalid_credentials — uniform for unknown customer AND wrong password', async () => {
    verifyBankLoginMock.mockRejectedValue(new BankInvalidCredentials());
    const res = await request(app).post('/api/demo-portal/bank/login').send(creds);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_credentials');
    expect(pairingCreateSessionMock).not.toHaveBeenCalled();
  });

  it('409 enrollment_pending when the ZeroAuth bind never completed', async () => {
    verifyBankLoginMock.mockRejectedValue(new BankEnrollmentPending());
    const res = await request(app).post('/api/demo-portal/bank/login').send(creds);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('enrollment_pending');
  });

  it('423 account_locked after repeated failures', async () => {
    verifyBankLoginMock.mockRejectedValue(new BankAccountLocked());
    const res = await request(app).post('/api/demo-portal/bank/login').send(creds);
    expect(res.status).toBe(423);
    expect(res.body.error).toBe('account_locked');
  });

  it('201 on success — opens a pairing session PINNED to the account DID', async () => {
    verifyBankLoginMock.mockResolvedValue({ id: 'bank-1', did: DID, fullName: 'Asha Rao', tenantUserId: 'u-1' });
    pairingCreateSessionMock.mockResolvedValue({
      id: 'sess-1', nonce: 'ab'.repeat(31), sessionBindToken: 'bind-token',
      expiresAt: '2030-01-01T00:00:00Z', qrPayload: 'za:pair:1:sess-1:...',
    });

    const res = await request(app).post('/api/demo-portal/bank/login').send(creds);

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe('sess-1');
    expect(res.body.qrPayload).toContain('za:pair:1:');
    // THE pinning assertion: expectedDid is threaded into createSession.
    const args = pairingCreateSessionMock.mock.calls[0];
    expect(args[0]).toBe(DEMO_TENANT_ID);
    expect(args[1]).toBe('live');
    expect(args[5]).toBe(DID);
    // desktop claim cookie minted so the browser can claim after approval
    const setCookie = String(res.headers['set-cookie'] ?? '');
    expect(setCookie).toMatch(/demo_portal_claim=/);
  });
});

// ─── POST /device/pending ──────────────────────────────────────────────

describe('POST /api/demo-portal/device/pending', () => {
  it('400 on a malformed DID', async () => {
    const res = await request(app).post('/api/demo-portal/device/pending').send({ did: 'nope' });
    expect(res.status).toBe(400);
    expect(listPinnedPendingSessionsMock).not.toHaveBeenCalled();
  });

  it('200 returns the approval inbox for the DID', async () => {
    listPinnedPendingSessionsMock.mockResolvedValue([{
      id: 'sess-1', qrPayload: 'za:pair:1:sess-1:nonce:zeroauth.dev:abcd',
      expiresAt: '2030-01-01T00:00:00Z', createdAt: '2029-12-31T23:56:00Z',
      deviceHint: 'Chrome on macOS',
    }]);

    const res = await request(app).post('/api/demo-portal/device/pending').send({ did: DID });

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    const r = res.body.requests[0];
    expect(r.sessionId).toBe('sess-1');
    expect(r.qrPayload).toContain('za:pair:1:');
    expect(r.bank).toBe('NeoBank');
    expect(r.deviceHint).toBe('Chrome on macOS');
    expect(listPinnedPendingSessionsMock).toHaveBeenCalledWith(DEMO_TENANT_ID, 'live', DID);
  });

  it('200 with an empty inbox when nothing is pending', async () => {
    listPinnedPendingSessionsMock.mockResolvedValue([]);
    const res = await request(app).post('/api/demo-portal/device/pending').send({ did: DID });
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });
});
