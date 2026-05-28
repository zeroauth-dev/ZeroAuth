/**
 * Tests for src/middleware/rate-limit.ts (Phase 0 commit C-026, audit
 * finding C-10).
 *
 * Mocks `getPool()` from src/services/db so no Postgres is required.
 * Each test queues a single `mockResolvedValueOnce` return value and
 * exercises the middleware end-to-end with a stub Express
 * Request/Response/NextFunction triple.
 */

import { Request, Response, NextFunction } from 'express';

const mockQuery = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  pgRateLimit,
  cleanupRateLimitBuckets,
  buildBucketKey,
} from '../src/middleware/rate-limit';

function mockResponse(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
  set: jest.Mock;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const set = jest.fn((name: string, value: string) => {
    headers[name] = value;
  });
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const res = { status, json, set } as unknown as Response;
  return { res, status, json, set, headers };
}

describe('middleware/rate-limit — pgRateLimit', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('passes through on the first request (count=1 <= max=30)', async () => {
    // Bucket starts empty; the UPSERT returns count=1.
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    const req = {
      ip: '203.0.113.7',
      tenantContext: { apiKey: { id: 'key-uuid-1' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'zkp:verify', windowMs: 60_000, max: 30, keyBy: 'apiKey' });
    await mw(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalledWith(429);
    expect(json).not.toHaveBeenCalled();
  });

  it('passes through on the boundary request (count=10 == max=10)', async () => {
    // The boundary request is allowed: count == max passes, count > max 429s.
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 10 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    const req = {
      ip: '203.0.113.7',
      tenantContext: { apiKey: { id: 'key-uuid-1' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'console:login', windowMs: 60_000, max: 10, keyBy: 'ip' });
    await mw(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalledWith(429);
    expect(json).not.toHaveBeenCalled();
  });

  it('returns 429 with rate_limited error code when count > max', async () => {
    // 11th request when max=10 — over the line.
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 11 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res, status, json } = mockResponse();
    const req = {
      ip: '203.0.113.7',
      tenantContext: { apiKey: { id: 'key-uuid-1' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'console:login', windowMs: 60_000, max: 10, keyBy: 'ip' });
    await mw(req, res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'rate_limited',
        message: 'Too many requests. Try again later.',
        retry_after_seconds: expect.any(Number),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('sets Retry-After header on the 429 response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 11 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res, set, headers } = mockResponse();
    const req = {
      ip: '203.0.113.7',
      tenantContext: { apiKey: { id: 'key-uuid-1' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'console:login', windowMs: 60_000, max: 10, keyBy: 'ip' });
    await mw(req, res, next);

    // The Retry-After header must be present and parseable as a
    // non-negative integer seconds value (per RFC 7231 §7.1.3).
    expect(set).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^\d+$/));
    expect(headers['Retry-After']).toBeDefined();
    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(Number(headers['Retry-After'])).toBeLessThanOrEqual(60);
  });

  it('keys the bucket on apiKey id when keyBy="apiKey"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res } = mockResponse();
    const req = {
      ip: '203.0.113.7',
      tenantContext: { apiKey: { id: 'key-uuid-abcdef' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'zkp:verify', windowMs: 60_000, max: 30, keyBy: 'apiKey' });
    await mw(req, res, next);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [_sql, params] = mockQuery.mock.calls[0];
    // The first parameter is the bucket key; it must contain the
    // route label and the apiKey id but NOT the request IP.
    expect(params[0]).toMatch(/^zkp:verify:key-uuid-abcdef:\d+$/);
    expect(params[0]).not.toContain('203.0.113.7');
  });

  it('keys the bucket on req.ip when keyBy="ip"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 });

    const next = jest.fn() as NextFunction;
    const { res } = mockResponse();
    const req = {
      ip: '198.51.100.42',
      tenantContext: { apiKey: { id: 'key-uuid-should-be-ignored' } },
    } as unknown as Request;

    const mw = pgRateLimit({ route: 'console:login', windowMs: 60_000, max: 10, keyBy: 'ip' });
    await mw(req, res, next);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [_sql, params] = mockQuery.mock.calls[0];
    // The bucket key must contain the IP, not the apiKey id, when
    // keyBy='ip'.
    expect(params[0]).toMatch(/^console:login:198\.51\.100\.42:\d+$/);
    expect(params[0]).not.toContain('key-uuid-should-be-ignored');
  });

  it('cleanupRateLimitBuckets issues a DELETE on expired rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 17 });

    await cleanupRateLimitBuckets();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    // The cleanup must be a DELETE filtered on expires_at < NOW().
    // Both fragments matter: the operation and the predicate.
    expect(String(sql)).toMatch(/DELETE\s+FROM\s+rate_limit_buckets/i);
    expect(String(sql)).toMatch(/expires_at\s*<\s*NOW\(\)/i);
  });
});

describe('middleware/rate-limit — buildBucketKey', () => {
  it('floors the window-start so two timestamps in the same window collide', () => {
    const windowMs = 60_000;
    // Both timestamps fall inside the window starting at
    // 1_700_000_040_000 ms (1_700_000_040_000 / 60_000 is an
    // integer, so the floor is itself).
    const t1 = 1_700_000_050_000;
    const t2 = 1_700_000_099_999;
    const k1 = buildBucketKey('zkp:verify', 'key-1', t1, windowMs);
    const k2 = buildBucketKey('zkp:verify', 'key-1', t2, windowMs);
    expect(k1).toBe(k2);
    expect(k1).toBe('zkp:verify:key-1:1700000040000');
  });

  it('produces a distinct key in the next window', () => {
    const windowMs = 60_000;
    const t1 = 1_700_000_050_000; // window: 1_700_000_040_000
    const t2 = 1_700_000_100_001; // window: 1_700_000_100_000
    const k1 = buildBucketKey('zkp:verify', 'key-1', t1, windowMs);
    const k2 = buildBucketKey('zkp:verify', 'key-1', t2, windowMs);
    expect(k1).not.toBe(k2);
  });
});
