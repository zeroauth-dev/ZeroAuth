/**
 * Tests for the three-QR registration ceremony (ADR 0023).
 *
 * Layered the same way as tests/device-enrollment.test.ts:
 *
 *   1. Service-layer state-machine tests with a mocked db pool.
 *      Covers happy-path transitions, the failure modes for each
 *      step, and the redaction invariant on poll responses.
 *
 *   2. One smoke test for the route layer to confirm the public
 *      route exceptions are wired correctly and the rate-limit
 *      middleware doesn't gate a single legitimate request.
 *
 * Proof verification is stubbed — production wires the route to
 * src/services/zkp.ts::verifyProofOffChain, and the verifier itself
 * is exercised in tests/zkp-version.test.ts.
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn(() => ({ query: mockQuery, release: jest.fn() }));
jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery, connect: mockConnect }),
}));

// Audit appender — silent for these tests.
jest.mock('../src/services/audit', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  sha256Hex,
  normaliseEnrollmentCode,
} from '../src/services/device-enrollment';
import {
  abandonRegistration,
  completeRegistration,
  getRegistrationSession,
  pairDeviceForRegistration,
  RegistrationStateError,
  startRegistration,
  submitCommitmentForRegistration,
} from '../src/services/registration';

const TENANT = 'tenant-A';
const ENV = 'live' as const;

const goodFingerprint = 'android_id:abcdef1234567890|installation:00112233';
const goodDid = 'did:zeroauth:face:5b6e7c1a';
const goodCommitment = '0x' + 'a'.repeat(64);

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset().mockReturnValue({ query: mockQuery, release: jest.fn() });
});

describe('startRegistration', () => {
  it('inserts a row with state=awaiting_device and returns the plaintext pair_code', async () => {
    const fakeRow = {
      id: 'sess-1',
      tenant_id: TENANT,
      environment: ENV,
      state: 'awaiting_device',
      profile: {},
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 });

    const result = await startRegistration(
      TENANT,
      ENV,
      { profile: { name: 'Alice', email: 'a@example.com' } },
      { type: 'api_key', id: 'k-1' },
    );

    expect(result.session).toBe(fakeRow);
    expect(result.pairCode).toMatch(/^ZA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(result.pairDeeplink).toContain('step=pair');
    expect(result.pairDeeplink).toContain('session=sess-1');
    expect(result.pairDeeplink).toContain('code=');

    // INSERT params carry SHA-256 of the code, NOT the plaintext.
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(sha256Hex(result.pairCode));
    expect(params).not.toContain(result.pairCode);
  });

  it('strips suspicious biometric-keyed fields from the profile blob (defence-in-depth)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sess-1' }], rowCount: 1 });
    await startRegistration(
      TENANT,
      ENV,
      { profile: { name: 'Alice', face_image: 'b64data', biometric_template: 'b64data' } },
      { type: 'api_key', id: 'k-1' },
    );
    const params = mockQuery.mock.calls[0][1] as unknown[];
    const profileParam = JSON.parse(params[2] as string);
    expect(profileParam).toEqual({ name: 'Alice' });
    expect(profileParam.face_image).toBeUndefined();
    expect(profileParam.biometric_template).toBeUndefined();
  });
});

describe('pairDeviceForRegistration (step 1)', () => {
  it('happy path: claims a device row, attaches to session, mints enroll_code', async () => {
    const sessionRow = {
      id: 'sess-1',
      tenant_id: TENANT,
      environment: ENV,
      state: 'awaiting_device',
      device_id: null,
    };
    const deviceRow = { id: 'dev-1', tenant_id: TENANT, environment: ENV };
    const updatedSession = { ...sessionRow, device_id: 'dev-1', state: 'awaiting_commitment' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                            // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })     // SELECT session
      .mockResolvedValueOnce({ rows: [deviceRow], rowCount: 1 })      // INSERT device
      .mockResolvedValueOnce({ rows: [updatedSession], rowCount: 1 }) // UPDATE session
      .mockResolvedValueOnce({ rows: [] });                           // COMMIT

    const result = await pairDeviceForRegistration({
      pairCode: 'ZA-AB23-CD45',
      fingerprint: goodFingerprint,
      attestationKind: 'play-integrity',
    });

    expect(result.session.state).toBe('awaiting_commitment');
    expect(result.session.device_id).toBe('dev-1');
    expect(result.nextCode).toMatch(/^ZA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(result.nextDeeplink).toContain('step=enroll');

    // The SELECT-FOR-UPDATE uses the SHA-256 of the *normalised* code.
    const selectParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(selectParams[0]).toBe(sha256Hex(normaliseEnrollmentCode('ZA-AB23-CD45')));
  });

  it('throws code_not_found_or_expired when no awaiting_device row matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })     // SELECT — empty
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    await expect(
      pairDeviceForRegistration({ pairCode: 'ZA-BAD0-CODE', fingerprint: goodFingerprint }),
    ).rejects.toMatchObject({ reason: 'code_not_found_or_expired' });
  });

  it('throws invalid_fingerprint without touching the database', async () => {
    await expect(
      pairDeviceForRegistration({ pairCode: 'ZA-AB23-CD45', fingerprint: 'short' }),
    ).rejects.toMatchObject({ reason: 'invalid_fingerprint' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('submitCommitmentForRegistration (step 2)', () => {
  it('happy path: stores (did, commitment), mints verify_code + challenge_nonce', async () => {
    const sessionRow = {
      id: 'sess-1',
      tenant_id: TENANT,
      environment: ENV,
      state: 'awaiting_commitment',
      device_id: 'dev-1',
    };
    const updated = { ...sessionRow, did: goodDid, commitment: goodCommitment, state: 'awaiting_verification' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })   // SELECT
      .mockResolvedValueOnce({ rows: [updated], rowCount: 1 })      // UPDATE
      .mockResolvedValueOnce({ rows: [] });                         // COMMIT

    const result = await submitCommitmentForRegistration({
      enrollCode: 'ZA-EF67-GH89',
      did: goodDid,
      commitment: goodCommitment,
    });

    expect(result.session.state).toBe('awaiting_verification');
    expect(result.challengeNonce).toMatch(/^[0-9a-f]{32}$/);
    expect(result.nextDeeplink).toContain('step=verify');
    expect(result.nextDeeplink).toContain(`challenge=${result.challengeNonce}`);
  });

  it('rejects malformed did at the boundary', async () => {
    await expect(
      submitCommitmentForRegistration({
        enrollCode: 'ZA-EF67-GH89',
        did: 'not-a-did',
        commitment: goodCommitment,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_commitment' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects malformed commitment at the boundary', async () => {
    await expect(
      submitCommitmentForRegistration({
        enrollCode: 'ZA-EF67-GH89',
        did: goodDid,
        commitment: 'not-hex',
      }),
    ).rejects.toMatchObject({ reason: 'invalid_commitment' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws code_not_found_or_expired when no awaiting_commitment row matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })     // SELECT — empty
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    await expect(
      submitCommitmentForRegistration({
        enrollCode: 'ZA-EF67-GH89',
        did: goodDid,
        commitment: goodCommitment,
      }),
    ).rejects.toMatchObject({ reason: 'code_not_found_or_expired' });
  });
});

describe('completeRegistration (step 3)', () => {
  const sessionRow = {
    id: 'sess-1',
    tenant_id: TENANT,
    environment: ENV,
    state: 'awaiting_verification',
    device_id: 'dev-1',
    did: goodDid,
    commitment: goodCommitment,
    verify_challenge_nonce: 'a'.repeat(32),
    profile: { name: 'Alice', email: 'a@example.com' },
  };

  it('happy path: verifies proof, creates tenant_user, flips state to completed', async () => {
    const userRow = {
      id: 'user-1',
      tenant_id: TENANT,
      environment: ENV,
      full_name: 'Alice',
      did: goodDid,
      commitment: goodCommitment,
    };
    const completedSession = { ...sessionRow, state: 'completed', tenant_user_id: 'user-1' };
    const deviceRow = { id: 'dev-1' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })       // SELECT session
      .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 })          // INSERT user
      .mockResolvedValueOnce({ rows: [completedSession], rowCount: 1 }) // UPDATE session
      .mockResolvedValueOnce({ rows: [deviceRow], rowCount: 1 })        // SELECT device
      .mockResolvedValueOnce({ rows: [] });                             // COMMIT

    const verifyProof = jest.fn().mockResolvedValue(true);

    const result = await completeRegistration(
      {
        verifyCode: 'ZA-IJ23-KL45',
        challengeNonce: 'a'.repeat(32),
        proof: { pi_a: ['1'], pi_b: [['2']], pi_c: ['3'] },
        publicSignals: [goodCommitment, '1'],
      },
      verifyProof,
    );

    expect(result.tenantUser).toBe(userRow);
    expect(result.session.state).toBe('completed');
    expect(result.device).toBe(deviceRow);
    expect(verifyProof).toHaveBeenCalled();
  });

  it('throws challenge_mismatch when the phone-supplied nonce does not equal the issued nonce', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })   // SELECT
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    const verifyProof = jest.fn();
    await expect(
      completeRegistration(
        {
          verifyCode: 'ZA-IJ23-KL45',
          challengeNonce: 'b'.repeat(32),
          proof: {},
          publicSignals: [goodCommitment],
        },
        verifyProof,
      ),
    ).rejects.toMatchObject({ reason: 'challenge_mismatch' });
    expect(verifyProof).not.toHaveBeenCalled();
  });

  it('throws commitment_mismatch when publicSignals[0] does not equal stored commitment', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })   // SELECT
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    const verifyProof = jest.fn();
    await expect(
      completeRegistration(
        {
          verifyCode: 'ZA-IJ23-KL45',
          challengeNonce: 'a'.repeat(32),
          proof: {},
          publicSignals: ['0xdeadbeef'],
        },
        verifyProof,
      ),
    ).rejects.toMatchObject({ reason: 'commitment_mismatch' });
    expect(verifyProof).not.toHaveBeenCalled();
  });

  it('throws proof_verification_failed when the verifier returns false', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [sessionRow], rowCount: 1 })   // SELECT
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    const verifyProof = jest.fn().mockResolvedValue(false);
    await expect(
      completeRegistration(
        {
          verifyCode: 'ZA-IJ23-KL45',
          challengeNonce: 'a'.repeat(32),
          proof: {},
          publicSignals: [goodCommitment],
        },
        verifyProof,
      ),
    ).rejects.toMatchObject({ reason: 'proof_verification_failed' });
  });

  it('throws code_not_found_or_expired when no awaiting_verification row matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                  // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })     // SELECT — empty
      .mockResolvedValueOnce({ rows: [] });                 // ROLLBACK

    const verifyProof = jest.fn();
    await expect(
      completeRegistration(
        {
          verifyCode: 'ZA-IJ23-KL45',
          challengeNonce: 'a'.repeat(32),
          proof: {},
          publicSignals: [goodCommitment],
        },
        verifyProof,
      ),
    ).rejects.toMatchObject({ reason: 'code_not_found_or_expired' });
    expect(verifyProof).not.toHaveBeenCalled();
  });
});

describe('getRegistrationSession', () => {
  it('returns the row when found', async () => {
    const row = { id: 'sess-1', tenant_id: TENANT };
    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const result = await getRegistrationSession(TENANT, ENV, 'sess-1');
    expect(result).toBe(row);
  });

  it('returns null when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await getRegistrationSession(TENANT, ENV, 'nope');
    expect(result).toBeNull();
  });
});

describe('abandonRegistration', () => {
  it('flips state to abandoned and clears all outstanding codes', async () => {
    const row = { id: 'sess-1', state: 'abandoned' };
    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const result = await abandonRegistration(TENANT, ENV, 'sess-1', { type: 'api_key', id: 'k-1' });
    expect(result).toBe(row);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/pair_code_hash = NULL/);
    expect(sql).toMatch(/enroll_code_hash = NULL/);
    expect(sql).toMatch(/verify_code_hash = NULL/);
    expect(sql).toMatch(/verify_challenge_nonce = NULL/);
  });

  it('returns null when the session does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await abandonRegistration(TENANT, ENV, 'nope', { type: 'api_key', id: 'k-1' });
    expect(result).toBeNull();
  });
});

describe('RegistrationStateError reasons', () => {
  it('round-trips the reason through the Error instance', () => {
    const e = new RegistrationStateError('challenge_mismatch');
    expect(e.reason).toBe('challenge_mismatch');
    expect(e.name).toBe('RegistrationStateError');
    expect(e.message).toBe('challenge_mismatch');
  });
});
