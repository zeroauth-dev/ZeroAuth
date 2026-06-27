/**
 * K-1 close-out: the legacy /api/auth/zkp/* surface is an unauthenticated
 * demo stub whose /register ingests a raw base64 biometricTemplate and derives
 * the commitment server-side — the literal "raw-biometric path" the master
 * plan §10 names as a kill-signal. It is now gated behind ENABLE_DEMO_AUTH, so
 * in a production-shaped config (flag off) the raw-biometric ingress is
 * unreachable (503), while it stays available for the W3 demo + local tests
 * (where ENABLE_DEMO_AUTH defaults on).
 *
 * config.enableDemoAuth is resolved once at module load, so we set the env and
 * load a fresh app module graph in beforeAll.
 */
import request from 'supertest';
import type { Express } from 'express';

describe('K-1: legacy /api/auth/zkp is gated off in production config', () => {
  let app: Express;
  const prev = process.env.ENABLE_DEMO_AUTH;

  beforeAll(() => {
    process.env.ENABLE_DEMO_AUTH = 'false';
    jest.resetModules();
    // Load a fresh app graph AFTER setting the env so config.enableDemoAuth
    // resolves to false (it is computed once at module load).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app = (require('../src/app') as typeof import('../src/app')).createApp();
  });

  afterAll(() => {
    if (prev === undefined) delete process.env.ENABLE_DEMO_AUTH;
    else process.env.ENABLE_DEMO_AUTH = prev;
    jest.resetModules();
  });

  it('POST /api/auth/zkp/register -> 503 demo_auth_disabled (no raw-bio ingress)', async () => {
    const res = await request(app)
      .post('/api/auth/zkp/register')
      .send({ biometricTemplate: Buffer.from('x'.repeat(32)).toString('base64') });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('demo_auth_disabled');
  });

  it('the gated response still advertises Deprecation + Sunset + the successor', async () => {
    const res = await request(app).post('/api/auth/zkp/register').send({});
    expect(res.headers['deprecation']).toBe('true');
    expect(res.headers['sunset']).toBeDefined();
    expect(res.headers['link']).toContain('/v1/identity/register');
  });

  it('POST /api/auth/zkp/verify is gated off too', async () => {
    const res = await request(app).post('/api/auth/zkp/verify').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('demo_auth_disabled');
  });
});
