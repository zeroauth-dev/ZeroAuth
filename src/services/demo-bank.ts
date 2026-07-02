/**
 * demo-bank.ts — the NeoBank demo's OWN account store.
 *
 * This models the real product boundary: the BANK keeps its customer
 * id + password (first factor, entirely the bank's); ZeroAuth is the
 * verification layer the bank delegates step-up to. The only ZeroAuth
 * artefact stored here is the bound `did` — a public pointer to the
 * enrolled identity. No biometric, no commitment, nothing derivable.
 *
 * Lifecycle:
 *   1. `createBankAccount` — signup form lands; the password is scrypt
 *      hashed; the row starts `pending_enrollment`, referencing the
 *      registration ceremony the desktop is about to drive.
 *   2. `bindEnrollment` — the ceremony poll sees `completed` and binds
 *      the ceremony's DID + tenant_user onto the row → `active`.
 *   3. `verifyBankLogin` — password check (first factor). Success does
 *      NOT log the user in: the route opens a DID-pinned pairing
 *      session and the ZeroAuth app must approve with a face proof
 *      (second factor).
 *
 * Uniform-failure policy (mirrors console login): unknown customer and
 * wrong password are indistinguishable (`BankInvalidCredentials`), and
 * the unknown-customer path still burns one scrypt verification so the
 * two are timing-uniform.
 */

import { getPool } from './db';
import { hashPassword, verifyPassword } from './tenants';
import { logger } from './logger';
import { ApiKeyEnvironment } from '../types';

export class BankCustomerIdTaken extends Error {
  readonly code = 'customer_id_taken';
  constructor(message = 'An account with this customer id already exists') { super(message); }
}
export class BankInvalidCredentials extends Error {
  readonly code = 'invalid_credentials';
  constructor(message = 'Customer id or password is incorrect') { super(message); }
}
export class BankEnrollmentPending extends Error {
  readonly code = 'enrollment_pending';
  constructor(message = 'ZeroAuth enrollment was not completed for this account') { super(message); }
}
export class BankAccountLocked extends Error {
  readonly code = 'account_locked';
  constructor(message = 'Account locked after repeated failed logins') { super(message); }
}

/** Failed password attempts before the account locks. */
export const MAX_FAILED_LOGINS = 10;

// A real scrypt hash of an unknowable random value, verified against on
// the unknown-customer path so "no such row" costs the same as "wrong
// password" (timing uniformity). Computed once at module load.
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword('timing-uniformity-dummy-' + Math.random().toString(36));
  }
  return dummyHashPromise;
}

export interface BankAccountRow {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  customer_id: string;
  password_hash: string;
  full_name: string;
  did: string | null;
  tenant_user_id: string | null;
  status: 'pending_enrollment' | 'active' | 'locked';
  failed_login_count: number;
}

export async function createBankAccount(input: {
  tenantId: string;
  environment: ApiKeyEnvironment;
  customerId: string;
  password: string;
  fullName: string;
  registrationSessionId: string;
}): Promise<{ id: string; status: string }> {
  const passwordHash = await hashPassword(input.password);
  const pool = getPool();
  try {
    const result = await pool.query<{ id: string; status: string }>(
      `INSERT INTO demo_bank_accounts
         (tenant_id, environment, customer_id, password_hash, full_name,
          registration_session_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_enrollment')
       RETURNING id, status`,
      [
        input.tenantId,
        input.environment,
        input.customerId,
        passwordHash,
        input.fullName,
        input.registrationSessionId,
      ],
    );
    return result.rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new BankCustomerIdTaken();
    }
    throw err;
  }
}

/**
 * Ceremony-completion bind: read the registration session; if it
 * reached `completed`, stamp its DID + tenant_user onto the pending
 * bank account and activate it. Idempotent (re-running against an
 * already-active row updates the same values). Returns null while the
 * ceremony is still in flight.
 */
export async function bindEnrollment(
  tenantId: string,
  environment: ApiKeyEnvironment,
  registrationSessionId: string,
): Promise<{ status: string; did: string } | null> {
  const pool = getPool();
  const reg = await pool.query<{ state: string; did: string | null; tenant_user_id: string | null }>(
    `SELECT state, did, tenant_user_id FROM registration_sessions
      WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [registrationSessionId, tenantId, environment],
  );
  const row = reg.rows[0];
  if (!row || row.state !== 'completed' || !row.did) return null;

  const updated = await pool.query<{ id: string; status: string; did: string }>(
    `UPDATE demo_bank_accounts
        SET did = $4, tenant_user_id = $5, status = 'active'
      WHERE registration_session_id = $1 AND tenant_id = $2 AND environment = $3
        AND status IN ('pending_enrollment', 'active')
      RETURNING id, status, did`,
    [registrationSessionId, tenantId, environment, row.did, row.tenant_user_id],
  );
  const bound = updated.rows[0];
  if (!bound) return null;
  logger.info('demo-bank: enrollment bound to account', {
    tenantId,
    registrationSessionId,
    did: row.did,
  });
  return { status: bound.status, did: bound.did };
}

/**
 * First-factor check. Throws:
 *   BankInvalidCredentials — unknown customer OR wrong password (uniform)
 *   BankAccountLocked      — status locked / failure cap reached
 *   BankEnrollmentPending  — password OK but no bound DID
 * Returns the bound identity on success (and resets the failure count).
 */
export async function verifyBankLogin(
  tenantId: string,
  environment: ApiKeyEnvironment,
  customerId: string,
  password: string,
): Promise<{ id: string; did: string; fullName: string; tenantUserId: string | null }> {
  const pool = getPool();
  const result = await pool.query<BankAccountRow>(
    `SELECT * FROM demo_bank_accounts
      WHERE tenant_id = $1 AND environment = $2 AND customer_id = $3
      LIMIT 1`,
    [tenantId, environment, customerId],
  );
  const account = result.rows[0] ?? null;

  if (!account) {
    // Timing uniformity: burn a scrypt verify against the dummy hash.
    await verifyPassword(password, await dummyHash()).catch(() => false);
    throw new BankInvalidCredentials();
  }

  if (account.status === 'locked' || account.failed_login_count >= MAX_FAILED_LOGINS) {
    throw new BankAccountLocked();
  }

  const ok = await verifyPassword(password, account.password_hash).catch(() => false);
  if (!ok) {
    await pool.query(
      `UPDATE demo_bank_accounts
          SET failed_login_count = failed_login_count + 1,
              status = CASE WHEN failed_login_count + 1 >= $4 THEN 'locked' ELSE status END
        WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
      [account.id, tenantId, environment, MAX_FAILED_LOGINS],
    ).catch(err => logger.warn('demo-bank: failure-count update failed', {
      error: (err as Error).message,
    }));
    throw new BankInvalidCredentials();
  }

  if (account.status !== 'active' || !account.did) {
    throw new BankEnrollmentPending();
  }

  await pool.query(
    `UPDATE demo_bank_accounts
        SET failed_login_count = 0, last_login_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [account.id, tenantId, environment],
  ).catch(err => logger.warn('demo-bank: login-stamp update failed', {
    error: (err as Error).message,
  }));

  return {
    id: account.id,
    did: account.did,
    fullName: account.full_name,
    tenantUserId: account.tenant_user_id,
  };
}
