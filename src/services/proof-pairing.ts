/**
 * Proof-pairing service — W3, ADR-0009.
 *
 * Pure-logic functions called by `src/routes/v1/proof-pairing.ts`. The
 * service holds the cryptographer's required server-side checks
 * (ADR-0009 § "Cryptographer's required server-side checks"); the
 * route layer is a thin HTTP adapter that maps these errors onto
 * the documented status codes and copies the session_bind cookie out
 * of the request.
 *
 * Threat model coverage:
 *   - A-11 — nonce binding (`Poseidon([didHash, sessionNonce])` re-derived
 *     server-side and constant-time-compared to publicSignals[1]).
 *   - A-12 — tenant context exclusively from the auth middleware;
 *     session row keyed on (id, tenant_id, environment).
 *   - A-13 — session_bind cookie sha256-compared to the row's
 *     stored hash before any state read.
 *   - A-14 — atomic UPDATE ... WHERE state='issued' RETURNING * for
 *     race-safe single-use.
 *   - A-21 — `recordAuditEvent('pairing.claimed', ...)` is awaited
 *     on the critical path; failure to write audit returns 500.
 *   - A-25 — uniform 404 across "doesn't exist" and "exists in another
 *     tenant" to defeat enumeration.
 *   - A-26 — failure-path latency padded to >= 200 ms.
 */

import crypto from 'crypto';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { poseidon2 } from 'poseidon-lite';
import { getPool } from './db';
import { logger } from './logger';
import { recordAuditEvent } from './platform';
import { issueTokens } from './jwt';
import { config } from '../config';
import { Groth16Proof } from '../types';
import {
  ApiKeyEnvironment,
  AuthToken,
  ProofPairingSession,
  ProofPairingState,
  TenantSecurityPolicy,
} from '../types';
import { evaluateVerdict } from './play-integrity';

// ─── Tunables ──────────────────────────────────────────────────────────

const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_SESSIONS_PER_TENANT = 50;
const MAX_FAILURES_BEFORE_LOCK = 3;
const LATENCY_FLOOR_MS = 200;
const STREAM_POLL_MS = 500;
const STREAM_HEARTBEAT_MS = 15_000;
const STREAM_MAX_LIFETIME_MS = SESSION_TTL_MS + 30_000;

// ─── Error taxonomy ────────────────────────────────────────────────────

export class PairingSessionNotFound extends Error {
  readonly code = 'pairing_session_not_found';
  constructor(message = 'Session not found') { super(message); }
}

export class PairingSessionExpired extends Error {
  readonly code = 'pairing_session_expired';
  constructor(message = 'Session expired') { super(message); }
}

export class PairingSessionAlreadyBound extends Error {
  readonly code = 'pairing_session_already_bound';
  constructor(message = 'Session already bound') { super(message); }
}

export class PairingSessionLocked extends Error {
  readonly code = 'pairing_session_locked';
  constructor(message = 'Session locked after repeated failures') { super(message); }
}

export class PairingSessionBindMismatch extends Error {
  readonly code = 'pairing_session_bind_mismatch';
  constructor(message = 'Session bind cookie missing or wrong') { super(message); }
}

export class PairingNonceMismatch extends Error {
  readonly code = 'pairing_nonce_mismatch';
  constructor(message = 'Public signals nonce mismatch') { super(message); }
}

export class PairingDidUnknown extends Error {
  readonly code = 'pairing_did_unknown';
  constructor(message = 'DID does not resolve to a stored commitment') { super(message); }
}

export class PairingProofInvalid extends Error {
  readonly code = 'pairing_proof_invalid';
  constructor(message = 'Groth16 proof verification failed') { super(message); }
}

export class PairingTenantMismatch extends Error {
  readonly code = 'pairing_tenant_mismatch';
  constructor(message = 'Tenant mismatch') { super(message); }
}

export class TooManyPendingSessions extends Error {
  readonly code = 'too_many_pending_sessions';
  constructor(message = 'Too many open pairing sessions') { super(message); }
}

export class VerifierUnavailable extends Error {
  readonly code = 'verifier_unavailable';
  constructor(message = 'Verifier loopback unavailable') { super(message); }
}

export class PlayIntegrityRequired extends Error {
  readonly code = 'play_integrity_required';
  constructor(message = 'Tenant policy requires a Play Integrity verdict') { super(message); }
}

export class PlayIntegrityInsufficient extends Error {
  readonly code = 'play_integrity_insufficient';
  constructor(message = 'Presented Play Integrity verdict is weaker than the tenant policy') { super(message); }
}

// ─── Public interface shapes ───────────────────────────────────────────

export interface CreateSessionResult {
  id: string;
  nonce: string;
  sessionBindToken: string;
  expiresAt: string;
  qrPayload: string;
}

export interface SessionPublicView {
  id: string;
  state: ProofPairingState;
  expiresAt: string;
  boundAt?: string;
  userId?: string;
  did?: string;
}

/**
 * Strictly-public view returned by `GET /sessions/:id/public`. No
 * tenant context, no bind cookie, no PII — only the freshness signal
 * the Android app needs to decide whether to bother prompting the user
 * for biometric. Everything in this shape is information the phone
 * already knows from the QR payload or could re-derive locally. The
 * endpoint exists purely so the phone can short-circuit a doomed
 * ceremony when the user scans a QR after it has already expired.
 */
export interface SessionPublicMinimalView {
  id: string;
  state: ProofPairingState;
  expiresAt: string;
}

export interface SubmitResult {
  session: SessionPublicView;
  verification: { id: string };
  tokens: AuthToken;
}

export interface StreamEvent {
  event: 'session_created' | 'session_bound' | 'session_expired' | 'session_error';
  data: Record<string, unknown> | SessionPublicView;
}

export interface ClientMeta {
  appVersion?: string;
  platform?: string;
  model?: string;
  proofMs?: number;
  playIntegrityVerdict?: string;
  [key: string]: unknown;
}

// ─── Internal helpers ──────────────────────────────────────────────────

/**
 * 31-byte nonce as a BN128 field element. The 31-byte truncation
 * convention here mirrors `iot/src/crypto.ts:toFieldElement` exactly
 * so the server's Poseidon-input encoding matches the phone's. The
 * server stores the nonce as 62 hex chars; the hex string itself is
 * the 31-byte representation, no further truncation needed.
 */
function nonceHexToField(nonceHex: string): bigint {
  if (!/^[0-9a-f]{62}$/i.test(nonceHex)) {
    throw new Error('Invalid nonce hex (expected 62 chars)');
  }
  return BigInt('0x' + nonceHex);
}

/**
 * Constant-time compare two decimal-or-hex stringified bigints. We
 * normalise to a 32-byte big-endian buffer first so the byte length
 * is fixed across the comparison (a prerequisite for
 * `crypto.timingSafeEqual`).
 */
function timingSafeBigIntEqual(a: bigint, b: bigint): boolean {
  const ah = a.toString(16).padStart(64, '0');
  const bh = b.toString(16).padStart(64, '0');
  const ab = Buffer.from(ah, 'hex');
  const bb = Buffer.from(bh, 'hex');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseBigIntFromSignal(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new PairingProofInvalid('public signal is not a bigint string');
  }
  const s = String(raw).trim();
  if (s.length === 0) throw new PairingProofInvalid('public signal is empty');
  // Accept decimal (snarkjs default) and 0x-hex.
  try {
    if (s.startsWith('0x') || s.startsWith('0X')) {
      return BigInt(s);
    }
    if (/^[0-9]+$/.test(s)) return BigInt(s);
    // Fallback — let BigInt throw a useful error.
    return BigInt(s);
  } catch {
    throw new PairingProofInvalid('public signal is not a valid bigint');
  }
}

function tenantDomainFromConfig(): string {
  try {
    return new URL(config.landingBaseUrl).hostname || 'zeroauth.dev';
  } catch {
    return 'zeroauth.dev';
  }
}

function buildQrPayload(sessionId: string, nonceHex: string, tenantDomain: string): string {
  const tagInput = `${sessionId}|${nonceHex}|${tenantDomain}`;
  const integrityTag = crypto.createHash('sha256').update(tagInput).digest('hex').slice(0, 4);
  return `za:pair:1:${sessionId}:${nonceHex}:${tenantDomain}:${integrityTag}`;
}

function rowToPublicView(row: ProofPairingSession & { consumed_user_id: string | null }): SessionPublicView {
  return {
    id: row.id,
    state: row.state,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
    boundAt: row.consumed_at
      ? (row.consumed_at instanceof Date ? row.consumed_at.toISOString() : String(row.consumed_at))
      : undefined,
    userId: row.consumed_user_id ?? undefined,
  };
}

async function padToFloor(startMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  if (elapsed >= LATENCY_FLOOR_MS) return;
  await new Promise(resolve => setTimeout(resolve, LATENCY_FLOOR_MS - elapsed));
}

async function incrementFailureCount(sessionId: string, errorCode: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ failure_count: number }>(
    `UPDATE proof_pairing_sessions
       SET failure_count = failure_count + 1,
           last_error_code = $2,
           state = CASE
             WHEN failure_count + 1 >= $3 THEN 'failed'
             ELSE state
           END
     WHERE id = $1 AND state IN ('issued','failed')
     RETURNING failure_count`,
    [sessionId, errorCode, MAX_FAILURES_BEFORE_LOCK],
  );
  return result.rows[0]?.failure_count ?? 0;
}

/**
 * Read the tenant's `security_policy` JSONB. Returns an empty object
 * for tenants that haven't set one — the permissive default. Failures
 * here are routed to a permissive default + a warn log so a temporary
 * Postgres blip on this read doesn't block legitimate submits. A
 * BFSI tenant whose policy MUST be enforced shouldn't tolerate
 * permissive fallback; address that in the W4 "strict-policy-fail-closed"
 * follow-up.
 */
async function loadTenantSecurityPolicy(tenantId: string): Promise<TenantSecurityPolicy> {
  try {
    const pool = getPool();
    const result = await pool.query<{ security_policy: TenantSecurityPolicy | null }>(
      `SELECT security_policy FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const raw = result.rows[0]?.security_policy;
    return raw && typeof raw === 'object' ? raw : {};
  } catch (err) {
    logger.warn('proof-pairing: failed to load tenant security_policy, defaulting permissive', {
      tenantId,
      error: (err as Error).message,
    });
    return {};
  }
}

async function loadSessionRow(
  sessionId: string,
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<ProofPairingSession | null> {
  const pool = getPool();
  const result = await pool.query<ProofPairingSession>(
    `SELECT * FROM proof_pairing_sessions
       WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [sessionId, tenantId, environment],
  );
  return result.rows[0] ?? null;
}

interface StoredUserCommitment {
  id: string;
  did_hash: string;     // decimal-stringified bigint
  commitment: string;   // decimal-stringified bigint
}

/**
 * Look up the tenant user that owns a given DID. The schema doesn't
 * carry a `did_hash` column on `tenant_users` today — the metadata
 * blob is where we stash the Poseidon-derived didHash and commitment
 * during the (future) /v1/auth/zkp/register-on-tenant flow. Read both
 * out of metadata so the lookup is stable.
 */
async function findUserByDid(
  tenantId: string,
  environment: ApiKeyEnvironment,
  did: string,
): Promise<StoredUserCommitment | null> {
  const pool = getPool();
  // Use the (tenant, environment, metadata->>'did') key. A tenant
  // never has more than one row per DID (enforced at registration time
  // — outside this PR).
  const result = await pool.query<{ id: string; metadata: Record<string, unknown> }>(
    `SELECT id, metadata FROM tenant_users
       WHERE tenant_id = $1 AND environment = $2 AND metadata->>'did' = $3
       LIMIT 1`,
    [tenantId, environment, did],
  );
  const row = result.rows[0];
  if (!row) return null;
  const md = row.metadata ?? {};
  const didHash = typeof md.did_hash === 'string' ? md.did_hash : null;
  const commitment = typeof md.commitment === 'string' ? md.commitment : null;
  if (!didHash || !commitment) return null;
  return { id: row.id, did_hash: didHash, commitment };
}

async function verifierVerify(
  proof: Groth16Proof,
  publicSignals: string[],
  tenantId: string,
  environment: ApiKeyEnvironment,
  correlationId: string,
): Promise<boolean> {
  const verifierUrl = config.zkp.verifierUrl;
  if (!verifierUrl) {
    // No verifier loopback configured — fall back to the existing
    // off-chain verifier in src/services/zkp.ts which knows how to do
    // structural validation in tests.
    const zkp = await import('./zkp');
    return zkp.verifyProofOffChain(proof, publicSignals);
  }
  try {
    const res = await fetch(`${verifierUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof,
        publicSignals,
        tenantId,
        environment,
        circuitVersion: 'v1',
        correlationId,
      }),
      signal: AbortSignal.timeout(config.zkp.verifierTimeoutMs),
    });
    if (!res.ok) {
      logger.error('proof-pairing: verifier returned non-2xx', { status: res.status });
      throw new VerifierUnavailable(`verifier ${res.status}`);
    }
    const body = (await res.json()) as {
      verified: boolean;
      structuralFallback: boolean;
    };
    if (body.structuralFallback) {
      logger.warn('proof-pairing: verifier returned structuralFallback=true — rejecting');
      return false;
    }
    return body.verified === true;
  } catch (err) {
    if (err instanceof VerifierUnavailable) throw err;
    logger.error('proof-pairing: verifier call failed', { error: (err as Error).message });
    throw new VerifierUnavailable((err as Error).message);
  }
}

// ─── Public surface ────────────────────────────────────────────────────

export async function createSession(
  tenantId: string,
  environment: ApiKeyEnvironment,
  // Nullable so the console proxy (which authenticates via JWT, not an
  // API key) can call this directly. When null the audit row records
  // actorType='console' with no actorId; when present, actorType
  // stays 'api_key' (the production /v1 path).
  apiKeyId: string | null,
  desktopIp: string | null,
  desktopUserAgent: string | null,
): Promise<CreateSessionResult> {
  const pool = getPool();

  // Per-tenant cap on open sessions (A-20 mitigation, partial).
  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM proof_pairing_sessions
       WHERE tenant_id = $1 AND environment = $2
         AND state = 'issued' AND expires_at > NOW()`,
    [tenantId, environment],
  );
  if (parseInt(count.rows[0]?.count ?? '0', 10) >= MAX_PENDING_SESSIONS_PER_TENANT) {
    throw new TooManyPendingSessions(
      `tenant has ${MAX_PENDING_SESSIONS_PER_TENANT}+ open pairing sessions`,
    );
  }

  const id = uuidv4();
  const nonceBytes = crypto.randomBytes(31);
  const nonceHex = nonceBytes.toString('hex'); // 62 chars

  const bindBytes = crypto.randomBytes(32);
  const bindToken = bindBytes.toString('base64url');
  const bindHash = crypto.createHash('sha256').update(bindToken).digest('hex');

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO proof_pairing_sessions
      (id, tenant_id, environment, api_key_id, nonce_hex, session_bind_token_hash,
       state, desktop_ip, desktop_user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'issued', $7::inet, $8, $9)`,
    [
      id,
      tenantId,
      environment,
      apiKeyId,
      nonceHex,
      bindHash,
      desktopIp,
      desktopUserAgent ? desktopUserAgent.slice(0, 512) : null,
      expiresAt.toISOString(),
    ],
  );

  const tenantDomain = tenantDomainFromConfig();
  const qrPayload = buildQrPayload(id, nonceHex, tenantDomain);

  // Audit row — fire-and-forget per A-21 (`pairing.created` is a
  // high-volume, non-critical event). Failure to write still logs.
  void recordAuditEvent(tenantId, {
    environment,
    actorType: apiKeyId ? 'api_key' : 'console',
    actorId: apiKeyId,
    action: 'pairing.created',
    entityType: 'pairing_session',
    entityId: id,
    status: 'success',
    summary: 'Pairing session opened',
    metadata: { qrPayloadBytes: qrPayload.length },
  }).catch(err => logger.warn('proof-pairing: audit pairing.created failed', { error: (err as Error).message }));

  return {
    id,
    nonce: nonceHex,
    sessionBindToken: bindToken,
    expiresAt: expiresAt.toISOString(),
    qrPayload,
  };
}

export async function submitProof(
  sessionId: string,
  tenantId: string,
  environment: ApiKeyEnvironment,
  did: string,
  proof: Groth16Proof,
  publicSignals: string[],
  clientMeta: ClientMeta,
  presentedSessionBindToken: string | undefined,
): Promise<SubmitResult> {
  const start = Date.now();
  const correlationId = uuidv4();

  try {
    // ─── Check 2: session lookup ───────────────────────────────────
    const row = await loadSessionRow(sessionId, tenantId, environment);
    if (!row) {
      // A-25: uniform 404 across "doesn't exist" and "exists in another
      // tenant". The lookup already filters on (id, tenant_id, env),
      // so we never know whether the row exists in another tenant
      // here — but we still emit the cross-tenant audit signal
      // defensively if the bare-id row exists somewhere.
      const pool = getPool();
      const bareRow = await pool.query(
        `SELECT id FROM proof_pairing_sessions WHERE id = $1 LIMIT 1`,
        [sessionId],
      );
      if (bareRow.rows.length > 0) {
        await recordAuditEvent(tenantId, {
          environment,
          actorType: 'api_key',
          action: 'pairing.cross_tenant_blocked',
          entityType: 'pairing_session',
          entityId: sessionId,
          status: 'failure',
          summary: 'Pairing session id belongs to another tenant',
        }).catch(err => logger.warn('proof-pairing: cross-tenant audit failed', {
          error: (err as Error).message,
        }));
      }
      throw new PairingSessionNotFound();
    }

    // State machine: reject hard before any crypto work (A-20).
    if (row.state === 'consumed') {
      throw new PairingSessionAlreadyBound();
    }
    if (row.state === 'failed' || row.failure_count >= MAX_FAILURES_BEFORE_LOCK) {
      throw new PairingSessionLocked();
    }
    const expiresMs = row.expires_at instanceof Date
      ? row.expires_at.getTime()
      : new Date(row.expires_at as unknown as string).getTime();
    if (expiresMs <= Date.now()) {
      throw new PairingSessionExpired();
    }

    // ─── Check 3a: tenant Play Integrity policy (A-18) ────────────
    // Done BEFORE the bind-cookie check + verifier call so a tenant
    // gating on STRONG can shed bogus submits without paying for the
    // Groth16 verify or even the audit-log write fanout. Failure
    // increments the per-session failure_count so a flood of weak-verdict
    // submits hits the MAX_FAILURES_BEFORE_LOCK lock-out (A-20).
    const policy = await loadTenantSecurityPolicy(tenantId);
    const policyDecision = evaluateVerdict(clientMeta?.playIntegrityVerdict, policy);
    if (!policyDecision.ok) {
      await incrementFailureCount(sessionId, policyDecision.code).catch(err => {
        logger.warn('proof-pairing: failure-count increment failed on integrity reject', {
          error: (err as Error).message,
        });
      });
      // A-18: audit the rejection with the presented verdict + the
      // required rank. NO PII (no `did`); we're recording a policy
      // outcome, not the user's identity.
      await recordAuditEvent(tenantId, {
        environment,
        actorType: 'api_key',
        action: 'pairing.integrity_rejected',
        entityType: 'pairing_session',
        entityId: sessionId,
        status: 'failure',
        summary: `Play Integrity rejection: ${policyDecision.code}`,
        metadata: {
          presented_verdict: clientMeta?.playIntegrityVerdict ?? null,
          policy: {
            require_strong_integrity: policy.require_strong_integrity ?? false,
            require_device_integrity: policy.require_device_integrity ?? false,
            require_basic_integrity: policy.require_basic_integrity ?? false,
            allow_play_integrity_absent: policy.allow_play_integrity_absent ?? false,
          },
        },
      });
      if (policyDecision.code === 'play_integrity_required') {
        throw new PlayIntegrityRequired(policyDecision.message);
      }
      throw new PlayIntegrityInsufficient(policyDecision.message);
    }

    // ─── Check 3: session_bind cookie sha256 match ────────────────
    if (!presentedSessionBindToken) {
      throw new PairingSessionBindMismatch('cookie absent');
    }
    const presentedHash = crypto.createHash('sha256')
      .update(presentedSessionBindToken)
      .digest();
    const storedHash = Buffer.from(row.session_bind_token_hash, 'hex');
    if (presentedHash.length !== storedHash.length
        || !crypto.timingSafeEqual(presentedHash, storedHash)) {
      // A-13 audit signal.
      await recordAuditEvent(tenantId, {
        environment,
        actorType: 'api_key',
        action: 'pairing.session_bind_mismatch',
        entityType: 'pairing_session',
        entityId: sessionId,
        status: 'failure',
        summary: 'session_bind cookie mismatch on submit',
      }).catch(err => logger.warn('proof-pairing: bind-mismatch audit failed', {
        error: (err as Error).message,
      }));
      throw new PairingSessionBindMismatch();
    }

    // ─── Check 4: user lookup by (tenant, did) ─────────────────────
    const user = await findUserByDid(tenantId, environment, did);
    if (!user) {
      throw new PairingDidUnknown();
    }

    // ─── Check 5: publicSignals[0] === user.commitment (CT compare) ─
    if (!Array.isArray(publicSignals) || publicSignals.length !== 3) {
      throw new PairingProofInvalid('public signals shape');
    }
    const signalCommitment = parseBigIntFromSignal(publicSignals[0]);
    const storedCommitment = parseBigIntFromSignal(user.commitment);
    if (!timingSafeBigIntEqual(signalCommitment, storedCommitment)) {
      // A-25: uniform error for enumeration defence.
      throw new PairingDidUnknown('commitment mismatch');
    }

    // ─── Check 6+7: expectedDidHashSession = Poseidon2(didHash, nonce) ─
    const storedDidHash = parseBigIntFromSignal(user.did_hash);
    const nonceField = nonceHexToField(row.nonce_hex);
    const expectedDidHashSession = poseidon2([storedDidHash, nonceField]);
    const signalDidHashSession = parseBigIntFromSignal(publicSignals[1]);
    if (!timingSafeBigIntEqual(signalDidHashSession, expectedDidHashSession)) {
      // A-11 audit signal — replay/wrong-nonce.
      await recordAuditEvent(tenantId, {
        environment,
        actorType: 'api_key',
        action: 'pairing.replay_blocked',
        entityType: 'pairing_session',
        entityId: sessionId,
        status: 'failure',
        summary: 'publicSignals[1] mismatch — replay or wrong-session proof',
      }).catch(err => logger.warn('proof-pairing: replay audit failed', {
        error: (err as Error).message,
      }));
      throw new PairingNonceMismatch();
    }

    // ─── Check 8: verifier loopback ───────────────────────────────
    const verified = await verifierVerify(proof, publicSignals, tenantId, environment, correlationId);
    if (!verified) {
      throw new PairingProofInvalid();
    }

    // ─── Check 9: atomic consume ──────────────────────────────────
    const pool = getPool();
    const claim = await pool.query<ProofPairingSession>(
      `UPDATE proof_pairing_sessions
         SET state = 'consumed',
             consumed_user_id = $2,
             consumed_at = NOW()
       WHERE id = $1 AND state = 'issued'
       RETURNING *`,
      [sessionId, user.id],
    );
    if (claim.rows.length === 0) {
      // A-14: someone else won the race.
      await recordAuditEvent(tenantId, {
        environment,
        actorType: 'api_key',
        action: 'pairing.race_lost',
        entityType: 'pairing_session',
        entityId: sessionId,
        status: 'failure',
        summary: 'Lost the single-use UPDATE race',
      }).catch(() => undefined);
      throw new PairingSessionAlreadyBound();
    }
    const consumedRow = claim.rows[0];

    // Optional: hash the proof for the audit trail (never the proof itself).
    const proofHash = crypto.createHash('sha256')
      .update(JSON.stringify(proof))
      .digest('hex');
    void pool.query(
      `UPDATE proof_pairing_sessions SET proof_hash = $2 WHERE id = $1`,
      [sessionId, proofHash],
    ).catch(() => undefined);

    // ─── Check 10: mint desktop JWT + AWAIT audit ─────────────────
    const sessionUuid = uuidv4();
    const tokens = issueTokens({
      sub: user.id,
      sessionId: sessionUuid,
      provider: 'zkp',
      verified: true,
      did,
    });

    // A-21: await — failure to write audit returns 500 (better to
    // refuse the login than mint a session with no trail).
    await recordAuditEvent(tenantId, {
      environment,
      actorType: 'api_key',
      action: 'pairing.claimed',
      entityType: 'pairing_session',
      entityId: sessionId,
      status: 'success',
      summary: `Pairing session bound to user ${user.id}`,
      metadata: {
        did_sha256: crypto.createHash('sha256').update(did).digest('hex'),
        proofMs: clientMeta?.proofMs,
        platform: clientMeta?.platform,
        playIntegrityVerdict: clientMeta?.playIntegrityVerdict,
        correlationId,
      },
    });

    // A-26: pad the success latency too — the SLO is "p95 submit
    // latency >= 200 ms for both failed and successful proofs."
    await padToFloor(start);

    return {
      session: {
        ...rowToPublicView(consumedRow),
        userId: user.id,
        did,
      },
      verification: { id: sessionUuid },
      tokens,
    };
  } catch (err) {
    // Per-session failure-count increment for cryptographic checks 3-8.
    // (Note: check 2's PairingSessionNotFound has no row to increment;
    // and check 9's PairingSessionAlreadyBound is not a failure of *this*
    // submit — it's losing the race, so no counter bump either.)
    if (
      err instanceof PairingSessionBindMismatch
      || err instanceof PairingDidUnknown
      || err instanceof PairingNonceMismatch
      || err instanceof PairingProofInvalid
    ) {
      const fc = await incrementFailureCount(sessionId, err.code).catch(() => -1);
      logger.info('proof-pairing: submit failed', {
        sessionId,
        code: err.code,
        failureCount: fc,
      });
      // A-21 fire-and-forget for the high-volume failed-attempt audit.
      void recordAuditEvent(tenantId, {
        environment,
        actorType: 'api_key',
        action: 'pairing.failed',
        entityType: 'pairing_session',
        entityId: sessionId,
        status: 'failure',
        summary: `Submit failed: ${err.code}`,
        metadata: { failureCount: fc, code: err.code, correlationId },
      }).catch(() => undefined);
    }

    // A-26: pad the failure path latency to >= 200 ms.
    await padToFloor(start);
    throw err;
  }
}

/**
 * Public read for the Android app — no tenant context, no bind cookie.
 * Returns only `{ id, state, expiresAt }` so the phone can decide
 * whether the session is worth a biometric prompt. Looks up the row
 * by ID alone (no tenant filter), which is safe because:
 *
 *   - the returned shape has no tenant identifier and no PII;
 *   - session IDs are UUIDv4 (~122 bits of entropy);
 *   - the route is per-IP rate-limited at 30 req/min/IP (route layer);
 *   - latency is padded to LATENCY_FLOOR_MS to defeat A-26.
 *
 * A `PairingSessionNotFound` thrown here maps to a uniform 404 — the
 * route layer must not distinguish "session doesn't exist" from any
 * other rejection class. See A-25 in `docs/threat_model.md`.
 */
export async function getSessionPublicMinimal(
  sessionId: string,
): Promise<SessionPublicMinimalView> {
  const startMs = Date.now();
  try {
    const pool = getPool();
    const result = await pool.query<ProofPairingSession>(
      `SELECT id, state, expires_at
         FROM proof_pairing_sessions
        WHERE id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PairingSessionNotFound();
    }
    return {
      id: row.id,
      state: row.state,
      expiresAt: row.expires_at instanceof Date
        ? row.expires_at.toISOString()
        : String(row.expires_at),
    };
  } finally {
    await padToFloor(startMs);
  }
}

export async function getSession(
  sessionId: string,
  tenantId: string,
  environment: ApiKeyEnvironment,
  presentedSessionBindToken: string | undefined,
): Promise<SessionPublicView> {
  const row = await loadSessionRow(sessionId, tenantId, environment);
  if (!row) {
    // A-25 uniform 404.
    throw new PairingSessionNotFound();
  }
  if (!presentedSessionBindToken) {
    throw new PairingSessionBindMismatch('cookie absent');
  }
  const presentedHash = crypto.createHash('sha256')
    .update(presentedSessionBindToken)
    .digest();
  const storedHash = Buffer.from(row.session_bind_token_hash, 'hex');
  if (presentedHash.length !== storedHash.length
      || !crypto.timingSafeEqual(presentedHash, storedHash)) {
    throw new PairingSessionBindMismatch();
  }
  return rowToPublicView(row);
}

/**
 * SSE event source. Emits a `session_created` immediately, then polls
 * the row state every 500 ms; emits a terminal event on state change
 * and returns. The route layer is responsible for actually formatting
 * the events on the wire and for sending heartbeat comments.
 */
export async function* subscribeStream(
  sessionId: string,
  tenantId: string,
  environment: ApiKeyEnvironment,
  presentedSessionBindToken: string | undefined,
): AsyncIterableIterator<StreamEvent> {
  // Auth gate first — same checks as getSession.
  const row = await loadSessionRow(sessionId, tenantId, environment);
  if (!row) {
    throw new PairingSessionNotFound();
  }
  if (!presentedSessionBindToken) {
    throw new PairingSessionBindMismatch('cookie absent');
  }
  const presentedHash = crypto.createHash('sha256')
    .update(presentedSessionBindToken)
    .digest();
  const storedHash = Buffer.from(row.session_bind_token_hash, 'hex');
  if (presentedHash.length !== storedHash.length
      || !crypto.timingSafeEqual(presentedHash, storedHash)) {
    throw new PairingSessionBindMismatch();
  }

  // First event: the current state.
  yield {
    event: 'session_created',
    data: rowToPublicView(row),
  };

  // If the row is already terminal, exit immediately.
  if (row.state !== 'issued') {
    yield { event: row.state === 'consumed' ? 'session_bound' : 'session_expired',
            data: rowToPublicView(row) };
    return;
  }

  // Otherwise poll until terminal.
  const deadline = Date.now() + STREAM_MAX_LIFETIME_MS;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, STREAM_POLL_MS));
    const next = await loadSessionRow(sessionId, tenantId, environment).catch(() => null);
    if (!next) {
      yield { event: 'session_error', data: { id: sessionId, error: 'pairing_session_not_found' } };
      return;
    }
    if (next.state === 'consumed') {
      yield { event: 'session_bound', data: rowToPublicView(next) };
      return;
    }
    if (next.state === 'expired') {
      yield { event: 'session_expired', data: rowToPublicView(next) };
      return;
    }
    if (next.state === 'failed') {
      yield {
        event: 'session_error',
        data: { id: sessionId, error: next.last_error_code ?? 'pairing_failed' },
      };
      return;
    }
    const ts = next.expires_at instanceof Date
      ? next.expires_at.getTime()
      : new Date(next.expires_at as unknown as string).getTime();
    if (ts <= Date.now()) {
      yield { event: 'session_expired', data: rowToPublicView(next) };
      return;
    }
  }
}

/** Returns the heartbeat interval the SSE route should emit. */
export const streamHeartbeatMs = STREAM_HEARTBEAT_MS;

/**
 * Hourly cleanup sweep — called from a setInterval. Marks every
 * 'issued' row whose expires_at has passed as 'expired' and emits a
 * `pairing.expired` audit row each. Returns the affected session ids.
 */
export async function expireOverdueSessions(): Promise<string[]> {
  const pool = getPool();
  const result = await pool.query<{ id: string; tenant_id: string; environment: ApiKeyEnvironment }>(
    `UPDATE proof_pairing_sessions
        SET state = 'expired',
            last_error_code = 'pairing_session_expired'
      WHERE state = 'issued' AND expires_at < NOW()
      RETURNING id, tenant_id, environment`,
  );
  for (const row of result.rows) {
    void recordAuditEvent(row.tenant_id, {
      environment: row.environment,
      actorType: 'system',
      action: 'pairing.expired',
      entityType: 'pairing_session',
      entityId: row.id,
      status: 'failure',
      summary: 'Pairing session expired without consumption',
    }).catch(err => logger.warn('proof-pairing: expired audit failed', {
      error: (err as Error).message,
    }));
  }
  return result.rows.map(r => r.id);
}

// Touch unused-import guard — type re-export to keep callers stable.
export type { ProofPairingSession };
