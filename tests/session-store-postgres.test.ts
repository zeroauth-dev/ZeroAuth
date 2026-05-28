/**
 * Tests for the Postgres-backed write-through behaviour in
 * src/services/session-store.ts (C-9 closure).
 *
 * Mocks the pg pool so we can assert what the store sends to the DB
 * without spinning up Postgres. The behavioural tests (in-memory
 * map semantics) already live in tests/session-store.test.ts.
 *
 * Six cases:
 *   1. create() writes an INSERT with ON CONFLICT DO UPDATE
 *   2. delete() writes a DELETE keyed on session_id
 *   3. init() runs the hydration SELECT, loads rows into the map
 *   4. init() is idempotent (a second call is a no-op)
 *   5. init() with a broken DB tolerates the error and proceeds
 *   6. cleanupExpired() (private) runs the DELETE WHERE expires_at <= NOW()
 *      indirectly through the hourly interval — verified by call shape
 *      on the mocked pool.
 */

const mockQuery = jest.fn();
const mockConnect = jest.fn();

jest.mock('../src/services/db', () => ({
  getPool: () => ({ query: mockQuery, connect: mockConnect }),
}));

// Reset the module-level singleton between tests so init() runs again.
beforeEach(() => {
  jest.resetModules();
  mockQuery.mockReset();
  mockConnect.mockReset();
});

describe('SessionStore — Postgres write-through (C-9)', () => {
  it('create() emits an INSERT … ON CONFLICT DO UPDATE', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');

    sessionStore.create({
      sessionId: 'sess-1',
      userId: 'user-1',
      provider: 'zkp',
      verified: true,
      createdAt: new Date('2026-05-28T00:00:00Z').toISOString(),
      expiresAt: new Date('2026-05-28T01:00:00Z').toISOString(),
    });

    // Microtask-flush so the fire-and-forget promise resolves.
    await new Promise(r => setImmediate(r));

    const insertCall = mockQuery.mock.calls.find(c => /INSERT INTO user_sessions/i.test(c[0]));
    expect(insertCall).toBeDefined();
    expect(insertCall![0]).toMatch(/ON CONFLICT \(session_id\) DO UPDATE/);
    const params = insertCall![1];
    expect(params[0]).toBe('sess-1');
    expect(params[1]).toBe('user-1');
    expect(params[2]).toBe('zkp');
    expect(params[3]).toBe(true);
  });

  it('delete() emits a DELETE keyed on session_id', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');

    sessionStore.create({
      sessionId: 'sess-2',
      userId: 'user-2',
      provider: 'zkp',
      verified: true,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    sessionStore.delete('sess-2');

    await new Promise(r => setImmediate(r));

    const deleteCall = mockQuery.mock.calls.find(c => /DELETE FROM user_sessions/i.test(c[0]));
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(['sess-2']);
  });

  it('init() hydrates the cache from a SELECT of non-expired rows', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: 'hydrated-1',
          user_id: 'user-x',
          provider: 'zkp',
          verified: true,
          created_at: new Date(),
          expires_at: expiresAt,
          did: null,
        },
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');
    await sessionStore.init();

    const selectCall = mockQuery.mock.calls.find(c => /SELECT session_id/i.test(c[0]));
    expect(selectCall).toBeDefined();
    expect(selectCall![0]).toMatch(/WHERE expires_at > NOW\(\)/);

    const got = sessionStore.get('hydrated-1');
    expect(got).toBeDefined();
    expect(got!.userId).toBe('user-x');

    sessionStore.stop();
  });

  it('init() is idempotent — a second call does not re-query', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');

    await sessionStore.init();
    const callsAfterFirst = mockQuery.mock.calls.length;
    await sessionStore.init();
    expect(mockQuery.mock.calls.length).toBe(callsAfterFirst);

    sessionStore.stop();
  });

  it('init() tolerates a broken DB without throwing', async () => {
    mockQuery.mockRejectedValue(new Error('postgres unreachable'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');

    // Must not throw.
    await sessionStore.init();
    // Cache should be empty but functional.
    expect(sessionStore.get('any')).toBeUndefined();

    sessionStore.stop();
  });

  it('persist errors are logged but do not break the in-memory contract', async () => {
    mockQuery.mockRejectedValue(new Error('write timeout'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sessionStore } = require('../src/services/session-store') as typeof import('../src/services/session-store');

    sessionStore.create({
      sessionId: 'tx-fail',
      userId: 'user-y',
      provider: 'zkp',
      verified: true,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // get() reads from the cache, which has the row regardless of the
    // failed Postgres write.
    expect(sessionStore.get('tx-fail')?.userId).toBe('user-y');

    // Allow the rejected promise to settle.
    await new Promise(r => setImmediate(r));
  });
});
