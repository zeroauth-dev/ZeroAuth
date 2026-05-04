import request from 'supertest';
import { createApp } from '../src/app';
import { issueTokens, verifyToken } from '../src/services/jwt';
import { v4 as uuidv4 } from 'uuid';
import { createValidVerifyRequest } from './fixtures/proof';

const app = createApp();

describe('JWT Token Service', () => {
  it('issues valid access and refresh tokens', () => {
    const tokens = issueTokens({
      sub: 'test-user',
      email: 'test@example.com',
      provider: 'zkp',
      verified: true,
      sessionId: uuidv4(),
    });

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresIn).toBeGreaterThan(0);
  });

  it('verifies a valid token', () => {
    const sessionId = uuidv4();
    const tokens = issueTokens({
      sub: 'test-user',
      email: 'test@example.com',
      provider: 'oidc',
      verified: true,
      sessionId,
    });

    const payload = verifyToken(tokens.accessToken);
    expect(payload.sub).toBe('test-user');
    expect(payload.email).toBe('test@example.com');
    expect(payload.provider).toBe('oidc');
    expect(payload.verified).toBe(true);
    expect(payload.sessionId).toBe(sessionId);
  });

  it('throws on invalid token', () => {
    expect(() => verifyToken('invalid-token')).toThrow();
  });
});

describe('Auth Endpoints', () => {
  let accessToken: string;

  beforeAll(async () => {
    // Get a valid token via ZKP verification
    const res = await request(app)
      .post('/api/auth/zkp/verify')
      .send(createValidVerifyRequest());
    accessToken = res.body.accessToken;
  });

  it('GET /api/auth/me returns user profile with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sub).toBeDefined();
    expect(res.body.verified).toBe(true);
    expect(res.body.dataStorageConfirmation.biometricDataStored).toBe(false);
  });

  it('GET /api/auth/me returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns 401 with invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout invalidates session', async () => {
    const zkpRes = await request(app)
      .post('/api/auth/zkp/verify')
      .send(createValidVerifyRequest());
    const token = zkpRes.body.accessToken;

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toBe('Logged out successfully');
  });
});
