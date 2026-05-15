/**
 * Integration tests for verifier/src/server.ts. Spins up the Express app
 * with supertest. No vkey is loaded (init is bypassed for these tests),
 * so the /verify response always carries structuralFallback: true. The
 * value of these tests is the HTTP shape — request validation, status
 * codes, response envelope.
 */

import request from 'supertest';
import { createApp } from '../src/server';
import { initVerifier } from '../src/groth16';
import { initAuditLog, _resetForTests } from '../src/audit-log';

const validProof = {
  proof: {
    pi_a: ['1', '2', '1'],
    pi_b: [['1', '2'], ['3', '4'], ['1', '0']],
    pi_c: ['5', '6', '1'],
    protocol: 'groth16',
    curve: 'bn128',
  },
  publicSignals: ['a', 'b', 'c'],
};

beforeAll(async () => {
  // Run in structural-fallback mode — no real vkey on disk.
  await initVerifier('nonexistent.json');
  // Audit log on an in-memory SQLite, so /verify can write rows.
  _resetForTests();
  initAuditLog(':memory:');
});

describe('verifier server — POST /verify', () => {
  const app = createApp();

  it('returns 200 with the expected envelope shape for a well-formed request', async () => {
    const res = await request(app).post('/verify').send(validProof);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      verified: expect.any(Boolean),
      verifierAuditId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      latencyMs: expect.any(Number),
      circuitVersion: 'v1',
      structuralFallback: true,
    });
  });

  it('400 invalid_request when proof is missing', async () => {
    const res = await request(app).post('/verify').send({ publicSignals: ['1', '2', '3'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('400 invalid_request when publicSignals is missing', async () => {
    const res = await request(app).post('/verify').send({ proof: validProof.proof });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('400 invalid_request when publicSignals length != 3', async () => {
    const res = await request(app).post('/verify').send({ proof: validProof.proof, publicSignals: ['only-two', 'x'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('400 invalid_request when publicSignals is not an array', async () => {
    const res = await request(app).post('/verify').send({ proof: validProof.proof, publicSignals: 'not-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('honors circuitVersion from the request body when provided', async () => {
    const res = await request(app)
      .post('/verify')
      .send({ ...validProof, circuitVersion: 'v2-experimental' });
    expect(res.status).toBe(200);
    expect(res.body.circuitVersion).toBe('v2-experimental');
  });

  it('issues a unique verifierAuditId per request', async () => {
    const r1 = await request(app).post('/verify').send(validProof);
    const r2 = await request(app).post('/verify').send(validProof);
    expect(r1.body.verifierAuditId).not.toBe(r2.body.verifierAuditId);
  });

  it('reports latencyMs as a non-negative number', async () => {
    const res = await request(app).post('/verify').send(validProof);
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects an empty body with 400', async () => {
    const res = await request(app).post('/verify').send({});
    expect(res.status).toBe(400);
  });
});

describe('verifier server — GET /health', () => {
  const app = createApp();

  it('returns the health envelope', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      version: expect.any(String),
      vkeyAvailable: expect.any(Boolean),
      uptimeSeconds: expect.any(Number),
    });
  });

  it('reports degraded + vkeyAvailable=false when no vkey was loaded', async () => {
    const res = await request(app).get('/health');
    // We bypassed real init with a nonexistent path
    expect(res.body.status).toBe('degraded');
    expect(res.body.vkeyAvailable).toBe(false);
  });

  it('uptimeSeconds is monotonic non-negative', async () => {
    const r1 = await request(app).get('/health');
    await new Promise(resolve => setTimeout(resolve, 1100));
    const r2 = await request(app).get('/health');
    expect(r2.body.uptimeSeconds).toBeGreaterThanOrEqual(r1.body.uptimeSeconds);
  });
});

describe('verifier server — unknown routes', () => {
  const app = createApp();

  it('404 on /unknown', async () => {
    const res = await request(app).get('/unknown');
    expect(res.status).toBe(404);
  });

  it('GET /verify is not allowed (no GET handler defined → 404)', async () => {
    const res = await request(app).get('/verify');
    expect(res.status).toBe(404);
  });
});
