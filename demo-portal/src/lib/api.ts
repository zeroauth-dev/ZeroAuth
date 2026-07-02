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

// ─── Bank 2FA types (contract: docs/api_contract.md, "NeoBank demo
//     bridge — bank 2FA") ─────────────────────────────────────────

/** Body for POST /api/demo-portal/bank/signup. customerId is an email. */
export interface BankSignupRequest {
  name: string;
  customerId: string;
  password: string;
}

/** 201 from POST /api/demo-portal/bank/signup — enrollment ceremony handle. */
export interface BankSignupResponse {
  signupId: string;
  pairDeeplink: string;
  expiresAt: string;
}

/** Enrollment ceremony states (same machine as /signup/:id). */
export type BankSignupState =
  | 'awaiting_device'
  | 'awaiting_commitment'
  | 'awaiting_verification'
  | 'completed'
  | 'failed';

/** 200 from GET /api/demo-portal/bank/signup/:id — ceremony poll. */
export interface BankSignupStatusResponse {
  state: BankSignupState;
  currentDeeplink: string | null;
  currentStep: string | null;
  /** Bank account status; populated once the ceremony completes and the
   *  DID binds (e.g. 'active'). */
  accountStatus: string | null;
}

/** Body for POST /api/demo-portal/bank/login (first factor). */
export interface BankLoginRequest {
  customerId: string;
  password: string;
}

/**
 * 201 from POST /api/demo-portal/bank/login. The response also sets the
 * demo_portal_claim cookie; the desktop then follows the existing
 * /sessions/:id/events SSE → /sessions/:id/claim flow. qrPayload is the
 * phone-offline fallback only.
 */
export interface BankLoginResponse {
  sessionId: string;
  expiresAt: string;
  qrPayload: string;
}

// ─── Bank overview / transfer types (contract: docs/api_contract.md,
//     "NeoBank demo bridge — bank 2FA") ─────────────────────────────

/** One synthetic account row on the NeoBank overview. */
export interface BankOverviewAccount {
  id: string;
  kind: 'savings' | 'current' | 'credit_card';
  /** Last-four masked, pre-formatted server-side. e.g. "•••• 4291". */
  maskedNumber: string;
  balancePaise: number;
  /** Display amount with currency symbol. e.g. "₹ 4,82,316". */
  balanceDisplay: string;
}

/** One ledger row on the NeoBank overview. */
export interface BankOverviewTransaction {
  id: string;
  direction: 'debit' | 'credit';
  counterparty: string;
  amountPaise: number;
  amountDisplay: string;
  note: string;
  category: string;
  status: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** 200 from GET /api/demo-portal/bank/overview. Ledger seeded on first read. */
export interface BankOverviewResponse {
  fullName: string;
  did: string;
  primaryBalancePaise: number;
  primaryBalanceDisplay: string;
  stepUpThresholdDisplay: string;
  accounts: BankOverviewAccount[];
  transactions: BankOverviewTransaction[];
}

/** Body for POST /api/demo-portal/bank/transfer. amount is integer rupees. */
export interface BankTransferRequest {
  amount: number;
  payeeName: string;
  note?: string;
}

/** 200 from POST /api/demo-portal/bank/transfer — immediate settle (< ₹10,000). */
export interface BankTransferImmediate {
  requiresApproval: false;
  status: 'completed';
  balanceDisplay: string;
  amountDisplay: string;
  payeeName: string;
}

/** 201 from POST /api/demo-portal/bank/transfer — face step-up (≥ ₹10,000). */
export interface BankTransferStepUp {
  requiresApproval: true;
  transferId: string;
  sessionId: string;
  qrPayload: string;
  contextLabel: string;
  amountDisplay: string;
  payeeName: string;
  /** ISO-8601 expiry of the pinned approval session. */
  expiresAt: string;
}

/** Discriminated union of the two /bank/transfer success shapes. */
export type BankTransferResponse = BankTransferImmediate | BankTransferStepUp;

/** Step-up transfer lifecycle, as polled via /bank/transfer/:id. */
export type BankTransferStatus = 'pending_approval' | 'completed' | 'declined';

/** 200 from GET /api/demo-portal/bank/transfer/:id — poll. Idempotent. */
export interface BankTransferStatusResponse {
  status: BankTransferStatus;
  balanceDisplay: string;
  amountDisplay: string;
  counterparty: string;
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

// ─── Bank 2FA endpoints ───────────────────────────────────────────

/**
 * POST /api/demo-portal/bank/signup — create the pending bank account
 * (password is the bank's first factor) and open the 3-QR ZeroAuth
 * enrollment ceremony.
 *
 * Throws ApiError with code 'invalid_request' | 'weak_password' (400)
 * or 'customer_id_taken' (409).
 */
export function bankSignup(
  body: BankSignupRequest,
  opts?: { signal?: AbortSignal },
): Promise<BankSignupResponse> {
  return request<BankSignupResponse>('/api/demo-portal/bank/signup', {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

/**
 * GET /api/demo-portal/bank/signup/:id — poll the enrollment ceremony.
 * The first poll that sees `completed` binds the ceremony DID onto the
 * bank account server-side (accountStatus flips to 'active').
 */
export function bankSignupStatus(
  signupId: string,
  opts?: { signal?: AbortSignal },
): Promise<BankSignupStatusResponse> {
  return request<BankSignupStatusResponse>(
    `/api/demo-portal/bank/signup/${encodeURIComponent(signupId)}`,
    { method: 'GET', signal: opts?.signal },
  );
}

/**
 * POST /api/demo-portal/bank/login — first factor (customer id +
 * password). On 201 the DID-pinned approval session is open and the
 * demo_portal_claim cookie is set; subscribe to the session's SSE
 * stream and claim on `session_bound`.
 *
 * Throws ApiError with code 'invalid_credentials' (401),
 * 'enrollment_pending' (409), 'account_locked' (423), or
 * 'too_many_pending_sessions' (429).
 */
export function bankLogin(
  body: BankLoginRequest,
  opts?: { signal?: AbortSignal },
): Promise<BankLoginResponse> {
  return request<BankLoginResponse>('/api/demo-portal/bank/login', {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

// ─── Bank overview / transfer endpoints ───────────────────────────

/**
 * GET /api/demo-portal/bank/overview — cookie-authed dashboard payload
 * (balance, accounts, seeded ledger). The ledger is seeded on the first
 * read for a fresh demo account.
 *
 * Throws ApiError with code 'unauthorized' (401) or 'no_account' (404).
 */
export function bankOverview(opts?: { signal?: AbortSignal }): Promise<BankOverviewResponse> {
  return request<BankOverviewResponse>('/api/demo-portal/bank/overview', {
    method: 'GET',
    signal: opts?.signal,
  });
}

/**
 * POST /api/demo-portal/bank/transfer — move money.
 *
 * Under ₹10,000 the transfer settles immediately (`200`,
 * `requiresApproval: false`). At ₹10,000+ the server opens a DID-pinned
 * "Payment approval" session (`201`, `requiresApproval: true`) and the
 * money moves only once the account holder's face consumes it — poll
 * `bankTransferStatus(transferId)` until it settles.
 *
 * Throws ApiError with code 'invalid_request' | 'insufficient_funds' (400).
 */
export function bankTransfer(
  body: BankTransferRequest,
  opts?: { signal?: AbortSignal },
): Promise<BankTransferResponse> {
  return request<BankTransferResponse>('/api/demo-portal/bank/transfer', {
    method: 'POST',
    body,
    signal: opts?.signal,
  });
}

/**
 * GET /api/demo-portal/bank/transfer/:id — poll a step-up transfer.
 * Settles the transfer iff its pinned session is `consumed`. Idempotent.
 */
export function bankTransferStatus(
  transferId: string,
  opts?: { signal?: AbortSignal },
): Promise<BankTransferStatusResponse> {
  return request<BankTransferStatusResponse>(
    `/api/demo-portal/bank/transfer/${encodeURIComponent(transferId)}`,
    { method: 'GET', signal: opts?.signal },
  );
}

/** Grouped export — call as `api.getMe()` etc. */
export const api = {
  initLogin,
  getMe,
  logout,
  bankSignup,
  bankSignupStatus,
  bankLogin,
  bankOverview,
  bankTransfer,
  bankTransferStatus,
} as const;

export default api;
