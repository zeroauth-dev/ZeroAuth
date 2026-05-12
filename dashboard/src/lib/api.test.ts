import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, getToken, setToken } from './api';

describe('api client', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    setToken(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setToken(null);
  });

  it('attaches the console JWT as a Bearer header on authed requests', async () => {
    setToken('test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 't', email: 'a@b', companyName: null, plan: 'free', status: 'active', rateLimit: 100, monthlyQuota: 1000, createdAt: new Date().toISOString() }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.account();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.method).toBe('GET');
  });

  it('does NOT attach Authorization on /signup or /login (auth: false)', async () => {
    setToken('should-not-be-used');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ token: 'x', tenant: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.login({ email: 'a@b', password: 'whatever' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('throws an ApiError carrying the server-returned error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'unauthorized', message: 'Login required.' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.account()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthorized',
      message: 'Login required.',
    });
  });

  it('clears the token on 401 from a console endpoint', async () => {
    setToken('about-to-expire');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'session_expired', message: 'Expired.' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.account()).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
  });

  it('serialises query parameters and drops empty values', async () => {
    setToken('tok');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ environment: 'live', devices: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await api.listDevices({ environment: 'live', status: undefined, limit: 25 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/console/devices');
    expect(url).toContain('environment=live');
    expect(url).toContain('limit=25');
    expect(url).not.toContain('status=');
  });
});
