/**
 * src/services/attendance-membership.ts
 *
 * Slice 2 — per-company attendance with provision-then-claim membership.
 *
 * - `attendance_companies` — an HR-configurable office (name, location, the
 *   WiFi presence anchor). Replaces the env-backed single company; the env
 *   fallback in `attendance-company.ts` still serves the demo when no row.
 * - `attendance_memberships` — HR provisions an employee (status='invited'
 *   + a single-use invite code); the employee's phone claims it, binding the
 *   phone's DID + commitment and creating/linking a `tenant_users` row.
 *
 * The claim binds a DID the SAME way check-in is verified: the injected
 * `verifyProof` is the nonce-bound `verifyAndConsumeForClaim` (proof-pairing),
 * so the proof must carry `publicSignals[1] = Poseidon(Poseidon(commitment),
 * nonce)` against a fresh server session — a captured proof tuple from a
 * prior sign-in cannot be replayed into an open invite (cryptographer review
 * Finding 1). On top of that nonce freshness, the single-use invite code is
 * consumed atomically in the same transaction (anti-double-claim), and
 * `did_hash = Poseidon(commitment)` is derived so the claimed member's DID
 * resolves via the same `findUserByDid` the proof-pairing verifier uses.
 */

import crypto from 'crypto';
import { poseidon1 } from 'poseidon-lite';
import { getPool } from './db';
import { recordAuditEvent } from './platform';
import { ApiKeyEnvironment } from '../types';
import { AttendanceWifiAnchor, AttendanceCompany, getAttendanceCompany } from './attendance-company';

// ─── Types ──────────────────────────────────────────────────────────────

export interface AttendanceCompanyRow {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  name: string;
  location: string;
  wifi: AttendanceWifiAnchor;
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export type MembershipStatus = 'provisioned' | 'invited' | 'claimed' | 'revoked';

export interface AttendanceMembershipRow {
  id: string;
  tenant_id: string;
  company_id: string;
  environment: ApiKeyEnvironment;
  user_id: string | null;
  employee_id: string;
  full_name: string;
  department: string | null;
  email: string | null;
  status: MembershipStatus;
  invite_code_hash: string | null;
  invite_code_expires_at: Date | null;
  invited_at: Date | null;
  claimed_at: Date | null;
  did: string | null;
  did_hash: string | null;
  commitment: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface AuditActorLite {
  type: 'console' | 'hr_admin' | 'api_key' | 'device' | 'system';
  id?: string | null;
  email?: string | null;
}

export class AttendanceMembershipError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'AttendanceMembershipError';
  }
}

// 48 hours — short enough to bound a leaked-invite window (security review
// Finding 4), long enough that an employee provisioned today can claim
// tomorrow. The nonce binding (verifyAndConsumeForClaim) is the primary
// anti-replay; this TTL is defence-in-depth on the bearer invite.
const INVITE_CODE_TTL_MS = 48 * 60 * 60 * 1000;
const CROCKFORD = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/1/I/L/O/U

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** ZA-XXXX-XXXX, mirrors the registration code shape the phone parser accepts. */
function mintInviteCode(): string {
  const pick = () => CROCKFORD[crypto.randomInt(0, CROCKFORD.length)];
  const group = () => Array.from({ length: 4 }, pick).join('');
  return `ZA-${group()}-${group()}`;
}

function normaliseInviteCode(code: string): string {
  return code.trim().toUpperCase();
}

function parseCommitmentBigInt(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') return raw;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
    if (/^[0-9]+$/.test(s)) return BigInt(s);
    if (/^[0-9a-fA-F]+$/.test(s)) return BigInt('0x' + s);
    return null;
  } catch {
    return null;
  }
}

function commitmentsEqual(a: unknown, b: unknown): boolean {
  const ai = parseCommitmentBigInt(a);
  const bi = parseCommitmentBigInt(b);
  return ai !== null && bi !== null && ai === bi;
}

// ─── Companies ──────────────────────────────────────────────────────────

export async function createCompany(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: { name: string; location?: string; wifi?: Partial<AttendanceWifiAnchor> },
  actor: AuditActorLite,
): Promise<AttendanceCompanyRow> {
  const pool = getPool();
  const wifi: AttendanceWifiAnchor = {
    ssidLabel: input.wifi?.ssidLabel ?? '',
    bssids: (input.wifi?.bssids ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean),
    minSignalPercent: clampPercent(input.wifi?.minSignalPercent ?? 85),
  };
  const result = await pool.query<AttendanceCompanyRow>(
    `INSERT INTO attendance_companies (tenant_id, environment, name, location, wifi)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [tenantId, environment, input.name, input.location ?? '', JSON.stringify(wifi)],
  );
  const company = result.rows[0];
  // A-21: HR admin actions are low-volume, accountability-critical events
  // (CLAUDE.md non-goal "never expose admin actions without an audit row").
  // Await so a write failure surfaces as a 500 rather than silently
  // dropping the trail (security review Finding 1, defence-in-depth).
  await recordAuditEvent(tenantId, {
    environment, actorType: actor.type, actorId: actor.id ?? null,
    action: 'attendance.company_created', entityType: 'attendance_company',
    entityId: company.id, status: 'success', summary: `Company "${company.name}" created`,
  });
  return company;
}

export async function getCompanyById(companyId: string): Promise<AttendanceCompanyRow | null> {
  const pool = getPool();
  const r = await pool.query<AttendanceCompanyRow>(
    `SELECT * FROM attendance_companies WHERE id = $1`, [companyId],
  );
  return r.rows[0] ?? null;
}

/** The tenant's primary (first active) company, or null. */
export async function getPrimaryCompanyForTenant(
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<AttendanceCompanyRow | null> {
  const pool = getPool();
  const r = await pool.query<AttendanceCompanyRow>(
    `SELECT * FROM attendance_companies
       WHERE tenant_id = $1 AND environment = $2 AND status = 'active'
       ORDER BY created_at ASC LIMIT 1`,
    [tenantId, environment],
  );
  return r.rows[0] ?? null;
}

export async function listCompanies(
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<AttendanceCompanyRow[]> {
  const pool = getPool();
  const r = await pool.query<AttendanceCompanyRow>(
    `SELECT * FROM attendance_companies
       WHERE tenant_id = $1 AND environment = $2 ORDER BY created_at ASC`,
    [tenantId, environment],
  );
  return r.rows;
}

export async function updateCompanyWifi(
  companyId: string,
  tenantId: string,
  wifi: Partial<AttendanceWifiAnchor>,
  actor: AuditActorLite,
): Promise<AttendanceCompanyRow | null> {
  const pool = getPool();
  const next: AttendanceWifiAnchor = {
    ssidLabel: wifi.ssidLabel ?? '',
    bssids: (wifi.bssids ?? []).map((b) => b.trim().toLowerCase()).filter(Boolean),
    minSignalPercent: clampPercent(wifi.minSignalPercent ?? 85),
  };
  const r = await pool.query<AttendanceCompanyRow>(
    `UPDATE attendance_companies SET wifi = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [companyId, tenantId, JSON.stringify(next)],
  );
  const company = r.rows[0] ?? null;
  if (company) {
    await recordAuditEvent(tenantId, {
      environment: company.environment, actorType: actor.type, actorId: actor.id ?? null,
      action: 'attendance.company_wifi_updated', entityType: 'attendance_company',
      entityId: company.id, status: 'success',
      summary: `WiFi anchor updated (${next.bssids.length} bssid(s), ≥${next.minSignalPercent}%)`,
    });
  }
  return company;
}

function clampPercent(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 85;
}

/**
 * Resolve the phone-facing company config for a `companyId`. Falls back to
 * the env-backed `getAttendanceCompany()` (the slice-1 demo "Anchor Corp")
 * when no id is given or the row is missing — so the existing demo keeps
 * working while real companies live in the DB.
 */
export async function resolveCompanyConfig(
  companyId: string | null | undefined,
): Promise<{ company: AttendanceCompany; companyId: string | null }> {
  if (companyId) {
    const row = await getCompanyById(companyId);
    if (row && row.status === 'active') {
      return {
        company: { name: row.name, location: row.location, wifi: row.wifi },
        companyId: row.id,
      };
    }
  }
  return { company: getAttendanceCompany(), companyId: null };
}

// ─── Memberships ────────────────────────────────────────────────────────

export async function provisionMember(
  tenantId: string,
  environment: ApiKeyEnvironment,
  companyId: string,
  input: { employeeId: string; fullName: string; department?: string; email?: string },
  actor: AuditActorLite,
): Promise<{ membership: AttendanceMembershipRow; inviteCode: string }> {
  const pool = getPool();
  const inviteCode = mintInviteCode();
  const inviteHash = sha256Hex(normaliseInviteCode(inviteCode));
  const expiresAt = new Date(Date.now() + INVITE_CODE_TTL_MS);

  let row: AttendanceMembershipRow;
  try {
    const r = await pool.query<AttendanceMembershipRow>(
      `INSERT INTO attendance_memberships
         (tenant_id, company_id, environment, employee_id, full_name, department, email,
          status, invite_code_hash, invite_code_expires_at, invited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'invited', $8, $9, NOW())
       RETURNING *`,
      [tenantId, companyId, environment, input.employeeId, input.fullName,
        input.department ?? null, input.email ?? null, inviteHash, expiresAt.toISOString()],
    );
    row = r.rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new AttendanceMembershipError('employee_exists', 'An employee with that ID already exists for this company.');
    }
    throw err;
  }

  await recordAuditEvent(tenantId, {
    environment, actorType: actor.type, actorId: actor.id ?? null,
    action: 'attendance.member_provisioned', entityType: 'attendance_membership',
    entityId: row.id, status: 'success',
    summary: `Provisioned ${input.fullName} (${input.employeeId})`,
    metadata: { companyId, employeeId: input.employeeId },
  });

  return { membership: row, inviteCode };
}

export async function listMembers(companyId: string): Promise<AttendanceMembershipRow[]> {
  const pool = getPool();
  const r = await pool.query<AttendanceMembershipRow>(
    `SELECT * FROM attendance_memberships WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId],
  );
  // Never leak the invite hash to the API surface.
  return r.rows.map((m) => ({ ...m, invite_code_hash: null }));
}

export async function setMemberStatus(
  membershipId: string,
  tenantId: string,
  status: 'revoked' | 'invited',
  actor: AuditActorLite,
): Promise<AttendanceMembershipRow | null> {
  const pool = getPool();
  const r = await pool.query<AttendanceMembershipRow>(
    `UPDATE attendance_memberships SET status = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [membershipId, tenantId, status],
  );
  const m = r.rows[0] ?? null;
  if (m) {
    await recordAuditEvent(tenantId, {
      environment: m.environment, actorType: actor.type, actorId: actor.id ?? null,
      action: 'attendance.member_status_changed', entityType: 'attendance_membership',
      entityId: m.id, status: 'success', summary: `Member status → ${status}`,
    });
  }
  return m ? { ...m, invite_code_hash: null } : null;
}

/** The claimed membership for a DID in a company (used to gate check-in). */
export async function findClaimedMembership(
  companyId: string,
  did: string,
): Promise<AttendanceMembershipRow | null> {
  const pool = getPool();
  const r = await pool.query<AttendanceMembershipRow>(
    `SELECT * FROM attendance_memberships
       WHERE company_id = $1 AND did = $2 AND status = 'claimed' LIMIT 1`,
    [companyId, did],
  );
  return r.rows[0] ?? null;
}

/**
 * Claim a provisioned membership: the employee's phone proves FRESH control
 * of the (did, commitment) against a server nonce, the single-use invite
 * code is consumed, and a `tenant_users` row is created/linked so the DID
 * verifies on later check-ins.
 *
 * `verifyProof(commitment)` is injected — the route wires the nonce-bound
 * `verifyAndConsumeForClaim` (proof-pairing), which enforces
 * `publicSignals[1] = Poseidon(Poseidon(commitment), nonce)` against a fresh
 * `/init` session and consumes it single-use. It throws `Pairing*` errors on
 * failure, which the route maps to HTTP — so a captured proof tuple cannot be
 * replayed into an open invite (cryptographer review Finding 1). Tests inject
 * a stub so they don't need the circuit on disk.
 */
export async function claimMembership(
  input: {
    companyId: string;
    inviteCode: string;
    did: string;
    commitment: string;
    publicSignals: unknown;
  },
  verifyProof: (commitment: bigint) => Promise<void>,
): Promise<{ membership: AttendanceMembershipRow; userId: string }> {
  if (!input.inviteCode) throw new AttendanceMembershipError('invite_not_found_or_expired', 'Invite code required.');
  if (!Array.isArray(input.publicSignals) || input.publicSignals.length < 1) {
    throw new AttendanceMembershipError('proof_verification_failed', 'Malformed public signals.');
  }
  const commitmentBigInt = parseCommitmentBigInt(input.commitment);
  if (commitmentBigInt === null) {
    throw new AttendanceMembershipError('commitment_mismatch', 'Unparseable commitment.');
  }
  // Commitment in the proof must equal the submitted commitment. Gated
  // up front so a mismatch is a clean 400 before any session/invite work,
  // and so the didHash the nonce binding derives is the same value the
  // proof committed to.
  if (!commitmentsEqual((input.publicSignals as unknown[])[0], input.commitment)) {
    throw new AttendanceMembershipError('commitment_mismatch', 'Proof commitment does not match.');
  }
  const codeHash = sha256Hex(normaliseInviteCode(input.inviteCode));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query<AttendanceMembershipRow>(
      `SELECT * FROM attendance_memberships
         WHERE company_id = $1 AND invite_code_hash = $2
           AND status IN ('provisioned', 'invited')
           AND (invite_code_expires_at IS NULL OR invite_code_expires_at > NOW())
         FOR UPDATE`,
      [input.companyId, codeHash],
    );
    const membership = found.rows[0];
    if (!membership) {
      await client.query('ROLLBACK');
      throw new AttendanceMembershipError('invite_not_found_or_expired', 'Invite not found, already used, or expired.');
    }

    // Nonce-bound proof verification (A-11) — consumes the single-use
    // pairing session. Throws Pairing* on failure; the invite stays
    // unconsumed (ROLLBACK below) so a fresh /init + retry is possible.
    await verifyProof(commitmentBigInt);

    const commitmentDec = commitmentBigInt.toString(10);
    const didHashDec = poseidon1([commitmentBigInt]).toString(10);
    const userMetadata = {
      via: 'attendance_claim',
      membershipId: membership.id,
      did: input.did,
      did_hash: didHashDec,
      commitment: commitmentDec,
    };

    // Link an existing tenant_user with this DID, else create one.
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE tenant_id = $1 AND environment = $2 AND did = $3 LIMIT 1`,
      [membership.tenant_id, membership.environment, input.did],
    );
    let userId: string;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE tenant_users SET commitment = $2, metadata = metadata || $3::jsonb, last_verified_at = NOW()
           WHERE id = $1`,
        [userId, commitmentDec, JSON.stringify(userMetadata)],
      );
    } else {
      const externalId = `emp_${membership.id.slice(0, 12).replace(/-/g, '')}`;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tenant_users
           (tenant_id, environment, external_id, full_name, email, employee_code,
            did, commitment, metadata, last_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
         RETURNING id`,
        [membership.tenant_id, membership.environment, externalId, membership.full_name,
          membership.email, membership.employee_id, input.did, commitmentDec, JSON.stringify(userMetadata)],
      );
      userId = ins.rows[0].id;
    }

    const updated = await client.query<AttendanceMembershipRow>(
      `UPDATE attendance_memberships
         SET status = 'claimed', user_id = $2, did = $3, did_hash = $4, commitment = $5,
             claimed_at = NOW(), invite_code_hash = NULL, invite_code_expires_at = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [membership.id, userId, input.did, didHashDec, commitmentDec],
    );

    await client.query('COMMIT');

    // A-21: the claim is an identity-binding event (this DID is now an
    // employee of record) — the highest-value attendance audit row. Await
    // it; a claim with no trail is worse than a failed claim (security
    // review Finding 5). actorType='device' (the phone drove the claim).
    await recordAuditEvent(membership.tenant_id, {
      environment: membership.environment, actorType: 'device', actorId: null,
      action: 'attendance.membership_claimed', entityType: 'attendance_membership',
      entityId: membership.id, status: 'success',
      summary: `Membership claimed by ${membership.full_name}`,
      metadata: { companyId: input.companyId, userId, did_sha256: sha256Hex(input.did) },
    });

    return { membership: { ...updated.rows[0], invite_code_hash: null }, userId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
