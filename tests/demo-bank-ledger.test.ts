/**
 * Service-level tests for the NeoBank ledger + step-up transfers
 * (src/services/demo-bank.ts). Real functions, SQL-dispatching pool mock.
 *
 * The load-bearing invariant: money moves ONLY when the step-up transfer's
 * linked pinned session is `consumed` (the account holder's face approved
 * it). A still-issued session must leave the balance untouched; an
 * expired/failed session declines the transfer without debiting.
 */
const queryMock = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: queryMock }) }));

import {
  executeImmediateTransfer,
  commitTransferIfApproved,
  getBankOverview,
  BankInsufficientFunds,
  STEP_UP_THRESHOLD_PAISE,
} from '../src/services/demo-bank';

const ACCT = 'bank-1';

beforeEach(() => queryMock.mockReset());

describe('executeImmediateTransfer', () => {
  it('debits atomically (guarded on funds) and records a completed txn', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ balance_paise: '48231600' }] }) // guarded debit
      .mockResolvedValueOnce({ rows: [{ id: 'txn-1' }] });               // insert txn
    const out = await executeImmediateTransfer(ACCT, { amountPaise: 50000, payeeName: 'Priya' });
    expect(out).toEqual({ transferId: 'txn-1', balancePaise: 48231600 });
    const debitSql = String(queryMock.mock.calls[0][0]);
    expect(debitSql).toMatch(/balance_paise = balance_paise - \$2/);
    expect(debitSql).toMatch(/balance_paise >= \$2/); // no overdraft
  });

  it('throws BankInsufficientFunds when the guarded debit matches no row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(
      executeImmediateTransfer(ACCT, { amountPaise: 999_999_00, payeeName: 'Priya' }),
    ).rejects.toBeInstanceOf(BankInsufficientFunds);
    expect(queryMock).toHaveBeenCalledTimes(1); // never reached the insert
  });
});

describe('commitTransferIfApproved — money moves only on a consumed session', () => {
  const DID = 'did:zeroauth:face:' + 'cc'.repeat(20);
  function wire(opts: {
    txnStatus?: string; sessionState?: string | null; sessionExpires?: Date | null;
    flipRows?: unknown[]; debitRows?: unknown[];
    sessionDid?: string | null; sessionLabel?: string | null; accountDid?: string | null;
  }) {
    const calls: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM demo_bank_transactions t') && sql.includes('proof_pairing_sessions')) {
        return { rows: [{
          id: 'txn-1', status: opts.txnStatus ?? 'pending_approval', bank_account_id: ACCT,
          amount_paise: '2500000', counterparty: 'Priya',
          session_state: opts.sessionState ?? 'issued',
          session_expires: opts.sessionExpires ?? new Date(Date.now() + 60_000),
          session_did: opts.sessionDid !== undefined ? opts.sessionDid : DID,
          session_label: opts.sessionLabel !== undefined ? opts.sessionLabel : 'Pay ₹25,000 to Priya',
          account_did: opts.accountDid !== undefined ? opts.accountDid : DID,
        }] };
      }
      if (sql.includes("UPDATE demo_bank_transactions SET status = 'completed'")) {
        return { rows: opts.flipRows ?? [{ amount_paise: '2500000' }] };
      }
      if (sql.includes('UPDATE demo_bank_accounts SET balance_paise = balance_paise - $2')) {
        return { rows: opts.debitRows ?? [{ balance_paise: '45731600' }] };
      }
      if (sql.includes("SET status = 'declined'")) return { rows: [] };
      return { rows: [] };
    });
    return calls;
  }
  const debitRan = (c: string[]) => c.some(s => s.includes('UPDATE demo_bank_accounts SET balance_paise = balance_paise - $2'));

  it('consumed session → completed + balance debited', async () => {
    const calls = wire({ sessionState: 'consumed' });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('completed');
    expect(r.balancePaise).toBe(45731600);
    expect(debitRan(calls)).toBe(true);
  });

  it('still-issued session → pending_approval, NO debit', async () => {
    const calls = wire({ sessionState: 'issued' });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('pending_approval');
    expect(debitRan(calls)).toBe(false);
  });

  it('expired session → declined, NO debit', async () => {
    const calls = wire({ sessionState: 'issued', sessionExpires: new Date(Date.now() - 1000) });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('declined');
    expect(debitRan(calls)).toBe(false);
  });

  it('failed session → declined, NO debit', async () => {
    const calls = wire({ sessionState: 'failed' });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('declined');
    expect(debitRan(calls)).toBe(false);
  });

  it('idempotent: an already-completed transfer stays completed, no double debit', async () => {
    const calls = wire({ txnStatus: 'completed', sessionState: 'consumed' });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('completed');
    expect(debitRan(calls)).toBe(false); // terminal short-circuit
  });

  it('lost the flip race (0 rows) → completed but no second debit', async () => {
    const calls = wire({ sessionState: 'consumed', flipRows: [] });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('completed');
    expect(debitRan(calls)).toBe(false);
  });

  it('unknown transfer → not_found', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const r = await commitTransferIfApproved(ACCT, 'nope');
    expect(r.status).toBe('not_found');
  });

  // Security review Finding 1: the gate re-asserts the pin it depends on.
  it('consumed session pinned to a DIFFERENT did → declined, NO debit', async () => {
    const calls = wire({ sessionState: 'consumed', sessionDid: 'did:zeroauth:face:' + 'ff'.repeat(20) });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('declined');
    expect(debitRan(calls)).toBe(false);
  });

  it('consumed session with NO label (a login session, not a payment) → declined, NO debit', async () => {
    const calls = wire({ sessionState: 'consumed', sessionLabel: null });
    const r = await commitTransferIfApproved(ACCT, 'txn-1');
    expect(r.status).toBe('declined');
    expect(debitRan(calls)).toBe(false);
  });
});

describe('getBankOverview', () => {
  it('returns null when no account is bound to the session user', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getBankOverview('t', 'live', 'user-x')).toBeNull();
  });

  it('seeds the ledger on first read and returns balance + transactions', async () => {
    const calls: string[] = [];
    queryMock.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT * FROM demo_bank_accounts')) {
        return { rows: [{ id: ACCT, full_name: 'Asha', did: 'did:zeroauth:face:aa', balance_paise: '0', ledger_seeded: false }] };
      }
      if (sql.includes('UPDATE demo_bank_accounts') && sql.includes('ledger_seeded = TRUE')) {
        return { rows: [{ id: ACCT }] }; // seed claimed
      }
      if (sql.includes('INSERT INTO demo_bank_transactions')) return { rows: [] };
      if (sql.includes('SELECT id, direction, counterparty')) {
        return { rows: [{ id: 'tx', direction: 'credit', counterparty: 'Salary', amount_paise: '8500000', note: 'x', category: 'salary', status: 'completed', created_at: new Date() }] };
      }
      return { rows: [] };
    });
    const overview = await getBankOverview('t', 'live', 'user-1');
    expect(overview?.fullName).toBe('Asha');
    expect(overview?.primaryBalancePaise).toBeGreaterThan(0); // seeded starting balance
    expect(overview?.transactions).toHaveLength(1);
    expect(calls.some(s => s.includes('ledger_seeded = TRUE'))).toBe(true);
  });
});

describe('STEP_UP_THRESHOLD_PAISE', () => {
  it('is ₹10,000 in paise', () => {
    expect(STEP_UP_THRESHOLD_PAISE).toBe(10_000_00);
  });
});
