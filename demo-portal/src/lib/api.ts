/**
 * Demo-portal fetch wrapper. Talks exclusively to /api/demo-portal/*.
 *
 * Endpoints (server contract owned by src/routes/demo-portal.ts):
 *   POST /api/demo-portal/init-login  — kicks off the QR sign-in
 *   GET  /api/demo-portal/me          — returns the current session
 *   POST /api/demo-portal/logout      — clears the server session
 *
 * Auth: a demo-only HttpOnly cookie (zeroauth_demo_session). The
 * dashboard uses a Bearer JWT on a different transport so a stolen
 * demo cookie cannot impersonate a tenant operator and vice versa.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Types ────────────────────────────────────────────────────────

/** Public view of the demo user. The server redacts DID + commitment. */
export interface DemoUser {
  id: string;
  displayName: string;
  email: string;
  /** ISO-8601 timestamp the demo session was created. */
  createdAt: string;
}

/** Synthetic banking account shown on the NeoBank dashboard. */
export interface DemoAccount {
  id: string;
  kind: 'savings' | 'current' | 'credit_card';
  /** Last-four masked, pre-formatted server-side. e.g. "•••• 4421". */
  maskedNumber: string;
  /** Display amount with currency symbol. e.g. "₹ 1,84,520.40". */
  balanceDisplay: string;
}

/** Combined session payload returned by GET /api/demo-portal/me. */
export interface DemoSession {
  user: DemoUser;
  accounts: DemoAccount[];
}

/** Response from POST /api/demo-portal/init-login — QR payload + expiry. */
export interface InitLoginResponse {
  sessionId: string;
  qrPayload: string;
  expiresAt: string;
}

// ─── Core request helper ──────────────────────────────────────────

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  const url = new URL(path, window.location.origin);

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    // The demo session cookie MUST ride along on every same-origin
    // request. If we ever split SPA and API hosts, this becomes
    // 'include' plus a CORS allow-list.
    credentials: 'same-origin',
  });

  // Best-effort parse: empty 204s are fine; non-JSON 5xxs are surfaced
  // as the raw text so the caller can still log something useful.
  let parsed: unknown = undefined;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const errBody = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      error?: string;
      message?: string;
    };
    const code = errBody.error ?? `http_${res.status}`;
    const msg = errBody.message ?? res.statusText ?? 'Request failed';
    throw new ApiError(res.status, code, msg, parsed);
  }

  return parsed as T;
}

// ─── Endpoint methods ─────────────────────────────────────────────

export function initLogin(opts?: { signal?: AbortSignal }): Promise<InitLoginResponse> {
  return request<InitLoginResponse>('/api/demo-portal/init-login', {
    method: 'POST',
    signal: opts?.signal,
  });
}

export function getMe(opts?: { signal?: AbortSignal }): Promise<DemoSession> {
  return request<DemoSession>('/api/demo-portal/me', {
    method: 'GET',
    signal: opts?.signal,
  });
}

export function logout(opts?: { signal?: AbortSignal }): Promise<void> {
  return request<void>('/api/demo-portal/logout', {
    method: 'POST',
    signal: opts?.signal,
  });
}

/** Grouped export — call as `api.getMe()` etc. */
export const api = {
  initLogin,
  getMe,
  logout,
} as const;

export default api;
