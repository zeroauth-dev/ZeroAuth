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
export class BankNoAccount extends Error {
  readonly code = 'no_account';
  constructor(message = 'No active bank account for this session') { super(message); }
}
export class BankInsufficientFunds extends Error {
  readonly code = 'insufficient_funds';
  constructor(message = 'Insufficient balance for this transfer') { super(message); }
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
    // Log only a DID prefix, matching the pairing path's did_sha256
    // convention (security review Finding 5) — a DID is a stable,
    // correlatable identity pointer; keep it out of operational logs.
    didPrefix: row.did.slice(0, 24),
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
    // Timing uniformity (security review Finding 4): pay one scrypt like the
    // unknown-customer and wrong-password paths so a locked account is not
    // distinguishable by response latency.
    await verifyPassword(password, await dummyHash()).catch(() => false);
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

// ─── NeoBank dashboard: ledger + step-up transfers ──────────────────────

/** Transfers at or above this move behind a face step-up. ₹10,000. */
export const STEP_UP_THRESHOLD_PAISE = 10_000_00;
/** Starting savings balance seeded at account activation. ₹4,82,316. */
const STARTING_BALANCE_PAISE = 4_82_316_00;

/** Deterministic starter history so the dashboard feels lived-in. */
const STARTER_TXNS: Array<{
  dir: 'debit' | 'credit'; cp: string; amt: number; note: string; cat: string; hoursAgo: number;
}> = [
  { dir: 'credit', cp: 'Salary — Acme Corp', amt: 85_000_00, note: 'Monthly salary', cat: 'salary', hoursAgo: 48 },
  { dir: 'debit', cp: 'Landlord — rent', amt: 32_000_00, note: 'July rent', cat: 'rent', hoursAgo: 120 },
  { dir: 'debit', cp: 'BESCOM', amt: 2_450_00, note: 'Electricity', cat: 'utility', hoursAgo: 168 },
  { dir: 'debit', cp: 'Mutual fund SIP', amt: 10_000_00, note: 'Monthly SIP', cat: 'investment', hoursAgo: 170 },
  { dir: 'debit', cp: 'Swiggy', amt: 284_00, note: 'Dinner', cat: 'food', hoursAgo: 2 },
  { dir: 'debit', cp: 'Amazon', amt: 1_899_00, note: 'Order', cat: 'shopping', hoursAgo: 336 },
  { dir: 'credit', cp: 'Refund — Myntra', amt: 1_299_00, note: 'Return refund', cat: 'transfer', hoursAgo: 672 },
];

export interface BankTransactionView {
  id: string;
  direction: 'debit' | 'credit';
  counterparty: string;
  amountPaise: number;
  note: string | null;
  category: string;
  status: string;
  createdAt: string;
}

export interface BankOverview {
  fullName: string;
  did: string | null;
  primaryBalancePaise: number;
  accounts: Array<{ id: string; kind: string; maskedNumber: string; balancePaise: number }>;
  transactions: BankTransactionView[];
}

/** Resolve the active bank account behind the demo session's tenant_user. */
export async function resolveBankAccountByUser(
  tenantId: string,
  environment: ApiKeyEnvironment,
  tenantUserId: string,
): Promise<BankAccountRow & { balance_paise: number; ledger_seeded: boolean } | null> {
  const pool = getPool();
  const result = await pool.query<BankAccountRow & { balance_paise: number; ledger_seeded: boolean }>(
    `SELECT * FROM demo_bank_accounts
      WHERE tenant_id = $1 AND environment = $2 AND tenant_user_id = $3
      ORDER BY created_at ASC LIMIT 1`,
    [tenantId, environment, tenantUserId],
  );
  return result.rows[0] ?? null;
}

/** One-shot ledger seed (single-winner via the ledger_seeded flag). */
async function seedLedger(bankAccountId: string): Promise<void> {
  const pool = getPool();
  const claimed = await pool.query(
    `UPDATE demo_bank_accounts
        SET balance_paise = $2, ledger_seeded = TRUE
      WHERE id = $1 AND ledger_seeded = FALSE
      RETURNING id`,
    [bankAccountId, STARTING_BALANCE_PAISE],
  );
  if (claimed.rows.length === 0) return; // already seeded by a concurrent call
  for (const t of STARTER_TXNS) {
    await pool.query(
      `INSERT INTO demo_bank_transactions
         (bank_account_id, direction, counterparty, amount_paise, note, category, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', NOW() - ($7 || ' hours')::interval)`,
      [bankAccountId, t.dir, t.cp, t.amt, t.note, t.cat, t.hoursAgo],
    ).catch(err => logger.warn('demo-bank: starter txn insert failed', { error: (err as Error).message }));
  }
}

/** The dashboard payload: the customer's balance + recent transactions. */
export async function getBankOverview(
  tenantId: string,
  environment: ApiKeyEnvironment,
  tenantUserId: string,
): Promise<BankOverview | null> {
  const pool = getPool();
  const account = await resolveBankAccountByUser(tenantId, environment, tenantUserId);
  if (!account) return null;

  let balance = Number(account.balance_paise);
  if (!account.ledger_seeded) {
    await seedLedger(account.id);
    balance = STARTING_BALANCE_PAISE;
  }

  const txns = await pool.query<{
    id: string; direction: 'debit' | 'credit'; counterparty: string;
    amount_paise: string; note: string | null; category: string; status: string; created_at: Date;
  }>(
    `SELECT id, direction, counterparty, amount_paise, note, category, status, created_at
       FROM demo_bank_transactions
      WHERE bank_account_id = $1
      ORDER BY created_at DESC
      LIMIT 25`,
    [account.id],
  );

  // The savings account is the real, spendable one; the other two are
  // static display so the dashboard reads like a full bank.
  return {
    fullName: account.full_name,
    did: account.did,
    primaryBalancePaise: balance,
    accounts: [
      { id: 'sav', kind: 'savings', maskedNumber: '•••• 4421', balancePaise: balance },
      { id: 'cur', kind: 'current', maskedNumber: '•••• 8810', balancePaise: 1_12_940_00 },
      { id: 'cc', kind: 'credit_card', maskedNumber: '•••• 3377', balancePaise: -18_420_00 },
    ],
    transactions: txns.rows.map(r => ({
      id: r.id,
      direction: r.direction,
      counterparty: r.counterparty,
      amountPaise: Number(r.amount_paise),
      note: r.note,
      category: r.category,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export interface TransferInput {
  amountPaise: number;
  payeeName: string;
  payeeHandle?: string | null;
  note?: string | null;
}

/** Debit + record a sub-threshold transfer atomically (guarded on funds). */
export async function executeImmediateTransfer(
  bankAccountId: string,
  input: TransferInput,
): Promise<{ transferId: string; balancePaise: number }> {
  const pool = getPool();
  const debit = await pool.query<{ balance_paise: string }>(
    `UPDATE demo_bank_accounts
        SET balance_paise = balance_paise - $2
      WHERE id = $1 AND balance_paise >= $2
      RETURNING balance_paise`,
    [bankAccountId, input.amountPaise],
  );
  if (debit.rows.length === 0) throw new BankInsufficientFunds();

  const txn = await pool.query<{ id: string }>(
    `INSERT INTO demo_bank_transactions
       (bank_account_id, direction, counterparty, amount_paise, note, category, status, settled_at)
     VALUES ($1, 'debit', $2, $3, $4, 'transfer', 'completed', NOW())
     RETURNING id`,
    [bankAccountId, input.payeeName, input.amountPaise, input.note ?? null],
  );
  return { transferId: txn.rows[0].id, balancePaise: Number(debit.rows[0].balance_paise) };
}

/** Record a step-up transfer as pending, linked to its pinned session. No
 *  money moves until commitTransferIfApproved sees the session consumed. */
export async function insertPendingTransfer(
  bankAccountId: string,
  input: TransferInput,
  pairingSessionId: string,
): Promise<{ transferId: string }> {
  const pool = getPool();
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO demo_bank_transactions
       (bank_account_id, direction, counterparty, amount_paise, note, category, status, pairing_session_id)
     VALUES ($1, 'debit', $2, $3, $4, 'transfer', 'pending_approval', $5)
     RETURNING id`,
    [bankAccountId, input.payeeName, input.amountPaise, input.note ?? null, pairingSessionId],
  );
  return { transferId: txn.rows[0].id };
}

export interface TransferStatus {
  status: 'pending_approval' | 'completed' | 'declined' | 'not_found';
  transferId?: string;
  counterparty?: string;
  amountPaise?: number;
  balancePaise?: number | null;
}

/**
 * Poll + settle a step-up transfer. Money moves ONLY when the linked
 * pinned session is `consumed` — i.e. the account's own face approved it.
 * Idempotent: the completed status-flip is a single-winner UPDATE, and the
 * debit is guarded on funds. An expired/failed session declines the
 * transfer. This is the money-movement gate — mirrors the pin invariant.
 */
export async function commitTransferIfApproved(
  bankAccountId: string,
  transferId: string,
): Promise<TransferStatus> {
  const pool = getPool();
  const row = (await pool.query<{
    id: string; status: string; bank_account_id: string; amount_paise: string;
    counterparty: string; session_state: string | null; session_expires: Date | null;
  }>(
    `SELECT t.id, t.status, t.bank_account_id, t.amount_paise, t.counterparty,
            s.state AS session_state, s.expires_at AS session_expires
       FROM demo_bank_transactions t
       LEFT JOIN proof_pairing_sessions s ON s.id = t.pairing_session_id
      WHERE t.id = $1 AND t.bank_account_id = $2`,
    [transferId, bankAccountId],
  )).rows[0];

  if (!row) return { status: 'not_found' };

  const base = { transferId: row.id, counterparty: row.counterparty, amountPaise: Number(row.amount_paise) };
  if (row.status !== 'pending_approval') {
    return { status: row.status as TransferStatus['status'], ...base, balancePaise: null };
  }

  const expired = row.session_expires ? new Date(row.session_expires).getTime() <= Date.now() : false;

  if (row.session_state === 'consumed') {
    // Approved. Flip to completed (single-winner), then debit (guarded).
    const flip = await pool.query<{ amount_paise: string }>(
      `UPDATE demo_bank_transactions SET status = 'completed', settled_at = NOW()
        WHERE id = $1 AND status = 'pending_approval'
        RETURNING amount_paise`,
      [transferId],
    );
    if (flip.rows.length === 0) return { status: 'completed', ...base, balancePaise: null };
    const debit = await pool.query<{ balance_paise: string }>(
      `UPDATE demo_bank_accounts SET balance_paise = balance_paise - $2
        WHERE id = $1 AND balance_paise >= $2
        RETURNING balance_paise`,
      [row.bank_account_id, Number(flip.rows[0].amount_paise)],
    );
    if (debit.rows.length === 0) {
      await pool.query(`UPDATE demo_bank_transactions SET status = 'declined' WHERE id = $1`, [transferId]);
      return { status: 'declined', ...base, balancePaise: null };
    }
    return { status: 'completed', ...base, balancePaise: Number(debit.rows[0].balance_paise) };
  }

  if (row.session_state === 'failed' || row.session_state === 'expired' || expired) {
    await pool.query(
      `UPDATE demo_bank_transactions SET status = 'declined'
        WHERE id = $1 AND status = 'pending_approval'`,
      [transferId],
    );
    return { status: 'declined', ...base, balancePaise: null };
  }

  return { status: 'pending_approval', ...base, balancePaise: null };
}

/** ₹ display for a paise amount, Indian grouping. */
export function formatPaise(paise: number): string {
  const rupees = Math.round(paise / 100);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(rupees);
}
