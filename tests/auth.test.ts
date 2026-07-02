import { issueTokens, verifyToken } from '../src/services/jwt';
import { v4 as uuidv4 } from 'uuid';

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
