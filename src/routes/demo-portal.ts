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
import zlib from 'zlib';
import { Router, Request, Response } from 'express';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { config } from '../config';
import { getTenantById, getTenantByEmail } from '../services/tenants';
import {
  createSession as pairingCreateSession,
  submitProof as pairingSubmitProof,
  listPinnedPendingSessions,
  PairingSessionNotFound,
  PairingSessionExpired,
  PairingSessionAlreadyBound,
  PairingSessionLocked,
  PairingSessionBindMismatch,
  PairingNonceMismatch,
  PairingDidUnknown,
  PairingProofInvalid,
  TooManyPendingSessions,
  VerifierUnavailable,
  PlayIntegrityRequired,
  PlayIntegrityInsufficient,
} from '../services/proof-pairing';
import { DEMO_PORTAL_TENANT_ID } from '../services/demo-portal-seed';
import { pgRateLimit } from '../middleware/rate-limit';
import { recordAuditEvent } from '../services/platform';
import { ApiKeyEnvironment, Groth16Proof } from '../types';
import {
  createBankAccount,
  bindEnrollment,
  verifyBankLogin,
  getBankOverview,
  resolveBankAccountByUser,
  executeImmediateTransfer,
  insertPendingTransfer,
  commitTransferIfApproved,
  formatPaise,
  STEP_UP_THRESHOLD_PAISE,
  BankCustomerIdTaken,
  BankInvalidCredentials,
  BankEnrollmentPending,
  BankAccountLocked,
  BankInsufficientFunds,
} from '../services/demo-bank';

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
 * Environment the demo runs in. Must be `live` because:
 *   - `DEMO_PORTAL_API_KEY` (src/services/demo-portal-seed.ts) is
 *     deterministically minted as a `za_live_*` key, so every row the
 *     three-QR ceremony creates via /v1/registrations lands in the
 *     `live` partition of `tenant_users` / `devices` /
 *     `registration_sessions`.
 *   - The `signup-init` route below ALREADY passes `'live'` explicitly
 *     to `startRegistration`, so newly minted users are unambiguously
 *     `live`.
 *   - The demo-portal tenant is a zeroauth-owned sandbox tenant (not a
 *     real customer's production data), so `live` here doesn't cross
 *     any tenant-data boundary — it just keeps the env tag consistent
 *     with the key it was authenticated under.
 * Previously this was `'test'`, which caused a mismatch where
 * `autonomous-test-setup.ts` would register a user in the `live`
 * partition (via the live API key) but the demo-portal login lookup
 * (loadDemoUser / loadPairingRow / pairingSubmitProof) would query the
 * `test` partition and find nothing — forcing a manual SQL INSERT
 * mirror to reconcile.
 */
const DEMO_ENVIRONMENT: ApiKeyEnvironment = 'live';

/**
 * Cookie name + lifetime. 24 h matches the JWT TTL used elsewhere; the
 * cookie is the demo's only auth surface so the lifetime is bounded by
 * the investor demo duration, not by a security guarantee.
 */
const DEMO_COOKIE_NAME = 'demo_portal_session';
const DEMO_COOKIE_PATH = '/api/demo-portal';
const DEMO_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Desktop-side claim-binding cookie (security-review Finding 1).
 *
 * In the phone-push flow the phone submits the proof, so the demo
 * session cookie would be set on the PHONE's response — the desktop
 * then calls POST /sessions/:id/claim to mint its own. Without a
 * binding, /claim would mint a session cookie for anyone who knows the
 * (consumed) session id, turning the session id into a bearer
 * capability (the A-13 session-fixation class).
 *
 * To restore an A-13-equivalent binding without touching the air-gap or
 * the crypto: at init-login we mint a 32-byte random token, set it as a
 * `SameSite=Strict` HttpOnly cookie on the DESKTOP's init-login
 * response, and stash its SHA-256 keyed by session id. /claim then
 * requires that exact cookie (constant-time compare against the stored
 * hash) and is single-use. Only the browser that opened the session
 * holds the token, so only it can claim the session cookie.
 *
 * SameSite=Strict (stricter than the session cookie's Lax) is safe here
 * because the SPA's init-login + claim fetches are same-origin; the
 * token is never needed on a cross-site navigation.
 */
const DEMO_CLAIM_COOKIE_NAME = 'demo_portal_claim';
const DEMO_CLAIM_TOKEN_TTL_MS = 6 * 60 * 1000; // session TTL (5m) + slack

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
  return readNamedCookie(req, DEMO_COOKIE_NAME);
}

/** Read an arbitrary cookie by name from the parsed jar or the raw header. */
function readNamedCookie(req: Request, name: string): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[name] === 'string') {
    return cookies[name];
  }
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

/**
 * Build the `SameSite=Strict` HttpOnly desktop-claim cookie. Scoped to
 * the demo-portal path; lifetime tracks the claim-token TTL so it
 * disappears with the session.
 */
function buildClaimCookieHeader(value: string): string {
  const secure = (process.env.NODE_ENV ?? 'development') === 'production';
  const maxAge = Math.floor(DEMO_CLAIM_TOKEN_TTL_MS / 1000);
  return (
    `${DEMO_CLAIM_COOKIE_NAME}=${value};`
    + ` HttpOnly;`
    + (secure ? ' Secure;' : '')
    + ` SameSite=Strict;`
    + ` Path=${DEMO_COOKIE_PATH};`
    + ` Max-Age=${maxAge}`
  );
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

// ─── Bind-token cache for the SPA-driven submit-proof path ─────────────
//
// The phone-side of the air-gap normally holds the session_bind cookie
// (issued on POST /v1/proof-pairing/sessions and required by the
// submitProof service-layer check). The demo-portal SPA creates the
// session on the user's behalf but the cookie is scoped to
// `/v1/proof-pairing/` and never reaches the SPA — by design, so XSS
// against the SPA can't replay a session bind.
//
// For the "I scanned the phone's proof-QR" loop to close inside the SPA
// we need to call submitProof() server-side from this router, and that
// call requires the bind token. We stash the plaintext bind token in an
// in-memory Map keyed by session id with a 5-minute TTL (matches
// SESSION_TTL_MS in proof-pairing.ts). The token never leaves the
// server — the SPA only ever sees the session id.
//
// Threat-model coverage:
//   - A-13 (session_bind mismatch) — we present the SAME token the
//     server minted, so the submitProof check passes by construction.
//   - A-20 (DoS) — the cache is per-session-id, single-token, TTL'd; an
//     attacker who can POST init-login can only fill it as fast as the
//     underlying MAX_PENDING_SESSIONS_PER_TENANT (50) allows.
//   - A-25 (enumeration) — the cache key is the session id; an attacker
//     guessing session ids gains nothing because they still need a
//     valid proof QR for THAT session id.
const BIND_TOKEN_TTL_MS = 5 * 60 * 1000;

interface CachedBindToken {
  token: string;
  expiresAtMs: number;
}

const sessionBindTokenCache = new Map<string, CachedBindToken>();

/**
 * Desktop-claim token cache (Finding 1). Keyed by session id; stores the
 * SHA-256 of the random token we set in the `demo_portal_claim` cookie
 * at init-login. /claim constant-time-compares the presented cookie's
 * hash against this and deletes the entry on success (single-use →
 * Finding 4). The plaintext token never leaves the desktop's cookie jar.
 */
interface CachedClaimToken {
  tokenSha256: string;
  expiresAtMs: number;
}

const desktopClaimTokenCache = new Map<string, CachedClaimToken>();

function rememberBindToken(sessionId: string, token: string): void {
  sessionBindTokenCache.set(sessionId, {
    token,
    expiresAtMs: Date.now() + BIND_TOKEN_TTL_MS,
  });
}

/**
 * Mint a fresh desktop-claim token for [sessionId], stash its SHA-256,
 * and return the plaintext (the caller sets it in the Set-Cookie). The
 * plaintext is never stored server-side.
 */
function mintClaimToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenSha256 = crypto.createHash('sha256').update(token).digest('hex');
  desktopClaimTokenCache.set(sessionId, {
    tokenSha256,
    expiresAtMs: Date.now() + DEMO_CLAIM_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Constant-time-verify a presented claim-cookie token against the stored
 * hash for [sessionId]. On a match the entry is consumed (single-use).
 * Returns false for: no presented token, no stored entry, expired entry,
 * or hash mismatch — all indistinguishable to the caller (uniform 409).
 */
function verifyAndConsumeClaimToken(sessionId: string, presented: string | undefined): boolean {
  const entry = desktopClaimTokenCache.get(sessionId);
  if (!entry) return false;
  if (entry.expiresAtMs <= Date.now()) {
    desktopClaimTokenCache.delete(sessionId);
    return false;
  }
  if (!presented) return false;
  const presentedHash = crypto.createHash('sha256').update(presented).digest('hex');
  const a = Buffer.from(presentedHash);
  const b = Buffer.from(entry.tokenSha256);
  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;
  // Single-use: drop on success so a re-claim (or a stolen cookie
  // replayed after the desktop already claimed) fails uniformly.
  desktopClaimTokenCache.delete(sessionId);
  return true;
}

function consumeBindToken(sessionId: string): string | null {
  const entry = sessionBindTokenCache.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    sessionBindTokenCache.delete(sessionId);
    return null;
  }
  // Single-use: drop the entry as soon as it's read so a stolen cookie
  // can't ride the same bind token twice.
  sessionBindTokenCache.delete(sessionId);
  return entry.token;
}

/**
 * Sweep expired entries every minute. Fire-and-forget setInterval —
 * never throws, never awaited. Safe on a fresh process; mocked away in
 * tests by the standard fake-timers harness.
 */
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessionBindTokenCache.entries()) {
    if (entry.expiresAtMs <= now) sessionBindTokenCache.delete(id);
  }
  for (const [id, entry] of desktopClaimTokenCache.entries()) {
    if (entry.expiresAtMs <= now) desktopClaimTokenCache.delete(id);
  }
}, 60_000).unref?.();

// ─── Proof-QR decoder (mirror of android/util/QrPayload.kt) ────────────
//
// The phone emits `za:proof:1:<base64url(gzip(cbor(5-field-map)))>` —
// see android/app/src/main/java/dev/zeroauth/android/util/QrPayload.kt
// for the canonical encoder. We decode the inverse here so the
// /submit-proof route can lift the decimal-stringified Groth16 proof
// out of the QR bytes and forward to the existing submitProof service.
//
// CBOR shape we decode:
//   { "s": sessionId, "p": <proof map>, "ps": <string[3]>, "d": did,
//     "m": <client meta map (4-5 keys)> }
// where <proof map> = { "pi_a": string[], "pi_b": string[][], "pi_c": string[],
//                       "protocol": "groth16", "curve": "bn128" }
// and <client meta map> = { "av":appVersion, "pl":platform, "md":model,
//                            "ms":proofMs (uint), "pi":?playIntegrityVerdict }
//
// We deliberately do NOT pull a general CBOR library — the dep-add ADR
// process is heavyweight, and the encoder on the phone is hand-rolled
// to a fixed shape. Mirror only what we need; reject anything else.

const PROOF_QR_PREFIX = 'za:proof:1:';
const PROOF_QR_MAX_BYTES = 1_500;

interface DecodedProofEnvelope {
  sessionId: string;
  proof: Groth16Proof;
  publicSignals: [string, string, string];
  did: string;
  clientMeta: Record<string, unknown>;
}

class ProofPayloadError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Minimal CBOR reader for the 5-field map shape emitted by the phone.
 * Stateful cursor over the input bytes; throws ProofPayloadError on
 * any structural deviation from the documented shape.
 */
class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  /** Read one CBOR data item. */
  read(): unknown {
    const initial = this.readByte();
    const major = initial >> 5;
    const additional = initial & 0x1f;
    const length = this.readLength(additional);
    switch (major) {
      case 0: // unsigned int
        return Number(length);
      case 3: { // text string
        const len = Number(length);
        const s = this.bytes.toString('utf8', this.offset, this.offset + len);
        this.offset += len;
        return s;
      }
      case 4: { // array
        const arr: unknown[] = [];
        const len = Number(length);
        for (let i = 0; i < len; i++) arr.push(this.read());
        return arr;
      }
      case 5: { // map
        const obj: Record<string, unknown> = {};
        const len = Number(length);
        for (let i = 0; i < len; i++) {
          const key = this.read();
          if (typeof key !== 'string') {
            throw new ProofPayloadError('CBOR map key was not a text string');
          }
          obj[key] = this.read();
        }
        return obj;
      }
      default:
        throw new ProofPayloadError(`Unsupported CBOR major type ${major}`);
    }
  }

  private readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new ProofPayloadError('Unexpected end of CBOR input');
    }
    return this.bytes[this.offset++];
  }

  private readLength(additional: number): bigint {
    if (additional < 24) return BigInt(additional);
    if (additional === 24) return BigInt(this.readByte());
    if (additional === 25) {
      return (BigInt(this.readByte()) << 8n) | BigInt(this.readByte());
    }
    if (additional === 26) {
      let v = 0n;
      for (let i = 0; i < 4; i++) v = (v << 8n) | BigInt(this.readByte());
      return v;
    }
    if (additional === 27) {
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.readByte());
      return v;
    }
    throw new ProofPayloadError(`Unsupported CBOR length encoding ${additional}`);
  }
}

function decodeProofQr(payload: string): DecodedProofEnvelope {
  const trimmed = payload.trim();
  if (!trimmed.startsWith(PROOF_QR_PREFIX)) {
    throw new ProofPayloadError(`Expected payload starting with "${PROOF_QR_PREFIX}".`);
  }
  if (trimmed.length > PROOF_QR_MAX_BYTES) {
    throw new ProofPayloadError(`Proof QR exceeded ${PROOF_QR_MAX_BYTES} bytes.`);
  }
  const b64 = trimmed.slice(PROOF_QR_PREFIX.length);
  let gzipped: Buffer;
  try {
    gzipped = Buffer.from(b64, 'base64url');
  } catch {
    throw new ProofPayloadError('Proof QR body was not valid base64url.');
  }
  let cbor: Buffer;
  try {
    cbor = zlib.gunzipSync(gzipped);
  } catch {
    throw new ProofPayloadError('Proof QR body could not be gunzipped.');
  }
  let raw: unknown;
  try {
    raw = new CborReader(cbor).read();
  } catch (err) {
    if (err instanceof ProofPayloadError) throw err;
    throw new ProofPayloadError('Proof QR body was not valid CBOR.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new ProofPayloadError('Proof QR root was not a CBOR map.');
  }
  const root = raw as Record<string, unknown>;

  const sessionId = root['s'];
  const proofMap = root['p'];
  const publicSignals = root['ps'];
  const did = root['d'];
  const metaMap = root['m'];

  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new ProofPayloadError('Proof QR field "s" (sessionId) was missing or not a string.');
  }
  if (typeof did !== 'string' || did.length === 0) {
    throw new ProofPayloadError('Proof QR field "d" (did) was missing or not a string.');
  }
  if (!Array.isArray(publicSignals) || publicSignals.length !== 3
      || publicSignals.some((s) => typeof s !== 'string')) {
    throw new ProofPayloadError('Proof QR field "ps" (publicSignals) must be a 3-string array.');
  }
  if (!proofMap || typeof proofMap !== 'object') {
    throw new ProofPayloadError('Proof QR field "p" (proof) was missing or not a CBOR map.');
  }
  const pm = proofMap as Record<string, unknown>;
  const piA = pm['pi_a'];
  const piB = pm['pi_b'];
  const piC = pm['pi_c'];
  const protocol = pm['protocol'];
  const curve = pm['curve'];
  if (!Array.isArray(piA) || piA.length !== 3 || piA.some((s) => typeof s !== 'string')
      || !Array.isArray(piB) || piB.length !== 3
      || piB.some((row) => !Array.isArray(row) || row.length !== 2
          || row.some((s) => typeof s !== 'string'))
      || !Array.isArray(piC) || piC.length !== 3 || piC.some((s) => typeof s !== 'string')
      || protocol !== 'groth16' || curve !== 'bn128') {
    throw new ProofPayloadError('Proof QR field "p" (proof) shape was not a valid Groth16 proof.');
  }
  const proof: Groth16Proof = {
    pi_a: piA as [string, string, string],
    pi_b: piB as [[string, string], [string, string], [string, string]],
    pi_c: piC as [string, string, string],
    protocol: 'groth16',
    curve: 'bn128',
  };

  const clientMeta: Record<string, unknown> = { source: 'demo-portal' };
  if (metaMap && typeof metaMap === 'object') {
    const mm = metaMap as Record<string, unknown>;
    if (typeof mm['av'] === 'string') clientMeta.appVersion = mm['av'];
    if (typeof mm['pl'] === 'string') clientMeta.platform = mm['pl'];
    if (typeof mm['md'] === 'string') clientMeta.model = mm['md'];
    if (typeof mm['ms'] === 'number') clientMeta.proofMs = mm['ms'];
    if (typeof mm['pi'] === 'string') clientMeta.playIntegrityVerdict = mm['pi'];
  }

  return {
    sessionId,
    proof,
    publicSignals: publicSignals as [string, string, string],
    did,
    clientMeta,
  };
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

    // Stash the bind token so /submit-proof (called by the SPA when the
    // operator scans / pastes the phone's proof-QR into the laptop) can
    // present it to the underlying submitProof service. The plaintext
    // never leaves the server: SPA only sees the session id.
    rememberBindToken(result.id, result.sessionBindToken);

    // Mint the desktop-claim token + set it as a SameSite=Strict cookie
    // on THIS (desktop) response (Finding 1). The phone-push flow has
    // the desktop call /claim to mint its session cookie; this binds
    // that claim to the browser that actually opened the session, so a
    // shoulder-surfed session id cannot be claimed by a third party.
    const claimToken = mintClaimToken(result.id);
    res.setHeader('Set-Cookie', buildClaimCookieHeader(claimToken));

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

/**
 * POST /api/demo-portal/submit-proof
 *
 * Closes the air-gap loop without a webcam. The SPA hands us either:
 *   - { session_id, qr_payload }       — operator pasted the phone's
 *     proof-QR string verbatim into a textarea on /signin, OR
 *   - { session_id, qr_payload }       — laptop's webcam decoded the
 *     phone's QR via the browser BarcodeDetector API and shipped the
 *     raw `za:proof:1:...` string.
 *
 * Decodes the proof QR server-side, looks up the session_bind token we
 * stashed at /init-login time, calls the existing submitProof service
 * (which runs the full crypto chain — Poseidon nonce re-derive,
 * commitment compare, Groth16 verify, atomic consume), and mints the
 * demo_portal_session cookie inline before returning. The SSE stream
 * the SPA opened at /init-login will ALSO see the row flip to
 * `consumed` and emit `session_bound` — both paths are idempotent.
 *
 * Body schema:
 *   { session_id: string, qr_payload: string }
 *
 * Returns 200 with { ok: true, redirect: '/dashboard' } on success
 * (cookie is set on the response). Returns 400 / 401 / 403 / 404 / 409
 * / 410 / 423 / 429 / 503 on the documented submitProof failure
 * classes; the SPA reflects the `error` code into the UI so an investor
 * sees "proof verification failed" rather than a generic 500.
 *
 * Threat-model coverage:
 *   - A-13 — bind token comes from our own cache, populated atomically
 *     in init-login. The SPA never holds it; a stolen demo session
 *     cookie cannot replay submit-proof against a different session id.
 *   - A-14 — submitProof's atomic UPDATE clause prevents two SPAs from
 *     racing the same session to `consumed`.
 *   - A-25 — failure codes are surfaced verbatim from submitProof so
 *     the enumeration-defence guarantees hold end-to-end.
 */
router.post('/submit-proof', async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.body?.session_id === 'string'
      ? req.body.session_id
      : typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    const qrPayload = typeof req.body?.qr_payload === 'string'
      ? req.body.qr_payload
      : typeof req.body?.qrPayload === 'string' ? req.body.qrPayload : '';

    if (!sessionId || !/^[0-9a-fA-F-]{8,64}$/.test(sessionId)) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'session_id is required and must be a UUID.',
      });
      return;
    }
    if (!qrPayload) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'qr_payload is required.',
      });
      return;
    }

    let decoded: DecodedProofEnvelope;
    try {
      decoded = decodeProofQr(qrPayload);
    } catch (err) {
      if (err instanceof ProofPayloadError) {
        res.status(400).json({ error: 'invalid_request', message: err.message });
        return;
      }
      throw err;
    }

    // Defence in depth: the QR's embedded session id MUST match the
    // session the SPA opened. Catches a stale phone-QR scanned into a
    // freshly minted desktop session.
    if (decoded.sessionId !== sessionId) {
      res.status(400).json({
        error: 'invalid_request',
        message: 'Proof QR session id does not match the desktop session.',
      });
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

    const bindToken = consumeBindToken(sessionId);
    if (!bindToken) {
      // Token expired, never minted, or already consumed. Surface a
      // distinct error so the SPA can prompt for a restart rather than
      // looping on the same submit.
      res.status(410).json({
        error: 'pairing_session_expired',
        message: 'This sign-in session has expired or was already used. Try again.',
      });
      return;
    }

    const result = await pairingSubmitProof(
      sessionId,
      tenantId,
      DEMO_ENVIRONMENT,
      decoded.did,
      decoded.proof,
      decoded.publicSignals,
      decoded.clientMeta,
      bindToken,
    );

    // Mint the demo-portal cookie inline so the SPA can navigate to
    // /dashboard immediately — no SSE round-trip required. This mirrors
    // the Phase-1 fast path in /sessions/:id/events.
    const cookieValue = encodeCookie({
      userId: result.session.userId ?? '',
      pairingSessionId: sessionId,
      startedAtMs: Date.now(),
    });
    res.setHeader('Set-Cookie', buildSetCookieHeader(cookieValue));
    res.status(200).json({
      ok: true,
      redirect: '/dashboard',
      session: {
        userId: result.session.userId,
        did: result.session.did,
        boundAt: result.session.boundAt,
      },
    });
  } catch (err) {
    if (err instanceof PairingSessionNotFound) {
      res.status(404).json({ error: err.code, message: 'Pairing session not found.' });
      return;
    }
    if (err instanceof PairingSessionExpired) {
      res.status(410).json({ error: err.code, message: 'Pairing session expired.' });
      return;
    }
    if (err instanceof PairingSessionAlreadyBound) {
      res.status(409).json({ error: err.code, message: 'Pairing session already bound.' });
      return;
    }
    if (err instanceof PairingSessionLocked) {
      res.status(423).json({ error: err.code, message: 'Pairing session locked after repeated failures.' });
      return;
    }
    if (err instanceof PairingSessionBindMismatch) {
      res.status(403).json({ error: err.code, message: 'Session bind mismatch.' });
      return;
    }
    if (err instanceof PairingNonceMismatch) {
      res.status(400).json({ error: err.code, message: 'Public-signals nonce mismatch.' });
      return;
    }
    if (err instanceof PairingDidUnknown) {
      res.status(400).json({ error: err.code, message: 'DID does not resolve for this tenant.' });
      return;
    }
    if (err instanceof PairingProofInvalid) {
      res.status(401).json({ error: err.code, message: 'Proof verification failed.' });
      return;
    }
    if (err instanceof PlayIntegrityRequired) {
      res.status(400).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof PlayIntegrityInsufficient) {
      res.status(401).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof VerifierUnavailable) {
      res.status(503).json({ error: err.code, message: 'Verifier loopback unavailable.' });
      return;
    }
    logger.error('demo-portal: submit-proof failed', { error: (err as Error).message });
    res.status(500).json({ error: 'proof_failed', message: 'Proof submission failed.' });
  }
});

/**
 * POST /api/demo-portal/sessions/:id/claim
 *
 * Desktop-side cookie claim for the PHONE-PUSH sign-in flow.
 *
 * In the phone-push flow (the primary login path now that most desktops
 * lack a working webcam), the phone POSTs its proof directly to
 * /submit-proof. That verifies the proof and flips the pairing row to
 * `consumed` — but the demo cookie set on that response lands on the
 * PHONE, which doesn't need it. The DESKTOP still needs a cookie to call
 * /me and render the dashboard.
 *
 * The desktop calls this endpoint (on its own browser request, so
 * Set-Cookie lands in the desktop's cookie jar) AFTER it hears the
 * `session_bound` SSE event. We:
 *   1. verify the pairing row is `consumed` for the demo tenant, AND
 *   2. verify the desktop holds the `demo_portal_claim` cookie minted
 *      for THIS session at init-login (constant-time, single-use),
 * then mint the demo_portal_session cookie on this response.
 *
 * Security (post-review hardening — Findings 1-4):
 *   - Finding 1 (was: session id as bearer capability): the
 *     `demo_portal_claim` cookie binds the claim to the browser that
 *     opened the session. A shoulder-surfed session id alone cannot
 *     claim the session — the SameSite=Strict HttpOnly claim cookie is
 *     also required. This restores the A-13 (session-fixation) defence
 *     that ADR-0009's session_bind cookie provides on production.
 *   - Finding 4 (idempotent re-claim): the claim token is single-use
 *     (consumed on the first successful match), so a stolen cookie
 *     cannot be replayed after the desktop has claimed.
 *   - Finding 3 (enumeration): ALL not-ready cases — unknown id,
 *     other-tenant id, pending/failed row, missing/wrong claim cookie,
 *     already-claimed — return the SAME uniform 409 `pairing_not_ready`.
 *     Only a malformed id (input format) returns 400. No 404/409 split
 *     leaks existence or bind-state.
 *   - Finding 2 (audit): a `pairing.desktop_claimed` audit row is
 *     awaited on success (fail-closed — no cookie if the trail can't be
 *     written), mirroring the A-21 treatment of `pairing.claimed`.
 *   - Performs NO cryptography and CANNOT consume a pairing session; the
 *     proof was already verified by /submit-proof's full crypto chain.
 *
 * Returns 200 + { ok, userId, did } on success (session cookie set on
 * the response); uniform 409 `pairing_not_ready` for every not-ready
 * case; 400 for a malformed session id; 503 if the demo tenant is not
 * provisioned.
 */
router.post('/sessions/:id/claim', async (req: Request, res: Response) => {
  // Uniform not-ready response — used for every "can't claim" branch so
  // none of them are distinguishable (Finding 3 / A-25).
  const notReady = (): void => {
    res.status(409).json({
      error: 'pairing_not_ready',
      message: 'This sign-in is not complete yet.',
    });
  };
  try {
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

    const row = await loadPairingRow(sessionId, tenantId);
    // Unknown id, other-tenant id (query is tenant-scoped → no row), or
    // a row that isn't bound yet → uniform not-ready. We check the row
    // BEFORE the claim token so a not-consumed session never burns the
    // single-use token.
    if (!row || row.state !== 'consumed' || !row.consumed_user_id) {
      notReady();
      return;
    }

    // Desktop-bind check (Finding 1). The claim cookie was set on this
    // browser at init-login; a third party who only knows the session
    // id does not hold it. Single-use: consumed on success.
    const presentedClaim = readNamedCookie(req, DEMO_CLAIM_COOKIE_NAME);
    if (!verifyAndConsumeClaimToken(sessionId, presentedClaim)) {
      notReady();
      return;
    }

    const user = await loadDemoUser(row.consumed_user_id, tenantId);

    // A-21 / Finding 2: await the audit row BEFORE minting the cookie so
    // a failed audit write refuses the claim rather than minting an
    // untraceable session. Actor is the (unauthenticated) desktop; we
    // record hashed IP + UA so the trail can answer "which device
    // claimed this session" without storing raw PII.
    await recordAuditEvent(tenantId, {
      environment: DEMO_ENVIRONMENT,
      actorType: 'system',
      action: 'pairing.desktop_claimed',
      entityType: 'pairing_session',
      entityId: row.id,
      status: 'success',
      summary: `Desktop claimed session cookie for user ${row.consumed_user_id}`,
      metadata: {
        client_ip_sha256: req.ip
          ? crypto.createHash('sha256').update(req.ip).digest('hex')
          : null,
        user_agent_sha256: req.headers['user-agent']
          ? crypto.createHash('sha256').update(String(req.headers['user-agent'])).digest('hex')
          : null,
      },
    });

    // Bind startedAtMs to the original consume time (not Date.now()) so
    // a re-mint cannot extend the session lifetime (Finding 4 corollary).
    const cookieValue = encodeCookie({
      userId: row.consumed_user_id,
      pairingSessionId: row.id,
      startedAtMs: (row.consumed_at ?? new Date()).getTime(),
    });
    res.setHeader('Set-Cookie', buildSetCookieHeader(cookieValue));
    res.status(200).json({
      ok: true,
      userId: row.consumed_user_id,
      did: user?.did ?? '',
      redirect: '/dashboard',
    });
  } catch (err) {
    logger.error('demo-portal: claim failed', { error: (err as Error).message });
    res.status(500).json({ error: 'claim_failed', message: 'Could not claim the sign-in session.' });
  }
});

// ─── Three-QR signup orchestration ────────────────────────────────────
//
// Until a real customer-tenant onboarding flow ships, the demo-portal
// itself acts as the "tenant signup page" so investors see the full
// three-QR registration end-to-end on a real phone. The endpoints
// below are thin wrappers around the existing /v1/registrations
// service, plus a peek endpoint that lets the SPA see each freshly
// minted plaintext code so it can re-render the next QR. The peek
// only reads from the in-memory demo cache (registration.ts), which is
// populated for the demo-portal tenant (any env) + all non-prod envs —
// see registration.ts::shouldCacheDemoCode. Real production tenants
// never populate it, so their codes stay private to the phone.
//
import {
  startRegistration,
  getRegistrationSession,
  peekPendingDemoCode,
} from '../services/registration';

/**
 * POST /api/demo-portal/signup-init
 *
 * Body: { name?: string, email?: string }
 *
 * Opens a registration session on the NeoBank tenant + returns the
 * pair_code deeplink. The SPA renders it as QR1 and polls
 * /signup/:id/peek for QR2 + QR3.
 */
router.post('/signup-init', async (req: Request, res: Response) => {
  try {
    // The applicant's details, entered on the "open an account" form
    // before the ZeroAuth ceremony. Stored on the registration session
    // profile so the created tenant_user carries real name/email/phone.
    const name = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim().slice(0, 120) : 'Demo User';
    const email = typeof req.body?.email === 'string' && req.body.email.trim()
      ? req.body.email.trim().slice(0, 160) : 'demo@neobank.example';
    const phone = typeof req.body?.phone === 'string' && req.body.phone.trim()
      ? req.body.phone.trim().slice(0, 32) : undefined;
    const result = await startRegistration(
      DEMO_PORTAL_TENANT_ID,
      'live',
      { profile: { name, email, ...(phone ? { phone } : {}) } },
      { type: 'api_key', id: null, email: null },
    );
    res.status(201).json({
      session_id: result.session.id,
      pair_code: result.pairCode,
      pair_deeplink: result.pairDeeplink,
      expires_at: result.pairCodeExpiresAt,
    });
  } catch (err) {
    logger.error('demo-portal: signup-init failed', { error: (err as Error).message });
    res.status(500).json({ error: 'signup_init_failed', message: (err as Error).message });
  }
});

/**
 * GET /api/demo-portal/signup/:id
 *
 * Polled by the SPA every ~1s. Returns:
 *   - session state ('awaiting_device' | 'awaiting_commitment' |
 *                    'awaiting_verification' | 'completed' | 'failed')
 *   - currentDeeplink: the most recently minted plaintext code as a
 *     ready-to-scan deeplink. The SPA renders this as the active QR.
 *     null once state == 'completed' (the user is done).
 */
router.get('/signup/:id', async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.id);
    const session = await getRegistrationSession(
      DEMO_PORTAL_TENANT_ID,
      'live',
      sessionId,
    );
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    const pending = peekPendingDemoCode(sessionId);
    res.status(200).json({
      state: session.state,
      currentDeeplink: pending?.deeplink ?? null,
      currentStep: pending?.step ?? null,
    });
  } catch (err) {
    logger.error('demo-portal: signup poll failed', { error: (err as Error).message });
    res.status(500).json({ error: 'signup_poll_failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Bank 2FA — ZeroAuth as the bank's verification layer.
//
// The bank owns the first factor (customer id + password, stored in
// demo_bank_accounts). ZeroAuth is the second factor: account creation
// binds the customer's enrolled DID onto the bank account, and every
// login opens a DID-PINNED pairing session that lands as an approval
// request in the ZeroAuth app (UPI-collect style) — only a face proof
// from THAT identity can consume it.
// ═══════════════════════════════════════════════════════════════════════

const BANK_EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const BANK_DID_PATTERN = /^did:zeroauth:[a-z0-9-]+:[a-f0-9]{20,80}$/i;

// Per-IP throttles on the public bank endpoints (security review Finding 3):
// the global app limiter is coarse; these bound password-guessing on /login
// and inbox-enumeration on /device/pending independent of overall traffic.
const bankLoginLimiter = pgRateLimit({ route: 'demo:bank:login', windowMs: 60_000, max: 20, keyBy: 'ip' });
const bankPendingLimiter = pgRateLimit({ route: 'demo:device:pending', windowMs: 60_000, max: 60, keyBy: 'ip' });

/**
 * POST /api/demo-portal/bank/signup
 *
 * Body: { name, customerId (email), password }
 *
 * Creates the bank's own account row (password scrypt-hashed, status
 * pending_enrollment) AND opens the ZeroAuth enrollment ceremony. The
 * desktop drives the 3-QR ceremony via GET /bank/signup/:id; the
 * account activates when the ceremony's DID binds.
 *
 * 201 { signupId, pairDeeplink, expiresAt } · 400 invalid_request /
 * weak_password · 409 customer_id_taken · 503 demo_portal_not_provisioned
 */
router.post('/bank/signup', async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      res.status(503).json({ error: 'demo_portal_not_provisioned' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
    const customerId = typeof req.body?.customerId === 'string'
      ? req.body.customerId.trim().toLowerCase().slice(0, 160) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (name.length < 2) {
      res.status(400).json({ error: 'invalid_request', message: 'name is required (2+ chars).' });
      return;
    }
    if (!BANK_EMAIL_PATTERN.test(customerId)) {
      res.status(400).json({ error: 'invalid_request', message: 'customerId must be an email address.' });
      return;
    }
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      res.status(400).json({
        error: 'weak_password',
        message: 'Password must be 8+ characters with at least one letter and one digit.',
      });
      return;
    }

    // Open the enrollment ceremony first — its session id is the
    // signup handle the account row references.
    const ceremony = await startRegistration(
      tenantId,
      DEMO_ENVIRONMENT,
      { profile: { name, email: customerId } },
      { type: 'api_key', id: null, email: null },
    );

    await createBankAccount({
      tenantId,
      environment: DEMO_ENVIRONMENT,
      customerId,
      password,
      fullName: name,
      registrationSessionId: ceremony.session.id,
    });

    // Audit: bank account opened (no password material in metadata).
    void recordAuditEvent(tenantId, {
      environment: DEMO_ENVIRONMENT,
      actorType: 'system',
      action: 'bank.account_opened',
      entityType: 'registration_session',
      entityId: ceremony.session.id,
      status: 'success',
      summary: 'NeoBank demo account opened; ZeroAuth enrollment started',
    }).catch(err => logger.warn('demo-portal: bank signup audit failed', {
      error: (err as Error).message,
    }));

    res.status(201).json({
      signup_id: ceremony.session.id,
      signupId: ceremony.session.id,
      pair_deeplink: ceremony.pairDeeplink,
      pairDeeplink: ceremony.pairDeeplink,
      expires_at: ceremony.pairCodeExpiresAt,
      expiresAt: ceremony.pairCodeExpiresAt,
    });
  } catch (err) {
    if (err instanceof BankCustomerIdTaken) {
      res.status(409).json({ error: 'customer_id_taken', message: err.message });
      return;
    }
    logger.error('demo-portal: bank signup failed', { error: (err as Error).message });
    res.status(500).json({ error: 'bank_signup_failed' });
  }
});

/**
 * GET /api/demo-portal/bank/signup/:id
 *
 * Ceremony poll (SPA, ~1s cadence). Same contract as /signup/:id plus
 * the bank bind: the first poll that sees `completed` stamps the
 * ceremony's DID onto the bank account and activates it.
 *
 * 200 { state, currentDeeplink, currentStep, accountStatus }
 */
router.get('/bank/signup/:id', async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      res.status(503).json({ error: 'demo_portal_not_provisioned' });
      return;
    }
    const sessionId = String(req.params.id);
    const session = await getRegistrationSession(tenantId, DEMO_ENVIRONMENT, sessionId);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    let accountStatus: string | null = null;
    if (session.state === 'completed') {
      const bound = await bindEnrollment(tenantId, DEMO_ENVIRONMENT, sessionId);
      accountStatus = bound?.status ?? null;
    }
    const pending = peekPendingDemoCode(sessionId);
    res.status(200).json({
      state: session.state,
      currentDeeplink: pending?.deeplink ?? null,
      currentStep: pending?.step ?? null,
      accountStatus,
    });
  } catch (err) {
    logger.error('demo-portal: bank signup poll failed', { error: (err as Error).message });
    res.status(500).json({ error: 'signup_poll_failed' });
  }
});

/**
 * POST /api/demo-portal/bank/login
 *
 * Body: { customerId, password }
 *
 * First factor: password (scrypt, uniform 401 on unknown/wrong). On
 * success the SECOND factor starts: a pairing session PINNED to the
 * account's bound DID is opened, and the ZeroAuth app on the enrolled
 * phone picks it up as an approval request. The desktop response gets
 * the claim cookie + session id for the existing SSE→/claim flow. The
 * QR payload is included only as the "phone offline?" fallback.
 *
 * 201 { sessionId, expiresAt, qrPayload } · 400 invalid_request ·
 * 401 invalid_credentials (uniform) · 409 enrollment_pending ·
 * 423 account_locked · 429 too_many_pending_sessions
 */
router.post('/bank/login', bankLoginLimiter, async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      res.status(503).json({ error: 'demo_portal_not_provisioned' });
      return;
    }
    const customerId = typeof req.body?.customerId === 'string'
      ? req.body.customerId.trim().toLowerCase().slice(0, 160) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!customerId || !password) {
      res.status(400).json({ error: 'invalid_request', message: 'customerId and password are required.' });
      return;
    }

    const account = await verifyBankLogin(tenantId, DEMO_ENVIRONMENT, customerId, password);

    // Second factor: DID-pinned pairing session → the app's inbox.
    const result = await pairingCreateSession(
      tenantId,
      DEMO_ENVIRONMENT,
      null,
      req.ip ?? null,
      (req.headers['user-agent'] as string | undefined) ?? null,
      account.did,
    );
    rememberBindToken(result.id, result.sessionBindToken);
    const claimToken = mintClaimToken(result.id);
    res.setHeader('Set-Cookie', buildClaimCookieHeader(claimToken));

    void recordAuditEvent(tenantId, {
      environment: DEMO_ENVIRONMENT,
      actorType: 'system',
      action: 'bank.login_password_ok',
      entityType: 'pairing_session',
      entityId: result.id,
      status: 'success',
      summary: 'Bank password accepted; ZeroAuth approval requested (pinned session)',
    }).catch(err => logger.warn('demo-portal: bank login audit failed', {
      error: (err as Error).message,
    }));

    res.status(201).json({
      session_id: result.id,
      sessionId: result.id,
      expires_at: result.expiresAt,
      expiresAt: result.expiresAt,
      qr_payload: result.qrPayload,
      qrPayload: result.qrPayload,
      approval: 'push',
    });
  } catch (err) {
    if (err instanceof BankInvalidCredentials) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Customer id or password is incorrect.' });
      return;
    }
    if (err instanceof BankEnrollmentPending) {
      res.status(409).json({ error: 'enrollment_pending', message: 'Finish ZeroAuth enrollment to activate this account.' });
      return;
    }
    if (err instanceof BankAccountLocked) {
      res.status(423).json({ error: 'account_locked', message: 'Account locked after repeated failures.' });
      return;
    }
    if (err instanceof TooManyPendingSessions) {
      res.status(429).json({ error: 'too_many_pending_sessions', message: 'Too many open sign-in sessions. Try again shortly.' });
      return;
    }
    logger.error('demo-portal: bank login failed', { error: (err as Error).message });
    res.status(500).json({ error: 'bank_login_failed' });
  }
});

/**
 * POST /api/demo-portal/device/pending
 *
 * Body: { did }
 *
 * The ZeroAuth app's approval inbox (UPI-collect style): pending
 * DID-pinned login requests for this identity. Each entry carries the
 * same `za:pair:1:` challenge a desktop QR would have shown — the app
 * feeds it into its existing prove→authorize flow. Approval still
 * requires the enrolled face; this listing only reveals that a login
 * is pending (see threat model A-27; FCM + device token is the
 * production path).
 *
 * 200 { requests: [{ sessionId, qrPayload, bank, deviceHint,
 *                    requestedAt, expiresAt }] }
 */
router.post('/device/pending', bankPendingLimiter, async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveDemoPortalTenantId();
    if (!tenantId) {
      res.status(503).json({ error: 'demo_portal_not_provisioned' });
      return;
    }
    const did = typeof req.body?.did === 'string' ? req.body.did.trim() : '';
    if (!BANK_DID_PATTERN.test(did)) {
      res.status(400).json({ error: 'invalid_request', message: 'did must be a did:zeroauth identifier.' });
      return;
    }
    const sessions = await listPinnedPendingSessions(tenantId, DEMO_ENVIRONMENT, did);
    res.status(200).json({
      requests: sessions.map(s => ({
        session_id: s.id,
        sessionId: s.id,
        qr_payload: s.qrPayload,
        qrPayload: s.qrPayload,
        bank: 'NeoBank',
        device_hint: s.deviceHint,
        deviceHint: s.deviceHint,
        context_label: s.contextLabel,
        contextLabel: s.contextLabel,
        kind: s.contextLabel ? 'payment' : 'login',
        requested_at: s.createdAt,
        requestedAt: s.createdAt,
        expires_at: s.expiresAt,
        expiresAt: s.expiresAt,
      })),
    });
  } catch (err) {
    logger.error('demo-portal: device pending poll failed', { error: (err as Error).message });
    res.status(500).json({ error: 'pending_poll_failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// NeoBank dashboard — real ledger + payments with face step-up.
//
// A transfer >= STEP_UP_THRESHOLD opens a DID-pinned pairing session
// labelled with the amount + payee; it lands in the ZeroAuth app inbox as
// a "Payment approval" and money moves ONLY when the account holder's own
// face consumes it (same pin invariant as login). Below the threshold the
// transfer settles instantly.
// ═══════════════════════════════════════════════════════════════════════

/** Cookie-auth guard for the bank dashboard routes. Returns the resolved
 *  { tenantId, userId } or null (the caller replies 401). */
async function requireBankSession(
  req: Request,
): Promise<{ tenantId: string; userId: string } | null> {
  const payload = decodeCookie(readDemoCookie(req));
  if (!payload) return null;
  const tenantId = await resolveDemoPortalTenantId();
  if (!tenantId) return null;
  return { tenantId, userId: payload.userId };
}

/**
 * GET /api/demo-portal/bank/overview — the dashboard payload: the
 * customer's balance + recent transactions (seeded on first read).
 * 200 { fullName, did, primaryBalanceDisplay, accounts[], transactions[] }
 * · 401 not_authenticated · 404 no_account
 */
router.get('/bank/overview', async (req: Request, res: Response) => {
  try {
    const session = await requireBankSession(req);
    if (!session) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const overview = await getBankOverview(session.tenantId, DEMO_ENVIRONMENT, session.userId);
    if (!overview) {
      res.status(404).json({ error: 'no_account', message: 'No bank account for this session.' });
      return;
    }
    res.status(200).json({
      fullName: overview.fullName,
      did: overview.did,
      primaryBalancePaise: overview.primaryBalancePaise,
      primaryBalanceDisplay: formatPaise(overview.primaryBalancePaise),
      stepUpThresholdPaise: STEP_UP_THRESHOLD_PAISE,
      stepUpThresholdDisplay: formatPaise(STEP_UP_THRESHOLD_PAISE),
      accounts: overview.accounts.map(a => ({
        ...a, balanceDisplay: formatPaise(a.balancePaise),
      })),
      transactions: overview.transactions.map(t => ({
        ...t, amountDisplay: formatPaise(t.amountPaise),
      })),
    });
  } catch (err) {
    logger.error('demo-portal: bank overview failed', { error: (err as Error).message });
    res.status(500).json({ error: 'overview_failed' });
  }
});

/**
 * POST /api/demo-portal/bank/transfer — send money.
 * Body: { amount (rupees), payeeName, payeeHandle?, note? }
 *
 * < step-up threshold: debits + settles immediately.
 * >= threshold: opens a DID-pinned "Payment approval" session and returns
 *   { requiresApproval: true, transferId, sessionId, qrPayload, ... }; the
 *   desktop polls /bank/transfer/:id while the phone approves with a face.
 *
 * 200/201 · 400 invalid_request / insufficient_funds · 401 · 404 no_account
 */
router.post('/bank/transfer', bankLoginLimiter, async (req: Request, res: Response) => {
  try {
    const session = await requireBankSession(req);
    if (!session) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const rupees = Number(req.body?.amount);
    const payeeName = typeof req.body?.payeeName === 'string' ? req.body.payeeName.trim().slice(0, 60) : '';
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 140) : null;

    // Safe-integer + a sane ₹10 crore ceiling (security review Finding 2):
    // above MAX_SAFE_INTEGER the paise math loses precision, which would
    // garble the approval label the user consents to and the audit trail.
    if (!Number.isSafeInteger(rupees) || rupees <= 0 || rupees > 10_00_00_000) {
      res.status(400).json({ error: 'invalid_request', message: 'amount must be a positive whole number of rupees, up to ₹10,00,00,000.' });
      return;
    }
    if (payeeName.length < 2) {
      res.status(400).json({ error: 'invalid_request', message: 'payeeName is required.' });
      return;
    }
    const amountPaise = rupees * 100;

    const account = await resolveBankAccountByUser(session.tenantId, DEMO_ENVIRONMENT, session.userId);
    if (!account || account.status !== 'active' || !account.did) {
      res.status(404).json({ error: 'no_account', message: 'No active bank account for this session.' });
      return;
    }

    const input = { amountPaise, payeeName, note };

    if (amountPaise >= STEP_UP_THRESHOLD_PAISE) {
      // Step-up: pinned, labelled approval session.
      const label = `Pay ${formatPaise(amountPaise)} to ${payeeName}`;
      const pairing = await pairingCreateSession(
        session.tenantId,
        DEMO_ENVIRONMENT,
        null,
        req.ip ?? null,
        (req.headers['user-agent'] as string | undefined) ?? null,
        account.did,
        label,
      );
      rememberBindToken(pairing.id, pairing.sessionBindToken);
      const { transferId } = await insertPendingTransfer(account.id, input, pairing.id);

      void recordAuditEvent(session.tenantId, {
        environment: DEMO_ENVIRONMENT,
        actorType: 'system',
        action: 'bank.transfer_stepup_requested',
        entityType: 'pairing_session',
        entityId: pairing.id,
        status: 'success',
        summary: `Step-up requested for a ${formatPaise(amountPaise)} transfer`,
      }).catch(() => undefined);

      res.status(201).json({
        requiresApproval: true,
        transferId,
        sessionId: pairing.id,
        expiresAt: pairing.expiresAt,
        qrPayload: pairing.qrPayload,
        contextLabel: label,
        amountDisplay: formatPaise(amountPaise),
        payeeName,
      });
      return;
    }

    // Under the threshold — settle immediately.
    const { transferId, balancePaise } = await executeImmediateTransfer(account.id, input);
    res.status(200).json({
      requiresApproval: false,
      transferId,
      status: 'completed',
      balancePaise,
      balanceDisplay: formatPaise(balancePaise),
      amountDisplay: formatPaise(amountPaise),
      payeeName,
    });
  } catch (err) {
    if (err instanceof BankInsufficientFunds) {
      res.status(400).json({ error: 'insufficient_funds', message: 'Insufficient balance for this transfer.' });
      return;
    }
    if (err instanceof TooManyPendingSessions) {
      res.status(429).json({ error: 'too_many_pending_sessions', message: 'Too many open approvals. Try again shortly.' });
      return;
    }
    logger.error('demo-portal: bank transfer failed', { error: (err as Error).message });
    res.status(500).json({ error: 'transfer_failed' });
  }
});

/**
 * GET /api/demo-portal/bank/transfer/:id — poll a step-up transfer. Money
 * moves here, and only when the linked pinned session is `consumed` (the
 * account holder's face approved it). Idempotent.
 * 200 { status: pending_approval|completed|declined, balanceDisplay? }
 */
router.get('/bank/transfer/:id', bankPendingLimiter, async (req: Request, res: Response) => {
  try {
    const session = await requireBankSession(req);
    if (!session) {
      res.status(401).json({ error: 'not_authenticated' });
      return;
    }
    const account = await resolveBankAccountByUser(session.tenantId, DEMO_ENVIRONMENT, session.userId);
    if (!account) {
      res.status(404).json({ error: 'no_account' });
      return;
    }
    const transferId = String(req.params.id);
    const result = await commitTransferIfApproved(account.id, transferId);
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'transfer_not_found' });
      return;
    }
    if (result.status === 'completed' && result.balancePaise != null) {
      void recordAuditEvent(session.tenantId, {
        environment: DEMO_ENVIRONMENT,
        actorType: 'system',
        action: 'bank.transfer_settled',
        entityType: 'demo_bank_transaction',
        entityId: transferId,
        status: 'success',
        summary: `Transfer of ${formatPaise(result.amountPaise ?? 0)} settled after face approval`,
      }).catch(() => undefined);
    }
    res.status(200).json({
      status: result.status,
      transferId: result.transferId,
      counterparty: result.counterparty,
      amountDisplay: result.amountPaise != null ? formatPaise(result.amountPaise) : null,
      balanceDisplay: result.balancePaise != null ? formatPaise(result.balancePaise) : null,
    });
  } catch (err) {
    logger.error('demo-portal: bank transfer poll failed', { error: (err as Error).message });
    res.status(500).json({ error: 'transfer_poll_failed' });
  }
});

export default router;
