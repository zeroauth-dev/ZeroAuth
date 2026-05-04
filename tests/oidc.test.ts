import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('OIDC Endpoints', () => {
  it('GET /api/auth/oidc/authorize returns authorization URL', async () => {
    const res = await request(app).get('/api/auth/oidc/authorize');
    expect(res.status).toBe(200);
    expect(res.body.authorizeUrl).toBeDefined();
    expect(res.body.state).toBeDefined();
    expect(res.body.authorizeUrl).toContain('response_type=code');
    expect(res.body.authorizeUrl).toContain('code_challenge');
  });

  it('POST /api/auth/oidc/callback returns 400 without code', async () => {
    const res = await request(app)
      .post('/api/auth/oidc/callback')
      .send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/auth/oidc/callback returns 400 with invalid state', async () => {
    const res = await request(app)
      .post('/api/auth/oidc/callback')
      .send({ code: 'mock-code', state: 'invalid-state' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('state');
  });

  it('POST /api/auth/oidc/callback succeeds with valid state', async () => {
    // First get a valid state
    const authRes = await request(app).get('/api/auth/oidc/authorize');
    const state = authRes.body.state;

    const res = await request(app)
      .post('/api/auth/oidc/callback')
      .send({ code: 'mock-code', state });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.provider).toBe('oidc');
    expect(res.body.dataStorageConfirmation.biometricDataStored).toBe(false);
  });

  it('GET .well-known/openid-configuration returns discovery doc', async () => {
    const res = await request(app)
      .get('/api/auth/oidc/.well-known/openid-configuration');
    expect(res.status).toBe(200);
    expect(res.body.issuer).toBeDefined();
    expect(res.body.authorization_endpoint).toBeDefined();
    expect(res.body.token_endpoint).toBeDefined();
    expect(res.body.scopes_supported).toContain('openid');
  });
});
