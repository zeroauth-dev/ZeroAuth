/**
 * Unit tests for the small middleware files:
 *
 *   - src/middleware/auth.ts         — authenticateAdmin
 *   - src/middleware/error-handler.ts — errorHandler, notFoundHandler
 *
 * The tenant-auth middleware is covered by tests/central-api.test.ts and
 * tests/console-proxy.test.ts (its integration surface).
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../src/config';
import { authenticateAdmin } from '../src/middleware/auth';
import { errorHandler, notFoundHandler } from '../src/middleware/error-handler';

function mockResponse(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

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
