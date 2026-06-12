/**
 * Service-level test for the REAL claimMembership derivation.
 *
 * The route-level tests (tests/attendance-membership.test.ts) mock the whole
 * service, so the load-bearing equality "did_hash stored at claim ==
 * Poseidon(commitment), which every later check-in re-derives" was only
 * guaranteed by inspection (cryptographer review Finding 4). This exercises
 * the real `poseidon1` derivation against a mocked DB so a future refactor of
 * the Poseidon call can't silently break every claimed member's check-in.
 */

import { poseidon1 } from 'poseidon-lite';

let lastInsertParams: unknown[] | null = null;
let lastMembershipUpdateParams: unknown[] | null = null;
let inviteFound = true;

function makeClient() {
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (/^\s*BEGIN/i.test(sql)) return {};
      if (/^\s*ROLLBACK/i.test(sql)) return {};
      if (/^\s*COMMIT/i.test(sql)) return {};
      if (/FROM attendance_memberships[\s\S]*FOR UPDATE/i.test(sql)) {
        return inviteFound
          ? { rows: [{ id: 'm-1', tenant_id: 't-1', environment: 'live', company_id: 'co-1', full_name: 'Asha', email: 'a@x.io', employee_id: 'E1', status: 'invited' }] }
          : { rows: [] };
      }
      if (/SELECT id FROM tenant_users/i.test(sql)) return { rows: [] };
      if (/INSERT INTO tenant_users/i.test(sql)) { lastInsertParams = params ?? null; return { rows: [{ id: 'u-1' }] }; }
      if (/UPDATE attendance_memberships/i.test(sql)) { lastMembershipUpdateParams = params ?? null; return { rows: [{ id: 'm-1', status: 'claimed' }] }; }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
}

let mockClient = makeClient();
jest.mock('../src/services/db', () => ({
  getPool: () => ({ connect: async () => mockClient, query: (...a: unknown[]) => mockClient.query(...(a as [string, unknown[]?])) }),
}));
jest.mock('../src/services/platform', () => ({ recordAuditEvent: jest.fn().mockResolvedValue(undefined) }));

import { claimMembership } from '../src/services/attendance-membership';

const DID = 'did:zeroauth:face:9f71801e57db9f337204933063586d3b95d27a11';

beforeEach(() => {
  mockClient = makeClient();
  lastInsertParams = null;
  lastMembershipUpdateParams = null;
  inviteFound = true;
});

describe('claimMembership (real Poseidon derivation)', () => {
  it('stores did_hash = Poseidon(commitment) so later check-ins re-derive the same value', async () => {
    const commitment = '12345678901234567890';
    const verify = jest.fn().mockResolvedValue(undefined);

    const out = await claimMembership(
      { companyId: 'co-1', inviteCode: 'ZA-AB23-CD45', did: DID, commitment, publicSignals: [commitment, '2', '3'] },
      verify,
    );

    // The nonce-bound verify is invoked with the parsed commitment bigint.
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0][0]).toBe(BigInt(commitment));

    const expectedDidHash = poseidon1([BigInt(commitment)]).toString(10);
    const insertedMeta = JSON.parse(String((lastInsertParams as unknown[])[8]));
    expect(insertedMeta.did_hash).toBe(expectedDidHash);
    expect(insertedMeta.commitment).toBe(BigInt(commitment).toString(10));
    // The membership row binds the same did_hash (UPDATE param index 3).
    expect((lastMembershipUpdateParams as unknown[])[3]).toBe(expectedDidHash);
    expect(out.userId).toBe('u-1');
  });

  it('rejects commitment_mismatch before the proof is verified', async () => {
    const verify = jest.fn().mockResolvedValue(undefined);
    await expect(claimMembership(
      { companyId: 'co-1', inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', publicSignals: ['999', '2', '3'] },
      verify,
    )).rejects.toMatchObject({ code: 'commitment_mismatch' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects invite_not_found_or_expired when no live invite matches (no proof work)', async () => {
    inviteFound = false;
    const verify = jest.fn().mockResolvedValue(undefined);
    await expect(claimMembership(
      { companyId: 'co-1', inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', publicSignals: ['111', '2', '3'] },
      verify,
    )).rejects.toMatchObject({ code: 'invite_not_found_or_expired' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('propagates a nonce/proof failure and rolls back — invite stays unconsumed', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('pairing_nonce_mismatch'));
    await expect(claimMembership(
      { companyId: 'co-1', inviteCode: 'ZA-AB23-CD45', did: DID, commitment: '111', publicSignals: ['111', '2', '3'] },
      verify,
    )).rejects.toThrow('pairing_nonce_mismatch');
    expect(lastInsertParams).toBeNull();
    expect(lastMembershipUpdateParams).toBeNull();
    const sqls = (mockClient.query as jest.Mock).mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /ROLLBACK/i.test(s))).toBe(true);
  });
});
