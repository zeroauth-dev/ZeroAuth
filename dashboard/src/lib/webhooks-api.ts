/**
 * Dashboard-side webhooks API client.
 *
 * Talks to /api/console/webhooks/* — the console-proxied surface that
 * lets a tenant register an HTTPS endpoint to receive event payloads
 * (verification.completed, registration.completed, audit.anchored, ...)
 * with an HMAC-SHA256 signature in the `X-ZeroAuth-Signature` header.
 *
 * Two contracts the rest of the dashboard relies on:
 *
 * 1. **`signing_secret` is returned ONCE.** The plaintext signing secret
 *    is included only on POST /api/console/webhooks (and only in the
 *    response body — never persisted in the dashboard layer beyond the
 *    one-time-reveal modal). Subsequent GETs return the row WITHOUT the
 *    secret. The `WebhookCreated` envelope is structurally distinct
 *    from `Webhook` for exactly this reason: a component that reads
 *    `.signing_secret` off a list row will not compile.
 *
 * 2. **Event filters are an allowlist.** `KNOWN_EVENTS` mirrors the
 *    server-side enum and is the only set of values the create form
 *    will send. The server rejects unknown events with `invalid_event`,
 *    but the client narrows first so a misclicked checkbox can never
 *    register a typo'd filter.
 *
 * This client deliberately does NOT export any helper that prints the
 * signing secret to the console (no `console.log(secret)`), and the
 * value is never stored in a query-cache key — `enabled` toggles, deletes,
 * and refetches read from the list endpoint which omits the secret.
 */
import { getToken, ApiError } from './api';
import type { Environment } from './api';

// ─── Public types ───────────────────────────────────────────────

/**
 * The canonical event names a webhook can subscribe to. Mirrors the
 * server-side `webhook_events` enum (planned in C-094 — backend
 * webhooks endpoint). Adding a new event requires an ADR-grade decision
 * because every subscriber starts receiving it on the next dispatch.
 */
export const KNOWN_EVENTS = [
  'verification.completed',
  'verification.failed',
  'registration.completed',
  'registration.abandoned',
  'audit.anchored',
  'device.enrolled',
  'device.revoked',
] as const;

export type WebhookEvent = (typeof KNOWN_EVENTS)[number];

/**
 * A webhook row as the dashboard renders it. NEVER carries the
 * plaintext signing secret — only the prefix (first 8 chars) for the
 * UX hint "secret starts with whsec_…".
 */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  environment: Environment;
  /** Prefix of the signing secret (e.g. `whsec_abc1`), never the full value. */
  secret_prefix: string;
  /** ISO-8601 of the most recent dispatch attempt, or `null` if never sent. */
  last_delivered_at: string | null;
  /** HTTP status of the most recent dispatch (200, 404, 500, …). null if untried. */
  last_status_code: number | null;
  /** Count of consecutive failures since the last 2xx. Resets on success. */
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

/**
 * The response shape from POST /api/console/webhooks. Structurally
 * distinct from `Webhook` because it carries `signing_secret` — the
 * one-time-reveal value the operator must save before closing the
 * modal. A type-level reminder that this object cannot be passed to a
 * list-row component without first stripping the secret.
 */
export interface WebhookCreated {
  webhook: Webhook;
  /**
   * Plaintext HMAC-SHA256 signing secret. Shown exactly once at
   * creation; never returned again. Format: `whsec_` + 48 hex chars.
   */
  signing_secret: string;
  /** Operator-visible warning the server includes for legal cover. */
  warning: string;
}

// ─── Wire shape ─────────────────────────────────────────────────
//
// What the server sends today. Wider than `Webhook` on purpose — the
// projection below narrows it. Any field not in the projection is
// dropped on the floor before reaching the component layer.

interface ServerWebhookRow {
  id: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
  environment?: 'live' | 'test';
  secret_prefix?: string;
  last_delivered_at?: string | null;
  last_status_code?: number | null;
  consecutive_failures?: number;
  created_at?: string;
  updated_at?: string;
  [extra: string]: unknown;
}

interface ServerListResponse {
  environment: Environment;
  webhooks: ServerWebhookRow[];
}

interface ServerCreateResponse {
  webhook: ServerWebhookRow;
  signing_secret: string;
  warning?: string;
}

interface ServerSingleResponse {
  webhook: ServerWebhookRow;
}

// ─── Projection ─────────────────────────────────────────────────

function isKnownEvent(value: string): value is WebhookEvent {
  return (KNOWN_EVENTS as readonly string[]).includes(value);
}

function pickWebhook(row: ServerWebhookRow): Webhook {
  const events = Array.isArray(row.events)
    ? row.events.filter(isKnownEvent)
    : [];
  return {
    id: String(row.id),
    url: typeof row.url === 'string' ? row.url : '',
    events,
    enabled: row.enabled === true,
    environment: row.environment === 'test' ? 'test' : 'live',
    secret_prefix: typeof row.secret_prefix === 'string' ? row.secret_prefix : '',
    last_delivered_at:
      typeof row.last_delivered_at === 'string' ? row.last_delivered_at : null,
    last_status_code:
      typeof row.last_status_code === 'number' ? row.last_status_code : null,
    consecutive_failures:
      typeof row.consecutive_failures === 'number' ? row.consecutive_failures : 0,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

// ─── Request helper ─────────────────────────────────────────────
//
// We deliberately don't reuse the shared `request<T>()` from api.ts here
// — the secret-bearing create endpoint needs hand-tuned error handling
// (we never want a plaintext secret bleeding into an Error message),
// and a single-purpose helper keeps the surface auditable.

async function fetchJson<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method: init.method ?? 'GET',
    headers,
    body: init.body,
  });

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
    throw new ApiError(
      res.status,
      errBody.error ?? `http_${res.status}`,
      errBody.message ?? res.statusText ?? 'Request failed',
      parsed,
    );
  }

  return parsed as T;
}

// ─── Public API ─────────────────────────────────────────────────

export interface ListWebhooksOpts {
  environment: Environment;
}

export async function listWebhooks(opts: ListWebhooksOpts): Promise<Webhook[]> {
  const body = await fetchJson<ServerListResponse>('/api/console/webhooks', {
    query: { environment: opts.environment },
  });
  const rows = Array.isArray(body.webhooks) ? body.webhooks : [];
  return rows.map(pickWebhook);
}

export interface CreateWebhookInput {
  environment: Environment;
  url: string;
  events: WebhookEvent[];
}

export async function createWebhook(input: CreateWebhookInput): Promise<WebhookCreated> {
  const body = await fetchJson<ServerCreateResponse>('/api/console/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      environment: input.environment,
      url: input.url,
      events: input.events.filter(isKnownEvent),
    }),
  });
  return {
    webhook: pickWebhook(body.webhook),
    signing_secret: typeof body.signing_secret === 'string' ? body.signing_secret : '',
    warning:
      typeof body.warning === 'string'
        ? body.warning
        : 'Save this signing secret now. It will not be shown again.',
  };
}

export async function deleteWebhook(
  webhookId: string,
  environment: Environment,
): Promise<void> {
  await fetchJson<unknown>(
    `/api/console/webhooks/${encodeURIComponent(webhookId)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ environment }),
    },
  );
}

export async function setWebhookEnabled(
  webhookId: string,
  environment: Environment,
  enabled: boolean,
): Promise<Webhook> {
  const body = await fetchJson<ServerSingleResponse>(
    `/api/console/webhooks/${encodeURIComponent(webhookId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ environment, enabled }),
    },
  );
  return pickWebhook(body.webhook);
}

// ─── URL validation helper (shared with the form) ───────────────
//
// Exported so the route component can disable the submit button before
// hitting the wire. The server is the authoritative gatekeeper, but a
// client-side narrowing keeps the typical "I forgot to type https://"
// path from bouncing through a round-trip.

export function isValidWebhookUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;
  // Reject obvious localhost / private-range hints — the dispatcher
  // will reject them server-side, but again, no round-trip needed.
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost') return false;
  if (host === '127.0.0.1' || host.startsWith('127.')) return false;
  if (host === '0.0.0.0') return false;
  return true;
}
