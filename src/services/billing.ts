/**
 * Stripe billing integration (scaffold).
 *
 * This module is the thin wrapper between the ZeroAuth platform and
 * Stripe's REST surface. Three concerns live here:
 *
 *   1. createCustomer(tenantId, email)           — create a Stripe
 *      customer record and pin our `tenantId` into its metadata so the
 *      Stripe dashboard / webhooks can route back to the right tenant.
 *
 *   2. createSubscription(customerId, plan)      — attach the given
 *      `plan` (one of the ZeroAuth `PlanTier` strings) to an existing
 *      customer. The plan is mapped to a Stripe price-id via the
 *      `STRIPE_PRICE_ID_*` env vars; if a mapping is missing the call
 *      throws so the dashboard surfaces the misconfiguration instead
 *      of silently creating a free-tier subscription.
 *
 *   3. reportUsage(customerId, units, metric)    — push a usage record
 *      to Stripe's metered-billing surface. The metric is one of the
 *      known meter names (e.g. `verifications`, `registrations`); the
 *      caller is responsible for already having mapped a subscription
 *      item id (cached out-of-band) — this scaffold looks it up by
 *      listing the customer's active subscription items and matching
 *      by the `metric` metadata key.
 *
 * Gating
 * ------
 *
 * Every exported function is gated by the `STRIPE_SECRET_KEY` env var.
 * If it is not set, the function throws a `StripeNotConfiguredError`
 * with a clear message. This is the right posture for ZeroAuth's
 * blockchain-agnostic philosophy applied to billing: a default tenant
 * boots with zero Stripe dependency, and the billing surface is
 * opt-in. Callers (the console-billing router below) check for the
 * env var first and return a graceful "billing_not_configured" response
 * rather than letting the throw bubble up as a 500.
 *
 * Why this is a scaffold
 * ----------------------
 *
 * The `stripe` npm package is intentionally NOT in `package.json` yet.
 * Adding a runtime dependency goes through DP6 (every dep is an ADR;
 * see `.claude/skills/dep-add/SKILL.md`). The import below is written
 * so that when the ADR lands and `npm install stripe` runs, this file
 * compiles without modification — no further wiring is needed at the
 * call sites. Until then, the gated functions throw the
 * StripeNotConfiguredError before reaching any `stripe`-typed code, so
 * TypeScript's `--noEmit` pass is happy under either state of the
 * package.json (a `// @ts-ignore` lives at the import).
 *
 * Audit-log discipline
 * --------------------
 *
 * Every successful Stripe call writes an `audit_events` row via the
 * caller (the console-billing router) — never the service itself. The
 * service is a pure I/O wrapper; routing and audit are the caller's
 * job. This keeps the service trivial to unit-test once the dep lands.
 */

// NOTE: the `stripe` SDK is loaded lazily inside getStripeClient()
// below — NOT at module load. This keeps `import './billing'` a
// zero-side-effect operation while the `stripe` npm package is
// intentionally NOT in package.json (the ADR-first dep-add skill
// hasn't been run for it yet — see the file-level comment). Without
// this discipline, requiring billing.ts (e.g. transitively via
// app.ts in a Jest test) cascades into MODULE_NOT_FOUND on stripe
// and takes out every suite that touches the API surface.

import { logger } from './logger';
import type { PlanTier } from '../types';

// ─── Errors ───────────────────────────────────────────────────────

/**
 * Thrown when any billing function is called and `STRIPE_SECRET_KEY`
 * is unset. The name and message are stable so the console-billing
 * router can `instanceof`-check and translate to the
 * `billing_not_configured` HTTP error code.
 */
export class StripeNotConfiguredError extends Error {
  readonly code = 'stripe_not_configured';
  constructor(message?: string) {
    super(
      message ??
        'STRIPE_SECRET_KEY is not set. Billing endpoints are disabled until the env var is configured.',
    );
    this.name = 'StripeNotConfiguredError';
  }
}

/**
 * Thrown when a ZeroAuth plan tier has no Stripe price-id mapping in
 * the environment. Distinct from StripeNotConfiguredError so the
 * dashboard can surface "you haven't priced the growth plan yet"
 * separately from "Stripe is off."
 */
export class StripePriceMissingError extends Error {
  readonly code = 'stripe_price_missing';
  constructor(plan: PlanTier) {
    super(
      `No Stripe price id configured for plan "${plan}". Set STRIPE_PRICE_ID_${plan.toUpperCase()} in the environment.`,
    );
    this.name = 'StripePriceMissingError';
  }
}

// ─── Client construction ──────────────────────────────────────────

/**
 * Returns a Stripe client built against the current `STRIPE_SECRET_KEY`.
 * Throws StripeNotConfiguredError if the key is unset.
 *
 * Both the SDK require AND the client construction happen lazily (not
 * at module load) so:
 *   - Test runs that never touch billing don't trip MODULE_NOT_FOUND
 *     while the `stripe` package is still absent from package.json
 *     (the dep-add ADR-first skill hasn't been run for it yet).
 *   - Runs that never touch billing don't pay the cost of resolving
 *     `STRIPE_SECRET_KEY`.
 *   - A runtime config-reload can change keys without a process restart.
 *
 * The Stripe API version is pinned. Pinning the version prevents
 * Stripe's silent API drift from changing the shape of our responses
 * out from under us.
 *
 * Return type is left to TypeScript inference because `Stripe` is no
 * longer a top-level binding — until the dep lands, the require'd
 * value's static type collapses to `any` via the @ts-expect-error
 * below, which is sufficient for the three call sites (each of which
 * only touches a narrow slice of the SDK surface and casts locally
 * where stricter typing matters).
 */
function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new StripeNotConfiguredError();
  }
  // @ts-expect-error — `stripe` is intentionally not in package.json yet; see the file-level comment.
  const Stripe = require('stripe') as typeof import('stripe'); // eslint-disable-line @typescript-eslint/no-require-imports
  return new Stripe(key, {
    apiVersion: '2024-06-20',
    typescript: true,
    appInfo: {
      name: 'zeroauth-platform',
      url: 'https://zeroauth.dev',
    },
  });
}

/**
 * Convenience guard for routes that need to short-circuit a request
 * before constructing a Stripe client. Returns true iff
 * STRIPE_SECRET_KEY is set; does not validate the key with Stripe.
 */
export function isBillingConfigured(): boolean {
  return typeof process.env.STRIPE_SECRET_KEY === 'string' && process.env.STRIPE_SECRET_KEY.length > 0;
}

// ─── Plan → price-id mapping ──────────────────────────────────────

/**
 * Map a ZeroAuth plan tier to the Stripe price id configured for it.
 * The env-var convention is `STRIPE_PRICE_ID_<PLAN>` (uppercase). The
 * free plan returns `null` — a free-tier subscription is not created
 * on Stripe; ZeroAuth treats "no Stripe subscription" as "free tier."
 */
function resolvePriceId(plan: PlanTier): string | null {
  if (plan === 'free') return null;
  const envKey = `STRIPE_PRICE_ID_${plan.toUpperCase()}`;
  const value = process.env[envKey];
  return value && value.length > 0 ? value : null;
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Create a Stripe customer for the given ZeroAuth tenant.
 *
 * The tenant id is written into Stripe metadata so webhook handlers
 * can map `invoice.paid` / `customer.subscription.deleted` events
 * back to the right row in our `tenant_billing` table without a
 * separate lookup table.
 *
 * Returns the Stripe customer id (e.g. `cus_...`). The caller is
 * responsible for persisting this id into `tenant_billing.stripe_customer_id`.
 */
export async function createCustomer(
  tenantId: string,
  email: string,
): Promise<{ id: string; created: number }> {
  if (!isBillingConfigured()) throw new StripeNotConfiguredError();
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('createCustomer: tenantId must be a non-empty string');
  }
  if (!email || typeof email !== 'string') {
    throw new Error('createCustomer: email must be a non-empty string');
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    metadata: { tenant_id: tenantId, platform: 'zeroauth' },
    description: `ZeroAuth tenant ${tenantId}`,
  });
  logger.info('Stripe customer created', { tenantId, customerId: customer.id });
  return { id: customer.id, created: customer.created };
}

/**
 * Attach a recurring subscription on `plan` to the given Stripe
 * customer. Returns the Stripe subscription id and status (e.g.
 * `active`, `trialing`, `incomplete`).
 *
 * The caller is responsible for:
 *   - Cancelling any existing subscription before calling (Stripe
 *     allows multiple active subscriptions per customer, but ZeroAuth
 *     models one-active-subscription-per-tenant).
 *   - Persisting the returned subscription id into
 *     `tenant_billing.stripe_subscription_id`.
 *   - Calling updateTenantPlan() once the webhook confirms the
 *     subscription is `active`.
 */
export async function createSubscription(
  customerId: string,
  plan: PlanTier,
): Promise<{ id: string; status: string; currentPeriodEnd: number }> {
  if (!isBillingConfigured()) throw new StripeNotConfiguredError();
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('createSubscription: customerId must be a non-empty string');
  }

  const priceId = resolvePriceId(plan);
  if (!priceId) throw new StripePriceMissingError(plan);

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { plan, platform: 'zeroauth' },
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
  });
  logger.info('Stripe subscription created', { customerId, plan, subscriptionId: subscription.id });
  return {
    id: subscription.id,
    status: subscription.status,
    currentPeriodEnd: (subscription as unknown as { current_period_end: number }).current_period_end,
  };
}

/**
 * Push a usage record for a metered billing meter.
 *
 * `metric` is one of the meter names we register in Stripe (e.g.
 * `verifications`, `registrations`). The function lists the customer's
 * active subscription items, finds the one whose `metadata.metric`
 * matches, and posts a usage record against it. The default action is
 * `increment` (Stripe sums per-period).
 *
 * `units` is a non-negative integer; floating point and negatives
 * throw before any network call.
 *
 * Returns the Stripe usage-record id so the caller can write it to
 * `usage_logs.metadata.stripe_usage_record_id` for audit trace-back.
 */
export async function reportUsage(
  customerId: string,
  units: number,
  metric: string,
): Promise<{ id: string; timestamp: number }> {
  if (!isBillingConfigured()) throw new StripeNotConfiguredError();
  if (!customerId || typeof customerId !== 'string') {
    throw new Error('reportUsage: customerId must be a non-empty string');
  }
  if (!Number.isInteger(units) || units < 0) {
    throw new Error('reportUsage: units must be a non-negative integer');
  }
  if (!metric || typeof metric !== 'string') {
    throw new Error('reportUsage: metric must be a non-empty string');
  }

  const stripe = getStripeClient();

  // Find the subscription item whose metadata.metric matches. We
  // walk all active subscriptions for the customer — typically one,
  // but the API doesn't guarantee that, so we don't assume.
  const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 10 });
  let subscriptionItemId: string | null = null;
  for (const sub of subs.data) {
    for (const item of sub.items.data) {
      if ((item.metadata as Record<string, string> | undefined)?.metric === metric) {
        subscriptionItemId = item.id;
        break;
      }
    }
    if (subscriptionItemId) break;
  }
  if (!subscriptionItemId) {
    throw new Error(
      `reportUsage: no active subscription item with metadata.metric="${metric}" for customer ${customerId}`,
    );
  }

  const usageRecord = await (stripe as unknown as {
    subscriptionItems: {
      createUsageRecord(
        id: string,
        params: { quantity: number; timestamp: 'now' | number; action: 'increment' | 'set' },
      ): Promise<{ id: string; timestamp: number }>;
    };
  }).subscriptionItems.createUsageRecord(subscriptionItemId, {
    quantity: units,
    timestamp: 'now',
    action: 'increment',
  });
  logger.info('Stripe usage reported', {
    customerId,
    metric,
    units,
    subscriptionItemId,
    usageRecordId: usageRecord.id,
  });
  return { id: usageRecord.id, timestamp: usageRecord.timestamp };
}
