/**
 * Verifies the service-mode path of src/services/zkp.ts (B02 Plan B).
 *
 * The other tests/zkp.test.ts file exercises the **inline fallback**
 * (VERIFIER_URL unset). This suite mocks `global.fetch` and sets
 * config.zkp.verifierUrl so the HTTP code path runs end-to-end. We
 * assert:
 *
 *   1. verifyBiometricProof POSTs to ${verifierUrl}/verify with the
 *      right shape
 *   2. A verifier `{verified: true}` response yields a verified result
 *   3. A verifier `{verified: false}` response yields rejected
 *   4. A non-2xx response yields rejected (no false positives if the
 *      verifier returns 500)
 *   5. A network error yields rejected
 *
 * This is the F-3-style "verify the seam exists" suite for the verifier
 * split. Once production rolls onto service mode (Friday Day 5), these
 * become the canonical zkp coverage and the inline tests can retire.
 */
import { config } from '../src/config';
import { verifyBiometricProof } from '../src/services/zkp';
import { createValidVerifyRequest } from './fixtures/proof';

describe('ZKP service-mode (B02 Plan B)', () => {
  const originalFetch = global.fetch;
  const originalVerifierUrl = config.zkp.verifierUrl;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    (config as any).zkp.verifierUrl = 'http://verifier-test:9999';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (config as any).zkp.verifierUrl = originalVerifierUrl;
    jest.clearAllMocks();
  });

  it('POSTs to ${verifierUrl}/verify with the correct shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        verified: true,
        verifierAuditId: 'audit-1',
        latencyMs: 7,
        circuitVersion: 'v1',
        structuralFallback: false,
      }),
    });

    const req = createValidVerifyRequest();
    await verifyBiometricProof(req);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://verifier-test:9999/verify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse((callArgs[1] as any).body);
    expect(body).toMatchObject({
      proof: req.proof,
      publicSignals: req.publicSignals,
      circuitVersion: 'v1',
      correlationId: req.nonce,
    });
  });

  it('returns verified: true when the verifier returns verified: true', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        verified: true,
        verifierAuditId: 'audit-2',
        latencyMs: 8,
        circuitVersion: 'v1',
        structuralFallback: false,
      }),
    });

    const result = await verifyBiometricProof(createValidVerifyRequest());
    expect(result.verified).toBe(true);
    expect(result.dataStored).toBe(false);
  });

  it('returns verified: false when the verifier returns verified: false', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        verified: false,
        verifierAuditId: 'audit-3',
        latencyMs: 6,
        circuitVersion: 'v1',
        structuralFallback: false,
      }),
    });

    const result = await verifyBiometricProof(createValidVerifyRequest());
    expect(result.verified).toBe(false);
  });

  it('returns verified: false when the verifier responds non-2xx (no false positives on 500)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'verifier_error' }),
    });

    const result = await verifyBiometricProof(createValidVerifyRequest());
    expect(result.verified).toBe(false);
  });

  it('returns verified: false on network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await verifyBiometricProof(createValidVerifyRequest());
    expect(result.verified).toBe(false);
  });
});
