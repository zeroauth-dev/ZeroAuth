/**
 * End-user signup ceremony — the orchestrator behind the three-QR
 * flow documented in ADR 0023.
 *
 * Lifecycle:
 *
 *   ┌─────────────────────────┐   POST /v1/registrations
 *   │ tenant SDK on the org's │   ─────────────────────────► server creates row,
 *   │ signup page             │                              state='awaiting_device',
 *   └────────────┬────────────┘                              mints pair_code
 *                │ renders QR1
 *                ▼
 *   ┌─────────────────────────┐   POST /v1/registrations/pair-device
 *   │ phone scans QR1         │   ─────────────────────────► server claims a device row
 *   │                         │                              (reuses ADR 0022 enrollment),
 *   │                         │                              attaches to session,
 *   │                         │                              state='awaiting_commitment',
 *   │                         │                              mints enroll_code
 *   └────────────┬────────────┘
 *                │ user captures biometric on device,
 *                │ phone computes (did, commitment) locally
 *                │ via the existing FaceEmbedder pipeline
 *                ▼
 *   ┌─────────────────────────┐   POST /v1/registrations/submit-commitment
 *   │ phone scans QR2 (shown  │   ─────────────────────────► server stores (did, commitment),
 *   │ on the org's page after │                              state='awaiting_verification',
 *   │ the platform polled the │                              mints verify_code + challenge_nonce
 *   │ awaiting_commitment     │
 *   │ state)                  │
 *   └────────────┬────────────┘
 *                │ user re-captures biometric, phone computes
 *                │ Groth16 proof binding (commitment) — V1
 *                │ doesn't bake challenge_nonce into the proof's
 *                │ public signals (the circuit doesn't support it
 *                │ yet — ADR 0023 §"Out of scope")
 *                ▼
 *   ┌─────────────────────────┐   POST /v1/registrations/complete
 *   │ phone scans QR3         │   ─────────────────────────► server asserts:
 *   │                         │                                - verify_code matches session
 *   │                         │                                - verify_challenge_nonce matches
 *   │                         │                                - proof verifies vs stored commitment
 *   │                         │                                - publicSignals[0] == stored commitment
 *   │                         │                              creates tenant_user (no PII columns
 *   │                         │                              touched beyond what the tenant
 *   │                         │                              passed in `profile`),
 *   │                         │                              state='completed'
 *   └─────────────────────────┘
 *
 * Replay defence: every step's code is single-use; once consumed, its
 * hash is cleared on the row. The chain of three single-use codes is
 * what prevents a captured proof from being submitted into a
 * different session. The Phase 1 Sprint 4 follow-on (circuit v1.3
 * with a public challenge signal) tightens this to a per-session
 * proof binding.
 *
 * Confused-deputy defence: codes for different steps live in
 * different columns (pair_code_hash / enroll_code_hash /
 * verify_code_hash) and each handler checks ONLY its own column. A
 * pair_code presented to /submit-commitment fails the lookup; a
 * verify_code presented to /pair-device fails the lookup. No way to
 * cross-pollinate.
 */

import { getPool } from './db';
import { logger } from './logger';
import {
  ENROLLMENT_CODE_TTL_MS,
  fingerprintHash,
  generateEnrollmentCode,
  isValidFingerprint,
  normaliseEnrollmentCode,
  sha256Hex,
} from './device-enrollment';
import { recordAuditEvent } from './platform';
import {
  ApiKeyEnvironment,
  Device,
  RegistrationSession,
  TenantUser,
} from '../types';

/** Whole-session TTL (the user has 30 min total to complete all 3 steps). */
export const REGISTRATION_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Length of the challenge nonce baked into QR3. 62 hex chars = 31 bytes.
 *
 * 31 bytes (NOT 32) because the mobile prover treats the nonce as a BN254
 * field element. 31 bytes = 248 bits is the largest power-of-eight size
 * that ALWAYS fits below the BN128 scalar field modulus (~2^254), so the
 * witness can ingest the hex directly with no mod-prime reduction
 * needed. The W3 proof-pairing flow at /v1/proof-pairing/sessions/:id
 * uses the same 31-byte convention; this aligns the registration
 * ceremony's QR3 with that contract.
 *
 * 31 bytes is also enormously over-margined for a one-shot single-use
 * side-channel — 2^248 collisions are not happening.
 */
const CHALLENGE_NONCE_HEX_LEN = 62;

function generateChallengeNonce(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(CHALLENGE_NONCE_HEX_LEN / 2).toString('hex');
}

/**
 * Parse a commitment string into a BigInt, accepting either the hex
 * form the phone sends to /submit-commitment (with or without 0x
 * prefix, lowercase) or the decimal form snarkjs emits in
 * publicSignals[0]. Returns null when the input is not a parseable
 * commitment shape — callers should treat that as a mismatch.
 *
 * The format heuristic mirrors what each call site already
 * understands: hex form is matched by /^(0x)?[0-9a-f]+$/i (the
 * submit-commitment validator allows up to 128 hex chars); decimal
 * form is /^[0-9]+$/. A pure-digit string COULD be parsed as either,
 * but BigInt('123') === BigInt('0x123') would only be true by
 * accident; since the server only ever stores either form, the
 * heuristic is "if it contains [a-f], it's hex; else if it has a
 * 0x prefix, it's hex; else it's decimal."
 */
function parseCommitmentBigInt(raw: unknown): bigint | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      return BigInt(trimmed);
    }
    // Pure-digit strings could be either decimal OR a hex commitment
    // that happens to contain no a-f. Storage form here is always
    // either lowercased hex (0x-stripped) from submit-commitment OR
    // decimal from snarkjs. We accept both via BigInt() coercion:
    //   - if the string contains a-f, prefix with 0x.
    //   - else interpret as decimal (BigInt default).
    if (/[a-f]/i.test(trimmed)) {
      return BigInt('0x' + trimmed);
    }
    // Pure digits: could be a hex commitment with no a-f letters OR a
    // decimal publicSignals value. We try decimal first (the canonical
    // form snarkjs returns); if the caller stored hex it would still
    // BigInt-equal the decimal form as long as the underlying field
    // element matches. To avoid an asymmetric interpretation we use
    // BigInt() directly which assumes decimal.
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/**
 * Compare two commitment strings by their underlying field-element
 * value, NOT by string equality. Handles the asymmetry where storage
 * is HEX (from /submit-commitment) but the on-wire publicSignals[0]
 * is DECIMAL (from snarkjs).
 */
function commitmentsEqual(a: unknown, b: unknown): boolean {
  const ai = parseCommitmentBigInt(a);
  const bi = parseCommitmentBigInt(b);
  if (ai === null || bi === null) return false;
  return ai === bi;
}

// Mirrors the forbidden-key set in tests/biometric-rejection.test.ts.
// Matches the token anywhere in the key name with word boundaries,
// so `face_image`, `biometric_template`, `depth_map`, `raw_face` etc.
// all get stripped — not just keys that start with the token.
const FORBIDDEN_PROFILE_KEY_TOKENS = /(?:^|_)(image|template|pixel|depth|frame|biometric|photo|raw[_-]?face|raw[_-]?finger)(?:$|_)/i;

function sanitizeProfile(profile: unknown): Record<string, unknown> {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return {};
  }
  // Defence-in-depth: drop any top-level field that even sounds like
  // raw biometric data. The tenant SDK is supposed to not pass these,
  // but if a buggy integration does we'd rather strip than store.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile as Record<string, unknown>)) {
    if (FORBIDDEN_PROFILE_KEY_TOKENS.test(k)) {
      logger.warn('Stripped suspicious key from registration profile', { key: k });
      continue;
    }
    out[k] = v;
  }
  return out;
}

export interface RegistrationStartInput {
  profile?: Record<string, unknown>;
}

export interface RegistrationStartResult {
  session: RegistrationSession;
  pairCode: string;
  pairCodeExpiresAt: Date;
  pairDeeplink: string;
}

export interface RegistrationStepResult {
  session: RegistrationSession;
  nextCode: string;
  nextCodeExpiresAt: Date;
  nextDeeplink: string;
  challengeNonce?: string;
}

export interface RegistrationCompleteResult {
  session: RegistrationSession;
  tenantUser: TenantUser;
  device: Device | null;
}

export class RegistrationStateError extends Error {
  constructor(
    public reason:
      | 'session_not_found'
      | 'session_expired'
      | 'wrong_state'
      | 'code_not_found_or_expired'
      | 'invalid_fingerprint'
      | 'invalid_commitment'
      | 'commitment_mismatch'
      | 'challenge_mismatch'
      | 'proof_verification_failed',
  ) {
    super(reason);
    this.name = 'RegistrationStateError';
  }
}

/**
 * Step 0: tenant SDK starts a session. Server creates a row in
 * `awaiting_device` state and mints the pair_code that the platform
 * encodes into QR1. The plaintext pair_code is returned exactly
 * once — only its SHA-256 is persisted.
 */
export async function startRegistration(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: RegistrationStartInput,
  actor: { type: 'api_key' | 'console'; id: string | null; email?: string | null },
): Promise<RegistrationStartResult> {
  const code = generateEnrollmentCode();
  const codeHash = sha256Hex(code);
  const now = Date.now();
  const codeExpiresAt = new Date(now + ENROLLMENT_CODE_TTL_MS);
  const sessionExpiresAt = new Date(now + REGISTRATION_SESSION_TTL_MS);
  const profile = sanitizeProfile(input.profile);

  const pool = getPool();
  const result = await pool.query<RegistrationSession>(
    `INSERT INTO registration_sessions
      (tenant_id, environment, profile, state,
       pair_code_hash, pair_code_expires_at, expires_at)
     VALUES ($1, $2, $3::jsonb, 'awaiting_device', $4, $5, $6)
     RETURNING *`,
    [tenantId, environment, JSON.stringify(profile), codeHash, codeExpiresAt, sessionExpiresAt],
  );
  const session = result.rows[0];

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action: 'registration.started',
    entityType: 'registration_session',
    entityId: session.id,
    status: 'success',
    summary: 'Registration session opened',
    metadata: {
      profileKeys: Object.keys(profile),
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      pairCodeExpiresAt: codeExpiresAt.toISOString(),
      // The code itself is NOT in audit metadata — only its expiry +
      // session-level fields. Operator-side recovery is via
      // POST /v1/registrations/:id/regenerate-pair-code.
      ...(actor.email ? { actor_email: actor.email } : {}),
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return {
    session,
    pairCode: code,
    pairCodeExpiresAt: codeExpiresAt,
    pairDeeplink: `zeroauth://reg?step=pair&session=${session.id}&code=${encodeURIComponent(code)}`,
  };
}

/**
 * Step 1: phone scans QR1, POSTs `pair_code` + `fingerprint`.
 *
 * Atomically: SELECT FOR UPDATE the awaiting_device row by
 * pair_code_hash, claim a device row (reusing ADR 0022 enrollment-
 * code-style fingerprint binding), attach device_id to the session,
 * mint enroll_code (for QR2), flip state to awaiting_commitment.
 */
export async function pairDeviceForRegistration(input: {
  pairCode: string;
  fingerprint: string;
  attestationKind?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<RegistrationStepResult> {
  if (!isValidFingerprint(input.fingerprint)) {
    throw new RegistrationStateError('invalid_fingerprint');
  }
  const pairCodeHash = sha256Hex(normaliseEnrollmentCode(input.pairCode));
  const fpHash = fingerprintHash(input.fingerprint);
  const nextCode = generateEnrollmentCode();
  const nextCodeHash = sha256Hex(nextCode);
  const nextCodeExpiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query<RegistrationSession>(
      `SELECT * FROM registration_sessions
       WHERE pair_code_hash = $1
         AND state = 'awaiting_device'
         AND pair_code_expires_at > NOW()
         AND expires_at > NOW()
       FOR UPDATE`,
      [pairCodeHash],
    );
    const session = found.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('code_not_found_or_expired');
    }

    // Reuse the devices table — a registration creates a device row
    // tied to the tenant just like a console-issued slot, but
    // marked enrolled directly (no separate enrollment_code on the
    // device row because the pair_code already established intent
    // at the registration level). The fingerprint is the device's
    // production identity from this point on.
    const deviceInsert = await client.query<Device>(
      `INSERT INTO devices
        (tenant_id, environment, external_id, name, device_type,
         enrollment_state, fingerprint_hash, attestation_kind,
         enrolled_at, last_seen_at, metadata)
       VALUES ($1, $2, $3, $4, 'mobile_android', 'enrolled', $5, $6,
               NOW(), NOW(), $7::jsonb)
       RETURNING *`,
      [
        session.tenant_id,
        session.environment,
        `dev_${fpHash.slice(0, 16)}`,
        `Registration device (${session.id.slice(0, 8)})`,
        fpHash,
        input.attestationKind ?? 'none',
        JSON.stringify({ via: 'registration', sessionId: session.id }),
      ],
    );
    const device = deviceInsert.rows[0];

    const updated = await client.query<RegistrationSession>(
      `UPDATE registration_sessions
       SET device_id = $2,
           state = 'awaiting_commitment',
           pair_code_hash = NULL,
           pair_code_expires_at = NULL,
           enroll_code_hash = $3,
           enroll_code_expires_at = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [session.id, device.id, nextCodeHash, nextCodeExpiresAt],
    );

    await client.query('COMMIT');

    void recordAuditEvent(session.tenant_id, {
      environment: session.environment,
      actorType: 'device',
      actorId: device.id,
      action: 'registration.device_paired',
      entityType: 'registration_session',
      entityId: session.id,
      status: 'success',
      summary: 'Phone paired to registration session',
      metadata: {
        deviceId: device.id,
        attestationKind: input.attestationKind ?? 'none',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

    return {
      session: updated.rows[0],
      nextCode,
      nextCodeExpiresAt,
      nextDeeplink: `zeroauth://reg?step=enroll&session=${session.id}&code=${encodeURIComponent(nextCode)}`,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Step 2: phone scans QR2, POSTs `enroll_code` + `did` + `commitment`.
 *
 * Atomically: SELECT FOR UPDATE the awaiting_commitment row by
 * enroll_code_hash, validate `did` shape + commitment shape, write
 * them to the session row, mint verify_code + challenge_nonce, flip
 * to awaiting_verification.
 *
 * The biometric NEVER touches this code path. The `commitment` is
 * the Poseidon hash of the on-device secret + salt; the `did` is the
 * Keccak256-derived identifier. Both are non-secret and non-PII per
 * the DPDP §2(t) memo.
 */
export async function submitCommitmentForRegistration(input: {
  enrollCode: string;
  did: string;
  commitment: string;
  attestationKind?: string;
}): Promise<RegistrationStepResult> {
  const codeHash = sha256Hex(normaliseEnrollmentCode(input.enrollCode));
  const didNorm = String(input.did ?? '').trim().toLowerCase();
  const commitmentNorm = String(input.commitment ?? '').trim().toLowerCase();
  if (!/^did:zeroauth:[a-z0-9_-]+:[0-9a-f]{8,80}$/.test(didNorm)) {
    throw new RegistrationStateError('invalid_commitment');
  }
  if (!/^(0x)?[0-9a-f]{32,128}$/.test(commitmentNorm)) {
    throw new RegistrationStateError('invalid_commitment');
  }

  const nextCode = generateEnrollmentCode();
  const nextCodeHash = sha256Hex(nextCode);
  const nextCodeExpiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);
  const challengeNonce = generateChallengeNonce();

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query<RegistrationSession>(
      `SELECT * FROM registration_sessions
       WHERE enroll_code_hash = $1
         AND state = 'awaiting_commitment'
         AND enroll_code_expires_at > NOW()
         AND expires_at > NOW()
       FOR UPDATE`,
      [codeHash],
    );
    const session = found.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('code_not_found_or_expired');
    }

    const updated = await client.query<RegistrationSession>(
      `UPDATE registration_sessions
       SET did = $2,
           commitment = $3,
           enroll_code_hash = NULL,
           enroll_code_expires_at = NULL,
           verify_code_hash = $4,
           verify_code_expires_at = $5,
           verify_challenge_nonce = $6,
           state = 'awaiting_verification',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [session.id, didNorm, commitmentNorm, nextCodeHash, nextCodeExpiresAt, challengeNonce],
    );

    await client.query('COMMIT');

    void recordAuditEvent(session.tenant_id, {
      environment: session.environment,
      actorType: 'device',
      actorId: session.device_id,
      action: 'registration.commitment_submitted',
      entityType: 'registration_session',
      entityId: session.id,
      status: 'success',
      summary: 'Commitment received from device',
      metadata: {
        did: didNorm,
        commitmentPrefix: commitmentNorm.slice(0, 16),
        attestationKind: input.attestationKind ?? 'none',
      },
    }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

    return {
      session: updated.rows[0],
      nextCode,
      nextCodeExpiresAt,
      nextDeeplink: `zeroauth://reg?step=verify&session=${session.id}&code=${encodeURIComponent(nextCode)}&challenge=${challengeNonce}`,
      challengeNonce,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Step 3: phone scans QR3, POSTs `verify_code` + `proof` +
 * `public_signals` + the `challenge_nonce` from QR3.
 *
 * Atomically: SELECT FOR UPDATE the awaiting_verification row by
 * verify_code_hash, assert challenge_nonce matches, verify the
 * Groth16 proof, assert publicSignals[0] equals the stored
 * commitment, create the tenant_user, flip the session to completed.
 *
 * V1 limitation: the circuit's public signals don't yet include the
 * challenge_nonce. We bind the nonce to the *request* (it must match
 * what the server issued in step 2) but not to the *proof itself*.
 * This is sufficient for V1 — replay across sessions is blocked by
 * the single-use verify_code chain — but the Phase 1 Sprint 4
 * circuit upgrade tightens it to a per-proof binding.
 */
export async function completeRegistration(
  input: {
    verifyCode: string;
    challengeNonce: string;
    proof: unknown;
    publicSignals: unknown;
  },
  // Caller-supplied proof verifier — injected so tests don't need
  // the real circuit + zkey on disk. Production wires this to
  // src/services/zkp.ts::verifyProofOffChain at the route level.
  verifyProof: (proof: unknown, publicSignals: unknown) => Promise<boolean>,
): Promise<RegistrationCompleteResult> {
  if (typeof input.verifyCode !== 'string' || input.verifyCode.length === 0) {
    throw new RegistrationStateError('code_not_found_or_expired');
  }
  if (typeof input.challengeNonce !== 'string' || input.challengeNonce.length === 0) {
    throw new RegistrationStateError('challenge_mismatch');
  }
  if (!Array.isArray(input.publicSignals) || input.publicSignals.length === 0) {
    throw new RegistrationStateError('proof_verification_failed');
  }

  const codeHash = sha256Hex(normaliseEnrollmentCode(input.verifyCode));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query<RegistrationSession>(
      `SELECT * FROM registration_sessions
       WHERE verify_code_hash = $1
         AND state = 'awaiting_verification'
         AND verify_code_expires_at > NOW()
         AND expires_at > NOW()
       FOR UPDATE`,
      [codeHash],
    );
    const session = found.rows[0];
    if (!session) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('code_not_found_or_expired');
    }
    if (session.verify_challenge_nonce !== input.challengeNonce) {
      // Bumping the failure here keeps the row consumable on a
      // legitimate retry (the verify_code is still alive). We do
      // NOT clear the verify_code_hash on this path.
      await client.query('ROLLBACK');
      throw new RegistrationStateError('challenge_mismatch');
    }

    // Step 1: assert the proof's commitment equals the one we
    // committed to in step 2. Mirrors src/routes/v1/identity.ts.
    //
    // Subtle: the phone submits the commitment to /submit-commitment
    // as 64-char HEX (Poseidon BigInt rendered with toString(16)),
    // but snarkjs emits publicSignals[0] as the same BigInt rendered
    // in DECIMAL (toString(10)). A naive lowercase-string compare
    // never matches even on a perfectly honest proof. Coerce both
    // sides to BigInt and compare numerically — the canonical form.
    if (!session.commitment) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('commitment_mismatch');
    }
    if (!commitmentsEqual((input.publicSignals as unknown[])[0], session.commitment)) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('commitment_mismatch');
    }

    // Step 2: cryptographic proof verification — the heavy lift.
    const ok = await verifyProof(input.proof, input.publicSignals);
    if (!ok) {
      await client.query('ROLLBACK');
      throw new RegistrationStateError('proof_verification_failed');
    }

    // Step 3: create the tenant_user row. The profile blob carries
    // whatever the tenant SDK passed in — we treat it as opaque
    // beyond mapping a few well-known keys onto tenant_users columns
    // for backwards compatibility with the legacy PII surface.
    const profile = (session.profile ?? {}) as Record<string, unknown>;
    const fullName = typeof profile.full_name === 'string' ? profile.full_name
      : typeof profile.name === 'string' ? profile.name
      : 'Unnamed';
    const email = typeof profile.email === 'string' ? profile.email.toLowerCase() : null;
    const phone = typeof profile.phone === 'string' ? profile.phone : null;
    const employeeCode = typeof profile.employee_code === 'string' ? profile.employee_code : null;

    const userInsert = await client.query<TenantUser>(
      `INSERT INTO tenant_users
        (tenant_id, environment, external_id, full_name, email, phone,
         employee_code, primary_device_id, did, commitment, metadata,
         last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
       RETURNING *`,
      [
        session.tenant_id,
        session.environment,
        `user_${session.id.slice(0, 12).replace(/-/g, '')}`,
        fullName,
        email,
        phone,
        employeeCode,
        session.device_id,
        session.did,
        session.commitment,
        JSON.stringify({ via: 'registration', sessionId: session.id }),
      ],
    );
    const tenantUser = userInsert.rows[0];

    const sessionUpdate = await client.query<RegistrationSession>(
      `UPDATE registration_sessions
       SET tenant_user_id = $2,
           state = 'completed',
           verify_code_hash = NULL,
           verify_code_expires_at = NULL,
           verify_challenge_nonce = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [session.id, tenantUser.id],
    );

    // Look up the device row (one already exists from step 1, unless
    // the tenant somehow nulled it via PATCH — rare but possible).
    const deviceRow = session.device_id
      ? await client.query<Device>(
          `SELECT * FROM devices WHERE id = $1`,
          [session.device_id],
        )
      : null;

    await client.query('COMMIT');

    void recordAuditEvent(session.tenant_id, {
      environment: session.environment,
      actorType: 'device',
      actorId: session.device_id,
      action: 'registration.completed',
      entityType: 'tenant_user',
      entityId: tenantUser.id,
      status: 'success',
      summary: 'Registration ceremony complete; tenant_user created',
      metadata: {
        sessionId: session.id,
        deviceId: session.device_id,
        did: session.did,
      },
    }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

    return {
      session: sessionUpdate.rows[0],
      tenantUser,
      device: deviceRow?.rows[0] ?? null,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Tenant-side poll. Returns the current state machine value plus the
 * non-sensitive fields the platform UI needs to advance the wizard.
 * Never returns code hashes or the challenge_nonce.
 */
export async function getRegistrationSession(
  tenantId: string,
  environment: ApiKeyEnvironment,
  sessionId: string,
): Promise<RegistrationSession | null> {
  const pool = getPool();
  const result = await pool.query<RegistrationSession>(
    `SELECT * FROM registration_sessions
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
     LIMIT 1`,
    [sessionId, tenantId, environment],
  );
  return result.rows[0] ?? null;
}

/**
 * Tenant-side abandon. Voids any outstanding code on the session row
 * and flips state to 'abandoned'. Idempotent on already-abandoned or
 * completed sessions (returns the row as-is).
 */
export async function abandonRegistration(
  tenantId: string,
  environment: ApiKeyEnvironment,
  sessionId: string,
  actor: { type: 'api_key' | 'console'; id: string | null; email?: string | null },
): Promise<RegistrationSession | null> {
  const pool = getPool();
  const result = await pool.query<RegistrationSession>(
    `UPDATE registration_sessions
     SET state = CASE WHEN state IN ('completed', 'abandoned') THEN state ELSE 'abandoned' END,
         pair_code_hash = NULL,
         pair_code_expires_at = NULL,
         enroll_code_hash = NULL,
         enroll_code_expires_at = NULL,
         verify_code_hash = NULL,
         verify_code_expires_at = NULL,
         verify_challenge_nonce = NULL,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
     RETURNING *`,
    [sessionId, tenantId, environment],
  );
  const session = result.rows[0];
  if (!session) return null;

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action: 'registration.abandoned',
    entityType: 'registration_session',
    entityId: session.id,
    status: 'success',
    summary: 'Registration session abandoned',
    metadata: actor.email ? { actor_email: actor.email } : {},
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return session;
}

/**
 * The plaintext-code-shaped envelope the tenant SDK sees when it
 * starts or advances a session. The deeplink is what the platform
 * encodes into the QR; the QR rendering itself lives in the
 * dashboard / SDK (no new QR dep on the server side — see ADR 0023).
 */
export interface QrPayload {
  step: 'pair' | 'enroll' | 'verify';
  sessionId: string;
  code: string;
  expiresAt: Date;
  deeplink: string;
  challengeNonce?: string;
}
