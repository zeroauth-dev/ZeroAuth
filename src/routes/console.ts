import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../services/logger';
import { createTenant, authenticateTenant, getTenantById, getTenantByEmail } from '../services/tenants';
import { createApiKey, listApiKeys, revokeApiKey, countActiveKeys } from '../services/api-keys';
import { getUsageSummary, getRecentCalls, getCurrentMonthUsage } from '../services/usage';
import { getConsoleOverview, listAuditEvents, recordAuditEvent } from '../services/platform';
import { ApiKeyEnvironment, ApiScope } from '../types';

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

// ─── Helper: Console JWT (for developer dashboard sessions) ──────

function issueConsoleToken(tenantId: string, email: string): string {
  return jwt.sign(
    { tenantId, email, type: 'console' },
    config.jwt.secret,
    { expiresIn: '24h', issuer: 'zeroauth-console' },
  );
}

function verifyConsoleToken(token: string): { tenantId: string; email: string } {
  const payload = jwt.verify(token, config.jwt.secret, { issuer: 'zeroauth-console' }) as any;
  if (payload.type !== 'console') throw new Error('Not a console token');
  return { tenantId: payload.tenantId, email: payload.email };
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
  try {
    const { email, password, companyName } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      res.status(400).json({ error: 'invalid_password', message: passwordError });
      return;
    }

    // Check existing
    const existing = await getTenantByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'email_taken', message: 'An account with this email already exists.' });
      return;
    }

    const tenant = await createTenant(email, password, companyName);

    // Auto-create a default live API key
    const defaultKey = await createApiKey(tenant.id, 'Default Live Key', 'live');

    // Issue console session token
    const token = issueConsoleToken(tenant.id, tenant.email);

    logger.info('Console: Tenant signup', { tenantId: tenant.id, email: tenant.email });
    void recordAuditEvent(tenant.id, {
      actorType: 'console',
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      status: 'success',
      summary: `Created tenant account for ${tenant.email}`,
      metadata: { companyName: tenant.company_name, plan: tenant.plan },
    }).catch(() => undefined);

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      tenant: {
        id: tenant.id,
        email: tenant.email,
        companyName: tenant.company_name,
        plan: tenant.plan,
      },
      apiKey: {
        key: defaultKey.key,
        id: defaultKey.id,
        name: defaultKey.name,
        prefix: defaultKey.key_prefix,
        environment: defaultKey.environment,
        warning: '⚠ Copy this API key now — it will never be shown again.',
      },
      quickstart: {
        verify: `curl -X POST ${config.apiBaseUrl}/v1/auth/zkp/verify \\
  -H "Authorization: Bearer ${defaultKey.key}" \\
  -H "Content-Type: application/json" \\
  -d '{"proof": {...}, "publicSignals": [...], "nonce": "...", "timestamp": "..."}'`,
        nonce: `curl ${config.apiBaseUrl}/v1/auth/zkp/nonce \\
  -H "Authorization: Bearer ${defaultKey.key}"`,
      },
    });
  } catch (err) {
    logger.error('Console: Signup error', { error: (err as Error).message });
    res.status(500).json({
      error: 'signup_failed',
      message: 'Could not create the account. Please try again or contact support.',
    });
  }
});

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
      res.status(400).json({ error: 'Email and password are required.' });
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
router.post('/keys', requireConsoleAuth, async (req: Request, res: Response) => {
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
router.delete('/keys/:keyId', requireConsoleAuth, async (req: Request, res: Response) => {
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const events = await listAuditEvents(tenantId, environment, { action, status, limit });
    res.json({ environment, events });
  } catch {
    res.status(500).json({ error: 'Failed to fetch audit events.' });
  }
});

export default router;
