import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../services/logger';
import { pgRateLimit } from '../middleware/rate-limit';
import { createTenant, createTenantWithHash, hashPassword, authenticateTenant, getTenantById, getTenantByEmail } from '../services/tenants';
import { createPendingSignup, consumePendingSignup } from '../services/pending-signups';
import { createApiKey, listApiKeys, revokeApiKey, countActiveKeys } from '../services/api-keys';
import { getUsageSummary, getRecentCalls, getCurrentMonthUsage } from '../services/usage';
import {
  getConsoleOverview,
  listAuditEvents,
  recordAuditEvent,
  isValidDeviceType,
  issueEnrollmentCode,
  listDevices,
  regenerateEnrollmentCode,
  revokeDevice,
  updateDevice,
  createTenantUser,
  listTenantUsers,
  updateTenantUser,
  listVerificationEvents,
  listAttendanceEvents,
} from '../services/platform';
import {
  abandonRegistration,
  getRegistrationSession,
  startRegistration,
} from '../services/registration';
import {
  ApiKeyEnvironment,
  ApiScope,
  AttendanceEventType,
  AttendanceResult,
  DeviceEnrollmentState,
  DeviceStatus,
  TenantUserStatus,
  VerificationMethod,
  VerificationResult,
} from '../types';
import { sendMail } from '../services/email';
import { welcomeEmail, signupAttemptedNoticeEmail, verifySignupEmail } from '../services/email-templates';
import {
  createSession as pairingCreateSession,
  submitProof as pairingSubmitProof,
  getSession as pairingGetSession,
  subscribeStream as pairingSubscribeStream,
  streamHeartbeatMs as pairingStreamHeartbeatMs,
  PairingSessionNotFound,
  PairingSessionExpired,
  PairingSessionAlreadyBound,
  PairingSessionLocked,
  PairingSessionBindMismatch,
  PairingNonceMismatch,
  PairingDidUnknown,
  PairingProofInvalid,
  PairingTenantMismatch,
  TooManyPendingSessions,
  VerifierUnavailable,
  PlayIntegrityRequired,
  PlayIntegrityInsufficient,
} from '../services/proof-pairing';
import { Groth16Proof } from '../types';
import { subscribeVerifications } from '../services/verification-events';

const router = Router();

// ─── Password policy ─────────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 12;
const COMMON_PASSWORDS = new Set([
  'password', 'password123', 'changeme', 'letmein', 'qwerty', 'qwerty123',
  '12345678', '123456789', '1234567890', 'admin1234', 'welcome1', 'iloveyou',
  'zeroauth', 'zeroauth123', 'zero-auth', 'p@ssw0rd', 'passw0rd',
]);

function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 256) {
    return 'Password must be at most 256 characters.';
  }
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasLetter || !hasDigit) {
    return 'Password must contain at least one letter and one digit.';
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'Password is too common. Pick something less guessable.';
  }
  return null;
}

// ─── Rate limits ─────────────────────────────────────────────────
// Anti-enumeration / credential-stuffing limit on the unauthenticated auth
// endpoints. Skipped under NODE_ENV=test so the jest suite isn't throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'too_many_attempts',
    message: 'Too many sign-up / login attempts from this IP. Try again in 15 minutes.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// Per-tenant rate limit on authenticated console WRITE endpoints (issue #26
// F-4). A stolen JWT can otherwise burn through the global 300/15min limiter
// before any other tenant feels it. Keyed on the console.tenantId, not the
// IP, so the limiter actually disincentivises the attacker class we care
// about. Reads (GET) are unaffected.
const consoleWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ctx = (req as { console?: { tenantId?: string } }).console;
    return ctx?.tenantId ?? req.ip ?? 'anonymous';
  },
  message: {
    error: 'tenant_write_rate_limited',
    message: 'Too many write requests for this tenant in the last 15 minutes. Pace your console actions or contact support.',
  },
  skip: () => process.env.NODE_ENV === 'test',
});

// ─── Helper: Console JWT (for developer dashboard sessions) ──────
//
// Tokens carry:
//   - `aud: 'zeroauth-console'`  — verified explicitly; a console JWT must
//     never be accepted on a /v1 endpoint and vice versa.
//   - `iss: 'zeroauth-console'`  — issuer.
//   - `jti: <uuid v4>`           — per-token id, makes server-side
//     revocation possible once the Redis-backed jti allow-list lands
//     (open ADR — see issue #26 F-5).
//   - `type: 'console'`          — historical marker; kept until the
//     dashboard's stored tokens have rotated past the 24h window.

const CONSOLE_JWT_ISSUER = 'zeroauth-console';
const CONSOLE_JWT_AUDIENCE = 'zeroauth-console';

function issueConsoleToken(tenantId: string, email: string): string {
  return jwt.sign(
    { tenantId, email, type: 'console' },
    config.jwt.secret,
    {
      expiresIn: '24h',
      issuer: CONSOLE_JWT_ISSUER,
      audience: CONSOLE_JWT_AUDIENCE,
      jwtid: randomUUID(),
    },
  );
}

function verifyConsoleToken(token: string): { tenantId: string; email: string; jti?: string } {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: CONSOLE_JWT_ISSUER,
    audience: CONSOLE_JWT_AUDIENCE,
  }) as any;
  if (payload.type !== 'console') throw new Error('Not a console token');
  return { tenantId: payload.tenantId, email: payload.email, jti: payload.jti };
}

/**
 * HttpOnly cookie name used as the EventSource auth fallback.
 *
 * EventSource has no API to set custom headers, so the SSE stream at
 * `/api/console/proof-pairing/sessions/:id/stream` cannot be reached
 * through the normal Authorization-header path. Phase 0 audit finding
 * C-3 removed the prior `?access_token=` query-string fallback (tokens
 * in query strings land in Caddy access logs). The replacement is this
 * HttpOnly, SameSite=Strict cookie set at login and refreshed at
 * subsequent authenticated requests.
 */
const CONSOLE_JWT_COOKIE = 'zeroauth_console_jwt';

function isProductionEnv(): boolean {
  return (process.env.NODE_ENV ?? 'development') === 'production';
}

function setConsoleJwtCookie(res: Response, token: string): void {
  // 24 h is the configured JWT TTL (see config.jwt.expiresIn); the
  // cookie outlives the token by no more than 60 s of clock skew.
  const maxAgeMs = 24 * 60 * 60 * 1000;
  res.cookie(CONSOLE_JWT_COOKIE, token, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
    maxAge: maxAgeMs,
    path: '/api/console',
  });
}

function clearConsoleJwtCookie(res: Response): void {
  res.clearCookie(CONSOLE_JWT_COOKIE, { path: '/api/console' });
}

/**
 * Middleware: authenticate console session.
 *
 * Reads the JWT in order: (1) `Authorization: Bearer …` header, then
 * (2) the HttpOnly `zeroauth_console_jwt` cookie. The cookie path is
 * `/api/console` so it never reaches the public `/v1/*` surface.
 *
 * The `?access_token=` query fallback that previously existed for
 * EventSource is removed (P0 audit finding C-3). EventSource clients
 * now rely on the cookie + `withCredentials: true`.
 */
function requireConsoleAuth(req: Request, res: Response, next: any): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.cookies?.[CONSOLE_JWT_COOKIE] === 'string') {
    token = req.cookies[CONSOLE_JWT_COOKIE];
  }

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Login required.' });
    return;
  }

  try {
    const payload = verifyConsoleToken(token);
    (req as any).console = payload;
    next();
  } catch {
    res.status(401).json({ error: 'session_expired', message: 'Console session expired. Please login again.' });
  }
}

// ─── Auth Endpoints ──────────────────────────────────────────────

/**
 * POST /api/console/signup
 *
 * Create a developer account.
 * Body: { email, password, companyName? }
 */
router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  // F-2 v2 byte-identical signup (issue #27):
  //
  // Goal: an attacker probing addresses against /api/console/signup must
  // observe identical responses (status, body, timing) whether the email is
  // taken or fresh. The v1 partial-fix kept the 201/409 split to preserve
  // the one-round-trip dashboard flow; v2 splits creation into two steps
  // and returns a uniform 202 from this endpoint.
  //
  // Branches (both end with the same 202 response):
  //   (a) Fresh email: hash the password, park the payload in
  //       pending_signups under a 24h-TTL token, send a verification
  //       email. Tenant is NOT created until the user clicks the link.
  //   (b) Email taken: send the legitimate holder a "someone tried to
  //       sign up" notice (security signal). Pin the same CPU cost as
  //       (a) by burning a scrypt hash on the request, so the timing
  //       side-channel is also closed.
  //
  // Anything that would 4xx (missing field, weak password) is still
  // returned synchronously — those checks don't leak account existence.
  //
  // See governance: docs/threat-model/api.md A-05 (Account Enumeration).
  const { email, password, companyName } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'invalid_request', message: 'Email and password are required.' });
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    res.status(400).json({ error: 'invalid_password', message: passwordError });
    return;
  }

  // Uniform 202 response body — referenced from both branches below.
  // The wording is deliberately ambiguous about whether the email was
  // already registered. Clients show a "check your inbox" view.
  const UNIFORM_BODY = {
    status: 'pending_verification' as const,
    message: 'If this email isn\'t already registered, we\'ve sent a verification link. Check your inbox.',
  };

  try {
    const existing = await getTenantByEmail(email);
    const sourceIp = (req.ip || req.headers['x-forwarded-for'] || '').toString().slice(0, 64) || null;

    if (existing) {
      // Branch (b): email taken. Burn an equivalent scrypt cost (the
      // fresh-email branch will also hashPassword + write a row), then
      // signal-email the legitimate holder. Fire-and-forget so the
      // response timing doesn't leak success/failure of the SMTP call.
      try {
        await hashPassword(password);
      } catch { /* swallow — timing only */ }

      void (async () => {
        const tmpl = signupAttemptedNoticeEmail({ email: existing.email, attemptIp: sourceIp });
        await sendMail({ to: existing.email, ...tmpl });
      })();

      res.status(202).json(UNIFORM_BODY);
      return;
    }

    // Branch (a): fresh email. Hash + park + email.
    const passwordHash = await hashPassword(password);
    const { token, expiresAt } = await createPendingSignup({
      email,
      passwordHash,
      companyName: companyName || null,
    });

    const verifyUrl = `${config.apiBaseUrl.replace(/\/$/, '')}/api/console/verify-signup?token=${encodeURIComponent(token)}`;
    void (async () => {
      const tmpl = verifySignupEmail({ email, verifyUrl, expiresAt });
      await sendMail({ to: email, ...tmpl });
    })();

    logger.info('Console: Pending signup parked', { sourceIp });
    res.status(202).json(UNIFORM_BODY);
  } catch (err) {
    logger.error('Console: Signup error', { error: (err as Error).message });
    // Return the same 202 body — never confess error state to the
    // client because that would create a "this email is registered"
    // side channel.
    res.status(202).json(UNIFORM_BODY);
  }
});

/**
 * GET /api/console/verify-signup?token=...
 *
 * Second leg of the F-2 v2 flow. Consumes the verification token,
 * creates the real tenant + a default live API key, issues a console
 * JWT, and redirects to the dashboard. The dashboard receives the
 * JWT via a one-time cookie and reveals the API key on landing.
 */
router.get('/verify-signup', async (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  if (!token) {
    res.status(400).send(renderVerifyResultHtml({ ok: false, message: 'Missing or invalid verification token.' }));
    return;
  }

  try {
    const payload = await consumePendingSignup(token);
    if (!payload) {
      res.status(400).send(renderVerifyResultHtml({ ok: false, message: 'This link is invalid or has already been used. Try signing up again.' }));
      return;
    }

    // Double-check the email isn't taken by a race with another verify or
    // a direct DB seed. Idempotent fallback: if the email is now claimed,
    // route the user to login rather than re-creating.
    const conflict = await getTenantByEmail(payload.email);
    if (conflict) {
      res.redirect(303, '/dashboard/login?already_verified=1');
      return;
    }

    const tenant = await createTenantWithHash(payload.email, payload.passwordHash, payload.companyName);
    const defaultKey = await createApiKey(tenant.id, 'Default Live Key', 'live');
    const jwtToken = issueConsoleToken(tenant.id, tenant.email);
    setConsoleJwtCookie(res, jwtToken);

    logger.info('Console: Tenant verified + created', { tenantId: tenant.id });
    void recordAuditEvent(tenant.id, {
      actorType: 'console',
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      status: 'success',
      summary: `Verified + created tenant account for ${tenant.email}`,
      metadata: { companyName: tenant.company_name, plan: tenant.plan, viaEmailVerification: true },
    }).catch(() => undefined);

    void (async () => {
      const tmpl = welcomeEmail({
        email: tenant.email,
        companyName: tenant.company_name ?? null,
        tenantId: tenant.id,
      });
      await sendMail({ to: tenant.email, ...tmpl });
    })();

    // Hand the dashboard a one-shot reveal payload via signed cookie.
    // The dashboard signup-complete page reads it once and clears it.
    const revealPayload = Buffer.from(JSON.stringify({
      token: jwtToken,
      apiKey: defaultKey.key,
      apiKeyId: defaultKey.id,
      apiKeyName: defaultKey.name,
      apiKeyPrefix: defaultKey.key_prefix,
      apiKeyEnv: defaultKey.environment,
    }), 'utf8').toString('base64url');

    // Cross-subdomain cookie. After the api./console.zeroauth.dev split
    // the verify-signup endpoint lives on api.zeroauth.dev but the
    // dashboard reads the reveal cookie on console.zeroauth.dev — they
    // share state only if the cookie is scoped to the eTLD+1.
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const apexHost = (() => {
      try { return new URL(config.consoleBaseUrl).hostname; } catch { return null; }
    })();
    const cookieDomain = apexHost && apexHost.endsWith('zeroauth.dev') ? '.zeroauth.dev' : undefined;
    res.cookie('zeroauth_signup_reveal', revealPayload, {
      httpOnly: false, // dashboard JS must read it
      secure: isHttps,
      sameSite: 'lax',
      maxAge: 5 * 60 * 1000, // 5 minutes — single-use; dashboard clears on read
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });

    // After verification we land the user on the console. In dev that's
    // /dashboard/signup-complete on the same host; in prod it's
    // console.zeroauth.dev/signup-complete.
    res.redirect(303, `${config.consoleBaseUrl.replace(/\/$/, '')}/signup-complete`);
  } catch (err) {
    logger.error('Console: verify-signup error', { error: (err as Error).message });
    res.status(500).send(renderVerifyResultHtml({ ok: false, message: 'Something went wrong completing your signup. Please try the verification link again, or sign up afresh.' }));
  }
});

function renderVerifyResultHtml(input: { ok: boolean; message: string }): string {
  const safeMsg = input.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const title = input.ok ? 'Account ready' : 'Verification failed';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>${title} — ZeroAuth</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fafafa; color: #0a0a0a; margin: 0; padding: 64px 24px; display: flex; min-height: 100vh; box-sizing: border-box; }
  main { max-width: 480px; margin: auto; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 300; font-size: 2rem; letter-spacing: -0.02em; margin-bottom: 16px; }
  p { font-size: 15px; line-height: 1.6; color: #525252; margin-bottom: 24px; }
  a { display: inline-block; padding: 12px 24px; background: #0a0a0a; color: #fff; text-decoration: none; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 500; }
</style>
</head><body><main>
  <h1>${title}</h1>
  <p>${safeMsg}</p>
  <a href="/dashboard/signup">Try again</a>
</main></body></html>`;
}

/**
 * POST /api/console/login
 *
 * Authenticate developer account.
 * Body: { email, password }
 */
router.post('/login',
  authLimiter,
  // C-026: Postgres-backed per-IP rate-limit on top of the existing
  // in-memory authLimiter. The in-memory limiter only protects a
  // single process; once the API runs on multiple replicas an
  // attacker who hashes credential-stuffing attempts across replicas
  // defeats the in-memory layer. 10 req / 60s matches the
  // anti-credential-stuffing baseline in docs/security/audit-findings.md.
  pgRateLimit({ route: 'console:login', windowMs: 60_000, max: 10, keyBy: 'ip' }),
  async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'invalid_request', message: 'Email and password are required.' });
      return;
    }

    const tenant = await authenticateTenant(email, password);
    if (!tenant) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password.' });
      return;
    }

    const token = issueConsoleToken(tenant.id, tenant.email);
    setConsoleJwtCookie(res, token);

    res.json({
      token,
      tenant: {
        id: tenant.id,
        email: tenant.email,
        companyName: tenant.company_name,
        plan: tenant.plan,
        status: tenant.status,
      },
    });
  } catch (err) {
    logger.error('Console: Login error', { error: (err as Error).message });
    res.status(500).json({ error: 'login_failed' });
  }
});

// ─── API Key Management ──────────────────────────────────────────

/**
 * GET /api/console/keys
 *
 * List all API keys for the authenticated tenant.
 */
router.get('/keys', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const keys = await listApiKeys(tenantId);
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list keys.' });
  }
});

/**
 * POST /api/console/keys
 *
 * Create a new API key.
 * Body: { name?, environment?, scopes? }
 */
router.post('/keys', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;

    // Limit: max 10 active keys per tenant
    const activeCount = await countActiveKeys(tenantId);
    if (activeCount >= 10) {
      res.status(400).json({
        error: 'key_limit_reached',
        message: 'Maximum 10 active API keys per account. Revoke unused keys first.',
      });
      return;
    }

    const name = req.body.name || 'API Key';
    const environment = (req.body.environment || 'live') as ApiKeyEnvironment;
    const scopes = req.body.scopes as ApiScope[] | undefined;

    const key = await createApiKey(tenantId, name, environment, scopes);

    res.status(201).json({
      key: key.key,
      id: key.id,
      name: key.name,
      prefix: key.key_prefix,
      environment: key.environment,
      scopes: key.scopes,
      createdAt: key.created_at,
      warning: '⚠ Copy this API key now — it will never be shown again.',
    });
  } catch (err) {
    logger.error('Console: Create key error', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to create key.' });
  }
});

/**
 * DELETE /api/console/keys/:keyId
 *
 * Revoke an API key. Irreversible.
 */
router.delete('/keys/:keyId', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const { keyId } = req.params;

    const revoked = await revokeApiKey(tenantId, keyId);
    if (!revoked) {
      res.status(404).json({ error: 'Key not found or already revoked.' });
      return;
    }

    res.json({ message: 'API key revoked successfully.', keyId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke key.' });
  }
});

// ─── Usage & Billing ─────────────────────────────────────────────

/**
 * GET /api/console/usage
 *
 * Get usage summary for the authenticated tenant.
 */
router.get('/usage', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found.' });
      return;
    }

    const currentMonth = await getCurrentMonthUsage(tenantId);
    const history = await getUsageSummary(tenantId);
    const recentCalls = await getRecentCalls(tenantId, 50);

    res.json({
      plan: tenant.plan,
      currentMonth: {
        used: currentMonth,
        limit: tenant.monthly_quota,
        remaining: tenant.monthly_quota === -1 ? 'unlimited' : Math.max(0, tenant.monthly_quota - currentMonth),
      },
      rateLimit: {
        requestsPer15Min: tenant.rate_limit,
      },
      history,
      recentCalls,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch usage.' });
  }
});

/**
 * GET /api/console/account
 *
 * Get current account info.
 */
router.get('/account', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found.' });
      return;
    }

    res.json({
      id: tenant.id,
      email: tenant.email,
      companyName: tenant.company_name,
      plan: tenant.plan,
      status: tenant.status,
      rateLimit: tenant.rate_limit,
      monthlyQuota: tenant.monthly_quota,
      createdAt: tenant.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch account.' });
  }
});

/**
 * GET /api/console/overview
 *
 * Returns the Week 1 demo viewer data for a tenant/environment.
 */
router.get('/overview', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = (req.query.environment === 'test' ? 'test' : 'live') as ApiKeyEnvironment;
    const overview = await getConsoleOverview(tenantId, environment);
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch overview.' });
  }
});

/**
 * GET /api/console/audit
 *
 * Returns recent business audit events for the selected environment.
 */
router.get('/audit', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = (req.query.environment === 'test' ? 'test' : 'live') as ApiKeyEnvironment;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const status = req.query.status === 'failure' ? 'failure' : req.query.status === 'success' ? 'success' : undefined;
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    const events = await listAuditEvents(tenantId, environment, { action, status, limit });
    res.json({ environment, events });
  } catch {
    res.status(500).json({ error: 'Failed to fetch audit events.' });
  }
});

// ─── Console proxy endpoints for the platform domain ──────────────
//
// These exist so the dashboard can manage devices, users, verifications,
// and attendance using the console JWT — without forcing the operator to
// mint a tenant API key. They are thin wrappers over `platform.ts` that
// resolve the tenant from the JWT, accept `environment=live|test` from
// the query (defaulting to live), and pass `actorId=null` since these are
// operator actions (no api_key_id; audit rows record `actor_type=console`).

function parseEnv(value: unknown): ApiKeyEnvironment {
  return value === 'test' ? 'test' : 'live';
}

/**
 * Parse a `?limit=` query value into a bounded integer.
 *
 * Returns `undefined` when the value is missing (service layer applies its
 * own default + sanitization). Returns the parsed value when it is a valid
 * positive integer ≤ 1000. Throws `RangeError` for anything else (NaN,
 * negative, zero, > 1000). Callers must catch and respond 400 — see F-6 in
 * issue #26.
 */
function parseLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) {
    throw new RangeError('limit must be an integer between 1 and 1000');
  }
  return parsed;
}

const DEVICE_STATUSES: DeviceStatus[] = ['active', 'inactive', 'retired'];
const DEVICE_ENROLLMENT_STATES: DeviceEnrollmentState[] = ['pending', 'enrolled', 'revoked'];
const USER_STATUSES: TenantUserStatus[] = ['active', 'inactive'];
const VERIFICATION_METHODS: VerificationMethod[] = ['zkp', 'fingerprint', 'face', 'depth', 'saml', 'oidc', 'manual'];
const VERIFICATION_RESULTS: VerificationResult[] = ['pass', 'fail', 'challenge'];
const ATTENDANCE_TYPES: AttendanceEventType[] = ['check_in', 'check_out'];
const ATTENDANCE_RESULTS: AttendanceResult[] = ['accepted', 'rejected'];

// ─── Devices ──────────────────────────────────────────────────────

router.get('/devices', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const status = req.query.status as DeviceStatus | undefined;
    const enrollmentState = req.query.enrollment_state as DeviceEnrollmentState | undefined;
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    if (status && !DEVICE_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status_filter' });
      return;
    }
    if (enrollmentState && !DEVICE_ENROLLMENT_STATES.includes(enrollmentState)) {
      res.status(400).json({ error: 'invalid_enrollment_state_filter' });
      return;
    }
    const devices = await listDevices(tenantId, environment, { status, enrollmentState, limit });
    res.json({ environment, devices });
  } catch {
    res.status(500).json({ error: 'device_list_failed' });
  }
});

/**
 * ADR 0022: console-initiated device registration.
 *
 * Returns the new pending device row PLUS the one-time enrollment
 * code (plaintext, returned exactly once — never persisted). The
 * device claims the slot by POSTing the code + a hardware fingerprint
 * to /v1/devices/enroll. If the operator loses the code they call
 * POST /api/console/devices/:id/regenerate-code to mint a new one.
 *
 * `device_type` is required because each type has a different
 * enrollment client (Android app vs kiosk firmware vs USB R307 bridge)
 * and a different default attestation expectation.
 */
router.post('/devices', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { name, deviceType, locationId, metadata } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'name is required' });
      return;
    }
    if (!isValidDeviceType(deviceType)) {
      res.status(400).json({
        error: 'invalid_request',
        message: "device_type is required; one of: 'mobile_android' | 'mobile_ios' | 'kiosk' | 'iot_bridge' | 'desktop'",
      });
      return;
    }
    const invite = await issueEnrollmentCode(
      tenantId,
      environment,
      { name, deviceType, locationId, metadata },
      { type: 'console', id: tenantId, email },
    );
    res.status(201).json({
      environment,
      device: invite.device,
      enrollment: {
        code: invite.enrollmentCode,
        expires_at: invite.expiresAt.toISOString(),
        // Convenience: the deep-link the dashboard renders as a QR for
        // the device-side scanner. Format documented in
        // docs/api_contract.md.
        deeplink: `zeroauth://enroll?code=${encodeURIComponent(invite.enrollmentCode)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'device_create_failed', message: (err as Error).message });
  }
});

/**
 * Re-issue the enrollment code on a pending slot. The previous code's
 * hash is overwritten — there is no way to recover it, and the
 * previous code will fail at /v1/devices/enroll from this point on.
 */
router.post('/devices/:deviceId/regenerate-code', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { deviceId } = req.params;
    const invite = await regenerateEnrollmentCode(
      tenantId,
      environment,
      deviceId,
      { type: 'console', id: tenantId, email },
    );
    if (!invite) {
      res.status(404).json({ error: 'device_not_found_or_not_pending' });
      return;
    }
    res.status(200).json({
      environment,
      device: invite.device,
      enrollment: {
        code: invite.enrollmentCode,
        expires_at: invite.expiresAt.toISOString(),
        deeplink: `zeroauth://enroll?code=${encodeURIComponent(invite.enrollmentCode)}`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'device_regenerate_failed', message: (err as Error).message });
  }
});

/**
 * Admin-initiated device revocation. Sets enrollment_state='revoked'
 * and status='retired'. The row is retained for audit-log
 * traceability — DELETE is intentionally a soft delete.
 */
router.delete('/devices/:deviceId', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { deviceId } = req.params;
    const device = await revokeDevice(
      tenantId,
      environment,
      deviceId,
      { type: 'console', id: tenantId, email },
    );
    if (!device) {
      res.status(404).json({ error: 'device_not_found' });
      return;
    }
    res.status(200).json({ environment, device });
  } catch (err) {
    res.status(500).json({ error: 'device_revoke_failed', message: (err as Error).message });
  }
});

router.patch('/devices/:deviceId', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { deviceId } = req.params;
    const { name, locationId, batteryLevel, status, metadata, lastSeenAt } = req.body;
    if (status && !DEVICE_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }
    if (batteryLevel !== undefined && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
      res.status(400).json({ error: 'invalid_battery_level' });
      return;
    }
    const device = await updateDevice(
      tenantId,
      environment,
      deviceId,
      { name, locationId, batteryLevel, status, metadata, lastSeenAt },
      { type: 'console', id: tenantId, email },
    );
    if (!device) {
      res.status(404).json({ error: 'device_not_found' });
      return;
    }
    res.json({ environment, device });
  } catch (err) {
    res.status(500).json({ error: 'device_update_failed', message: (err as Error).message });
  }
});

// ─── Users ────────────────────────────────────────────────────────

router.get('/users', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const status = req.query.status as TenantUserStatus | undefined;
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    if (status && !USER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status_filter' });
      return;
    }
    const users = await listTenantUsers(tenantId, environment, { status, limit });
    res.json({ environment, users });
  } catch {
    res.status(500).json({ error: 'user_list_failed' });
  }
});

router.post('/users', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email: operatorEmail } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata } = req.body;
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'fullName is required' });
      return;
    }
    const user = await createTenantUser(
      tenantId,
      environment,
      { fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata },
      { type: 'console', id: tenantId, email: operatorEmail },
    );
    res.status(201).json({ environment, user });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('duplicate key')) {
      res.status(409).json({ error: 'user_external_id_taken' });
      return;
    }
    if (message.includes('Device not found')) {
      res.status(404).json({ error: 'device_not_found', message });
      return;
    }
    res.status(500).json({ error: 'user_create_failed', message });
  }
});

router.patch('/users/:userId', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email: operatorEmail } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { userId } = req.params;
    const { fullName, email, phone, employeeCode, status, primaryDeviceId, metadata } = req.body;
    if (status && !USER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }
    const user = await updateTenantUser(
      tenantId,
      environment,
      userId,
      { fullName, email, phone, employeeCode, status, primaryDeviceId, metadata },
      { type: 'console', id: tenantId, email: operatorEmail },
    );
    if (!user) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    res.json({ environment, user });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('Device not found')) {
      res.status(404).json({ error: 'device_not_found', message });
      return;
    }
    res.status(500).json({ error: 'user_update_failed', message });
  }
});

// ─── Verifications (read-only on the console) ─────────────────────

router.get('/verifications', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const method = req.query.method as VerificationMethod | undefined;
    const result = req.query.result as VerificationResult | undefined;
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    if (method && !VERIFICATION_METHODS.includes(method)) {
      res.status(400).json({ error: 'invalid_method_filter' });
      return;
    }
    if (result && !VERIFICATION_RESULTS.includes(result)) {
      res.status(400).json({ error: 'invalid_result_filter' });
      return;
    }
    const verifications = await listVerificationEvents(tenantId, environment, { method, result, limit });
    res.json({ environment, verifications });
  } catch {
    res.status(500).json({ error: 'verification_list_failed' });
  }
});

/**
 * GET /api/console/verifications/stream
 *
 * Server-Sent Events stream of live verification audit rows for the
 * authenticated tenant. Backs the live verifications dashboard view
 * at `/dashboard/tenant/verifications`.
 *
 * Auth: requireConsoleAuth (Authorization: Bearer OR HttpOnly
 * `zeroauth_console_jwt` cookie per ADR/console-auth — P0 audit
 * finding C-3 removed the `?access_token=` query fallback).
 *
 * Wire shape: one `event: verification` per row, with the JSON
 * payload defined in `src/services/verification-events.ts`. A `:
 * ping` comment frame goes out every 25 s as the heartbeat — same
 * cadence the proof-pairing SSE route uses (see
 * `pairingStreamHeartbeatMs` above).
 *
 * Per-tenant isolation: the subscription wires the listener through
 * `subscribeVerifications(tenantId, …)`. The emitter key is the
 * tenant id, so tenant A's subscriber never sees tenant B's rows.
 *
 * Scope: this is a v1 in-process emitter. Multi-pod scale-out
 * requires a Redis pub/sub backing — tracked in
 * `src/services/verification-events.ts`. Today the deployment is
 * single-pod, so subscribers see every row written by the platform.
 */
router.get('/verifications/stream', requireConsoleAuth, async (req: Request, res: Response) => {
  const { tenantId } = (req as any).console;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // First write — flush headers immediately so the client's
  // EventSource transitions from CONNECTING to OPEN. Without this
  // the browser may sit on the response for the heartbeat interval.
  res.write(': connected\n\n');

  // Heartbeat every 25 s — matches the proof-pairing stream cadence
  // and the EventSource default reconnect window. Comment frames
  // (lines starting with `:`) are valid SSE that the client parses
  // and discards; they keep middleboxes from idling out the socket.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25_000);

  // Subscribe the SSE consumer to the per-tenant emitter. The
  // listener forwards every verification payload as a single
  // `event: verification` SSE frame. Per-tenant isolation is
  // enforced in subscribeVerifications().
  const subscription = subscribeVerifications(tenantId, (payload) => {
    if (res.writableEnded) return;
    try {
      res.write('event: verification\n');
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // Socket closed between the writableEnded check and write —
      // common on client disconnect. The close handler below
      // already tears down the subscription.
    }
  });

  // Tear-down on client disconnect. Without this the listener
  // leaks for the lifetime of the Node process.
  const cleanup = (): void => {
    clearInterval(heartbeat);
    subscription.close();
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

// ─── Attendance (read-only on the console) ────────────────────────

router.get('/attendance', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const type = req.query.type as AttendanceEventType | undefined;
    const result = req.query.result as AttendanceResult | undefined;
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    if (type && !ATTENDANCE_TYPES.includes(type)) {
      res.status(400).json({ error: 'invalid_type_filter' });
      return;
    }
    if (result && !ATTENDANCE_RESULTS.includes(result)) {
      res.status(400).json({ error: 'invalid_result_filter' });
      return;
    }
    const attendance = await listAttendanceEvents(tenantId, environment, { type, result, limit });
    res.json({ environment, attendance });
  } catch {
    res.status(500).json({ error: 'attendance_list_failed' });
  }
});

// ─── Proof pairing (W3 wrapper demo) ───────────────────────────────
//
// The dashboard's QR-proof sign-in page (dashboard/src/routes/demo/
// QrProofLogin.tsx) talks to these five endpoints. They no longer
// HTTP-proxy to /v1/proof-pairing/* — calling the service directly
// avoids the API-key roundtrip the proxy never had a key to satisfy
// (the console JWT identifies a tenant, not an API key). Same shape
// on the wire; the service-layer auth checks (session_bind cookie,
// nonce binding, etc.) remain in place.

const PAIR_COOKIE = 'zeroauth_pair_bind';
const PAIR_COOKIE_PATH = '/api/console/proof-pairing/';
const PAIR_COOKIE_MAX_AGE_SEC = 300; // matches the 5-minute session TTL.

function buildPairBindCookie(value: string): string {
  return (
    `${PAIR_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict;`
    + ` Path=${PAIR_COOKIE_PATH}; Max-Age=${PAIR_COOKIE_MAX_AGE_SEC}`
  );
}

function readPairBindCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[PAIR_COOKIE] === 'string') {
    return cookies[PAIR_COOKIE];
  }
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === PAIR_COOKIE) return rest.join('=');
  }
  return undefined;
}

// Service-error → HTTP mapping. Mirrors the table in
// src/routes/v1/proof-pairing.ts so the dashboard sees the same
// status/code regardless of which entry point it hit.
function mapPairingError(err: unknown): { status: number; code: string; message: string } {
  if (err instanceof PairingSessionNotFound) return { status: 404, code: err.code, message: 'Pairing session not found.' };
  if (err instanceof PairingSessionExpired) return { status: 410, code: err.code, message: 'Pairing session expired.' };
  if (err instanceof PairingSessionAlreadyBound) return { status: 409, code: err.code, message: 'Pairing session already bound.' };
  if (err instanceof PairingSessionLocked) return { status: 423, code: err.code, message: 'Pairing session locked.' };
  if (err instanceof PairingSessionBindMismatch) return { status: 403, code: err.code, message: 'Session bind cookie missing or mismatched.' };
  if (err instanceof PairingNonceMismatch) return { status: 400, code: err.code, message: 'Public signals nonce mismatch.' };
  if (err instanceof PairingDidUnknown) return { status: 400, code: err.code, message: 'DID does not resolve for this tenant.' };
  if (err instanceof PairingProofInvalid) return { status: 401, code: err.code, message: 'Proof verification failed.' };
  if (err instanceof PairingTenantMismatch) return { status: 403, code: err.code, message: 'Session belongs to another tenant.' };
  if (err instanceof TooManyPendingSessions) return { status: 429, code: err.code, message: 'Too many open pairing sessions for this tenant.' };
  if (err instanceof VerifierUnavailable) return { status: 503, code: err.code, message: 'Verifier loopback unavailable. Retry shortly.' };
  if (err instanceof PlayIntegrityRequired) return { status: 400, code: err.code, message: err.message };
  if (err instanceof PlayIntegrityInsufficient) return { status: 401, code: err.code, message: err.message };
  return { status: 500, code: 'pairing_failed', message: 'Pairing failed.' };
}

router.post('/proof-pairing/sessions', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    // apiKeyId is null — the console JWT identifies the tenant, no API key.
    const result = await pairingCreateSession(
      tenantId,
      environment,
      null,
      req.ip ?? null,
      (req.headers['user-agent'] as string | undefined) ?? null,
    );
    res.setHeader('Set-Cookie', buildPairBindCookie(result.sessionBindToken));
    res.status(201).json({
      session: {
        id: result.id,
        nonce: result.nonce,
        expiresAt: result.expiresAt,
        qrPayload: result.qrPayload,
        streamUrl: `/api/console/proof-pairing/sessions/${result.id}/stream`,
        state: 'issued',
      },
    });
  } catch (err) {
    const m = mapPairingError(err);
    if (m.status === 500) {
      logger.error('Console: pairing createSession failed', { error: (err as Error).message });
    }
    res.status(m.status).json({ error: m.code, message: m.message });
  }
});

router.post('/proof-pairing/sessions/:id/submit', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const { id } = req.params;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      res.status(400).json({ error: 'invalid_session_id', message: 'Session id is not a valid UUID.' });
      return;
    }
    const body = req.body ?? {};
    const result = await pairingSubmitProof(
      id,
      tenantId,
      environment,
      String(body.did ?? ''),
      body.proof as Groth16Proof,
      Array.isArray(body.publicSignals) ? body.publicSignals : [],
      body.clientMeta ?? {},
      readPairBindCookie(req),
    );
    res.status(200).json(result);
  } catch (err) {
    const m = mapPairingError(err);
    if (m.status === 500) {
      logger.error('Console: pairing submitProof failed', { error: (err as Error).message });
    }
    res.status(m.status).json({ error: m.code, message: m.message });
  }
});

router.get('/proof-pairing/sessions/:id', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const { id } = req.params;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      res.status(400).json({ error: 'invalid_session_id', message: 'Session id is not a valid UUID.' });
      return;
    }
    const session = await pairingGetSession(id, tenantId, environment, readPairBindCookie(req));
    res.status(200).json({ session });
  } catch (err) {
    const m = mapPairingError(err);
    res.status(m.status).json({ error: m.code, message: m.message });
  }
});

router.delete('/proof-pairing/sessions/:id', requireConsoleAuth, consoleWriteLimiter, async (_req: Request, res: Response) => {
  // Cancel-on-close is a UX nicety, not a security primitive. Sessions
  // self-expire after 5 minutes anyway. Return 204 No Content
  // immediately and let the row time out — service layer doesn't
  // expose a cancel function today. Logged for future implementation.
  res.status(204).end();
});

router.get('/proof-pairing/sessions/:id/stream', requireConsoleAuth, async (req: Request, res: Response) => {
  const { tenantId } = (req as any).console;
  const environment = parseEnv(req.query.environment);
  const { id } = req.params;
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
    res.status(400).json({ error: 'invalid_session_id', message: 'Session id is not a valid UUID.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, pairingStreamHeartbeatMs ?? 25_000);

  let closed = false;
  req.on('close', () => { closed = true; });

  try {
    for await (const event of pairingSubscribeStream(id, tenantId, environment, readPairBindCookie(req))) {
      if (closed || res.writableEnded) break;
      res.write(`event: ${event.event}\n`);
      res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (err) {
    const m = mapPairingError(err);
    if (!res.writableEnded) {
      res.write(`event: session_error\n`);
      res.write(`data: ${JSON.stringify({ error: m.code, message: m.message })}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

// ─── Registration ceremony proxies (ADR 0023) ─────────────────────
//
// Console-facing surfaces over the /v1/registrations service. The
// dashboard demo at /demo/registration uses these to drive the
// three-QR flow without needing a tenant API key on the browser
// side — auth is the console JWT, same pattern as the proof-pairing
// proxies above.

router.post('/registrations', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const profile = req.body?.profile ?? {};
    const result = await startRegistration(
      tenantId,
      environment,
      { profile },
      { type: 'console', id: tenantId, email },
    );
    res.status(201).json({
      environment,
      session: redactRegistrationSession(result.session),
      pair: {
        code: result.pairCode,
        expires_at: result.pairCodeExpiresAt.toISOString(),
        deeplink: result.pairDeeplink,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'registration_start_failed', message: (err as Error).message });
  }
});

router.get('/registrations/:id', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const session = await getRegistrationSession(tenantId, environment, req.params.id);
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    res.status(200).json({ environment, session: redactRegistrationSession(session) });
  } catch (err) {
    res.status(500).json({ error: 'registration_poll_failed', message: (err as Error).message });
  }
});

router.delete('/registrations/:id', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const session = await abandonRegistration(
      tenantId,
      environment,
      req.params.id,
      { type: 'console', id: tenantId, email },
    );
    if (!session) {
      res.status(404).json({ error: 'session_not_found' });
      return;
    }
    res.status(200).json({ environment, session: redactRegistrationSession(session) });
  } catch (err) {
    res.status(500).json({ error: 'registration_abandon_failed', message: (err as Error).message });
  }
});

/**
 * Strip the bearer-grade columns out of the registration_sessions
 * row before it touches a browser. The plaintext codes are returned
 * only at issuance time (and only to the same browser that issued
 * them); the challenge_nonce is part of the QR3 deeplink and the
 * server keeps it for the verify-step compare. The hashes never
 * need to leave the server.
 */
function redactRegistrationSession(session: object): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pair_code_hash, enroll_code_hash, verify_code_hash, verify_challenge_nonce, ...safe } =
    session as Record<string, unknown>;
  return safe;
}

export default router;
