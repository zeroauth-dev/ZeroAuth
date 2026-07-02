/**
 * Request-level tests for the NeoBank dashboard routes:
 *   GET  /api/demo-portal/bank/overview
 *   POST /api/demo-portal/bank/transfer
 *   GET  /api/demo-portal/bank/transfer/:id
 *
 * The differentiator under test: a transfer >= the step-up threshold opens
 * a DID-PINNED "Payment approval" session (createSession called with the
 * account DID + an amount/payee label); a sub-threshold transfer settles
 * immediately. Harness mirrors tests/demo-portal.test.ts (cookie synthesis,
 * services mocked, no live DB).
 */
import crypto from 'crypto';
import request from 'supertest';
import { config } from '../src/config';

const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: mockQuery }) }));

const DEMO_TENANT_ID = '67ef58b3-683b-4033-83be-0b90d6dee38c';
jest.mock('../src/services/tenants', () => ({
  getTenantById: jest.fn().mockResolvedValue({ id: '67ef58b3-683b-4033-83be-0b90d6dee38c', status: 'active' }),
  getTenantByEmail: jest.fn(),
  authenticateTenant: jest.fn(), createTenant: jest.fn(), createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(), verifyPassword: jest.fn(),
}));

const pairingCreateSessionMock = jest.fn();
jest.mock('../src/services/proof-pairing', () => {
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  return {
    createSession: (...a: unknown[]) => pairingCreateSessionMock(...a),
    listPinnedPendingSessions: jest.fn(), submitProof: jest.fn(), getSession: jest.fn(),
    getSessionPublicMinimal: jest.fn(), subscribeStream: jest.fn(), expireOverdueSessions: jest.fn(),
    TooManyPendingSessions,
    PairingSessionNotFound: class extends Error {}, PairingSessionExpired: class extends Error {},
    PairingSessionAlreadyBound: class extends Error {}, PairingSessionLocked: class extends Error {},
    PairingSessionBindMismatch: class extends Error {}, PairingNonceMismatch: class extends Error {},
    PairingDidUnknown: class extends Error {}, PairingProofInvalid: class extends Error {},
    PlayIntegrityRequired: class extends Error {}, PlayIntegrityInsufficient: class extends Error {},
    VerifierUnavailable: class extends Error {}, streamHeartbeatMs: 15000,
  };
});

const getBankOverviewMock = jest.fn();
const resolveBankAccountByUserMock = jest.fn();
const executeImmediateTransferMock = jest.fn();
const insertPendingTransferMock = jest.fn();
const commitTransferIfApprovedMock = jest.fn();
jest.mock('../src/services/demo-bank', () => {
  class BankInsufficientFunds extends Error { code = 'insufficient_funds'; }
  return {
    getBankOverview: (...a: unknown[]) => getBankOverviewMock(...a),
    resolveBankAccountByUser: (...a: unknown[]) => resolveBankAccountByUserMock(...a),
    executeImmediateTransfer: (...a: unknown[]) => executeImmediateTransferMock(...a),
    insertPendingTransfer: (...a: unknown[]) => insertPendingTransferMock(...a),
    commitTransferIfApproved: (...a: unknown[]) => commitTransferIfApprovedMock(...a),
    formatPaise: (p: number) => `₹${Math.round(p / 100)}`,
    STEP_UP_THRESHOLD_PAISE: 10_000_00,
    createBankAccount: jest.fn(), bindEnrollment: jest.fn(), verifyBankLogin: jest.fn(),
    BankInsufficientFunds,
    BankCustomerIdTaken: class extends Error {}, BankInvalidCredentials: class extends Error {},
    BankEnrollmentPending: class extends Error {}, BankAccountLocked: class extends Error {},
  };
});

jest.mock('../src/services/platform', () => {
  const actual = jest.requireActual('../src/services/platform');
  return { ...actual, recordAuditEvent: jest.fn().mockResolvedValue(undefined) };
});
jest.mock('../src/services/api-keys', () => ({ listApiKeys: jest.fn().mockResolvedValue([]), createApiKey: jest.fn(), revokeApiKey: jest.fn(), countActiveKeys: jest.fn().mockResolvedValue(0) }));
jest.mock('../src/services/usage', () => ({ getMonthlyUsage: jest.fn(), getUsageSummary: jest.fn(), getRecentCalls: jest.fn(), getCurrentMonthUsage: jest.fn() }));
jest.mock('../src/services/pending-signups', () => ({ createPendingSignup: jest.fn(), consumePendingSignup: jest.fn() }));
jest.mock('../src/services/email', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/email-templates', () => ({ welcomeEmail: () => ({}), signupAttemptedNoticeEmail: () => ({}), verifySignupEmail: () => ({}) }));

import { createApp } from '../src/app';

const app = createApp();
const DID = 'did:zeroauth:face:' + 'aa'.repeat(20);

/** Replicate demo-portal encodeCookie() so we can synthesise a logged-in session. */
function demoCookie(userId: string): string {
  const body = Buffer.from(JSON.stringify({ userId, pairingSessionId: 'p', startedAtMs: Date.now() }), 'utf8').toString('base64url');
  const key = crypto.createHash('sha256').update('demo-portal::' + config.jwt.secret).digest();
  const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `demo_portal_session=${body}.${mac}`;
}
const COOKIE = demoCookie('user-1');

const ACTIVE_ACCOUNT = { id: 'bank-1', did: DID, status: 'active' };
beforeEach(() => {
  jest.clearAllMocks();
  // Set on every mocked fn the transfer routes resolve, so no test depends
  // on execution order for the account lookup.
  resolveBankAccountByUserMock.mockResolvedValue(ACTIVE_ACCOUNT);
});

describe('GET /api/demo-portal/bank/overview', () => {
  it('401 without a session cookie', async () => {
    const res = await request(app).get('/api/demo-portal/bank/overview');
    expect(res.status).toBe(401);
  });

  it('200 returns balance + transactions for the session account', async () => {
    getBankOverviewMock.mockResolvedValue({
      fullName: 'Asha', did: DID, primaryBalancePaise: 48231600,
      accounts: [{ id: 'sav', kind: 'savings', maskedNumber: '•••• 4421', balancePaise: 48231600 }],
      transactions: [{ id: 't', direction: 'debit', counterparty: 'Swiggy', amountPaise: 28400, note: null, category: 'food', status: 'completed', createdAt: '2026-07-01T00:00:00Z' }],
    });
    const res = await request(app).get('/api/demo-portal/bank/overview').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Asha');
    expect(res.body.primaryBalanceDisplay).toBe('₹482316');
    expect(res.body.accounts[0].balanceDisplay).toBe('₹482316');
    expect(res.body.transactions[0].amountDisplay).toBe('₹284');
    expect(res.body.stepUpThresholdDisplay).toBe('₹10000');
  });

  it('404 no_account when the session user has no bank account', async () => {
    getBankOverviewMock.mockResolvedValue(null);
    const res = await request(app).get('/api/demo-portal/bank/overview').set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('no_account');
  });
});

describe('POST /api/demo-portal/bank/transfer', () => {
  it('401 without a cookie', async () => {
    const res = await request(app).post('/api/demo-portal/bank/transfer').send({ amount: 500, payeeName: 'Priya' });
    expect(res.status).toBe(401);
  });

  it('400 on a non-positive / non-integer amount', async () => {
    for (const amount of [0, -5, 12.5]) {
      const res = await request(app).post('/api/demo-portal/bank/transfer').set('Cookie', COOKIE).send({ amount, payeeName: 'Priya' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_request');
    }
  });

  it('sub-threshold (₹500) settles immediately, no approval session', async () => {
    resolveBankAccountByUserMock.mockResolvedValue(ACTIVE_ACCOUNT);
    executeImmediateTransferMock.mockResolvedValue({ transferId: 'txn-1', balancePaise: 48181600 });
    const res = await request(app).post('/api/demo-portal/bank/transfer').set('Cookie', COOKIE).send({ amount: 500, payeeName: 'Priya' });
    expect(res.status).toBe(200);
    expect(res.body.requiresApproval).toBe(false);
    expect(res.body.status).toBe('completed');
    expect(res.body.balanceDisplay).toBe('₹481816');
    expect(pairingCreateSessionMock).not.toHaveBeenCalled();
    expect(executeImmediateTransferMock).toHaveBeenCalledWith('bank-1', expect.objectContaining({ amountPaise: 50000, payeeName: 'Priya' }));
  });

  it('at-threshold (₹10,000) opens a DID-PINNED, LABELLED approval session', async () => {
    resolveBankAccountByUserMock.mockResolvedValue(ACTIVE_ACCOUNT);
    pairingCreateSessionMock.mockResolvedValue({
      id: 'sess-1', nonce: 'ab'.repeat(31), sessionBindToken: 'tok',
      expiresAt: '2030-01-01T00:00:00Z', qrPayload: 'za:pair:1:sess-1:...',
    });
    insertPendingTransferMock.mockResolvedValue({ transferId: 'txn-2' });

    const res = await request(app).post('/api/demo-portal/bank/transfer').set('Cookie', COOKIE)
      .send({ amount: 10000, payeeName: 'Priya Sharma', note: 'rent' });

    expect(res.status).toBe(201);
    expect(res.body.requiresApproval).toBe(true);
    expect(res.body.transferId).toBe('txn-2');
    expect(res.body.sessionId).toBe('sess-1');
    expect(res.body.contextLabel).toBe('Pay ₹10000 to Priya Sharma');
    // THE assertions: pinned to the account DID (arg 6) + labelled (arg 7).
    const args = pairingCreateSessionMock.mock.calls[0];
    expect(args[5]).toBe(DID);
    expect(args[6]).toBe('Pay ₹10000 to Priya Sharma');
    // the pending transfer is linked to that session
    expect(insertPendingTransferMock).toHaveBeenCalledWith('bank-1', expect.objectContaining({ amountPaise: 10_000_00 }), 'sess-1');
  });

  it('400 insufficient_funds surfaced from the service', async () => {
    resolveBankAccountByUserMock.mockResolvedValue(ACTIVE_ACCOUNT);
    const { BankInsufficientFunds } = jest.requireMock('../src/services/demo-bank');
    executeImmediateTransferMock.mockRejectedValue(new BankInsufficientFunds());
    const res = await request(app).post('/api/demo-portal/bank/transfer').set('Cookie', COOKIE).send({ amount: 500, payeeName: 'Priya' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('insufficient_funds');
  });
});

describe('GET /api/demo-portal/bank/transfer/:id', () => {
  it('reflects the settle status from the service', async () => {
    commitTransferIfApprovedMock.mockResolvedValue({ status: 'completed', transferId: 'txn-2', counterparty: 'Priya', amountPaise: 10_000_00, balancePaise: 47231600 });
    const res = await request(app).get('/api/demo-portal/bank/transfer/txn-2').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.balanceDisplay).toBe('₹472316');
  });

  it('still-pending while the phone has not approved', async () => {
    commitTransferIfApprovedMock.mockResolvedValue({ status: 'pending_approval', transferId: 'txn-2', counterparty: 'Priya', amountPaise: 10_000_00, balancePaise: null });
    const res = await request(app).get('/api/demo-portal/bank/transfer/txn-2').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.balanceDisplay).toBeNull();
  });

  it('404 for an unknown transfer', async () => {
    commitTransferIfApprovedMock.mockResolvedValue({ status: 'not_found' });
    const res = await request(app).get('/api/demo-portal/bank/transfer/nope').set('Cookie', COOKIE);
    expect(res.status).toBe(404);
  });
});
