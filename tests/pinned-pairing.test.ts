/**
 * Service-level test for the expected_did PINNING in
 * proof-pairing.submitProof — the invariant behind the bank 2FA push:
 * a pairing session opened by a password login carries the account's
 * bound DID, and ONLY a proof presenting that DID may proceed past the
 * session checks. Any other enrolled identity gets the uniform
 * PairingDidUnknown (A-25) and never reaches the user lookup.
 *
 * Drives the REAL submitProof with a SQL-dispatching pool mock
 * (harness pattern: tests/verify-identity-proof.test.ts).
 */
import crypto from 'crypto';

const queryMock = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: queryMock }) }));
jest.mock('../src/services/platform', () => ({ recordAuditEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/services/zkp', () => ({ verifyProofOffChain: jest.fn(() => true) }));

import { submitProof, PairingDidUnknown } from '../src/services/proof-pairing';

const TENANT = 'tenant-demo';
const PINNED_DID = 'did:zeroauth:face:' + 'aa'.repeat(20);
const OTHER_DID = 'did:zeroauth:face:' + 'bb'.repeat(20);
const SESSION = 'sess-uuid-1';
const BIND_TOKEN = 'bind-token-plaintext';
const NONCE_HEX = 'ab'.repeat(31);

const PROOF = {
  pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'],
  protocol: 'groth16', curve: 'bn128',
} as never;

function sessionRow(expectedDid: string | null) {
  return {
    id: SESSION, tenant_id: TENANT, environment: 'live', state: 'issued',
    failure_count: 0, nonce_hex: NONCE_HEX,
    session_bind_token_hash: crypto.createHash('sha256').update(BIND_TOKEN).digest('hex'),
    expires_at: new Date(Date.now() + 5 * 60_000),
    expected_did: expectedDid,
  };
}

function wirePool(expectedDid: string | null) {
  const calls: string[] = [];
  queryMock.mockImplementation(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('security_policy')) return { rows: [{ security_policy: {} }] };
    if (sql.includes('SELECT * FROM proof_pairing_sessions')) return { rows: [sessionRow(expectedDid)] };
    if (sql.includes('tenant_users')) return { rows: [] }; // user lookup — empty (we stop the flow here)
    return { rows: [] }; // failure-count UPDATE etc.
  });
  return calls;
}

function userLookupRan(calls: string[]): boolean {
  return calls.some(sql => sql.includes('tenant_users'));
}

beforeEach(() => queryMock.mockReset());

describe('submitProof — expected_did pinning (bank 2FA step-up)', () => {
  it('REJECTS a different enrolled DID BEFORE the user lookup (uniform PairingDidUnknown)', async () => {
    const calls = wirePool(PINNED_DID);
    await expect(
      submitProof(SESSION, TENANT, 'live', OTHER_DID, PROOF, ['1', '2', '3'], {}, BIND_TOKEN),
    ).rejects.toBeInstanceOf(PairingDidUnknown);
    expect(userLookupRan(calls)).toBe(false);
  });

  it('lets the PINNED DID through to the user lookup', async () => {
    const calls = wirePool(PINNED_DID);
    // user lookup returns empty → still PairingDidUnknown, but the pin
    // gate itself passed: the tenant_users query ran.
    await expect(
      submitProof(SESSION, TENANT, 'live', PINNED_DID, PROOF, ['1', '2', '3'], {}, BIND_TOKEN),
    ).rejects.toBeInstanceOf(PairingDidUnknown);
    expect(userLookupRan(calls)).toBe(true);
  });

  it('unpinned sessions (expected_did NULL) keep the existing open behavior', async () => {
    const calls = wirePool(null);
    await expect(
      submitProof(SESSION, TENANT, 'live', OTHER_DID, PROOF, ['1', '2', '3'], {}, BIND_TOKEN),
    ).rejects.toBeInstanceOf(PairingDidUnknown);
    expect(userLookupRan(calls)).toBe(true); // reached the lookup — no pin gate
  });
});
