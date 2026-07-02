import { verifyBiometricProof } from '../src/services/zkp';
import { v4 as uuidv4 } from 'uuid';
import { createValidProof, createValidPublicSignals } from './fixtures/proof';

// Service-level coverage for verifyBiometricProof — the verifier behind the
// deprecated-but-contracted /v1/auth/zkp/verify surface (Sunset 2026-12-31).
// The legacy /api/auth/zkp/* demo routes were removed in the dead-API sweep;
// request-level coverage for the surviving surface lives in
// tests/biometric-rejection.test.ts.
describe('ZKP Biometric Verification', () => {
  describe('Service: verifyBiometricProof', () => {
    it('returns verified: true for valid Groth16 proof structure', async () => {
      const result = await verifyBiometricProof({
        proof: createValidProof(),
        publicSignals: createValidPublicSignals(),
        nonce: uuidv4(),
        timestamp: new Date().toISOString(),
      });
      expect(result.verified).toBe(true);
      expect(result.dataStored).toBe(false);
      expect(result.sessionId).toBeDefined();
    });

    it('returns verified: false for missing fields', async () => {
      const result = await verifyBiometricProof({
        proof: {} as any,
        publicSignals: [] as any,
        nonce: '',
        timestamp: '',
      });
      expect(result.verified).toBe(false);
      expect(result.dataStored).toBe(false);
    });

    it('returns verified: false for expired timestamp', async () => {
      const oldDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const result = await verifyBiometricProof({
        proof: createValidProof(),
        publicSignals: createValidPublicSignals(),
        nonce: uuidv4(),
        timestamp: oldDate,
      });
      expect(result.verified).toBe(false);
      expect(result.dataStored).toBe(false);
    });

    it('returns verified: false for invalid nonce format', async () => {
      const result = await verifyBiometricProof({
        proof: createValidProof(),
        publicSignals: createValidPublicSignals(),
        nonce: 'not-a-uuid',
        timestamp: new Date().toISOString(),
      });
      expect(result.verified).toBe(false);
      expect(result.dataStored).toBe(false);
    });

    it('returns verified: false for wrong publicSignals count', async () => {
      const result = await verifyBiometricProof({
        proof: createValidProof(),
        publicSignals: ['1', '2'] as any,
        nonce: uuidv4(),
        timestamp: new Date().toISOString(),
      });
      expect(result.verified).toBe(false);
      expect(result.dataStored).toBe(false);
    });

    it('NEVER stores biometric data (dataStored is always false)', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await verifyBiometricProof({
          proof: createValidProof(),
          publicSignals: createValidPublicSignals(),
          nonce: uuidv4(),
          timestamp: new Date().toISOString(),
        });
        expect(result.dataStored).toBe(false);
      }
    });
  });
});
