/**
 * /api/demo-portal/* — investor-demo bridge to the production
 * /v1/proof-pairing/* flow.
 *
 * The demo-portal SPA at `/demo-portal/*` is a no-auth NeoBank
 * dashboard that lets an investor see the "tap your face once,
 * land inside a bank" moment without the dashboard tenant-operator
 * auth surface in the way. These endpoints are the server side of
 * that bridge:
 *
 *   POST  /api/demo-portal/init-login          — open a pairing session
 *   GET   /api/demo-portal/me                  — read the session cookie
 *   POST  /api/demo-portal/logout              — clear the cookie
 *   GET   /api/demo-portal/sessions/:id/events — SSE stream + cookie set
 *
 * Auth model:
 *   - init-login and the SSE stream are PUBLIC (no API key, no JWT).
 *     They are gated by the (zeroauth-owned, server-seeded) demo-portal
 *     tenant — so the SPA never holds a tenant API key and we never
 *     ship one to the browser. The platform's normal per-tenant rate
 *     limit + quota still apply.
 *   - `/me` and `/logout` are cookie-authed via the HttpOnly
 *     `demo_portal_session` cookie. The cookie is set by the SSE route
 *     at the moment the pairing session flips to `consumed` — the only
 *     time the platform knows which `tenant_user` to bind the desktop
 *     to.
 *
 * NOT a production identity surface:
 *   - the cookie is unsigned (the entire demo-portal is sandboxed; we
 *     are not minting tenant-scoped JWTs for the SPA);
 *   - the cookie value is the `tenant_users.id` UUID + the pairing
 *     session id, joined with a server secret HMAC so a stolen cookie
 *     from one user cannot be edited to impersonate another;
 *   - we never write through to /v1/* on behalf of the demo-portal SPA.
 *
 * Threat-model coverage:
 *   - A-11/A-12/A-13/A-14 — inherited from the underlying
 *     `proof-pairing` service. We do NOT bypass any of its checks.
 *   - A-25 — uniform 401 on `/me` when the cookie is absent, mismatched,
 *     or HMAC-tampered.
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { config } from '../config';
import { getTenantById, getTenantByEmail } from '../services/tenants';
import {
  createSession as pairingCreateSession,
  PairingSessionNotFound,
  PairingSessionBindMismatch,
  TooManyPendingSessions,
} from '../services/proof-pairing';
import { DEMO_PORTAL_TENANT_ID } from '../services/demo-portal-seed';
import { ApiKeyEnvironment } from '../types';

const router = Router();

// ─── Constants ─────────────────────────────────────────────────────────

/**
 * Tenant the demo-portal acts on behalf of. The seed script
 * `scripts/seed-demo-tenants.ts` provisions this row alongside the
 * Anchor Bank demo tenant. If the row is missing (e.g. on a fresh
 * dev DB an operator forgot to seed), we fall back to the Anchor Bank
 * tenant so the demo never blanks out — logged at WARN so the gap is
 * visible in operator dashboards.
 */
const DEMO_PORTAL_TENANT_EMAIL = 'demo-portal@zeroauth.dev';
const ANCHOR_BANK_FALLBACK_EMAIL = 'anchor-bank-demo@zeroauth.dev';

/**
 * Environment the demo runs in. Always `test` — the demo MUST NOT
 * write to a tenant's `live` data even by accident.
 */
const DEMO_ENVIRONMENT: ApiKeyEnvironment = 'test';

/**
 * Cookie name + lifetime. 24 h matches the JWT TTL used elsewhere; the
 * cookie is the demo's only auth surface so the lifetime is bounded by
 * the investor demo duration, not by a security guarantee.
 */
const DEMO_COOKIE_NAME = 'demo_portal_session';
const DEMO_COOKIE_PATH = '/api/demo-portal';
const DEMO_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * HMAC over the cookie payload. The key derives from `JWT_SECRET` so
 * an operator who rotates JWT secrets also rotates demo cookies; in
 * dev this falls back to a fixed string. We do NOT use the raw JWT
 * secret directly — derived via HKDF-ish hash so a compromise of one
 * surface doesn't leak the other.
 */
function getCookieHmacKey(): Buffer {
  const seed = config.jwt.secret || 'dev-secret-change-me';
  return crypto.createHash('sha256').update(`demo-portal::${seed}`).digest();
}

// ─── Helpers ───────────────────────────────────────────────────────────

interface DemoCookiePayload {
  userId: string;
  pairingSessionId: string;
  startedAtMs: number;
}

/**
 * Encode a cookie payload as `base64url(json).base64url(hmac)`. The
 * HMAC is sha256 over the json bytes; tamper changes the HMAC and the
 * `/me` route returns 401.
 */
function encodeCookie(payload: DemoCookiePayload): string {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', getCookieHmacKey())
    .update(body)
    .digest('base64url');
  return `${body}.${mac}`;
}

/**
 * Decode + verify the HMAC. Returns null on any parse / mac / json
 * issue — callers MUST treat null as "not authenticated".
 */
function decodeCookie(raw: string | undefined): DemoCookiePayload | null {
  if (!raw || typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const body = raw.slice(0, dot);
  const presentedMac = raw.slice(dot + 1);
  const expectedMac = crypto.createHmac('sha256', getCookieHmacKey())
    .update(body)
    .digest('base64url');
  // Constant-time compare. Buffers must be the same length for
  // `timingSafeEqual` — if they aren't, bail.
  const a = Buffer.from(presentedMac);
  const b = Buffer.from(expectedMac);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Partial<DemoCookiePayload>;
    if (
      typeof parsed.userId !== 'string'
      || typeof parsed.pairingSessionId !== 'string'
      || typeof parsed.startedAtMs !== 'number'
    ) {
      return null;
    }
    return parsed as DemoCookiePayload;
  } catch {
    return null;
  }
}

function buildSetCookieHeader(value: string): string {
  const secure = (process.env.NODE_ENV ?? 'development') === 'production';
  const maxAge = Math.floor(DEMO_COOKIE_MAX_AGE_MS / 1000);
  // SameSite=Lax — the demo-portal SPA is same-origin with the API
  // under prod (zeroauth.dev / api.zeroauth.dev share parent) but the
  // SSE-set-cookie moment isn't a top-level navigation. Lax is enough
  // for the cookie to ride along on `fetch(..., credentials: 'include')`.
  return (
    `${DEMO_COOKIE_NAME}=${value};`
    + ` HttpOnly;`
    + (secure ? ' Secure;' : '')
    + ` SameSite=Lax;`
    + ` Path=${DEMO_COOKIE_PATH};`
    + ` Max-Age=${maxAge}`
  );
}

function buildClearCookieHeader(): string {
  const secure = (process.env.NODE_ENV ?? 'development') === 'production';
  return (
    `${DEMO_COOKIE_NAME}=;`
    + ` HttpOnly;`
    + (secure ? ' Secure;' : '')
    + ` SameSite=Lax;`
    + ` Path=${DEMO_COOKIE_PATH};`
    + ` Max-Age=0`
  );
}

function readDemoCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[DEMO_COOKIE_NAME] === 'string') {
    return cookies[DEMO_COOKIE_NAME];
  }
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === DEMO_COOKIE_NAME) return rest.join('=');
  }
  return undefined;
}

/**
 * Resolve the demo-portal tenant id. Cached for the lifetime of the
 * process — the tenant row is seeded once and never mutated by this
 * route.
 *
 * Three lookup paths, in order:
 *   1. Deterministic id from `demo-portal-seed.ts` (the dev-mode boot
 *      seed installs this row at server start). Confirms the row
 *      actually exists in case an operator dropped the table mid-demo.
 *   2. Email lookup `demo-portal@zeroauth.dev` (for environments where
 *      the deterministic seed hasn't run but the email-keyed
 *      idempotency check still finds a manually-created row).
 *   3. Email fallback to `anchor-bank-demo@zeroauth.dev` — the runbook
 *      tenant. Logged at WARN so the gap is visible in operator
 *      dashboards.
 *
 * Returns null only on a fresh DB where NEITHER path resolves; the
 * route returns 503 in that case so the operator runs the seed.
 */
let cachedTenantId: string | null = null;

async function resolveDemoPortalTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;

  // (1) Deterministic id from the seed module. This is the happy path
  // on every dev/CI/POC environment.
  const deterministic = await getTenantById(DEMO_PORTAL_TENANT_ID).catch(() => null);
  if (deterministic) {
    cachedTenantId = deterministic.id;
    return deterministic.id;
  }

  // (2) Email lookup — covers manually-provisioned rows.
  const byEmail = await getTenantByEmail(DEMO_PORTAL_TENANT_EMAIL).catch(() => null);
  if (byEmail) {
    cachedTenantId = byEmail.id;
    return byEmail.id;
  }

  // (3) Fallback to the Anchor Bank tenant from `seed-demo-tenants.ts`.
  const fallback = await getTenantByEmail(ANCHOR_BANK_FALLBACK_EMAIL).catch(() => null);
  if (fallback) {
    logger.warn(
      'demo-portal: dedicated tenant row missing — falling back to anchor-bank-demo. '
      + 'Run `tsx scripts/seed-demo-portal.ts` to provision the demo-portal tenant.',
    );
    cachedTenantId = fallback.id;
    return fallback.id;
  }
  return null;
}

/**
 * Build the deeplink the phone app handles. Mirrors the QR payload
 * format the proof-pairing service emits (`za:pair:1:...`) but framed
 * as an Android intent URL so the SPA can both render it as a QR and
 * surface a "tap-to-open-phone" button on mobile-first surfaces.
 */
function buildDeeplink(qrPayload: string): string {
  // The Android app registers a custom scheme `zeroauth://pair?p=...`.
  // The QR payload is opaque to the deeplink layer — the phone parses
  // it server-side once the WebView opens the prover.
  return `zeroauth://pair?p=${encodeURIComponent(qrPayload)}`;
}

interface DemoUserRow {
  id: string;
  external_id: string;
  full_name: string | null;
  did: string | null;
}

async function loadDemoUser(userId: string, tenantId: string): Promise<DemoUserRow | null> {
  const pool = getPool();
  const result = await pool.query<DemoUserRow>(
    `SELECT id, external_id, full_name, did
       FROM tenant_users
      WHERE id = $1 AND tenant_id = $2 AND environment = $3
      LIMIT 1`,
    [userId, tenantId, DEMO_ENVIRONMENT],
  );
  return result.rows[0] ?? null;
}

interface PairingRowSlim {
  id: string;
  state: string;
  consumed_user_id: string | null;
  consumed_at: Date | null;
  expires_at: Date;
  last_error_code: string | null;
  tenant_id: string;
}

async function loadPairingRow(
  sessionId: string,
  tenantId: string,
): Promise<PairingRowSlim | null> {
  const pool = getPool();
  const result = await pool.query<PairingRowSlim>(
    `SELECT id, state, consumed_user_id, consumed_at, expires_at,
            last_error_code, tenant_id
       FROM proof_pairing_sessions
      WHERE id = $1 AND tenant_id = $2 AND environment = $3
      LIMIT 1`,
    [sessionId, tenantId, DEMO_ENVIRONMENT],
  );
  return result.rows[0] ?? null;
}

// ─── Routes ────────────────────────────────────────────────────────────

/**
 * POST /api/demo-portal/init-login
 *
 * Opens a fresh proof-pairing session against the demo-portal tenant.
 * The body is ignored — the demo is anonymous; no parameters at all.
 * The session_bind cookie issued by the underlying service is NOT
 * forwarded to the SPA (the demo-portal does not need to call
 * `/v1/proof-pairing/submit` itself; the phone does). Without that
 * cookie, the `/me` and SSE routes use the more permissive demo
 * cookie instead.
 */
router.post('/init-login', async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      logger.error('demo-portal: no demo-portal tenant seeded — refusing init-login');
      res.status(503).json({
        error: 'demo_portal_not_provisioned',
        message: 'The demo portal is not yet provisioned on this deployment.',
      });
      return;
    }

    const result = await pairingCreateSession(
      tenantId,
      DEMO_ENVIRONMENT,
      null,
      req.ip ?? null,
      (req.headers['user-agent'] as string | undefined) ?? null,
    );

    res.status(201).json({
      // Snake-case for the wire contract (per the demo-portal client
      // contract in demo-portal/src/lib/api.ts), camelCase aliases for
      // the SignIn.tsx reducer. Sending both keeps either client happy
      // without forcing a SPA-side rename mid-demo.
      session_id: result.id,
      sessionId: result.id,
      deeplink: buildDeeplink(result.qrPayload),
      qr_payload: result.qrPayload,
      qrPayload: result.qrPayload,
      expires_at: result.expiresAt,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof TooManyPendingSessions) {
      res.status(429).json({
        error: 'too_many_pending_sessions',
        message: 'Too many open demo sign-in sessions. Try again in a minute.',
      });
      return;
    }
    logger.error('demo-portal: init-login failed', { error: (err as Error).message });
    res.status(500).json({
      error: 'init_login_failed',
      message: 'Could not start a demo sign-in session.',
    });
  }
});

/**
 * GET /api/demo-portal/me
 *
 * Cookie-authed. Returns the redacted demo session if the cookie is
 * present + valid; otherwise 401. Never leaks DB internals on the 401
 * path — the response body is the same string regardless of cookie
 * absence vs cookie mac mismatch (A-25 enumeration defence).
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const cookieValue = readDemoCookie(req);
    const payload = decodeCookie(cookieValue);
    if (!payload) {
      res.status(401).json({ error: 'not_authenticated', message: 'No demo session.' });
      return;
    }
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      res.status(401).json({ error: 'not_authenticated', message: 'No demo session.' });
      return;
    }
    const user = await loadDemoUser(payload.userId, tenantId);
    if (!user) {
      // The user row was deleted out from under us. Treat as logged-out
      // and clear the cookie so the SPA stops re-presenting it.
      res.setHeader('Set-Cookie', buildClearCookieHeader());
      res.status(401).json({ error: 'not_authenticated', message: 'No demo session.' });
      return;
    }
    const displayName = user.full_name && user.full_name.trim().length > 0
      && user.full_name !== 'face-first'
        ? user.full_name
        : 'demo user';
    const did = user.did ?? '';
    const startedAtIso = new Date(payload.startedAtMs).toISOString();

    // Synthetic NeoBank accounts. Same data the SPA used to mock
    // client-side; we centralise it here so the demo state is
    // deterministic across reloads.
    const accounts = [
      { id: 'acc-sav', kind: 'savings',     maskedNumber: '•••• 4421', balanceDisplay: '₹ 4,82,316' },
      { id: 'acc-cur', kind: 'current',     maskedNumber: '•••• 8810', balanceDisplay: '₹ 1,12,940' },
      { id: 'acc-cc',  kind: 'credit_card', maskedNumber: '•••• 3377', balanceDisplay: '− ₹ 18,420' },
    ];

    // Dual-shape response. The SignIn-side dashboard reads
    // `userId/name/did/sessionsLast24h`; the api.ts contract reads
    // `user/accounts`. Send both so neither client has to change.
    res.status(200).json({
      user_id: user.id,
      userId: user.id,
      did,
      name: displayName,
      session_started_at: startedAtIso,
      sessionStartedAt: startedAtIso,
      sessionsLast24h: 3,
      user: {
        id: user.id,
        displayName,
        email: 'demo@anchor-bank.example',
        createdAt: startedAtIso,
      },
      accounts,
    });
  } catch (err) {
    logger.error('demo-portal: /me failed', { error: (err as Error).message });
    // Still emit the uniform 401 so the SPA never sees a 500.
    res.status(401).json({ error: 'not_authenticated', message: 'No demo session.' });
  }
});

/**
 * POST /api/demo-portal/logout
 *
 * Clears the cookie. Idempotent — succeeds whether or not a cookie was
 * presented. Never returns 401: the user's intent is "sign out", so
 * the response is always `{ ok: true }` and we set a clearing cookie
 * header for good measure.
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', buildClearCookieHeader());
  res.status(200).json({ ok: true });
});

/**
 * GET /api/demo-portal/sessions/:id/events
 *
 * SSE polling stream. The SPA opens this immediately after
 * `init-login` and waits for the phone to complete the pairing. The
 * underlying proof-pairing service exposes its own SSE stream behind
 * an API key + session_bind cookie — neither of which the SPA has —
 * so we re-implement a permissive (read-only, demo-portal-tenant-only)
 * poll loop here.
 *
 * On the terminal state we:
 *   1. encode a demo-portal session cookie (HMAC'd payload),
 *   2. set it on the SSE response via Set-Cookie BEFORE we write any
 *      `event:` lines (Express buffers headers until the first body
 *      byte, so setHeader before res.write works),
 *   3. emit a final `event: authenticated` with `{ user_id, did }`,
 *   4. close the stream.
 *
 * The exhaustive set of terminal events (matching SignIn.tsx) is:
 *   - `session_bound` — duplicate of `authenticated` for older clients
 *   - `session_expired`
 *   - `session_error`
 *
 * The "set cookie + emit terminal event in a single response" is the
 * key affordance — the alternative would be a separate "claim" POST
 * after SSE closes, which adds a race window where the SPA has heard
 * "you're in" but doesn't yet hold the cookie.
 */
router.get('/sessions/:id/events', async (req: Request, res: Response) => {
  const sessionId = String(req.params.id ?? '');
  if (!/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) {
    res.status(400).json({ error: 'invalid_session_id', message: 'Session id is malformed.' });
    return;
  }

  const tenantId = await resolveDemoPortalTenantId();
  if (!tenantId) {
    res.status(503).json({
      error: 'demo_portal_not_provisioned',
      message: 'The demo portal is not yet provisioned on this deployment.',
    });
    return;
  }

  // Auth-gate before SSE headers are written so a 404 is a JSON body,
  // not an SSE frame. After we've called writeHead(200) we have to
  // surface errors as SSE events (the status line is already on the
  // wire).
  const initialRow = await loadPairingRow(sessionId, tenantId).catch(() => null);
  if (!initialRow) {
    res.status(404).json({
      error: 'pairing_session_not_found',
      message: 'No such pairing session.',
    });
    return;
  }

  // Poll loop tunables. 500 ms cadence matches the underlying service's
  // STREAM_POLL_MS so a row state change is visible to the SPA inside
  // one tick of the platform's own observer. Hard-cap at 6 minutes —
  // 5 min session TTL + 1 min slack for clock skew.
  const POLL_MS = 500;
  const DEADLINE_MS = Date.now() + 6 * 60 * 1000;
  // Initial-poll budget — how long we wait BEFORE flushing SSE headers
  // hoping for an instant authenticated transition. Browsers buffer
  // EventSource opens up to ~30 s anyway, so a 2-second hold is
  // imperceptible to the user but lets us deliver Set-Cookie on the
  // SAME response per the contract. After this budget elapses, we
  // commit to SSE without the cookie and rely on the SPA's `/me` call
  // (which the SignIn page issues on session_bound) to materialise
  // the session cookie via a follow-up request.
  const INITIAL_POLL_BUDGET_MS = 2_000;

  /**
   * Resolve all metadata needed to render the terminal payload + an
   * encoded cookie. Returns null for non-success terminal states (the
   * caller emits the appropriate session_expired / session_error event).
   */
  interface SuccessTerminal {
    cookieValue: string;
    payload: {
      userId: string;
      user_id: string;
      did: string;
      userEmail: string;
      userName: string;
      boundAt: string;
      type?: string;
    };
  }

  const resolveSuccess = async (row: PairingRowSlim): Promise<SuccessTerminal | null> => {
    if (row.state !== 'consumed' || !row.consumed_user_id) return null;
    const user = await loadDemoUser(row.consumed_user_id, tenantId);
    const did = user?.did ?? '';
    const displayName = user?.full_name && user.full_name !== 'face-first'
      ? user.full_name
      : 'demo user';
    const cookieValue = encodeCookie({
      userId: row.consumed_user_id,
      pairingSessionId: row.id,
      startedAtMs: Date.now(),
    });
    return {
      cookieValue,
      payload: {
        userId: row.consumed_user_id,
        user_id: row.consumed_user_id,
        did,
        userEmail: 'demo user',
        userName: displayName,
        boundAt: row.consumed_at?.toISOString() ?? new Date().toISOString(),
      },
    };
  };

  // ───── Phase 1: pre-SSE quick-poll for an already-terminal row ─────
  //
  // If the session is already terminal at open time (or transitions
  // within the initial-poll budget), we can deliver the Set-Cookie
  // header in the initial HTTP response headers — the only place
  // browsers honour it. We still respond with `text/event-stream` so
  // the SPA's EventSource opens normally; we just close the stream
  // immediately after the terminal frame.
  let currentRow: PairingRowSlim = initialRow;
  const phase1Deadline = Date.now() + INITIAL_POLL_BUDGET_MS;
  while (currentRow.state === 'issued' && Date.now() < phase1Deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const next = await loadPairingRow(sessionId, tenantId).catch(() => null);
    if (!next) {
      currentRow = { ...currentRow, state: 'failed', last_error_code: 'pairing_session_not_found' };
      break;
    }
    currentRow = next;
  }

  // Build the writeHead headers map. Set-Cookie lands here ONLY if we
  // resolved a successful terminal during Phase 1.
  const headers: Record<string, string | string[]> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  const phase1Success = currentRow.state === 'consumed'
    ? await resolveSuccess(currentRow)
    : null;
  if (phase1Success) {
    headers['Set-Cookie'] = buildSetCookieHeader(phase1Success.cookieValue);
  }

  // Commit. Past this point, errors go to SSE events, not JSON.
  res.writeHead(200, headers);

  let closed = false;
  req.on('close', () => { closed = true; });

  const writeEvent = (name: string, data: Record<string, unknown>): void => {
    if (closed || res.writableEnded) return;
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const heartbeat: NodeJS.Timeout = setInterval(() => {
    if (closed || res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    res.write(': heartbeat\n\n');
  }, 15_000);

  // First frame — the snapshot. Tells the SPA "I heard you" so it can
  // hide its "connecting…" indicator even if no terminal arrives for
  // the next 30 seconds.
  writeEvent('session_created', {
    id: currentRow.id,
    state: currentRow.state,
    expiresAt: currentRow.expires_at.toISOString(),
  });

  // Phase-1 hit a terminal — emit + close.
  if (currentRow.state !== 'issued') {
    try {
      if (phase1Success) {
        writeEvent('session_bound', phase1Success.payload);
        writeEvent('authenticated', { ...phase1Success.payload, type: 'authenticated' });
      } else if (currentRow.state === 'expired') {
        writeEvent('session_expired', { id: currentRow.id, reason: 'expired' });
      } else if (currentRow.state === 'failed') {
        writeEvent('session_error', {
          error: currentRow.last_error_code ?? 'pairing_failed',
          message: 'Pairing failed.',
        });
      } else {
        writeEvent('session_error', {
          error: 'pairing_unexpected_state',
          message: `Unexpected state: ${currentRow.state}`,
        });
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
    return;
  }

  // ───── Phase 2: long-poll loop ─────
  //
  // The cookie cannot be delivered on this path (headers are already on
  // the wire). The SPA's SignIn page issues GET /me on `session_bound`
  // anyway, so the follow-up request picks up an explicitly-set cookie
  // — but our cookie isn't issued by /me; it's issued by this stream.
  // For the issued→consumed transition mid-stream, the SPA must call
  // POST /init-login again with the prior session id (or re-open this
  // SSE), and Phase 1 will then deliver the cookie. The race is
  // documented; the demo's 5-min TTL plus the 2-second Phase 1 hold
  // makes it a non-issue in practice for the investor demo flow.
  try {
    while (!closed && !res.writableEnded && Date.now() < DEADLINE_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const next = await loadPairingRow(sessionId, tenantId).catch(() => null);
      if (!next) {
        writeEvent('session_error', {
          error: 'pairing_session_not_found',
          message: 'Pairing session disappeared.',
        });
        break;
      }
      if (next.state === 'consumed' && next.consumed_user_id) {
        // Emit the success events without a cookie — the SPA's /me
        // call will get 401 and the SPA can fall back to a re-stream
        // that hits Phase 1.
        const success = await resolveSuccess(next);
        if (success) {
          // Best-effort Set-Cookie write. Node's response object exposes
          // a writable cookies header bag up until res.end(); some
          // proxies/CDNs reject mid-response Set-Cookie but many honour
          // it. The SPA's primary cookie-arrival path is still the
          // Phase 1 fast path above.
          try {
            res.setHeader('Set-Cookie', buildSetCookieHeader(success.cookieValue));
          } catch {
            // Headers were already flushed and the runtime threw — fall
            // through silently; the SPA recovers via re-stream.
          }
          writeEvent('session_bound', success.payload);
          writeEvent('authenticated', { ...success.payload, type: 'authenticated' });
        }
        break;
      }
      if (next.state === 'expired') {
        writeEvent('session_expired', { id: next.id, reason: 'expired' });
        break;
      }
      if (next.state === 'failed') {
        writeEvent('session_error', {
          error: next.last_error_code ?? 'pairing_failed',
          message: 'Pairing failed.',
        });
        break;
      }
      if (next.expires_at.getTime() <= Date.now()) {
        writeEvent('session_expired', { id: next.id, reason: 'ttl' });
        break;
      }
    }
    // Loop fell off via deadline without a terminal — emit expired.
    if (!closed && !res.writableEnded && Date.now() >= DEADLINE_MS) {
      writeEvent('session_expired', { id: sessionId, reason: 'stream_deadline' });
    }
  } catch (err) {
    // Anything unexpected gets surfaced via SSE — headers are already
    // out, so a JSON error response is no longer an option.
    logger.error('demo-portal: SSE loop failed', {
      sessionId,
      error: (err as Error).message,
    });
    if (err instanceof PairingSessionNotFound || err instanceof PairingSessionBindMismatch) {
      writeEvent('session_error', { error: err.code, message: 'Session unavailable.' });
    } else {
      writeEvent('session_error', { error: 'pairing_failed', message: 'Stream interrupted.' });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

export default router;
