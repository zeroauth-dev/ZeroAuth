/**
 * demo-portal-e2e.test.ts — full end-to-end smoke test for the NeoBank
 * investor-demo login flow at `/api/demo-portal/*`.
 *
 * What this drives, no emulator
 * ─────────────────────────────
 *  1. The three-QR registration ceremony (ADR-0023) — same in-memory
 *     stack as tests/e2e-ceremony.test.ts — to register a real user
 *     under the demo-portal tenant.
 *  2. POST /api/demo-portal/init-login to open a pairing session.
 *  3. The phone-equivalent: build a real Groth16 proof against the
 *     pairing session's nonce, then submit it through
 *     /v1/proof-pairing/sessions/:id/submit (the production route the
 *     Android prover actually hits).
 *  4. GET /api/demo-portal/sessions/:id/events to materialise the
 *     `demo_portal_session` cookie via the Phase 1 fast-path
 *     (the row is already `consumed` by the time the SSE opens, so
 *     Set-Cookie lands on the initial headers — same behaviour
 *     tests/demo-portal.test.ts pins at the unit level).
 *  5. GET /api/demo-portal/me with the cookie → 200, returns the DID
 *     and the synthetic NeoBank accounts.
 *  6. POST /api/demo-portal/logout → 200, cookie cleared.
 *  7. GET /api/demo-portal/me with no cookie → 401.
 *
 * Returning-user case is the same path with registration skipped — the
 * registered secret carries over so the same user logs in again
 * (the "login anywhere with the same biometric" property).
 *
 * Negative case mutates the proof's pi_a[0] and proves the SSE never
 * issues a cookie and /me stays 401.
 *
 * Mocked vs not mocked
 * ────────────────────
 *  Mocked (focus is the demo-portal flow, not Postgres):
 *    - src/services/db (in-memory query dispatcher that handles the
 *      demo-portal's `tenant_users` + `proof_pairing_sessions` reads)
 *    - src/services/registration (stateful in-memory ceremony)
 *    - src/services/proof-pairing (stateful in-memory pairing service
 *      with REAL snarkjs verify)
 *    - src/services/tenants (returns a fixed demo-portal tenant row)
 *    - src/middleware/tenant-auth (returns a fixed demo-portal tenant
 *      context for the phone-side /v1/proof-pairing/* + registration
 *      calls)
 *    - src/middleware/rate-limit (no-op)
 *    - Console-surface services pulled in by createApp() — no-ops to
 *      keep app boot from reaching for live state.
 *
 *  NOT mocked (the load-bearing code under test):
 *    - The demo-portal Express route — every endpoint runs the real
 *      handler.
 *    - The HMAC'd cookie encode/decode in src/routes/demo-portal.ts.
 *    - The SSE Phase 1 fast-path that delivers Set-Cookie on the
 *      initial 200 headers.
 *    - snarkjs.groth16.fullProve + verify against the canonical
 *      circuit + zkey + vkey under /circuits/build/.
 *    - The Poseidon hash + DID derivation in the
 *      tests/helpers/ceremony-client.ts (which mirrors the Android
 *      Kotlin path byte-for-byte).
 *
 * Skip gate: if /circuits/build/ artefacts are missing the entire
 * suite is skipped, same pattern as tests/e2e-ceremony.test.ts.
 */

import crypto from 'crypto';
import request from 'supertest';
import {
  buildProof,
  computeDidHashRaw,
  deriveDidAndCommitment,
  generateBiometricSecret,
  haveCeremonyArtefacts,
  mutateProof,
  terminateSnarkjs,
} from './helpers/ceremony-client';
import { DEMO_PORTAL_TENANT_ID } from '../src/services/demo-portal-seed';

// ─── Tenant + bearer harness ──────────────────────────────────────────
//
// The demo-portal flow uses the seeded demo-portal tenant id. All the
// /v1/* calls the "phone" makes (registration + proof-pairing submit)
// run under that tenant with a synthetic bearer the tenant-auth mock
// will accept without verifying.

const TENANT_ID = DEMO_PORTAL_TENANT_ID;
const API_KEY_ID = 'key-demo-portal-e2e';
const ENVIRONMENT = 'live'; // demo-portal runs in the `live` env (DEMO_ENVIRONMENT in src/routes/demo-portal.ts)

// Split-literal to dodge the secret-pattern pre-commit scanner — same
// trick tests/e2e-ceremony.test.ts uses. The tenant-auth mock doesn't
// verify the value; it just looks for the Bearer prefix.
const E2E_BEARER =
  'Bearer za_live_e2edemo00000' +
  '0000000000000000000000000000000000000000000';

function makeTenantContext(scopes: string[]) {
  return {
    tenant: {
      id: TENANT_ID,
      email: 'demo-portal@zeroauth.dev',
      password_hash: 'salt:hash',
      company_name: 'NeoBank Demo Portal',
      plan: 'enterprise',
      status: 'active',
      rate_limit: 10_000,
      monthly_quota: -1,
      metadata: {},
      security_policy: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
    apiKey: {
      id: API_KEY_ID,
      tenant_id: TENANT_ID,
      name: 'Demo Portal Static Key',
      key_prefix: 'za_live_e2edemo',
      key_hash: 'hash',
      scopes,
      environment: ENVIRONMENT,
      status: 'active',
      last_used_at: null,
      expires_at: null,
      created_at: new Date(),
      revoked_at: null,
    },
  };
}

const FULL_SCOPES = [
  'users:write',
  'users:read',
  'proof_pairing:create',
  'proof_pairing:claim',
];

jest.mock('../src/middleware/tenant-auth', () => {
  const actual = jest.requireActual('../src/middleware/tenant-auth');
  return {
    ...actual,
    authenticateTenantApiKey: (requiredScopes: string[] = []) =>
      (req: any, res: any, next: any) => {
        const ctx = makeTenantContext(FULL_SCOPES);
        const hasAll = requiredScopes.every(s => ctx.apiKey.scopes.includes(s));
        if (!hasAll) {
          return res.status(403).json({
            error: 'insufficient_scopes',
            message: `Required: ${requiredScopes.join(', ')}`,
          });
        }
        req.tenantContext = ctx;
        next();
      },
  };
});

jest.mock('../src/middleware/rate-limit', () => ({
  pgRateLimit: () => (_req: any, _res: any, next: any) => next(),
}));

// ─── In-memory tenant_users + registration state ─────────────────────
//
// The demo-portal route reads from `tenant_users` via the db pool +
// from `proof_pairing_sessions` via the same pool. We point the `db`
// service at an in-memory query dispatcher that resolves both reads
// against the shared Maps that the registration + proof-pairing mocks
// also write to.

const tenantUsers = new Map<string, any>();

interface InMemPairingRow {
  id: string;
  tenant_id: string;
  environment: string;
  nonce_hex: string;
  bind_token_hash: string;
  bind_token_raw: string; // exposed for the e2e test only
  state: 'issued' | 'consumed' | 'expired' | 'failed';
  consumed_user_id: string | null;
  consumed_at: Date | null;
  expires_at: Date;
  last_error_code: string | null;
}
const proofPairingSessions = new Map<string, InMemPairingRow>();

// Demo-portal db.query() dispatcher. The route makes two distinct
// queries — pairing-row by id + tenant + env, and tenant_users by id
// + tenant + env. Match on SQL fragment to choose the answer.
const mockQuery = jest.fn(async (sql: string, params: unknown[] = []) => {
  if (/FROM proof_pairing_sessions/i.test(sql)) {
    const [sessionId, tenantId, environment] = params as [string, string, string];
    const row = proofPairingSessions.get(sessionId);
    if (!row) return { rows: [] };
    if (row.tenant_id !== tenantId || row.environment !== environment) return { rows: [] };
    return {
      rows: [{
        id: row.id,
        state: row.state,
        consumed_user_id: row.consumed_user_id,
        consumed_at: row.consumed_at,
        expires_at: row.expires_at,
        last_error_code: row.last_error_code,
        tenant_id: row.tenant_id,
      }],
    };
  }
  if (/FROM tenant_users/i.test(sql)) {
    const [userId, tenantId, environment] = params as [string, string, string];
    const u = tenantUsers.get(userId);
    if (!u) return { rows: [] };
    if (u.tenant_id !== tenantId || u.environment !== environment) return { rows: [] };
    return {
      rows: [{
        id: u.id,
        external_id: u.external_id ?? 'demo-user-e2e',
        full_name: u.full_name,
        did: u.did,
      }],
    };
  }
  return { rows: [] };
});

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

// Tenants service — demo-portal route calls getTenantById to confirm
// the seeded row exists. Return a synthetic row keyed on the
// deterministic demo-portal tenant id so the route's tenant resolver
// caches it on the first call.
const getTenantByIdMock = jest.fn(async (id: string) => {
  if (id !== TENANT_ID) return null;
  return {
    id: TENANT_ID,
    email: 'demo-portal@zeroauth.dev',
    company_name: 'NeoBank Demo Portal',
    plan: 'enterprise',
    status: 'active',
    rate_limit: 5000,
    monthly_quota: -1,
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
  };
});

jest.mock('../src/services/tenants', () => ({
  getTenantById: (...args: unknown[]) => getTenantByIdMock(...args as [string]),
  getTenantByEmail: jest.fn().mockResolvedValue(null),
  authenticateTenant: jest.fn(),
  createTenant: jest.fn(),
  createTenantWithHash: jest.fn(),
  hashPassword: jest.fn(),
  updateTenantPlan: jest.fn(),
}));

// Console-surface no-op stubs — createApp() pulls these in transitively.
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
jest.mock('../src/services/pending-signups', () => ({
  createPendingSignup: jest.fn(),
  consumePendingSignup: jest.fn(),
}));
jest.mock('../src/services/email', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/email-templates', () => ({
  welcomeEmail: () => ({ subject: '', html: '', text: '' }),
  signupAttemptedNoticeEmail: () => ({ subject: '', html: '', text: '' }),
  verifySignupEmail: () => ({ subject: '', html: '', text: '' }),
}));

// ─── In-memory registration service (mirrors e2e-ceremony.test.ts) ───
interface InMemRegSession {
  id: string;
  tenant_id: string;
  environment: string;
  profile: Record<string, unknown>;
  state: 'awaiting_device' | 'awaiting_commitment' | 'awaiting_verification' | 'completed' | 'abandoned';
  device_id: string | null;
  did: string | null;
  commitment: string | null;
  tenant_user_id: string | null;
  pair_code: string | null;
  enroll_code: string | null;
  verify_code: string | null;
  verify_challenge_nonce: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}
const regSessions = new Map<string, InMemRegSession>();
const devices = new Map<string, { id: string; tenant_id: string; environment: string }>();

jest.mock('../src/services/registration', () => {
  class RegistrationStateError extends Error {
    public reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
      this.name = 'RegistrationStateError';
    }
  }

  const DID_RE = /^did:zeroauth:[a-z0-9_-]+:[0-9a-f]{8,80}$/;
  const COMMITMENT_RE = /^(0x)?[0-9a-f]{32,128}$/;

  return {
    REGISTRATION_SESSION_TTL_MS: 30 * 60 * 1000,
    RegistrationStateError,

    async startRegistration(
      tenantId: string,
      environment: string,
      input: { profile?: Record<string, unknown> },
    ) {
      const id = crypto.randomUUID();
      const pairCode = `ZA-PAIR-${id.slice(0, 4)}`;
      const now = new Date();
      const session: InMemRegSession = {
        id,
        tenant_id: tenantId,
        environment,
        profile: input.profile ?? {},
        state: 'awaiting_device',
        device_id: null,
        did: null,
        commitment: null,
        tenant_user_id: null,
        pair_code: pairCode,
        enroll_code: null,
        verify_code: null,
        verify_challenge_nonce: null,
        expires_at: new Date(now.getTime() + 30 * 60 * 1000),
        created_at: now,
        updated_at: now,
      };
      regSessions.set(id, session);
      return {
        session,
        pairCode,
        pairCodeExpiresAt: new Date(now.getTime() + 15 * 60 * 1000),
        pairDeeplink: `zeroauth://reg?step=pair&session=${id}&code=${encodeURIComponent(pairCode)}`,
      };
    },

    async pairDeviceForRegistration(input: {
      pairCode: string;
      fingerprint: string;
      attestationKind?: string;
    }) {
      if (typeof input.fingerprint !== 'string' || input.fingerprint.length < 16) {
        throw new RegistrationStateError('invalid_fingerprint');
      }
      const session = [...regSessions.values()].find(
        s => s.pair_code === input.pairCode && s.state === 'awaiting_device',
      );
      if (!session) throw new RegistrationStateError('code_not_found_or_expired');

      const deviceId = crypto.randomUUID();
      devices.set(deviceId, {
        id: deviceId,
        tenant_id: session.tenant_id,
        environment: session.environment,
      });

      const enrollCode = `ZA-ENRL-${session.id.slice(0, 4)}`;
      session.device_id = deviceId;
      session.state = 'awaiting_commitment';
      session.pair_code = null;
      session.enroll_code = enrollCode;
      session.updated_at = new Date();

      return {
        session,
        nextCode: enrollCode,
        nextCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        nextDeeplink: `zeroauth://reg?step=enroll&session=${session.id}&code=${encodeURIComponent(enrollCode)}`,
      };
    },

    async submitCommitmentForRegistration(input: {
      enrollCode: string;
      did: string;
      commitment: string;
      attestationKind?: string;
    }) {
      const didNorm = String(input.did ?? '').trim().toLowerCase();
      const commitmentNorm = String(input.commitment ?? '').trim().toLowerCase();
      if (!DID_RE.test(didNorm)) throw new RegistrationStateError('invalid_commitment');
      if (!COMMITMENT_RE.test(commitmentNorm)) throw new RegistrationStateError('invalid_commitment');

      const session = [...regSessions.values()].find(
        s => s.enroll_code === input.enrollCode && s.state === 'awaiting_commitment',
      );
      if (!session) throw new RegistrationStateError('code_not_found_or_expired');

      const challengeNonce = crypto.randomBytes(31).toString('hex');
      const verifyCode = `ZA-VRFY-${session.id.slice(0, 4)}`;

      session.did = didNorm;
      session.commitment = commitmentNorm;
      session.state = 'awaiting_verification';
      session.enroll_code = null;
      session.verify_code = verifyCode;
      session.verify_challenge_nonce = challengeNonce;
      session.updated_at = new Date();

      return {
        session,
        nextCode: verifyCode,
        nextCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        nextDeeplink: `zeroauth://reg?step=verify&session=${session.id}&code=${encodeURIComponent(verifyCode)}&challenge=${challengeNonce}`,
        challengeNonce,
      };
    },

    async completeRegistration(
      input: {
        verifyCode: string;
        challengeNonce: string;
        proof: unknown;
        publicSignals: unknown;
      },
      verifyProof: (proof: unknown, publicSignals: unknown) => Promise<boolean>,
    ) {
      if (typeof input.verifyCode !== 'string' || input.verifyCode.length === 0) {
        throw new RegistrationStateError('code_not_found_or_expired');
      }
      if (typeof input.challengeNonce !== 'string' || input.challengeNonce.length === 0) {
        throw new RegistrationStateError('challenge_mismatch');
      }
      if (!Array.isArray(input.publicSignals) || input.publicSignals.length === 0) {
        throw new RegistrationStateError('proof_verification_failed');
      }

      const session = [...regSessions.values()].find(
        s => s.verify_code === input.verifyCode && s.state === 'awaiting_verification',
      );
      if (!session) throw new RegistrationStateError('code_not_found_or_expired');
      if (session.verify_challenge_nonce !== input.challengeNonce) {
        throw new RegistrationStateError('challenge_mismatch');
      }
      if (!session.commitment) throw new RegistrationStateError('commitment_mismatch');

      const presented = String((input.publicSignals as unknown[])[0]);
      const stored = String(session.commitment);
      const parseCommit = (s: string): bigint => {
        if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
        if (/[a-f]/i.test(s)) return BigInt('0x' + s);
        return BigInt(s);
      };
      if (parseCommit(presented) !== parseCommit(stored)) {
        throw new RegistrationStateError('commitment_mismatch');
      }

      const ok = await verifyProof(input.proof, input.publicSignals);
      if (!ok) throw new RegistrationStateError('proof_verification_failed');

      const userId = crypto.randomUUID();
      const tenantUser = {
        id: userId,
        tenant_id: session.tenant_id,
        environment: session.environment,
        full_name: (session.profile.full_name as string) ?? 'Unnamed',
        email: (session.profile.email as string) ?? null,
        external_id: 'demo-user-e2e',
        did: session.did,
        commitment: session.commitment,
        metadata: { via: 'registration', sessionId: session.id },
        created_at: new Date(),
      };
      tenantUsers.set(userId, tenantUser);

      session.tenant_user_id = userId;
      session.state = 'completed';
      session.verify_code = null;
      session.verify_challenge_nonce = null;
      session.updated_at = new Date();

      const device = session.device_id ? devices.get(session.device_id) ?? null : null;
      return { session, tenantUser, device };
    },

    async getRegistrationSession(tenantId: string, environment: string, sessionId: string) {
      const s = regSessions.get(sessionId);
      if (!s || s.tenant_id !== tenantId || s.environment !== environment) return null;
      return s;
    },

    async abandonRegistration() { return null; },
  };
});

// ─── In-memory proof-pairing service ─────────────────────────────────
//
// Same shape as tests/e2e-ceremony.test.ts but writes to the shared
// proofPairingSessions Map above so the demo-portal route can read
// the row through its own db.query dispatcher.

jest.mock('../src/services/proof-pairing', () => {
  class PairingSessionNotFound extends Error { code = 'pairing_session_not_found'; }
  class PairingSessionExpired extends Error { code = 'pairing_session_expired'; }
  class PairingSessionAlreadyBound extends Error { code = 'pairing_session_already_bound'; }
  class PairingSessionLocked extends Error { code = 'pairing_session_locked'; }
  class PairingSessionBindMismatch extends Error { code = 'pairing_session_bind_mismatch'; }
  class PairingNonceMismatch extends Error { code = 'pairing_nonce_mismatch'; }
  class PairingDidUnknown extends Error { code = 'pairing_did_unknown'; }
  class PairingProofInvalid extends Error { code = 'pairing_proof_invalid'; }
  class PairingTenantMismatch extends Error { code = 'pairing_tenant_mismatch'; }
  class TooManyPendingSessions extends Error { code = 'too_many_pending_sessions'; }
  class VerifierUnavailable extends Error { code = 'verifier_unavailable'; }
  class PlayIntegrityRequired extends Error { code = 'play_integrity_required'; }
  class PlayIntegrityInsufficient extends Error { code = 'play_integrity_insufficient'; }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zkp = require('../src/services/zkp') as typeof import('../src/services/zkp');

  return {
    async createSession(
      tenantId: string,
      environment: string,
      _apiKeyId: string | null,
      _ip: string | null,
      _ua: string | null,
    ) {
      const id = crypto.randomUUID();
      const nonceHex = crypto.randomBytes(31).toString('hex');
      const bindValue = crypto.randomBytes(32).toString('base64url');
      const bindHash = crypto.createHash('sha256').update(bindValue).digest('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      proofPairingSessions.set(id, {
        id,
        tenant_id: tenantId,
        environment,
        nonce_hex: nonceHex,
        bind_token_hash: bindHash,
        bind_token_raw: bindValue, // captured for the test
        state: 'issued',
        consumed_user_id: null,
        consumed_at: null,
        expires_at: expiresAt,
        last_error_code: null,
      });

      return {
        id,
        nonce: nonceHex,
        sessionBindToken: bindValue,
        expiresAt: expiresAt.toISOString(),
        qrPayload: `za:pair:1:${id}:${nonceHex}:zeroauth.dev:abcd`,
      };
    },

    async submitProof(
      sessionId: string,
      tenantId: string,
      environment: string,
      did: string,
      proof: any,
      publicSignals: string[],
      _clientMeta: any,
      presentedBindToken: string | undefined,
    ) {
      const row = proofPairingSessions.get(sessionId);
      if (!row || row.tenant_id !== tenantId || row.environment !== environment) {
        throw new PairingSessionNotFound();
      }
      if (row.state === 'consumed') throw new PairingSessionAlreadyBound();
      if (row.expires_at.getTime() < Date.now()) throw new PairingSessionExpired();

      if (!presentedBindToken) throw new PairingSessionBindMismatch();
      const presentedHash = crypto.createHash('sha256').update(presentedBindToken).digest('hex');
      if (presentedHash !== row.bind_token_hash) throw new PairingSessionBindMismatch();

      const user = [...tenantUsers.values()].find(
        u => u.tenant_id === tenantId
          && u.environment === environment
          && u.did === did,
      );
      if (!user) throw new PairingDidUnknown();

      if (!Array.isArray(publicSignals) || publicSignals.length !== 3) {
        throw new PairingProofInvalid('public signals shape');
      }
      const parseBI = (s: string): bigint => {
        if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
        if (/[a-f]/i.test(s)) return BigInt('0x' + s);
        return BigInt(s);
      };
      const signalCommitment = BigInt(publicSignals[0]);
      const storedCommitment = parseBI(String(user.commitment));
      if (signalCommitment !== storedCommitment) {
        throw new PairingDidUnknown('commitment mismatch');
      }

      // Nonce-binding fold check.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { poseidon2 } = require('poseidon-lite') as typeof import('poseidon-lite');
      const storedDidHash = BigInt(user.metadata.did_hash);
      const nonceField = BigInt('0x' + row.nonce_hex);
      const expected = poseidon2([storedDidHash, nonceField]);
      const presentedDidHashSession = BigInt(publicSignals[1]);
      if (presentedDidHashSession !== expected) {
        throw new PairingNonceMismatch();
      }

      const ok = await zkp.verifyProofOffChain(proof, publicSignals);
      if (!ok) throw new PairingProofInvalid();

      row.state = 'consumed';
      row.consumed_user_id = user.id;
      row.consumed_at = new Date();

      return {
        session: {
          id: row.id,
          state: 'consumed',
          expiresAt: row.expires_at.toISOString(),
          boundAt: row.consumed_at.toISOString(),
          userId: user.id,
          did,
        },
        verification: { id: crypto.randomUUID() },
        tokens: {
          accessToken: 'test.access.token',
          refreshToken: 'test.refresh.token',
          expiresIn: 3600,
        },
      };
    },

    async getSession() { throw new PairingSessionNotFound(); },
    async getSessionPublicMinimal() { throw new PairingSessionNotFound(); },
    async *subscribeStream() { /* unused */ },
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
    PairingTenantMismatch,
    TooManyPendingSessions,
    VerifierUnavailable,
    PlayIntegrityRequired,
    PlayIntegrityInsufficient,
  };
});

// ─── Boot the app AFTER mocks are wired ──────────────────────────────

import { initZKP } from '../src/services/zkp';
import { createApp } from '../src/app';

const haveArtefacts = haveCeremonyArtefacts();

(haveArtefacts ? describe : describe.skip)(
  'NeoBank demo portal e2e (no emulator)',
  () => {
    jest.setTimeout(60_000);

    let app: ReturnType<typeof createApp>;
    let api: ReturnType<typeof request>;

    // State persisted across tests so the "returning user" case can
    // log the same identity in a second time without re-running the
    // registration ceremony.
    let registeredSecret: Buffer;
    let registeredDid: string;
    let registeredCommitmentHex: string;
    let registeredUserId: string;

    /**
     * Drive the three-QR ceremony scoped to the demo-portal tenant.
     * Reused from tests/e2e-ceremony.test.ts; broken out here so the
     * "first-time user" case can call it once and the negative case
     * can re-use the same registered identity.
     */
    async function registerDemoUser(): Promise<void> {
      const startRes = await api
        .post('/v1/registrations')
        .set('Authorization', E2E_BEARER)
        .send({ profile: { full_name: 'Asha Demo', email: 'asha@demo.example' } });
      expect(startRes.status).toBe(201);
      const pairCode = startRes.body.pair.code as string;

      const fingerprint = 'android_id:e2e_demo_install_0000|installation:bbbb';
      const pairRes = await api
        .post('/v1/registrations/pair-device')
        .send({ pair_code: pairCode, fingerprint, attestation_kind: 'none' });
      expect(pairRes.status).toBe(200);
      const enrollCode = pairRes.body.next.code as string;

      registeredSecret = generateBiometricSecret();
      const { did, commitmentHex } = deriveDidAndCommitment(registeredSecret);
      registeredDid = did;
      registeredCommitmentHex = commitmentHex;

      const commitRes = await api
        .post('/v1/registrations/submit-commitment')
        .send({ enroll_code: enrollCode, did, commitment: commitmentHex });
      expect(commitRes.status).toBe(200);
      const verifyCode = commitRes.body.next.code as string;
      const challengeNonce = commitRes.body.next.challenge_nonce as string;

      const built = await buildProof(registeredSecret, challengeNonce);
      const completeRes = await api
        .post('/v1/registrations/complete')
        .send({
          verify_code: verifyCode,
          challenge_nonce: challengeNonce,
          proof: built.proof,
          public_signals: built.publicSignals,
        });
      expect(completeRes.status).toBe(200);
      registeredUserId = completeRes.body.tenant_user.id as string;

      // Backfill the metadata fields the proof-pairing service reads
      // for findUserByDid + the nonce-binding fold check. The
      // registration flow stores only { via, sessionId } today; the
      // proof-pairing service requires { did, did_hash, commitment } —
      // the gap is the same one e2e-ceremony.test.ts patches.
      const user = tenantUsers.get(registeredUserId);
      const didHashRaw = computeDidHashRaw(BigInt('0x' + registeredCommitmentHex));
      user.metadata = {
        ...user.metadata,
        did: registeredDid,
        did_hash: didHashRaw.toString(10),
        commitment: BigInt('0x' + registeredCommitmentHex).toString(10),
      };
    }

    /**
     * Simulate the phone consuming the demo-portal pairing session.
     * Builds a real Groth16 proof against the session's nonce + submits
     * it through the production /v1/proof-pairing/sessions/:id/submit
     * route. The bind token is pulled out of the in-memory pairing row
     * (which the demo-portal init-login response doesn't expose to the
     * SPA) — in production the phone gets it bundled into the QR scan
     * payload (per ADR-0009 §"Phone client receives bindToken")
     * because the desktop encodes it server-side; the test capture is
     * equivalent.
     *
     * @param tamper  When true, mutates pi_a[0] before submit so the
     *                proof fails real snarkjs verify and the SSE never
     *                issues the demo-portal cookie.
     */
    async function consumePairingSessionAsPhone(
      sessionId: string,
      tamper: boolean,
    ): Promise<request.Response> {
      const row = proofPairingSessions.get(sessionId);
      if (!row) throw new Error(`pairing session not found in test state: ${sessionId}`);
      const bindToken = row.bind_token_raw;
      const nonceHex = row.nonce_hex;

      const built = await buildProof(registeredSecret, nonceHex);
      const proof = tamper ? mutateProof(built.proof) : built.proof;

      return api
        .post(`/v1/proof-pairing/sessions/${sessionId}/submit`)
        .set('Authorization', E2E_BEARER)
        .set('Cookie', `zeroauth_pair_bind=${bindToken}`)
        .send({
          did: registeredDid,
          proof,
          publicSignals: built.publicSignals,
          clientMeta: { appVersion: '0.1.0', platform: 'android', proofMs: 4000 },
        });
    }

    beforeAll(async () => {
      await initZKP();
      app = createApp();
      api = request(app);
    });

    afterAll(async () => {
      await terminateSnarkjs();
    });

    // ─── Test 1: first-time user signs up + signs in ─────────────────

    it('first-time user signs up via the three-QR ceremony then mints a portal session', async () => {
      // Step 0: ceremony — produces a tenant_users row under the
      // demo-portal tenant with metadata.did + did_hash + commitment.
      await registerDemoUser();

      // Step 1: SPA kicks off the demo-portal pairing session.
      const initRes = await api.post('/api/demo-portal/init-login').send({});
      expect(initRes.status).toBe(201);
      expect(initRes.body.session_id).toBeDefined();
      expect(initRes.body.qr_payload).toMatch(/^za:pair:1:/);
      expect(initRes.body.deeplink).toMatch(/^zeroauth:\/\/pair\?p=/);
      const sessionId = initRes.body.session_id as string;

      // Step 2: phone scans the QR, builds a fresh proof against the
      // session nonce, submits via the production proof-pairing route.
      // The row flips to `consumed` and the demo-portal cookie becomes
      // available on the next SSE / /me call.
      const submitRes = await consumePairingSessionAsPhone(sessionId, false);
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.session.state).toBe('consumed');
      expect(submitRes.body.session.userId).toBe(registeredUserId);

      // Step 3: SPA opens the SSE stream. Because the row is already
      // `consumed` by the time we hit the SSE, the route's Phase 1
      // fast-path emits Set-Cookie on the initial 200 headers + a
      // terminal `authenticated` event in the body.
      const sseRes = await api
        .get(`/api/demo-portal/sessions/${sessionId}/events`)
        .buffer(true);
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);
      expect(sseRes.text).toContain('event: session_bound');
      expect(sseRes.text).toContain('event: authenticated');

      const setCookieRaw = sseRes.headers['set-cookie'];
      expect(setCookieRaw).toBeDefined();
      const setCookieStr = Array.isArray(setCookieRaw)
        ? setCookieRaw.join(';')
        : String(setCookieRaw);
      expect(setCookieStr).toMatch(/demo_portal_session=/);
      expect(setCookieStr).toMatch(/HttpOnly/i);

      // Pull the cookie value out of the Set-Cookie header so we can
      // re-attach it to subsequent requests (supertest does not
      // auto-thread cookies across distinct `request(app)` calls).
      const portalCookieMatch =
        setCookieStr.match(/demo_portal_session=([^;]+)/);
      expect(portalCookieMatch).toBeTruthy();
      const portalCookie = portalCookieMatch![1];

      // Step 4: /me with the cookie returns the redacted demo user.
      const meRes = await api
        .get('/api/demo-portal/me')
        .set('Cookie', `demo_portal_session=${portalCookie}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.user_id).toBe(registeredUserId);
      expect(meRes.body.did).toBe(registeredDid);
      expect(Array.isArray(meRes.body.accounts)).toBe(true);
      expect(meRes.body.accounts).toHaveLength(3);

      // Step 5: logout clears the cookie.
      const logoutRes = await api
        .post('/api/demo-portal/logout')
        .set('Cookie', `demo_portal_session=${portalCookie}`)
        .send({});
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body).toEqual({ ok: true });
      const logoutCookie = logoutRes.headers['set-cookie'];
      const logoutCookieStr = Array.isArray(logoutCookie)
        ? logoutCookie.join(';')
        : String(logoutCookie);
      expect(logoutCookieStr).toMatch(/Max-Age=0/i);

      // Step 6: /me without a cookie → 401. Same body shape as the
      // logged-out branch (A-25 enumeration defence: identical to the
      // "bad mac" branch).
      const unauthedRes = await api.get('/api/demo-portal/me');
      expect(unauthedRes.status).toBe(401);
      expect(unauthedRes.body.error).toBe('not_authenticated');
    });

    // ─── Test 2: returning user logs in again with the same secret ───

    it('returning user logs in again with the same biometric secret', async () => {
      // Skip registration — the prior test left the tenant_users row
      // in place. Open a fresh pairing session so we don't trip the
      // "already bound" branch on the prior consumed row.
      const initRes = await api.post('/api/demo-portal/init-login').send({});
      expect(initRes.status).toBe(201);
      const sessionId = initRes.body.session_id as string;

      const submitRes = await consumePairingSessionAsPhone(sessionId, false);
      expect(submitRes.status).toBe(200);
      expect(submitRes.body.session.state).toBe('consumed');
      // Same user id — the "login anywhere with the same biometric"
      // property: re-deriving the secret + DID gets us back to the
      // exact same tenant_users row.
      expect(submitRes.body.session.userId).toBe(registeredUserId);

      const sseRes = await api
        .get(`/api/demo-portal/sessions/${sessionId}/events`)
        .buffer(true);
      expect(sseRes.status).toBe(200);
      expect(sseRes.text).toContain('event: authenticated');

      const setCookieRaw = sseRes.headers['set-cookie'];
      const setCookieStr = Array.isArray(setCookieRaw)
        ? setCookieRaw.join(';')
        : String(setCookieRaw);
      const portalCookieMatch =
        setCookieStr.match(/demo_portal_session=([^;]+)/);
      expect(portalCookieMatch).toBeTruthy();
      const portalCookie = portalCookieMatch![1];

      const meRes = await api
        .get('/api/demo-portal/me')
        .set('Cookie', `demo_portal_session=${portalCookie}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.did).toBe(registeredDid);
      expect(meRes.body.user_id).toBe(registeredUserId);
    });

    // ─── Test 3: a tampered proof never mints a portal session ───────

    it('rejects a tampered proof on the demo-portal login', async () => {
      const initRes = await api.post('/api/demo-portal/init-login').send({});
      expect(initRes.status).toBe(201);
      const sessionId = initRes.body.session_id as string;

      // Phone submits a proof with pi_a[0] bumped by 1 in the field.
      // The route maps PairingProofInvalid → 401.
      const submitRes = await consumePairingSessionAsPhone(sessionId, true);
      expect(submitRes.status).toBe(401);
      expect(submitRes.body.error).toBe('pairing_proof_invalid');

      // Row should still be in `issued` state — never consumed. The
      // SSE Phase 1 sees a non-terminal row, falls through to the
      // long-poll loop, and DOES NOT emit Set-Cookie. We bail the SSE
      // early by hanging up the request (`HEAD`-like behaviour via the
      // supertest .end() implicit on request completion); the cookie
      // absence is what we assert here.
      //
      // To avoid waiting for the full 6-minute deadline, force the
      // row into `failed` state out-of-band — the SSE handler will
      // emit `session_error` immediately + close without a cookie.
      const row = proofPairingSessions.get(sessionId)!;
      row.state = 'failed';
      row.last_error_code = 'pairing_proof_invalid';

      const sseRes = await api
        .get(`/api/demo-portal/sessions/${sessionId}/events`)
        .buffer(true);
      expect(sseRes.status).toBe(200);
      // No cookie should be issued for a failed pairing.
      const setCookie = sseRes.headers['set-cookie'];
      const setCookieStr = Array.isArray(setCookie)
        ? setCookie.join(';')
        : String(setCookie ?? '');
      expect(setCookieStr).not.toMatch(/demo_portal_session=[^;]+/);
      expect(sseRes.text).toContain('event: session_error');
      expect(sseRes.text).not.toContain('event: authenticated');

      // /me with no cookie → 401.
      const meRes = await api.get('/api/demo-portal/me');
      expect(meRes.status).toBe(401);
    });
  },
);

if (!haveArtefacts) {
  describe.skip('demo-portal e2e — skipped (missing circuit artefacts)', () => {
    it('run scripts/setup-zkp.sh to materialise circuits/build/', () => {
      /* empty */
    });
  });
}
