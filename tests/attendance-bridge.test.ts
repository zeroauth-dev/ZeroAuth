/**
 * Request-level tests for /api/attendance/* — the face-first office
 * attendance bridge in front of the production /v1/proof-pairing/*
 * verifier.
 *
 *   GET  /api/attendance/company        — anchor config for the phone
 *   POST /api/attendance/init           — open a pairing session, return nonce
 *   POST /api/attendance/record         — verify proof + WiFi gate, record event
 *
 * Attendance reuses the EXACT proof-pairing verifier the W3 sign-in uses
 * (Poseidon nonce binding, commitment match, Groth16 verify, atomic
 * single-use consume). On top of that it adds a strict server-side
 * WiFi-anchor re-check and an attendance_events write. These tests pin:
 *
 *   1. /company returns the configured anchor (BSSIDs + min signal).
 *   2. /init opens a pairing session on the demo-portal tenant + `live`.
 *   3. /record happy path → 201 accepted, attendance recorded.
 *   4. /record off-network → 403 outside_anchor + a `rejected` row
 *      (audit trail of an off-site attempt — buddy-punch defence).
 *   5. /record proof failures map to the proof-pairing status codes.
 *   6. /record is single-use per session (replay defence).
 *   7. tenant isolation — every verify is scoped to the demo tenant id.
 *
 * There is intentionally no did-keyed /status read (it would be a public
 * presence-enumeration oracle); the phone tracks its own check-in state.
 *
 * Harness mirrors tests/demo-portal.test.ts (service mocking, no live DB).
 */

import crypto from 'crypto';
import request from 'supertest';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

const DEMO_TENANT_ID = '67ef58b3-683b-4033-83be-0b90d6dee38c';
const getTenantByIdMock = jest.fn();
const getTenantByEmailMock = jest.fn();
jest.mock('../src/services/tenants', () => ({
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args),
  getTenantByEmail: (...args: unknown[]) => getTenantByEmailMock(...args),
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  updateTenantPlan: jest.fn(),
}));

// proof-pairing.createSession + submitProof are the only functions the
// bridge calls. Error classes are real ES classes so the route's
// `err instanceof Pairing*` mapping fires.
const pairingCreateSessionMock = jest.fn();
const pairingSubmitProofMock = jest.fn();
jest.mock('../src/services/proof-pairing', () => {
  class PairingSessionNotFound extends Error { code = 'pairing_session_not_found'; }
  class PairingSessionExpired extends Error { code = 'pairing_session_expired'; }
  class PairingSessionAlreadyBound extends Error { code = 'pairing_session_already_bound'; }
  class PairingSessionLocked extends Error { code = 'pairing_session_locked'; }
  class PairingSessionBindMismatch extends Error { code = 'pairing_session_bind_mismatch'; }
  class PairingNonceMismatch extends Error { code = 'pairing_nonce_mismatch'; }
  class PairingDidUnknown extends Error { code = 'pairing_did_unknown'; }
  class PairingProofInvalid extends Error { code = 'pairing_proof_invalid'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  class PlayIntegrityRequired extends Error { code = 'play_integrity_required'; }
  class PlayIntegrityInsufficient extends Error { code = 'play_integrity_insufficient'; }
  return {
    createSession: (...args: unknown[]) => pairingCreateSessionMock(...args),
    submitProof: (...args: unknown[]) => pairingSubmitProofMock(...args),
    getSession: jest.fn(),
    getSessionPublicMinimal: jest.fn(),
    subscribeStream: jest.fn(),
    expireOverdueSessions: jest.fn(),
    streamHeartbeatMs: 15000,
    PairingSessionNotFound,
    PairingSessionExpired,
    PairingSessionAlreadyBound,
    PairingSessionLocked,
    PairingSessionBindMismatch,
    PairingNonceMismatch,
    PairingDidUnknown,
    PairingProofInvalid,
    TooManyPendingSessions,
    PlayIntegrityRequired,
    PlayIntegrityInsufficient,
  };
});

// platform.createAttendanceEvent is mocked (no DB); everything else the
// v1 router pulls at import stays real.
const createAttendanceEventMock = jest.fn();
const recordAuditEventMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/services/platform', () => {
  const actual = jest.requireActual('../src/services/platform');
  return {
    ...actual,
    createAttendanceEvent: (...args: unknown[]) => createAttendanceEventMock(...args),
    recordAuditEvent: (...args: unknown[]) => recordAuditEventMock(...args),
  };
});

// Console-surface services app.ts pulls at import — no-op stubs so
// createApp() doesn't reach for live state.
jest.mock('../src/services/api-keys', () => ({
  listApiKeys: jest.fn().mockResolvedValue([]),
  createApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  countActiveKeys: jest.fn().mockResolvedValue(0),
}));
jest.mock('../src/services/usage', () => ({
  getMonthlyUsage: jest.fn().mockResolvedValue({ requests: 0, period: '2026-05' }),
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

// ─── Fixtures ──────────────────────────────────────────────────────────

const ANCHOR_BSSID = 'aa:bb:cc:dd:ee:ff';
const DID = 'did:zeroauth:face:9f71801e57db9f337204933063586d3b95d27a11';

function makeTenantRow(id: string) {
  return {
    id, email: 'demo-portal@zeroauth.dev', company_name: 'NeoBank Demo Portal',
    plan: 'free', status: 'active', rate_limit: 100, monthly_quota: 1000,
    metadata: {}, created_at: new Date(), updated_at: new Date(),
  };
}

function validProofBody(extra: Record<string, unknown> = {}) {
  return {
    did: DID,
    proof: {
      pi_a: ['1', '2', '3'],
      pi_b: [['1', '2'], ['3', '4'], ['5', '6']],
      pi_c: ['1', '2', '3'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals: ['111', '222', '333'],
    clientMeta: { appVersion: '0.1.0', platform: 'android', proofMs: 4200 },
    ...extra,
  };
}

/** Run /init for a known session id and return it (seeds the bind token). */
async function initSession(app: ReturnType<typeof createApp>): Promise<string> {
  const id = crypto.randomUUID();
  pairingCreateSessionMock.mockResolvedValueOnce({
    id,
    nonce: crypto.randomBytes(31).toString('hex'),
    sessionBindToken: 'bind-' + crypto.randomBytes(8).toString('hex'),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    qrPayload: `za:pair:1:${id}:nonce:zeroauth.dev:abcd`,
  });
  const res = await request(app).post('/api/attendance/init').send({});
  expect(res.status).toBe(201);
  return res.body.sessionId as string;
}

function submitSucceeds(userId: string) {
  pairingSubmitProofMock.mockResolvedValueOnce({
    session: { id: crypto.randomUUID(), state: 'consumed', userId, did: DID, boundAt: new Date().toISOString() },
    verification: { id: crypto.randomUUID() },
    tokens: { accessToken: 't', refreshToken: 'r', tokenType: 'Bearer', expiresIn: 3600 },
  });
}

function eventRow(type: string, result: string) {
  return {
    id: crypto.randomUUID(),
    event_type: type,
    result,
    occurred_at: new Date('2026-06-12T09:02:00.000Z'),
    user_id: 'user-1',
    device_id: null,
    verification_id: null,
  };
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  getTenantByIdMock.mockResolvedValue(makeTenantRow(DEMO_TENANT_ID));
  getTenantByEmailMock.mockResolvedValue(null);
  // Strict anchor: one office BSSID, default 85% floor.
  process.env.ATTENDANCE_WIFI_BSSIDS = ANCHOR_BSSID;
  process.env.ATTENDANCE_WIFI_MIN_SIGNAL = '85';
  process.env.ATTENDANCE_COMPANY_NAME = 'Anchor Corp';
  // api_keys lookup (resolveApiKeyId) + status queries default to empty.
  mockQuery.mockResolvedValue({ rows: [] });
});

afterAll(() => {
  delete process.env.ATTENDANCE_WIFI_BSSIDS;
  delete process.env.ATTENDANCE_WIFI_MIN_SIGNAL;
  delete process.env.ATTENDANCE_COMPANY_NAME;
});

// ─── (1) GET /company ──────────────────────────────────────────────────

describe('GET /api/attendance/company', () => {
  it('returns the configured company + WiFi anchor', async () => {
    const res = await request(app).get('/api/attendance/company');
    expect(res.status).toBe(200);
    expect(res.body.company.name).toBe('Anchor Corp');
    expect(res.body.company.wifi.bssids).toEqual([ANCHOR_BSSID]);
    expect(res.body.company.wifi.minSignalPercent).toBe(85);
    // The label is informational; the BSSID is the real anchor.
    expect(res.body.company.wifi.ssidLabel).toBeDefined();
  });
});

// ─── (2) POST /init ────────────────────────────────────────────────────

describe('POST /api/attendance/init', () => {
  it('201 returns sessionId + 62-hex nonce + company, scoped to the demo tenant + live', async () => {
    const id = crypto.randomUUID();
    const nonce = crypto.randomBytes(31).toString('hex');
    pairingCreateSessionMock.mockResolvedValueOnce({
      id, nonce, sessionBindToken: 'tok', expiresAt: new Date(Date.now() + 300000).toISOString(),
      qrPayload: `za:pair:1:${id}:${nonce}:zeroauth.dev:abcd`,
    });

    const res = await request(app).post('/api/attendance/init').send({});

    expect(res.status).toBe(201);
    expect(res.body.sessionId).toBe(id);
    expect(res.body.nonce).toBe(nonce);
    expect(res.body.nonce).toHaveLength(62);
    expect(res.body.company.name).toBe('Anchor Corp');

    const callArgs = pairingCreateSessionMock.mock.calls[0];
    expect(callArgs[0]).toBe(DEMO_TENANT_ID); // tenant
    expect(callArgs[1]).toBe('live');         // environment
    expect(callArgs[2]).toBeNull();           // no api key id (phone holds none)
  });
});

// ─── (3) POST /record — happy path ─────────────────────────────────────

describe('POST /api/attendance/record — happy path', () => {
  it('201 records an accepted check_in when proof verifies and WiFi matches', async () => {
    const sessionId = await initSession(app);
    submitSucceeds('user-1');
    createAttendanceEventMock.mockResolvedValueOnce(eventRow('check_in', 'accepted'));

    const res = await request(app).post('/api/attendance/record').send({
      sessionId,
      type: 'check_in',
      wifi: { bssid: 'AA:BB:CC:DD:EE:FF', signal: 92 },
      ...validProofBody(),
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.type).toBe('check_in');
    expect(res.body.result).toBe('accepted');

    // Verify ran on the demo tenant via the proof-pairing path.
    const submitArgs = pairingSubmitProofMock.mock.calls[0];
    expect(submitArgs[0]).toBe(sessionId);
    expect(submitArgs[1]).toBe(DEMO_TENANT_ID);
    expect(submitArgs[2]).toBe('live');
    expect(submitArgs[3]).toBe(DID);

    // Attendance recorded as accepted for the verified user.
    const evArgs = createAttendanceEventMock.mock.calls[0];
    expect(evArgs[0]).toBe(DEMO_TENANT_ID);
    expect(evArgs[1]).toBe('live');
    expect(evArgs[3]).toMatchObject({ userId: 'user-1', type: 'check_in', result: 'accepted' });
    expect(evArgs[3].metadata).toMatchObject({ wifi_ok: true });
  });
});

// ─── (4) POST /record — off-network ────────────────────────────────────

describe('POST /api/attendance/record — WiFi gate', () => {
  it('403 outside_anchor + records a rejected row when the BSSID does not match', async () => {
    const sessionId = await initSession(app);
    submitSucceeds('user-1');
    createAttendanceEventMock.mockResolvedValueOnce(eventRow('check_in', 'rejected'));

    const res = await request(app).post('/api/attendance/record').send({
      sessionId,
      type: 'check_in',
      wifi: { bssid: '11:22:33:44:55:66', signal: 99 }, // wrong network
      ...validProofBody(),
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('outside_anchor');
    // Identity was still verified, and the off-site attempt is recorded.
    expect(pairingSubmitProofMock).toHaveBeenCalledTimes(1);
    const evArgs = createAttendanceEventMock.mock.calls[0];
    expect(evArgs[3]).toMatchObject({ userId: 'user-1', result: 'rejected' });
    expect(evArgs[3].metadata).toMatchObject({ wifi_ok: false, wifi_reason: 'bssid_mismatch' });
  });

  it('403 outside_anchor when the signal is below the configured floor', async () => {
    const sessionId = await initSession(app);
    submitSucceeds('user-1');
    createAttendanceEventMock.mockResolvedValueOnce(eventRow('check_in', 'rejected'));

    const res = await request(app).post('/api/attendance/record').send({
      sessionId,
      type: 'check_in',
      wifi: { bssid: ANCHOR_BSSID, signal: 40 }, // right network, too weak
      ...validProofBody(),
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('outside_anchor');
    expect(createAttendanceEventMock.mock.calls[0][3].metadata).toMatchObject({ wifi_reason: 'weak_signal' });
  });
});

// ─── (5) POST /record — proof failures map to pairing codes ────────────

describe('POST /api/attendance/record — proof failures', () => {
  it('401 pairing_proof_invalid when the verifier rejects the proof', async () => {
    const { PairingProofInvalid } = jest.requireMock('../src/services/proof-pairing');
    const sessionId = await initSession(app);
    pairingSubmitProofMock.mockRejectedValueOnce(new PairingProofInvalid());

    const res = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('pairing_proof_invalid');
    // No attendance row written when identity fails.
    expect(createAttendanceEventMock).not.toHaveBeenCalled();
  });

  it('400 pairing_did_unknown for a DID / commitment that does not resolve (A-25 uniform)', async () => {
    const { PairingDidUnknown } = jest.requireMock('../src/services/proof-pairing');
    const sessionId = await initSession(app);
    pairingSubmitProofMock.mockRejectedValueOnce(new PairingDidUnknown());

    const res = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('pairing_did_unknown');
  });

  it('400 invalid_request when the body is missing required fields', async () => {
    const res = await request(app).post('/api/attendance/record').send({ type: 'check_in' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(pairingSubmitProofMock).not.toHaveBeenCalled();
  });

  it('400 invalid_type for an unknown attendance type', async () => {
    const sessionId = await initSession(app);
    const res = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'lunch', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_type');
  });

  it('400 invalid_request for a malformed did (rejected before the verifier)', async () => {
    const sessionId = await initSession(app);
    const res = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 },
      ...validProofBody({ did: 'not-a-did' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    expect(pairingSubmitProofMock).not.toHaveBeenCalled();
  });
});

// ─── (6) POST /record — single-use per session (replay defence) ────────

describe('POST /api/attendance/record — replay defence', () => {
  it('410 attendance_session_expired on a second record for the same session id', async () => {
    const sessionId = await initSession(app);
    submitSucceeds('user-1');
    createAttendanceEventMock.mockResolvedValueOnce(eventRow('check_in', 'accepted'));

    const first = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });
    expect(first.status).toBe(201);

    // The bind token is single-use; a replayed record cannot re-verify.
    const second = await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });
    expect(second.status).toBe(410);
    expect(second.body.error).toBe('attendance_session_expired');
    expect(pairingSubmitProofMock).toHaveBeenCalledTimes(1);
  });
});

// ─── (7) Tenant isolation ──────────────────────────────────────────────
//
// There is intentionally no did-keyed /status read (it would be a public
// presence oracle — security review Finding 1). Tenant isolation is
// asserted on the verify path: /init and /record always scope to the
// resolved demo-portal tenant, never a caller-supplied value.

describe('tenant isolation', () => {
  it('init + record verify against the demo-portal tenant id + live only', async () => {
    const sessionId = await initSession(app);
    // /init scoped the pairing session to the demo tenant.
    expect(pairingCreateSessionMock.mock.calls[0][0]).toBe(DEMO_TENANT_ID);
    expect(pairingCreateSessionMock.mock.calls[0][1]).toBe('live');

    submitSucceeds('user-1');
    createAttendanceEventMock.mockResolvedValueOnce(eventRow('check_in', 'accepted'));
    await request(app).post('/api/attendance/record').send({
      sessionId, type: 'check_in', wifi: { bssid: ANCHOR_BSSID, signal: 90 }, ...validProofBody(),
    });
    // /record verified + recorded against the same tenant.
    expect(pairingSubmitProofMock.mock.calls[0][1]).toBe(DEMO_TENANT_ID);
    expect(pairingSubmitProofMock.mock.calls[0][2]).toBe('live');
    expect(createAttendanceEventMock.mock.calls[0][0]).toBe(DEMO_TENANT_ID);
    expect(createAttendanceEventMock.mock.calls[0][1]).toBe('live');
  });
});
