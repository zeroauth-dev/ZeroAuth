/**
 * Unit tests for the small middleware files:
 *
 *   - src/middleware/auth.ts         — authenticateJWT, authenticateAdmin
 *   - src/middleware/error-handler.ts — errorHandler, notFoundHandler
 *   - src/middleware/demo-auth-gate.ts — demoAuthOnly (the 503 gate)
 *
 * The tenant-auth middleware is covered by tests/central-api.test.ts and
 * tests/console-proxy.test.ts (its integration surface).
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { authenticateJWT, authenticateAdmin } from '../src/middleware/auth';
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler';
import { demoAuthOnly } from '../src/middleware/demo-auth-gate';
import { issueTokens } from '../src/services/jwt';

function mockResponse(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('middleware/auth — authenticateJWT', () => {
  it('401s when no Authorization header is present', () => {
    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    authenticateJWT({ headers: {} } as Request, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Missing or invalid Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  it('401s when Authorization header does not start with "Bearer "', () => {
    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    authenticateJWT({ headers: { authorization: 'Basic abc' } } as Request, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Missing or invalid Authorization header' });
  });

  it('401s when the bearer is not a valid JWT', () => {
    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    authenticateJWT(
      { headers: { authorization: 'Bearer not-a-jwt' } } as Request,
      res,
      next,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on an expired token', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = mockResponse();
    const expired = jwt.sign(
      { sub: 'u', sessionId: 's', provider: 'zkp', verified: true },
      config.jwt.secret,
      { issuer: 'zeroauth', expiresIn: -1 },
    );
    authenticateJWT(
      { headers: { authorization: `Bearer ${expired}` } } as Request,
      res,
      next,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s on a token signed with the wrong secret', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = mockResponse();
    const bad = jwt.sign({ sub: 'u' }, 'wrong-secret', { issuer: 'zeroauth' });
    authenticateJWT(
      { headers: { authorization: `Bearer ${bad}` } } as Request,
      res,
      next,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches the payload to req.user for a valid token', () => {
    const next = jest.fn() as NextFunction;
    const tokens = issueTokens({
      sub: 'u-1',
      sessionId: 's-1',
      provider: 'zkp',
      verified: true,
    });
    const req = { headers: { authorization: `Bearer ${tokens.accessToken}` } } as Request & { user?: unknown };
    const { res } = mockResponse();
    authenticateJWT(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect((req as any).user).toMatchObject({ sub: 'u-1', sessionId: 's-1' });
  });
});

describe('middleware/auth — authenticateAdmin', () => {
  it('403s when no x-api-key header is present', () => {
    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    authenticateAdmin({ headers: {} } as Request, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid admin API key' });
  });

  it('403s when x-api-key does not match config.admin.apiKey', () => {
    const next = jest.fn() as NextFunction;
    const { res, status } = mockResponse();
    authenticateAdmin(
      { headers: { 'x-api-key': 'wrong' } } as unknown as Request,
      res,
      next,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when x-api-key matches', () => {
    const next = jest.fn() as NextFunction;
    const { res } = mockResponse();
    authenticateAdmin(
      { headers: { 'x-api-key': config.admin.apiKey } } as unknown as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});

describe('middleware/error-handler', () => {
  it('errorHandler returns 500 + generic message (no stack leak in prod)', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { res, status, json } = mockResponse();
    errorHandler(
      new Error('database exploded with secret table info'),
      {} as Request,
      res,
      jest.fn() as NextFunction,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error', message: undefined });
    process.env.NODE_ENV = oldEnv;
  });

  it('errorHandler returns the message in development for easier debugging', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const { res, json } = mockResponse();
    errorHandler(new Error('dev only details'), {} as Request, res, jest.fn() as NextFunction);
    expect(json).toHaveBeenCalledWith({
      error: 'Internal server error',
      message: 'dev only details',
    });
    process.env.NODE_ENV = oldEnv;
  });

  it('notFoundHandler returns 404 + {error:"Not found"}', () => {
    const { res, status, json } = mockResponse();
    notFoundHandler({} as Request, res);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'Not found' });
  });
});

describe('middleware/demo-auth-gate', () => {
  const originalFlag = (config as any).enableDemoAuth;

  afterEach(() => {
    (config as any).enableDemoAuth = originalFlag;
  });

  it('passes through to next() when ENABLE_DEMO_AUTH is true', () => {
    (config as any).enableDemoAuth = true;
    const next = jest.fn() as NextFunction;
    const { res } = mockResponse();
    demoAuthOnly({} as Request, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 503 demo_auth_disabled when the flag is false', () => {
    (config as any).enableDemoAuth = false;
    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    demoAuthOnly({} as Request, res, next);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'demo_auth_disabled',
        docs: '/docs/integrations/saml-sso',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
