import request from 'supertest';
import { createApp } from '../src/app';
import { verifyBiometricProof } from '../src/services/zkp';
import { v4 as uuidv4 } from 'uuid';
import { createValidProof, createValidPublicSignals, createValidVerifyRequest } from './fixtures/proof';

const app = createApp();

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

  describe('API: POST /api/auth/zkp/verify', () => {
    it('returns tokens on successful verification', async () => {
      const res = await request(app)
        .post('/api/auth/zkp/verify')
        .send(createValidVerifyRequest());
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.dataStorageConfirmation.biometricDataStored).toBe(false);
    });

    it('returns 401 on invalid proof structure', async () => {
      const res = await request(app)
        .post('/api/auth/zkp/verify')
        .send({
          proof: { pi_a: [], pi_b: [], pi_c: [], protocol: 'invalid', curve: 'wrong' },
          publicSignals: ['1', '2', '3'],
          nonce: uuidv4(),
          timestamp: new Date().toISOString(),
        });
      expect(res.status).toBe(401);
      expect(res.body.verified).toBe(false);
      expect(res.body.dataStored).toBe(false);
    });
  });

  describe('API: POST /api/auth/zkp/register', () => {
    it('returns 400 for missing biometricTemplate', async () => {
      const res = await request(app)
        .post('/api/auth/zkp/register')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.dataStored).toBe(false);
    });

    it('returns 400 for too-short biometric template', async () => {
      const res = await request(app)
        .post('/api/auth/zkp/register')
        .send({ biometricTemplate: Buffer.from('short').toString('base64') });
      expect(res.status).toBe(400);
      expect(res.body.dataStored).toBe(false);
    });
  });

  describe('API: GET /api/auth/zkp/nonce', () => {
    it('returns a nonce and timestamp', async () => {
      const res = await request(app).get('/api/auth/zkp/nonce');
      expect(res.status).toBe(200);
      expect(res.body.nonce).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.expiresIn).toBe(300);
    });
  });

  describe('API: GET /api/auth/zkp/circuit-info', () => {
    it('returns circuit metadata', async () => {
      const res = await request(app).get('/api/auth/zkp/circuit-info');
      expect(res.status).toBe(200);
      expect(res.body.circuit).toBe('identity_proof');
      expect(res.body.protocol).toBe('groth16');
      expect(res.body.curve).toBe('bn128');
      expect(res.body.publicInputs).toEqual(['commitment', 'didHash', 'identityBinding']);
      expect(res.body.privateInputs).toEqual(['biometricSecret', 'salt']);
    });
  });
});
