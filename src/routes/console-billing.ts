/**
 * Console: Stripe billing management (scaffold).
 *
 * Two endpoints, both authed by the developer-dashboard console JWT:
 *
 *   - GET  /api/console/billing            — current plan + month-to-date usage
 *   - POST /api/console/billing/subscribe  — create or upgrade a subscription
 *
 * Both go through the thin `src/services/billing.ts` wrapper. That
 * service throws `StripeNotConfiguredError` when `STRIPE_SECRET_KEY` is
 * unset; this router translates that throw into a graceful
 * `billing_not_configured` JSON response (HTTP 503) rather than letting
 * the request bubble up as a 500. This matches the ADR 0017 posture
 * applied to billing: a default ZeroAuth tenant boots with no Stripe
 * dependency, and the billing surface is entirely opt-in.
 *
 * Auth
 * ----
 *
 * `requireConsoleAuth` is not exported from `src/routes/console.ts`
 * — same pattern as `src/routes/console-security-policy.ts` and
 * `src/routes/console-webhooks.ts`. The JWT verification shape is
 * repeated here verbatim; if the constants ever move into a shared
 * `src/middleware/console-auth.ts` module this file switches over
 * without behaviour change.
 *
 * Audit-log discipline
 * --------------------
 *
 * Every successful POST writes an `audit_events` row via
 * `appendAuditEvent` with `action='billing.subscription.created'` (or
 * `'billing.subscription.upgraded'`). The summary is bounded to 255
 * chars by the schema CHECK constraint; the Stripe customer/subscription
 * ids are recorded in `metadata` for downstream invoice / receipt
 * cross-reference. Secrets (Stripe keys, card tokens) are never logged.
 *
 * Per-tenant isolation
 * --------------------
 *
 * Every query is gated by `tenant_id` from the console JWT — the
 * operator cannot ask for another tenant's billing because that
 * tenant id is not in their token.
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { getTenantById } from '../services/tenants';
import { getCurrentMonthUsage } from '../services/usage';
import { appendAuditEvent } from '../services/audit';
import {
  createCustomer,
  createSubscription,
  isBillingConfigured,
  StripeNotConfiguredError,
  StripePriceMissingError,
} from '../services/billing';
import type { PlanTier } from '../types';

// ─── JWT verification (mirrors console.ts) ────────────────────────

const CONSOLE_JWT_ISSUER = 'zeroauth-console';
const CONSOLE_JWT_AUDIENCE = 'zeroauth-console';
const CONSOLE_JWT_COOKIE = 'zeroauth_console_jwt';

interface ConsolePrincipal {
  tenantId: string;
  email: string;
  jti?: string;
}

function verifyConsoleToken(token: string): ConsolePrincipal {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: CONSOLE_JWT_ISSUER,
    audience: CONSOLE_JWT_AUDIENCE,
  }) as { tenantId?: string; email?: string; type?: string; jti?: string };
  if (payload.type !== 'console' || !payload.tenantId || !payload.email) {
    throw new Error('Not a console token');
  }
  return { tenantId: payload.tenantId, email: payload.email, jti: payload.jti };
}

function requireConsoleAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof (req as Request & { cookies?: Record<string, string> }).cookies?.[CONSOLE_JWT_COOKIE] === 'string') {
    token = (req as Request & { cookies: Record<string, string> }).cookies[CONSOLE_JWT_COOKIE];
  }

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Login required.' });
    return;
  }

  try {
    const payload = verifyConsoleToken(token);
    (req as Request & { console?: ConsolePrincipal }).console = payload;
    next();
  } catch {
    res.status(401).json({ error: 'session_expired', message: 'Console session expired. Please login again.' });
  }
}

// ─── Plan validation ──────────────────────────────────────────────

const VALID_PLANS: readonly PlanTier[] = ['free', 'starter', 'growth', 'enterprise'] as const;

function isValidPlan(value: unknown): value is PlanTier {
  return typeof value === 'string' && (VALID_PLANS as readonly string[]).includes(value);
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Read the tenant_billing row for this tenant (if any). Returns null
 * when the tenant hasn't opted into a paid plan yet — the row simply
 * doesn't exist. The caller treats null as "free tier, no Stripe
 * customer."
 */
async function readBillingRow(tenantId: string): Promise<{
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: PlanTier;
  status: string;
  current_period_end: Date | null;
} | null> {
  const pool = getPool();
  const result = await pool.query<{
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    plan: PlanTier;
    status: string;
    current_period_end: Date | null;
  }>(
    `SELECT stripe_customer_id, stripe_subscription_id, plan, status, current_period_end
     FROM tenant_billing
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

/**
 * Translate a billing service throw into the right JSON response.
 * Returns true if the error was handled; false means the caller
 * should re-throw / fall back to the route's generic 500.
 */
function handleBillingError(err: unknown, res: Response): boolean {
  if (err instanceof StripeNotConfiguredError) {
    res.status(503).json({
      error: 'billing_not_configured',
      message:
        'The Stripe billing surface is not configured on this deployment. Contact the operator to enable it.',
    });
    return true;
  }
  if (err instanceof StripePriceMissingError) {
    res.status(400).json({
      error: 'billing_price_missing',
      message: err.message,
    });
    return true;
  }
  return false;
}

const router = Router();

// ─── GET /api/console/billing ─────────────────────────────────────
//
// Returns the authenticated tenant's current plan, billing status,
// and month-to-date usage. Does NOT round-trip to Stripe — the
// response is built from the local `tenants` + `tenant_billing` +
// `usage_logs` tables so the dashboard's "Billing" tab loads in a
// single fast query even if Stripe is degraded or unconfigured.

router.get('/billing', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as Request & { console: ConsolePrincipal }).console;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found', message: 'Tenant not found.' });
      return;
    }

    const billing = await readBillingRow(tenantId);
    const usedThisMonth = await getCurrentMonthUsage(tenantId);

    res.status(200).json({
      plan: tenant.plan,
      status: billing?.status ?? (tenant.plan === 'free' ? 'free_tier' : 'inactive'),
      monthly_quota: tenant.monthly_quota,
      usage: {
        current_month: usedThisMonth,
        quota: tenant.monthly_quota,
        // -1 sentinel = unlimited (enterprise plan). The dashboard
        // renders "Unlimited" rather than a percentage when it
        // sees that value.
        remaining: tenant.monthly_quota < 0 ? -1 : Math.max(0, tenant.monthly_quota - usedThisMonth),
      },
      stripe: {
        configured: isBillingConfigured(),
        customer_id: billing?.stripe_customer_id ?? null,
        subscription_id: billing?.stripe_subscription_id ?? null,
        current_period_end: billing?.current_period_end?.toISOString() ?? null,
      },
    });
  } catch (err) {
    logger.error('billing GET failed', { error: (err as Error).message });
    res.status(500).json({
      error: 'billing_read_failed',
      message: 'Failed to read billing information.',
    });
  }
});

// ─── POST /api/console/billing/subscribe ──────────────────────────
//
// Body: { plan: 'starter' | 'growth' | 'enterprise' }
//
// Creates a Stripe customer if one doesn't yet exist for this
// tenant, then creates a subscription on the requested plan.
// Idempotent on customer creation: a retried request reuses the
// stored stripe_customer_id rather than creating a duplicate.

router.post('/billing/subscribe', requireConsoleAuth, async (req: Request, res: Response) => {
  const { tenantId, email } = (req as Request & { console: ConsolePrincipal }).console;
  const { plan } = req.body ?? {};

  if (!isValidPlan(plan)) {
    res.status(400).json({
      error: 'invalid_plan',
      message: `Plan must be one of: ${VALID_PLANS.join(', ')}.`,
    });
    return;
  }
  if (plan === 'free') {
    res.status(400).json({
      error: 'invalid_plan',
      message: 'The free plan does not require a subscription. Downgrade via the cancel endpoint instead.',
    });
    return;
  }

  if (!isBillingConfigured()) {
    res.status(503).json({
      error: 'billing_not_configured',
      message:
        'The Stripe billing surface is not configured on this deployment. Contact the operator to enable it.',
    });
    return;
  }

  try {
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found', message: 'Tenant not found.' });
      return;
    }

    // Step 1: ensure a Stripe customer exists. Reuse if present.
    const existing = await readBillingRow(tenantId);
    let customerId: string | null = existing?.stripe_customer_id ?? null;
    let action: 'billing.subscription.created' | 'billing.subscription.upgraded' = 'billing.subscription.created';

    if (!customerId) {
      const customer = await createCustomer(tenantId, email);
      customerId = customer.id;
    } else if (existing?.stripe_subscription_id) {
      // An existing subscription means this is an upgrade rather
      // than a fresh subscribe. The audit row reflects that.
      action = 'billing.subscription.upgraded';
    }

    // Step 2: create the subscription on the requested plan.
    const subscription = await createSubscription(customerId, plan);

    // Step 3: persist the row. Upsert on tenant_id so a retried
    // request that crashed between createCustomer and the DB write
    // doesn't end up with two rows.
    const pool = getPool();
    await pool.query(
      `INSERT INTO tenant_billing
         (tenant_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end, updated_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6), NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET stripe_customer_id     = EXCLUDED.stripe_customer_id,
             stripe_subscription_id = EXCLUDED.stripe_subscription_id,
             plan                   = EXCLUDED.plan,
             status                 = EXCLUDED.status,
             current_period_end     = EXCLUDED.current_period_end,
             updated_at             = NOW()`,
      [tenantId, customerId, subscription.id, plan, subscription.status, subscription.currentPeriodEnd],
    );

    // Step 4: audit log. Secrets are never written — only the
    // tenant-visible identifiers (Stripe ids, plan name) land in
    // the metadata blob.
    try {
      await appendAuditEvent({
        tenant_id: tenantId,
        environment: null,
        actor_type: 'console',
        actor_id: email,
        action,
        entity_type: 'billing_subscription',
        entity_id: subscription.id,
        status: 'success',
        summary: `Subscribed to ${plan} plan (${subscription.status})`.slice(0, 255),
        metadata: {
          plan,
          subscription_status: subscription.status,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
        },
      });
    } catch (auditErr) {
      // Audit write failure does not roll back the Stripe action
      // — that would orphan a real subscription. Log and proceed.
      logger.error('billing audit append failed', {
        tenantId,
        action,
        error: (auditErr as Error).message,
      });
    }

    res.status(201).json({
      plan,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        current_period_end: subscription.currentPeriodEnd,
      },
      stripe_customer_id: customerId,
    });
  } catch (err) {
    if (handleBillingError(err, res)) return;
    logger.error('billing subscribe failed', {
      tenantId,
      plan,
      error: (err as Error).message,
    });
    res.status(500).json({
      error: 'billing_subscribe_failed',
      message: 'Failed to create subscription.',
    });
  }
});

export default router;
