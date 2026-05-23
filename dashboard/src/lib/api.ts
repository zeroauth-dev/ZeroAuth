/**
 * Typed fetch client for the ZeroAuth console + v1 APIs.
 *
 * Console endpoints use a 24h JWT, returned from /api/console/login or
 * /api/console/signup. v1 endpoints use a tenant API key — those are not
 * stored in the dashboard; the dashboard talks to the console surface, and
 * the console surface (server-side) is what actually owns the tenant data.
 *
 * The JWT lives in localStorage under `zeroauth.console_token`. We rotate
 * + drop it on logout. There is no refresh-token flow for the console
 * session today — when it expires (24h) the user logs in again.
 */

const CONSOLE_TOKEN_KEY = 'zeroauth.console_token';

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

function readToken(): string | null {
  try {
    return localStorage.getItem(CONSOLE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(CONSOLE_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(CONSOLE_TOKEN_KEY);
    }
  } catch {
    /* ignore — private mode / disabled storage */
  }
}

export function getToken(): string | null {
  return readToken();
}

type RequestOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  auth?: boolean; // default true — attach the console JWT
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    query,
    auth = true,
    signal,
  } = opts;

  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    const token = readToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  // Parse body (best-effort). Empty responses (204) and non-JSON 5xxs are OK.
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

    // 401 from the console means our token is gone or expired — purge it
    // so the next render kicks the user to /login.
    if (res.status === 401 && path.startsWith('/api/console/')) {
      setToken(null);
    }

    throw new ApiError(res.status, code, msg, parsed);
  }

  return parsed as T;
}

// ─── Console types ───────────────────────────────────────────────

export type Plan = 'free' | 'starter' | 'growth' | 'enterprise';
export type Environment = 'live' | 'test';

export interface Tenant {
  id: string;
  email: string;
  companyName: string | null;
  plan: Plan;
  status: 'active' | 'suspended' | 'deactivated';
}

/**
 * F-2 v2 byte-identical signup response (issue #27).
 *
 * POST /api/console/signup always returns 202 with this shape regardless
 * of whether the email is taken. The dashboard reads `status` to render
 * the "check your inbox" state. The actual account + API key are minted
 * only after the user clicks the verification link, at which point the
 * GET /api/console/verify-signup endpoint sets a one-shot reveal cookie
 * and redirects to /dashboard/signup-complete.
 */
export interface SignupResponse {
  status: 'pending_verification';
  message: string;
}

/**
 * Payload set by the backend at verify-signup time and read once by the
 * SignupComplete page. Source: the `zeroauth_signup_reveal` cookie,
 * base64url-encoded JSON. Cleared after the page reads it.
 */
export interface SignupRevealPayload {
  token: string;
  apiKey: string;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyPrefix: string;
  apiKeyEnv: Environment;
}

export interface LoginResponse {
  token: string;
  tenant: Tenant;
}

export interface Account {
  id: string;
  email: string;
  companyName: string | null;
  plan: Plan;
  status: 'active' | 'suspended' | 'deactivated';
  rateLimit: number;
  monthlyQuota: number;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  environment: Environment;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface ApiKeyCreateResponse {
  key: string;
  id: string;
  name: string;
  prefix: string;
  environment: Environment;
  scopes: string[];
  createdAt: string;
  warning: string;
}

export interface UsageSummary {
  plan: Plan;
  currentMonth: {
    used: number;
    limit: number;
    remaining: number | 'unlimited';
  };
  rateLimit: { requestsPer15Min: number };
  history: Array<{
    period: string;
    total_requests: number;
    zkp_verifications: number;
    zkp_registrations: number;
    saml_auths: number;
    oidc_auths: number;
  }>;
  recentCalls: Array<{
    id: string | number;
    endpoint: string;
    method: string;
    status_code: number;
    response_time_ms: number | null;
    created_at: string;
  }>;
}

export interface Device {
  id: string;
  external_id: string;
  name: string;
  location_id: string | null;
  status: 'active' | 'inactive' | 'retired';
  battery_level: number | null;
  metadata: Record<string, unknown>;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  external_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_code: string | null;
  status: 'active' | 'inactive';
  primary_device_id: string | null;
  metadata: Record<string, unknown>;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Verification {
  id: string;
  user_id: string | null;
  device_id: string | null;
  method: 'zkp' | 'fingerprint' | 'face' | 'depth' | 'saml' | 'oidc' | 'manual';
  result: 'pass' | 'fail' | 'challenge';
  reason: string | null;
  confidence_score: number | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AttendanceEvent {
  id: string;
  user_id: string;
  device_id: string | null;
  verification_id: string | null;
  event_type: 'check_in' | 'check_out';
  result: 'accepted' | 'rejected';
  metadata: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}

export interface AuditEvent {
  id: number;
  environment: Environment | null;
  actor_type: 'api_key' | 'console' | 'device' | 'system';
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  status: 'success' | 'failure';
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ConsoleOverview {
  environment: Environment;
  counts: {
    devices: number;
    users: number;
    verifications: number;
    attendanceEvents: number;
    auditEvents: number;
  };
  recentDevices: Device[];
  recentUsers: User[];
  recentVerifications: Verification[];
  recentAttendance: AttendanceEvent[];
  recentAuditEvents: AuditEvent[];
}

// ─── Proof-pairing (W3 desktop sign-in demo) ─────────────────────
//
// The dashboard talks to /api/console/proof-pairing/* (see
// src/routes/console.ts); that surface forwards to /v1/proof-pairing/*
// on the API side. The mock mode (VITE_PAIRING_MOCK=1) bypasses both
// layers and synthesises responses in the browser so the demo page
// can be exercised without the backend.
//
// Discriminated union on `type` mirrors the SSE event names the
// backend emits (see docs/api_contract.md → Proof pairing).

export interface PairingTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type PairingSessionState = 'issued' | 'bound' | 'expired' | 'failed';

export interface PairingSession {
  id: string;
  nonce: string;
  expiresAt: string;
  qrPayload: string;
  streamUrl: string;
  state: PairingSessionState;
  boundAt?: string;
  userId?: string | null;
  did?: string | null;
}

export interface PairingSessionResponse {
  session: PairingSession;
}

export interface PairingSubmitResponse {
  session: PairingSession & { state: 'bound'; boundAt: string; userId: string; did: string };
  tokens: PairingTokens;
}

export type PairingStreamEvent =
  | { type: 'session_created'; id: string; state: 'issued'; expiresAt: string }
  | { type: 'session_bound'; id: string; state: 'bound'; userId: string; did: string; tokens: PairingTokens; userEmail?: string }
  | { type: 'session_expired'; id: string; state: 'expired' }
  | { type: 'session_error'; id: string; error: string; message: string };

/** Listener registry returned by `api.pairing.subscribeStream`. */
export interface PairingStream {
  on<T extends PairingStreamEvent['type']>(
    type: T,
    handler: (event: Extract<PairingStreamEvent, { type: T }>) => void,
  ): () => void;
  close(): void;
}

/**
 * Build an EventSource-like wrapper around the SSE stream. Returns a
 * tiny pub/sub so callers can `stream.on('session_bound', cb)` without
 * juggling addEventListener('session_bound') wiring.
 *
 * In MOCK mode we skip the network and let the QR-proof demo page
 * drive events synthetically via the page-local helper.
 */
function buildPairingStream(sessionId: string, options: { mock?: boolean } = {}): PairingStream {
  type Handler = (event: PairingStreamEvent) => void;
  const handlers = new Map<PairingStreamEvent['type'], Set<Handler>>();
  let eventSource: EventSource | null = null;

  const emit = (event: PairingStreamEvent) => {
    const list = handlers.get(event.type);
    if (!list) return;
    for (const h of list) {
      try {
        h(event);
      } catch (err) {
        // Don't let one bad subscriber kill the stream for everyone.
        console.error('PairingStream handler error', err);
      }
    }
  };

  if (!options.mock && typeof EventSource !== 'undefined') {
    const url = `/api/console/proof-pairing/sessions/${encodeURIComponent(sessionId)}/stream`;
    eventSource = new EventSource(url, { withCredentials: true });

    const wireOne = (name: PairingStreamEvent['type']) => {
      eventSource!.addEventListener(name, (raw) => {
        try {
          const parsed = JSON.parse((raw as MessageEvent).data) as Omit<PairingStreamEvent, 'type'>;
          emit({ ...parsed, type: name } as PairingStreamEvent);
        } catch {
          emit({ type: 'session_error', id: sessionId, error: 'sse_parse_error', message: 'Malformed SSE payload from server.' });
        }
      });
    };
    wireOne('session_created');
    wireOne('session_bound');
    wireOne('session_expired');
    wireOne('session_error');

    eventSource.onerror = () => {
      // EventSource auto-retries on transient errors; the spec leaves
      // the readyState at CONNECTING. We surface only the hard-close
      // ("closed") as an error to consumers.
      if (eventSource?.readyState === EventSource.CLOSED) {
        emit({
          type: 'session_error',
          id: sessionId,
          error: 'sse_disconnected',
          message: 'Lost the connection to the proof-pairing stream.',
        });
      }
    };
  }

  const api: PairingStream & { __emit?: (e: PairingStreamEvent) => void } = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as Handler);
      return () => {
        set!.delete(handler as Handler);
      };
    },
    close() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      handlers.clear();
    },
  };

  // Mock mode exposes an internal __emit so the QrProofLogin page can
  // drive the lifecycle via the "Trigger mock claim" button.
  if (options.mock) {
    api.__emit = emit;
  }

  return api;
}

/**
 * In-process mock store for VITE_PAIRING_MOCK=1. Keyed on session id so
 * a page reload (which mounts a fresh QrProofLogin) gets a fresh session
 * without leaking state from the previous one. State is intentionally
 * non-persistent — module-level memory only.
 */
const mockSessions = new Map<string, {
  session: PairingSession;
  stream: PairingStream;
  // The "Trigger mock claim" button calls this to advance the lifecycle.
  bind: () => void;
  expire: () => void;
}>();

function mockSessionId(): string {
  // Crypto.randomUUID is universally available in browsers + jsdom 22+.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `mock-${Math.random().toString(36).slice(2, 14)}`;
}

function mockNonceHex(): string {
  // 31 bytes = 62 hex chars, matching the production wire format. We
  // don't need cryptographic quality in mock mode, but the length lets
  // the QR encoder accept the payload without padding.
  const bytes = new Uint8Array(31);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isMockMode(): boolean {
  try {
    return (import.meta.env.VITE_PAIRING_MOCK ?? '') === '1';
  } catch {
    return false;
  }
}

async function mockCreateSession(): Promise<PairingSessionResponse> {
  const id = mockSessionId();
  const nonce = mockNonceHex();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const session: PairingSession = {
    id,
    nonce,
    expiresAt,
    qrPayload: `za:pair:1:${id}:${nonce}:zeroauth.local:demo`,
    streamUrl: `/api/console/proof-pairing/sessions/${id}/stream`,
    state: 'issued',
  };
  const stream = buildPairingStream(id, { mock: true });
  type EmittingStream = PairingStream & { __emit?: (e: PairingStreamEvent) => void };
  const emit = (stream as EmittingStream).__emit ?? (() => {});

  // Fire session_created on the next tick so listeners attached after
  // the createSession() resolves still receive it.
  setTimeout(() => {
    emit({ type: 'session_created', id, state: 'issued', expiresAt });
  }, 0);

  mockSessions.set(id, {
    session,
    stream,
    bind: () => {
      const tokens: PairingTokens = {
        accessToken: `mock_access_${id}`,
        refreshToken: `mock_refresh_${id}`,
        tokenType: 'Bearer',
        expiresIn: 3600,
      };
      emit({
        type: 'session_bound',
        id,
        state: 'bound',
        userId: 'mock-user-1',
        did: 'did:zeroauth:mock:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b',
        tokens,
        userEmail: 'demo@zeroauth.dev',
      });
    },
    expire: () => {
      emit({ type: 'session_expired', id, state: 'expired' });
    },
  });

  return { session };
}

async function mockGetSession(id: string): Promise<PairingSession> {
  const rec = mockSessions.get(id);
  if (!rec) throw new ApiError(404, 'pairing_session_not_found', 'Session not found.');
  return rec.session;
}

async function mockSubmitProof(id: string): Promise<PairingSubmitResponse> {
  const rec = mockSessions.get(id);
  if (!rec) throw new ApiError(404, 'pairing_session_not_found', 'Session not found.');
  // Drive the SSE consumer to the same terminal state the real backend
  // would, then resolve the submit promise.
  rec.bind();
  const tokens: PairingTokens = {
    accessToken: `mock_access_${id}`,
    refreshToken: `mock_refresh_${id}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
  };
  return {
    session: {
      ...rec.session,
      state: 'bound',
      boundAt: new Date().toISOString(),
      userId: 'mock-user-1',
      did: 'did:zeroauth:mock:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b',
    },
    tokens,
  };
}

/** Exposed for the QrProofLogin page's "Trigger mock claim" button. */
export function __mockBind(sessionId: string): void {
  mockSessions.get(sessionId)?.bind();
}

export function __mockExpire(sessionId: string): void {
  mockSessions.get(sessionId)?.expire();
}

// ─── API call helpers ────────────────────────────────────────────

export const api = {
  // Auth
  signup: (input: { email: string; password: string; companyName?: string }) =>
    request<SignupResponse>('/api/console/signup', { method: 'POST', body: input, auth: false }),

  login: (input: { email: string; password: string }) =>
    request<LoginResponse>('/api/console/login', { method: 'POST', body: input, auth: false }),

  // Account + usage
  account: () => request<Account>('/api/console/account'),
  usage: () => request<UsageSummary>('/api/console/usage'),

  // Overview + audit
  overview: (environment: Environment) =>
    request<ConsoleOverview>('/api/console/overview', { query: { environment } }),
  audit: (params: { environment: Environment; action?: string; status?: 'success' | 'failure'; limit?: number }) =>
    request<{ environment: Environment; events: AuditEvent[] }>('/api/console/audit', { query: params }),

  // API keys
  listKeys: () => request<{ keys: ApiKey[] }>('/api/console/keys'),
  createKey: (input: { name?: string; environment?: Environment; scopes?: string[] }) =>
    request<ApiKeyCreateResponse>('/api/console/keys', { method: 'POST', body: input }),
  revokeKey: (keyId: string) =>
    request<{ message: string; keyId: string }>(`/api/console/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),

  // Devices — console proxies live at /api/console/devices
  listDevices: (params: { environment: Environment; status?: Device['status']; limit?: number }) =>
    request<{ environment: Environment; devices: Device[] }>('/api/console/devices', { query: params }),
  createDevice: (input: {
    environment: Environment;
    name: string;
    externalId?: string;
    locationId?: string;
    batteryLevel?: number;
    metadata?: Record<string, unknown>;
  }) => request<{ environment: Environment; device: Device }>('/api/console/devices', { method: 'POST', body: input }),
  updateDevice: (
    deviceId: string,
    input: {
      environment: Environment;
      name?: string;
      locationId?: string;
      batteryLevel?: number;
      status?: Device['status'];
      metadata?: Record<string, unknown>;
      lastSeenAt?: string;
    },
  ) => request<{ environment: Environment; device: Device }>(`/api/console/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', body: input }),

  // Users
  listUsers: (params: { environment: Environment; status?: User['status']; limit?: number }) =>
    request<{ environment: Environment; users: User[] }>('/api/console/users', { query: params }),
  createUser: (input: {
    environment: Environment;
    fullName: string;
    externalId?: string;
    email?: string;
    phone?: string;
    employeeCode?: string;
    primaryDeviceId?: string;
    metadata?: Record<string, unknown>;
  }) => request<{ environment: Environment; user: User }>('/api/console/users', { method: 'POST', body: input }),
  updateUser: (
    userId: string,
    input: {
      environment: Environment;
      fullName?: string;
      email?: string;
      phone?: string;
      employeeCode?: string;
      status?: User['status'];
      primaryDeviceId?: string;
      metadata?: Record<string, unknown>;
    },
  ) => request<{ environment: Environment; user: User }>(`/api/console/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: input }),

  // Verifications (read-only on the console)
  listVerifications: (params: { environment: Environment; method?: Verification['method']; result?: Verification['result']; limit?: number }) =>
    request<{ environment: Environment; verifications: Verification[] }>('/api/console/verifications', { query: params }),

  // Attendance (read-only on the console)
  listAttendance: (params: { environment: Environment; type?: AttendanceEvent['event_type']; result?: AttendanceEvent['result']; limit?: number }) =>
    request<{ environment: Environment; attendance: AttendanceEvent[] }>('/api/console/attendance', { query: params }),

  // ─── Proof pairing (W3 — desktop QR sign-in) ───────────────────
  //
  // In MOCK mode we never hit the network. Otherwise the four endpoints
  // round-trip through /api/console/proof-pairing/*. The createSession
  // response sets a `zeroauth_pair_bind` cookie at Path=/api/console/
  // proof-pairing/ that subsequent calls (stream, GET session) ship
  // automatically — the browser handles it for us because both are
  // same-origin to the dashboard.
  pairing: {
    createSession: async (input: { environment?: Environment } = {}): Promise<PairingSessionResponse> => {
      if (isMockMode()) return mockCreateSession();
      // Always include the bind cookie on the create call so a stale
      // cookie from a prior aborted session is replaced server-side.
      return request<PairingSessionResponse>('/api/console/proof-pairing/sessions', {
        method: 'POST',
        body: { environment: input.environment ?? 'live' },
      });
    },

    getSession: async (id: string): Promise<PairingSession> => {
      if (isMockMode()) return mockGetSession(id);
      const { session } = await request<{ session: PairingSession }>(
        `/api/console/proof-pairing/sessions/${encodeURIComponent(id)}`,
      );
      return session;
    },

    submitProof: async (
      id: string,
      body: {
        did: string;
        proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[]; protocol: 'groth16'; curve: 'bn128' };
        publicSignals: [string, string, string];
        clientMeta?: Record<string, unknown>;
      },
    ): Promise<PairingSubmitResponse> => {
      if (isMockMode()) return mockSubmitProof(id);
      return request<PairingSubmitResponse>(
        `/api/console/proof-pairing/sessions/${encodeURIComponent(id)}/submit`,
        { method: 'POST', body },
      );
    },

    cancelSession: async (id: string): Promise<void> => {
      if (isMockMode()) {
        mockSessions.delete(id);
        return;
      }
      await request<unknown>(
        `/api/console/proof-pairing/sessions/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    },

    subscribeStream: (id: string): PairingStream => {
      if (isMockMode()) {
        const existing = mockSessions.get(id);
        if (existing) return existing.stream;
        // If the page came up with a session id but no mock-store entry
        // (browser refresh) we return a dead stream rather than throwing.
        return buildPairingStream(id, { mock: true });
      }
      return buildPairingStream(id);
    },

    isMockMode,
  },
};
