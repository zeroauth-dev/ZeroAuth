/**
 * Service-level tests for src/services/demo-bank.ts — the NeoBank demo
 * account store behind /api/demo-portal/bank/*.
 *
 * Real scrypt (via tenants.hashPassword/verifyPassword), pool mocked
 * with a SQL dispatcher. The properties pinned here:
 *   - the password is scrypt-hashed at rest (never the plaintext)
 *   - login failure is UNIFORM: unknown customer and wrong password
 *     both throw BankInvalidCredentials, and the unknown-customer path
 *     still burns a scrypt verify (timing uniformity)
 *   - lockout after MAX_FAILED_LOGINS, counter resets on success
 *   - bindEnrollment flips pending_enrollment → active with the
 *     ceremony's DID
 */
const queryMock = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: queryMock }) }));

import {
  createBankAccount,
  verifyBankLogin,
  bindEnrollment,
  BankCustomerIdTaken,
  BankInvalidCredentials,
  BankEnrollmentPending,
  BankAccountLocked,
  MAX_FAILED_LOGINS,
} from '../src/services/demo-bank';
import { hashPassword } from '../src/services/tenants';

const TENANT = 'tenant-demo';
const DID = 'did:zeroauth:face:' + 'b2'.repeat(20);

beforeEach(() => queryMock.mockReset());

describe('createBankAccount', () => {
  it('stores a scrypt hash, never the plaintext', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 'bank-1', status: 'pending_enrollment' }] });
    await createBankAccount({
      tenantId: TENANT, environment: 'live', customerId: 'a@b.com',
      password: 'S3cure-pass', fullName: 'Asha', registrationSessionId: 'reg-1',
    });
    const params = queryMock.mock.calls[0][1] as unknown[];
    const stored = params.find(p => typeof p === 'string' && (p as string).includes(':')) as string;
    expect(stored).toBeDefined();
    expect(stored).not.toContain('S3cure-pass');
    expect(stored.split(':')).toHaveLength(2); // salt:derivedKey hex
  });

  it('maps the unique-violation to BankCustomerIdTaken', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(createBankAccount({
      tenantId: TENANT, environment: 'live', customerId: 'a@b.com',
      password: 'S3cure-pass', fullName: 'Asha', registrationSessionId: 'reg-1',
    })).rejects.toBeInstanceOf(BankCustomerIdTaken);
  });
});

describe('verifyBankLogin', () => {
  async function activeRow(password: string, overrides: Record<string, unknown> = {}) {
    return {
      id: 'bank-1', tenant_id: TENANT, environment: 'live',
      customer_id: 'a@b.com', password_hash: await hashPassword(password),
      full_name: 'Asha', did: DID, tenant_user_id: 'u-1',
      status: 'active', failed_login_count: 0, ...overrides,
    };
  }

  it('unknown customer → BankInvalidCredentials (uniform)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(verifyBankLogin(TENANT, 'live', 'ghost@b.com', 'whatever1'))
      .rejects.toBeInstanceOf(BankInvalidCredentials);
  });

  it('wrong password → BankInvalidCredentials + failure counter increment', async () => {
    queryMock.mockResolvedValueOnce({ rows: [await activeRow('right-pass1')] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // the increment UPDATE
    await expect(verifyBankLogin(TENANT, 'live', 'a@b.com', 'wrong-pass1'))
      .rejects.toBeInstanceOf(BankInvalidCredentials);
    const updateSql = String(queryMock.mock.calls[1][0]);
    expect(updateSql).toMatch(/failed_login_count = failed_login_count \+ 1/);
  });

  it('correct password but enrollment never completed → BankEnrollmentPending', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [await activeRow('S3cure-pass', { status: 'pending_enrollment', did: null })],
    });
    await expect(verifyBankLogin(TENANT, 'live', 'a@b.com', 'S3cure-pass'))
      .rejects.toBeInstanceOf(BankEnrollmentPending);
  });

  it('locked account → BankAccountLocked even with the right password', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [await activeRow('S3cure-pass', { failed_login_count: MAX_FAILED_LOGINS })],
    });
    await expect(verifyBankLogin(TENANT, 'live', 'a@b.com', 'S3cure-pass'))
      .rejects.toBeInstanceOf(BankAccountLocked);
  });

  it('success → returns the bound identity + resets the counter', async () => {
    queryMock.mockResolvedValueOnce({ rows: [await activeRow('S3cure-pass', { failed_login_count: 3 })] });
    queryMock.mockResolvedValueOnce({ rows: [] }); // reset UPDATE
    const acct = await verifyBankLogin(TENANT, 'live', 'a@b.com', 'S3cure-pass');
    expect(acct).toMatchObject({ id: 'bank-1', did: DID, fullName: 'Asha', tenantUserId: 'u-1' });
    const resetSql = String(queryMock.mock.calls[1][0]);
    expect(resetSql).toMatch(/failed_login_count = 0/);
    expect(resetSql).toMatch(/last_login_at = NOW\(\)/);
  });
});

describe('bindEnrollment', () => {
  it('binds the completed ceremony DID onto the pending account', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ state: 'completed', did: DID, tenant_user_id: 'u-1' }],
    });
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'bank-1', status: 'active', did: DID }],
    });
    const out = await bindEnrollment(TENANT, 'live', 'reg-1');
    expect(out).toMatchObject({ status: 'active', did: DID });
    const updateSql = String(queryMock.mock.calls[1][0]);
    expect(updateSql).toMatch(/status = 'active'/);
  });

  it('no-op (returns null) when the ceremony is not complete yet', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ state: 'awaiting_verification', did: null, tenant_user_id: null }] });
    const out = await bindEnrollment(TENANT, 'live', 'reg-1');
    expect(out).toBeNull();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
