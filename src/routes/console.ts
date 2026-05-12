import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { logger } from '../services/logger';
import { createTenant, authenticateTenant, getTenantById, getTenantByEmail } from '../services/tenants';
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
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

router.post('/devices', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
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
    const device = await createDevice(tenantId, environment, { name, externalId, locationId, batteryLevel, metadata });
    res.status(201).json({ environment, device });
  } catch (err) {
    if ((err as Error).message.includes('duplicate key')) {
      res.status(409).json({ error: 'device_external_id_taken' });
      return;
    }
    res.status(500).json({ error: 'device_create_failed', message: (err as Error).message });
  }
});

router.patch('/devices/:deviceId', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
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
    const device = await updateDevice(tenantId, environment, deviceId, { name, locationId, batteryLevel, status, metadata, lastSeenAt });
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
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

router.post('/users', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata } = req.body;
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'fullName is required' });
      return;
    }
    const user = await createTenantUser(tenantId, environment, {
      fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata,
    });
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

router.patch('/users/:userId', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as any).console;
    const environment = parseEnv(req.body.environment ?? req.query.environment);
    const { userId } = req.params;
    const { fullName, email, phone, employeeCode, status, primaryDeviceId, metadata } = req.body;
    if (status && !USER_STATUSES.includes(status)) {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }
    const user = await updateTenantUser(tenantId, environment, userId, {
      fullName, email, phone, employeeCode, status, primaryDeviceId, metadata,
    });
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
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
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
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

export default router;
