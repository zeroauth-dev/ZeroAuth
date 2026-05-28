/**
 * Tests for the production device-enrollment flow (ADR 0022).
 *
 * Two layers covered here:
 *
 *   1. Pure helpers in `src/services/device-enrollment.ts`:
 *      code generation, normalisation, fingerprint hashing,
 *      fingerprint validation.
 *
 *   2. Service-layer functions in `src/services/platform.ts` that
 *      orchestrate the pending → enrolled → revoked state machine:
 *      `issueEnrollmentCode`, `claimDeviceWithCode`,
 *      `regenerateEnrollmentCode`, `revokeDevice`.
 *
 * The db pool is mocked so no Postgres is required. The audit-log
 * appender is silenced because it would otherwise queue an
 * appendAuditEvent against the mocked pool and warn into the test
 * logs.
 */

// db pool mock — set up before importing the service modules.
const mockQuery = jest.fn();
const mockConnect = jest.fn(() => ({
  query: mockQuery,
  release: jest.fn(),
}));
jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery, connect: mockConnect }),
}));

// Silence the audit-log appender — the tests assert the service-level
// behaviour, not the audit-row content (which is covered by
// tests/audit-chain.test.ts).
jest.mock('../src/services/audit', () => ({
  appendAuditEvent: jest.fn().mockResolvedValue(undefined),
}));

import {
  ENROLLMENT_CODE_TTL_MS,
  fingerprintHash,
  generateEnrollmentCode,
  isValidFingerprint,
  normaliseEnrollmentCode,
  sha256Hex,
} from '../src/services/device-enrollment';
import {
  claimDeviceWithCode,
  EnrollmentClaimError,
  issueEnrollmentCode,
  regenerateEnrollmentCode,
  revokeDevice,
} from '../src/services/platform';

describe('generateEnrollmentCode', () => {
  it('returns the documented ZA-XXXX-XXXX format', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateEnrollmentCode();
      expect(code).toMatch(/^ZA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    }
  });

  it('excludes visually ambiguous symbols (0, 1, I, L, O, U)', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateEnrollmentCode();
      expect(code).not.toMatch(/[01ILOU]/);
    }
  });

  it('produces distinct codes across 200 draws (uniqueness sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateEnrollmentCode());
    // log2(27^8) ≈ 38 bits — birthday probability of any collision
    // in 200 draws is ~2^(-25). One collision = test failure here.
    expect(seen.size).toBe(200);
  });
});

describe('normaliseEnrollmentCode', () => {
  it('accepts the canonical form unchanged', () => {
    expect(normaliseEnrollmentCode('ZA-AB23-CD45')).toBe('ZA-AB23-CD45');
  });

  it('uppercases lowercase input', () => {
    expect(normaliseEnrollmentCode('za-ab23-cd45')).toBe('ZA-AB23-CD45');
  });

  it('re-inserts hyphens when the operator types them out', () => {
    expect(normaliseEnrollmentCode('ZAAB23CD45')).toBe('ZA-AB23-CD45');
  });

  it('strips whitespace anywhere in the input', () => {
    expect(normaliseEnrollmentCode(' ZA-AB23 -CD45 ')).toBe('ZA-AB23-CD45');
  });

  it('returns malformed input as-is (causes hash-compare to fail downstream)', () => {
    expect(normaliseEnrollmentCode('not-a-code')).toBe('NOTACODE');
  });
});

describe('sha256Hex', () => {
  it('produces 64 lowercase hex characters', () => {
    expect(sha256Hex('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('foo')).toBe(sha256Hex('foo'));
  });

  it('matches the canonical RFC 6234 test vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('fingerprintHash + isValidFingerprint', () => {
  it('rejects fingerprints below 16 chars', () => {
    expect(isValidFingerprint('short')).toBe(false);
    expect(isValidFingerprint('012345678901234')).toBe(false); // 15 chars
  });

  it('accepts fingerprints at 16 chars and above', () => {
    expect(isValidFingerprint('a'.repeat(16))).toBe(true);
    expect(isValidFingerprint('a'.repeat(1024))).toBe(true);
  });

  it('rejects fingerprints above the 4096-char ceiling', () => {
    expect(isValidFingerprint('a'.repeat(4097))).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidFingerprint(undefined)).toBe(false);
    expect(isValidFingerprint(null)).toBe(false);
    expect(isValidFingerprint(12345)).toBe(false);
    expect(isValidFingerprint({})).toBe(false);
  });

  it('hash is deterministic across calls with the same input', () => {
    const fp = 'android_id:abcdef1234567890|installation:00112233';
    expect(fingerprintHash(fp)).toBe(fingerprintHash(fp));
  });
});

describe('issueEnrollmentCode', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset().mockReturnValue({ query: mockQuery, release: jest.fn() });
  });

  it('inserts a pending row and returns the plaintext code + expiry', async () => {
    const fakeRow = {
      id: 'dev-1',
      tenant_id: 't-1',
      environment: 'live',
      name: 'Branch kiosk #1',
      device_type: 'kiosk',
      enrollment_state: 'pending',
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow], rowCount: 1 });

    const before = Date.now();
    const invite = await issueEnrollmentCode(
      't-1',
      'live',
      { name: 'Branch kiosk #1', deviceType: 'kiosk' },
      { type: 'console', id: 't-1', email: 'admin@example.com' },
    );
    const after = Date.now();

    expect(invite.device).toBe(fakeRow);
    expect(invite.enrollmentCode).toMatch(/^ZA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const expiryMs = invite.expiresAt.getTime();
    expect(expiryMs).toBeGreaterThanOrEqual(before + ENROLLMENT_CODE_TTL_MS - 100);
    expect(expiryMs).toBeLessThanOrEqual(after + ENROLLMENT_CODE_TTL_MS + 100);

    // The INSERT call should carry the SHA-256 of the code, NEVER
    // the plaintext code.
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(sha256Hex(invite.enrollmentCode));
    expect(params).not.toContain(invite.enrollmentCode);
  });

  it('rejects an unknown device_type at the service layer', async () => {
    await expect(
      issueEnrollmentCode(
        't-1',
        'live',
        { name: 'Whatever', deviceType: 'toaster' as unknown as 'kiosk' },
      ),
    ).rejects.toThrow(/invalid device_type/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('claimDeviceWithCode', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset().mockReturnValue({ query: mockQuery, release: jest.fn() });
  });

  const goodFingerprint = 'android_id:abcdef1234567890|installation:00112233';

  it('happy path: looks up pending row by hash, binds fingerprint, flips to enrolled', async () => {
    const code = 'ZA-TEST-CODE';
    const pendingRow = {
      id: 'dev-1',
      tenant_id: 't-1',
      environment: 'live',
      name: 'Branch kiosk #1',
      device_type: 'kiosk',
      enrollment_state: 'pending',
    };
    const enrolledRow = { ...pendingRow, enrollment_state: 'enrolled' };

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [pendingRow], rowCount: 1 })   // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })             // collision check
      .mockResolvedValueOnce({ rows: [enrolledRow], rowCount: 1 })  // UPDATE
      .mockResolvedValueOnce({ rows: [] });                         // COMMIT

    const device = await claimDeviceWithCode({
      enrollmentCode: code,
      fingerprint: goodFingerprint,
    });

    expect(device.enrollment_state).toBe('enrolled');
    // The SELECT used the SHA-256 of the *normalised* code.
    const selectParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(selectParams[0]).toBe(sha256Hex(normaliseEnrollmentCode(code)));
  });

  it('throws invalid_fingerprint when fingerprint is too short', async () => {
    await expect(
      claimDeviceWithCode({ enrollmentCode: 'ZA-AB23-CD45', fingerprint: 'short' }),
    ).rejects.toBeInstanceOf(EnrollmentClaimError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('throws code_not_found_or_expired when no pending row matches', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                          // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })             // SELECT → empty
      .mockResolvedValueOnce({ rows: [] });                         // ROLLBACK

    try {
      await claimDeviceWithCode({ enrollmentCode: 'ZA-BAD0-WRNG', fingerprint: goodFingerprint });
      throw new Error('expected claim to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnrollmentClaimError);
      expect((err as EnrollmentClaimError).reason).toBe('code_not_found_or_expired');
    }
  });

  it('throws fingerprint_collision when another row already has the same fingerprint', async () => {
    const pendingRow = {
      id: 'dev-2',
      tenant_id: 't-1',
      environment: 'live',
      name: 'New kiosk',
      device_type: 'kiosk',
      enrollment_state: 'pending',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                            // BEGIN
      .mockResolvedValueOnce({ rows: [pendingRow], rowCount: 1 })                     // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'dev-other' }], rowCount: 1 })            // collision
      .mockResolvedValueOnce({ rows: [] });                                           // ROLLBACK

    try {
      await claimDeviceWithCode({ enrollmentCode: 'ZA-AB23-CD45', fingerprint: goodFingerprint });
      throw new Error('expected claim to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EnrollmentClaimError);
      expect((err as EnrollmentClaimError).reason).toBe('fingerprint_collision');
    }
  });
});

describe('regenerateEnrollmentCode', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset().mockReturnValue({ query: mockQuery, release: jest.fn() });
  });

  it('returns the new code on success and writes a fresh hash', async () => {
    const row = {
      id: 'dev-1',
      tenant_id: 't-1',
      environment: 'live',
      name: 'Kiosk',
      device_type: 'kiosk',
      enrollment_state: 'pending',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    const invite = await regenerateEnrollmentCode(
      't-1',
      'live',
      'dev-1',
      { type: 'console', id: 't-1', email: 'admin@example.com' },
    );
    expect(invite).not.toBeNull();
    expect(invite!.enrollmentCode).toMatch(/^ZA-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(sha256Hex(invite!.enrollmentCode));
  });

  it('returns null when no pending row matches (404 path)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const invite = await regenerateEnrollmentCode('t-1', 'live', 'dev-bad');
    expect(invite).toBeNull();
  });
});

describe('revokeDevice', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset().mockReturnValue({ query: mockQuery, release: jest.fn() });
  });

  it('sets enrollment_state=revoked and status=retired on the row', async () => {
    const row = {
      id: 'dev-1',
      tenant_id: 't-1',
      environment: 'live',
      name: 'Kiosk',
      device_type: 'kiosk',
      enrollment_state: 'revoked',
      status: 'retired',
    };
    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    const result = await revokeDevice('t-1', 'live', 'dev-1');
    expect(result).toBe(row);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/enrollment_state = 'revoked'/);
    expect(sql).toMatch(/status = 'retired'/);
    expect(sql).toMatch(/enrollment_code_hash = NULL/);
  });

  it('returns null when the device id is unknown', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await revokeDevice('t-1', 'live', 'nope');
    expect(result).toBeNull();
  });
});
