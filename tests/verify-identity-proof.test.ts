/**
 * Service-level test for proof-pairing.verifyIdentityProof — the function
 * behind POST /v1/identity/verify (A-02 close-out).
 *
 * The route-level test (tests/identity-verify-face.test.ts) mocks this
 * function wholesale, which hid a Critical found in review: the verifier must
 * look up the user by the `did` / `commitment` COLUMNS that
 * /v1/identity/register writes (registerFaceFirstIdentity), and derive
 * didHash = Poseidon(commitment) FRESH — not read a stored did_hash, and not
 * use the metadata-keyed findUserByDid the W3 submitProof path uses. This
 * drives the REAL function with real Poseidon + a SQL-dispatching pool mock so
 * the column lookup and the nonce binding are actually exercised.
 */
import { poseidon1, poseidon2 } from 'poseidon-lite';

const queryMock = jest.fn();
jest.mock('../src/services/db', () => ({ getPool: () => ({ query: queryMock }) }));
jest.mock('../src/services/platform', () => ({ recordAuditEvent: jest.fn(() => Promise.resolve()) }));
jest.mock('../src/services/zkp', () => ({ verifyProofOffChain: jest.fn(() => true) }));

import {
  verifyIdentityProof,
  PairingDidUnknown,
  PairingNonceMismatch,
  PairingSessionAlreadyBound,
  PairingSessionExpired,
} from '../src/services/proof-pairing';

const TENANT = 'tenant-A';
const ENV = 'live';
const DID = 'did:zeroauth:face:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b9d2e4f6a';
const CHALLENGE = 'chal-uuid-1';

// Commitment with hex letters so the stored bare-lowercase-hex form
// (registerFaceFirstIdentity: commitment.toLowerCase().replace(/^0x/,'')) is
// unambiguously parsed as hex by commitmentToField.
const COMMITMENT = BigInt('0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d');
const COMMITMENT_HEX = COMMITMENT.toString(16);   // the stored column value
const COMMITMENT_DEC = COMMITMENT.toString();     // snarkjs publicSignals[0]
const NONCE_HEX = 'ab'.repeat(31);                // 62 hex chars (31 bytes)
const NONCE_FIELD = BigInt('0x' + NONCE_HEX);
const DID_HASH = poseidon1([COMMITMENT]);
const EXPECTED_BINDING = poseidon2([DID_HASH, NONCE_FIELD]);

const PROOF = {
  pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'],
  protocol: 'groth16', curve: 'bn128',
};

function issuedSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CHALLENGE, tenant_id: TENANT, environment: ENV, state: 'issued',
    failure_count: 0, nonce_hex: NONCE_HEX,
    expires_at: new Date(Date.now() + 5 * 60_000), session_bind_token_hash: 'x',
    ...overrides,
  };
}

/** Dispatch getPool().query by SQL: session SELECT, user SELECT, consume
 *  UPDATE, failure-count UPDATE. Per-test overrides via `opts`. */
function wirePool(opts: {
  session?: Record<string, unknown> | null;
  user?: { id: string; commitment: string } | null;
} = {}) {
  const session = opts.session === undefined ? issuedSessionRow() : opts.session;
  const user = opts.user === undefined ? { id: 'user-1', commitment: COMMITMENT_HEX } : opts.user;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT * FROM proof_pairing_sessions')) {
      return { rows: session ? [session] : [] };
    }
    if (sql.includes('FROM tenant_users')) {
      return { rows: user ? [user] : [] };
    }
    if (sql.includes('UPDATE proof_pairing_sessions') && sql.includes("state = 'consumed'")) {
      return { rows: [issuedSessionRow({ state: 'consumed' })] };
    }
    if (sql.includes('UPDATE proof_pairing_sessions')) { // failure-count
      return { rows: [{ failure_count: 1 }] };
    }
    return { rows: [] };
  });
}

function publicSignals(binding: bigint = EXPECTED_BINDING): string[] {
  return [COMMITMENT_DEC, binding.toString(), '0'];
}

beforeEach(() => queryMock.mockReset());

describe('verifyIdentityProof — A-02 column lookup + Poseidon(commitment) binding', () => {
  it('REGRESSION (Findings 1+2): a correctly-bound proof for a column-registered user verifies', async () => {
    wirePool();
    const res = await verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals());
    expect(res).toEqual({ userId: 'user-1', did: DID });
    // The user lookup hit the COLUMN query, not the metadata blob.
    const userQuery = queryMock.mock.calls.find(c => String(c[0]).includes('FROM tenant_users'));
    expect(String(userQuery?.[0])).toMatch(/SELECT id, commitment FROM tenant_users/);
    expect(String(userQuery?.[0])).toMatch(/did = \$3/);
    expect(String(userQuery?.[0])).not.toMatch(/metadata/);
  });

  it('PairingNonceMismatch when publicSignals[1] is bound to a different nonce (replay/wrong-challenge)', async () => {
    wirePool();
    const wrong = poseidon2([DID_HASH, BigInt('0x' + 'cd'.repeat(31))]);
    await expect(
      verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals(wrong)),
    ).rejects.toBeInstanceOf(PairingNonceMismatch);
  });

  it('PairingDidUnknown when no column row resolves the DID', async () => {
    wirePool({ user: null });
    await expect(
      verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals()),
    ).rejects.toBeInstanceOf(PairingDidUnknown);
  });

  it('PairingDidUnknown (uniform, enumeration defence) on commitment mismatch', async () => {
    wirePool({ user: { id: 'user-1', commitment: (COMMITMENT + 1n).toString(16) } });
    await expect(
      verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals()),
    ).rejects.toBeInstanceOf(PairingDidUnknown);
  });

  it('PairingSessionAlreadyBound on a consumed challenge (replay of a spent challenge)', async () => {
    wirePool({ session: issuedSessionRow({ state: 'consumed' }) });
    await expect(
      verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals()),
    ).rejects.toBeInstanceOf(PairingSessionAlreadyBound);
  });

  it('PairingSessionExpired on an expired challenge', async () => {
    wirePool({ session: issuedSessionRow({ expires_at: new Date(Date.now() - 1000) }) });
    await expect(
      verifyIdentityProof(CHALLENGE, TENANT, ENV, DID, PROOF as never, publicSignals()),
    ).rejects.toBeInstanceOf(PairingSessionExpired);
  });
});
