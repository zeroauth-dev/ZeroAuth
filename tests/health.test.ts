import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Health Endpoint', () => {
  it('GET /api/health returns healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.service).toBe('ZeroAuth');
    expect(res.body.message).toContain('Zero biometric data stored');
  });

  it('GET /api/health returns subsystem statuses', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.subsystems).toBeDefined();
    expect(res.body.subsystems.blockchain).toBeDefined();
    expect(res.body.subsystems.zkp).toBeDefined();
    expect(res.body.subsystems.zkp.protocol).toBe('groth16');
    expect(res.body.subsystems.zkp.curve).toBe('bn128');
    expect(res.body.subsystems.poseidon).toBeDefined();
  });

  it('GET / returns landing page HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('ZeroAuth');
  });
});
