import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../services/logger';
import { createTenant, createTenantWithHash, hashPassword, authenticateTenant, getTenantById, getTenantByEmail } from '../services/tenants';
import { createPendingSignup, consumePendingSignup } from '../services/pending-signups';
import { createApiKey, listApiKeys, revokeApiKey, countActiveKeys } from '../services/api-keys';
import { getUsageSummary, getRecentCalls, getCurrentMonthUsage } from '../services/usage';
import {
  getConsoleOverview,
  listAuditEvents,
  recordAuditEvent,
  createDevice,
  listDevices,
  updateDevice,
  createTenantUser,
  listTenantUsers,
  updateTenantUser,
  listVerificationEvents,
  listAttendanceEvents,
} from '../services/platform';
import {
  ApiKeyEnvironment,
  ApiScope,
  AttendanceEventType,
  AttendanceResult,
  DeviceStatus,
  TenantUserStatus,
  VerificationMethod,
  VerificationResult,
} from '../types';
import { sendMail } from '../services/email';
import { welcomeEmail, signupAttemptedNoticeEmail, verifySignupEmail } from '../services/email-templates';

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

/** Middleware: authenticate console session */
function requireConsoleAuth(req: Request, res: Response, next: any): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Login required.' });
    return;
  }

  try {
    const payload = verifyConsoleToken(authHeader.slice(7));
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
router.post('/login', authLimiter, async (req: Request, res: Response) => {
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
    let limit: number | undefined;
    try { limit = parseLimit(req.query.limit); }
    catch (e) { res.status(400).json({ error: 'invalid_limit', message: (e as Error).message }); return; }
    if (status && !DEVICE_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status_filter' });
      return;
    }
    const devices = await listDevices(tenantId, environment, { status, limit });
    res.json({ environment, devices });
  } catch {
    res.status(500).json({ error: 'device_list_failed' });
  }
});

router.post('/devices', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { name, externalId, locationId, batteryLevel, metadata } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'name is required' });
      return;
    }
    if (batteryLevel !== undefined && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
      res.status(400).json({ error: 'invalid_request', message: 'batteryLevel must be an integer between 0 and 100' });
      return;
    }
    const device = await createDevice(
      tenantId,
      environment,
      { name, externalId, locationId, batteryLevel, metadata },
      { type: 'console', id: tenantId, email },
    );
    res.status(201).json({ environment, device });
  } catch (err) {
    if ((err as Error).message.includes('duplicate key')) {
      res.status(409).json({ error: 'device_external_id_taken' });
      return;
    }
    res.status(500).json({ error: 'device_create_failed', message: (err as Error).message });
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
// QrProofLogin.tsx) talks to these five endpoints. They forward — same
// shape — to the tenant-scoped /v1/proof-pairing/* layer that ADR-0009
// owns. The console JWT gates access; the upstream /v1 layer enforces
// the actual scope checks (`proof_pairing:create`, `proof_pairing:claim`).
//
// Backend contract is in docs/api_contract.md → Proof pairing section.
//
// Why a fetch-proxy and not a direct service call (like devices/users):
// the /v1/proof-pairing surface manages its OWN session_bind cookie —
// that cookie's value is bound to the issuing browser, not the server-
// side tenant id, so it has to round-trip through the upstream layer.
// We pipe Set-Cookie from upstream straight to the dashboard browser
// (Path remapped from /v1/proof-pairing/ to /api/console/proof-pairing/
// so the browser ships the cookie on subsequent /api/console/* calls)
// and we forward the inbound Cookie header back upstream on every
// follow-up read.
//
// SSE: we set text/event-stream + flushHeaders, then pipe the upstream
// body straight to the response. Caddy + Node both flush by default
// once content-type is set; the explicit flushHeaders() is belt-and-
// braces against an absent X-Accel-Buffering on some proxies.
//
// When `/v1/proof-pairing/*` is not yet mounted (backend feature flag
// or the W3 backend hasn't merged) the upstream returns 404 and we
// pass it through verbatim. The dashboard runs an opt-in MOCK mode
// (VITE_PAIRING_MOCK=1) that bypasses these routes entirely while the
// real backend lands.

const PAIRING_UPSTREAM_BASE = (() => {
  // Loopback by default. Same-process call goes through the local
  // express server, which means the /v1 layer sees the same Node
  // instance. Override via PAIRING_UPSTREAM_BASE for split deployments
  // (api.zeroauth.dev when console.zeroauth.dev is on a different VPS).
  return (process.env.PAIRING_UPSTREAM_BASE ?? config.apiBaseUrl).replace(/\/$/, '');
})();

const PAIRING_INTERNAL_HEADER = 'x-zeroauth-console-proxy';

// The dashboard browser sees the cookie at /api/console/proof-pairing/*
// (because that's the path it called); the upstream /v1 layer sets it
// at Path=/v1/proof-pairing/. We rewrite the Path attribute when piping
// Set-Cookie back. Domain is left untouched — the upstream knows whether
// it's same-host with the dashboard or a cross-subdomain deployment.
function rewriteSetCookiePath(setCookie: string | string[] | undefined): string[] {
  if (!setCookie) return [];
  const items = Array.isArray(setCookie) ? setCookie : [setCookie];
  return items.map((raw) =>
    raw.replace(
      /Path=\/v1\/proof-pairing\//gi,
      'Path=/api/console/proof-pairing/',
    ),
  );
}

// The `Response` symbol is shadowed by the Express type import at the top
// of this file; `FetchResponse` keeps the DOM/fetch Response distinct.
type FetchResponse = globalThis.Response;

interface PairingProxyResult {
  status: number;
  headers: Headers;
  // For SSE we want the raw ReadableStream; for JSON the parsed body.
  body: FetchResponse['body'];
}

async function pairingFetch(
  pathSuffix: string,
  init: {
    method: 'GET' | 'POST' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
    forwardCookie?: string;
    signal?: AbortSignal;
  },
  tenantContext: { tenantId: string; email: string; environment: ApiKeyEnvironment },
): Promise<PairingProxyResult> {
  const url = `${PAIRING_UPSTREAM_BASE}/v1/proof-pairing/${pathSuffix.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    [PAIRING_INTERNAL_HEADER]: '1',
    'x-zeroauth-tenant-id': tenantContext.tenantId,
    'x-zeroauth-tenant-environment': tenantContext.environment,
    'x-zeroauth-console-actor': tenantContext.email,
    ...(init.headers ?? {}),
  };
  if (init.forwardCookie) {
    headers.cookie = init.forwardCookie;
  }
  const upstream = await fetch(url, {
    method: init.method,
    headers,
    body: init.body,
    signal: init.signal,
    redirect: 'manual',
  });
  return {
    status: upstream.status,
    headers: upstream.headers,
    body: upstream.body,
  };
}

function applyPairingCookies(res: Response, upstreamHeaders: Headers): void {
  // node-undici's Headers exposes getSetCookie() since Node 19.7.
  type GetSetCookieSupportingHeaders = Headers & { getSetCookie?: () => string[] };
  const headersWithSetCookie = upstreamHeaders as GetSetCookieSupportingHeaders;
  const rawSetCookie = typeof headersWithSetCookie.getSetCookie === 'function'
    ? headersWithSetCookie.getSetCookie()
    : upstreamHeaders.get('set-cookie');
  const rewritten = rewriteSetCookiePath(rawSetCookie ?? undefined);
  if (rewritten.length > 0) {
    res.setHeader('Set-Cookie', rewritten);
  }
}

async function pipeJson(
  res: Response,
  upstream: PairingProxyResult,
): Promise<void> {
  applyPairingCookies(res, upstream.headers);
  const text = upstream.body ? await new Response(upstream.body).text() : '';
  res.status(upstream.status);
  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('Content-Type', contentType);
  res.send(text);
}

function buildPairingError(status: number, code: string, message: string): { status: number; body: { error: string; message: string } } {
  return { status, body: { error: code, message } };
}

function handleUpstreamFailure(err: unknown, res: Response, op: string): void {
  const code = (err as { code?: string }).code;
  // ECONNREFUSED — backend not running. Surface 503 so the dashboard
  // can render the "backend offline; enable VITE_PAIRING_MOCK=1" hint.
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    logger.warn(`Console: pairing ${op} — upstream unavailable`, { code });
    res.status(503).json({
      error: 'pairing_backend_unavailable',
      message: 'Proof-pairing backend is not reachable. Enable VITE_PAIRING_MOCK=1 to drive the demo locally without it.',
    });
    return;
  }
  logger.error(`Console: pairing ${op} failed`, { error: (err as Error).message });
  res.status(502).json({ error: 'pairing_upstream_failed', message: 'Failed to reach the proof-pairing backend.' });
}

router.post('/proof-pairing/sessions', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const bodyPayload = { ...(req.body ?? {}), environment };
    const upstream = await pairingFetch(
      'sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        forwardCookie: req.headers.cookie,
      },
      { tenantId, email, environment },
    );
    await pipeJson(res, upstream);
  } catch (err) {
    handleUpstreamFailure(err, res, 'createSession');
  }
});

router.post('/proof-pairing/sessions/:id/submit', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.body?.environment ?? req.query.environment);
    const { id } = req.params;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      const err = buildPairingError(400, 'invalid_session_id', 'Session id is not a valid UUID.');
      res.status(err.status).json(err.body);
      return;
    }
    const upstream = await pairingFetch(
      `sessions/${encodeURIComponent(id)}/submit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req.body ?? {}),
        forwardCookie: req.headers.cookie,
      },
      { tenantId, email, environment },
    );
    await pipeJson(res, upstream);
  } catch (err) {
    handleUpstreamFailure(err, res, 'submitProof');
  }
});

router.get('/proof-pairing/sessions/:id', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const { id } = req.params;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      const err = buildPairingError(400, 'invalid_session_id', 'Session id is not a valid UUID.');
      res.status(err.status).json(err.body);
      return;
    }
    const upstream = await pairingFetch(
      `sessions/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        forwardCookie: req.headers.cookie,
      },
      { tenantId, email, environment },
    );
    await pipeJson(res, upstream);
  } catch (err) {
    handleUpstreamFailure(err, res, 'getSession');
  }
});

router.delete('/proof-pairing/sessions/:id', requireConsoleAuth, consoleWriteLimiter, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as any).console;
    const environment = parseEnv(req.query.environment);
    const { id } = req.params;
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      const err = buildPairingError(400, 'invalid_session_id', 'Session id is not a valid UUID.');
      res.status(err.status).json(err.body);
      return;
    }
    const upstream = await pairingFetch(
      `sessions/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        forwardCookie: req.headers.cookie,
      },
      { tenantId, email, environment },
    );
    await pipeJson(res, upstream);
  } catch (err) {
    handleUpstreamFailure(err, res, 'cancelSession');
  }
});

router.get('/proof-pairing/sessions/:id/stream', requireConsoleAuth, async (req: Request, res: Response) => {
  const { tenantId, email } = (req as any).console;
  const environment = parseEnv(req.query.environment);
  const { id } = req.params;
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
    res.status(400).json({ error: 'invalid_session_id', message: 'Session id is not a valid UUID.' });
    return;
  }

  // Tie upstream cancellation to client disconnect.
  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  let upstream: PairingProxyResult;
  try {
    upstream = await pairingFetch(
      `sessions/${encodeURIComponent(id)}/stream`,
      {
        method: 'GET',
        forwardCookie: req.headers.cookie,
        signal: abortController.signal,
      },
      { tenantId, email, environment },
    );
  } catch (err) {
    handleUpstreamFailure(err, res, 'subscribeStream');
    return;
  }

  if (upstream.status >= 400) {
    await pipeJson(res, upstream);
    return;
  }

  // SSE pipe-through. We set the response headers ourselves rather than
  // copying upstream's wholesale — Express handles compression/encoding
  // for the response object, and we want to keep the stream uncompressed.
  applyPairingCookies(res, upstream.headers);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Some reverse proxies buffer text/event-stream by default; the
    // X-Accel-Buffering header turns that off for nginx and Caddy
    // honours it via its FastCGI translator.
    'X-Accel-Buffering': 'no',
  });

  // Heartbeat — every 25s send a comment so transparent proxies don't
  // GC the connection during long no-event stretches.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 25_000);

  try {
    if (upstream.body) {
      // Node 20 has Web ReadableStream-to-Node-stream interop via
      // Readable.fromWeb, but pipeline accepts either; the simplest
      // approach is the async iterator.
      const reader = upstream.body.getReader();
      while (!res.writableEnded) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && !res.writableEnded) res.write(value);
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      logger.warn('Console: pairing SSE pipe error', { error: (err as Error).message });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

export default router;
