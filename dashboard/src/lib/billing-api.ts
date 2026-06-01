/**
 * Dashboard-side billing API client.
 *
 * Talks to `/api/console/billing/*` — the console-proxied surface that
 * surfaces the tenant's current plan + monthly usage, and lets the
 * operator switch to a different plan via `POST /api/console/billing/
 * subscribe`. The actual payment-provider integration (Stripe Checkout
 * / Razorpay Hosted Pages / a sales-led PO for Enterprise) is owned by
 * the server side; this client speaks the small JSON envelope on the
 * wire and never touches a payment-provider SDK directly.
 *
 * Contracts the rest of the dashboard relies on:
 *
 *   1. **Plan tier is a closed enum.** `BillingPlanTier` is the public
 *      surface — three tiers visible in the picker (Free / Pro /
 *      Enterprise). The server's internal `Plan` enum (used in
 *      `lib/api.ts::Plan`) carries more granular SKUs (`free`,
 *      `starter`, `growth`, `enterprise`); the mapper below folds the
 *      legacy SKUs onto the three public tiers so a tenant on the
 *      `starter` SKU lights up the `pro` card on the picker. New SKUs
 *      land via ADR — adding one to the public picker without an ADR is
 *      a no-no.
 *
 *   2. **`subscribe` returns a redirect.** Free → Pro and Pro → Free
 *      flow inline (the server toggles the tenant row + returns
 *      `{ ok: true }`). Pro requires a payment-provider checkout; the
 *      server returns `{ ok: true, checkoutUrl }` and the page does a
 *      top-level navigation. Enterprise routes to a sales contact form
 *      (`{ ok: true, contactUrl }`). The discriminated union below makes
 *      the consumer handle all three branches.
 *
 *   3. **Usage is read-only here.** The page reads usage from
 *      `/api/console/billing/summary`, which is a billing-flavoured
 *      projection of `/api/console/usage` (same numbers, additional
 *      `nextResetAt` + `overageAllowed` flags the operator cares about
 *      when deciding to upgrade). No mutation paths touch the usage
 *      counters from this client.
 *
 * Source-of-truth pointers:
 *   - Internal Plan enum + UsageSummary — `lib/api.ts`
 *   - Backend route (planned) — `src/routes/console.ts::billing`
 *   - Pricing copy — `docs/pricing/v1.md` (when it lands)
 */
import { ApiError, getToken, type Plan } from './api';

// ─── Public plan picker tiers ───────────────────────────────────

/**
 * The three tiers shown on the picker. Maps onto the internal `Plan`
 * enum via `PUBLIC_TIER_FOR_PLAN`. A tenant on `starter` or `growth`
 * lights up the Pro card; a tenant on `free` lights up Free; everyone
 * else lights up Enterprise.
 */
export type BillingPlanTier = 'free' | 'pro' | 'enterprise';

export const BILLING_PLAN_TIERS: readonly BillingPlanTier[] = [
  'free',
  'pro',
  'enterprise',
] as const;

/**
 * Display metadata for each tier. Used by the picker card grid.
 * Pricing strings are deliberately string-typed (not numeric) — INR vs.
 * USD, monthly vs. annual, "contact us" all coexist here.
 */
export interface BillingPlanDescriptor {
  tier: BillingPlanTier;
  name: string;
  /** Headline price string, e.g. "₹0", "₹4,999/mo", "Contact sales". */
  price: string;
  /** One-line marketing tagline. */
  tagline: string;
  /** Bullet list of capabilities surfaced on the card. */
  features: readonly string[];
  /** Monthly verification quota — null means "metered" / "custom". */
  monthlyQuota: number | null;
  /** Rate limit (requests per 15 min) — null means "custom". */
  rateLimit: number | null;
  /** CTA copy on the subscribe button when this tier is not the current plan. */
  ctaLabel: string;
}

export const BILLING_PLANS: readonly BillingPlanDescriptor[] = [
  {
    tier: 'free',
    name: 'Free',
    price: '₹0',
    tagline: 'For pilots and prototypes. No card required.',
    features: [
      '1,000 verifications / month',
      'Test environment only',
      'Community Slack support',
      'Audit log retained 7 days',
    ],
    monthlyQuota: 1000,
    rateLimit: 60,
    ctaLabel: 'Switch to Free',
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: '₹4,999/mo',
    tagline: 'For production traffic and live verification volumes.',
    features: [
      '100,000 verifications / month',
      'Live + test environments',
      'Email + business-hours support',
      'Audit log retained 90 days',
      'Webhooks + SSO providers',
    ],
    monthlyQuota: 100_000,
    rateLimit: 600,
    ctaLabel: 'Upgrade to Pro',
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    price: 'Contact sales',
    tagline: 'For regulated workloads (BFSI, healthcare, gov).',
    features: [
      'Custom verification quota',
      'On-chain audit anchoring',
      'SLAs + 24x7 incident response',
      'Compliance pack (DPDP, RBI, SOC 2)',
      'Dedicated success engineer',
    ],
    monthlyQuota: null,
    rateLimit: null,
    ctaLabel: 'Contact sales',
  },
] as const;

/**
 * Folds the server's internal `Plan` SKU onto a public tier. Keep this
 * in lock-step with the server-side billing service when new SKUs land
 * — the picker should always be able to highlight exactly one card.
 */
export function publicTierForPlan(plan: Plan): BillingPlanTier {
  switch (plan) {
    case 'free':
      return 'free';
    case 'starter':
    case 'growth':
      return 'pro';
    case 'enterprise':
      return 'enterprise';
    default:
      return 'free';
  }
}

// ─── Wire shape ─────────────────────────────────────────────────

/**
 * Server response from `GET /api/console/billing/summary`. The shape is
 * a thin projection of `/api/console/usage` with two extra fields the
 * operator cares about when deciding to upgrade: when the quota resets,
 * and whether overage on the current plan would be allowed.
 */
interface ServerBillingSummary {
  plan?: Plan | null;
  currentMonth?: {
    used?: number | null;
    limit?: number | null;
    remaining?: number | 'unlimited' | null;
  } | null;
  rateLimit?: { requestsPer15Min?: number | null } | null;
  nextResetAt?: string | null;
  overageAllowed?: boolean | null;
}

interface ServerSubscribeResponse {
  ok?: boolean;
  plan?: Plan | null;
  /** Hosted checkout URL — the page does a top-level navigation when present. */
  checkoutUrl?: string | null;
  /** Sales-contact URL — used by the Enterprise tier. */
  contactUrl?: string | null;
}

// ─── Public shapes ──────────────────────────────────────────────

export interface BillingSummary {
  plan: Plan;
  tier: BillingPlanTier;
  used: number;
  limit: number | 'unlimited';
  remaining: number | 'unlimited';
  rateLimit: number;
  nextResetAt: string | null;
  overageAllowed: boolean;
}

/**
 * Result of `subscribe`. Three branches:
 *   - `applied`        — the plan switch took effect immediately.
 *   - `checkout`       — the operator must complete a hosted checkout.
 *   - `contact_sales`  — Enterprise tier; route to a contact form.
 */
export type SubscribeResult =
  | { kind: 'applied'; plan: Plan }
  | { kind: 'checkout'; plan: Plan; checkoutUrl: string }
  | { kind: 'contact_sales'; contactUrl: string };

// ─── Mappers ────────────────────────────────────────────────────

function pickPlan(raw: unknown): Plan {
  if (raw === 'free' || raw === 'starter' || raw === 'growth' || raw === 'enterprise') {
    return raw;
  }
  return 'free';
}

function fromSummaryWire(body: ServerBillingSummary | null | undefined): BillingSummary {
  const plan = pickPlan(body?.plan);
  const currentMonth = body?.currentMonth ?? {};
  const used = typeof currentMonth.used === 'number' ? currentMonth.used : 0;
  const limit =
    currentMonth.limit === -1 || currentMonth.limit === null || currentMonth.limit === undefined
      ? 'unlimited'
      : Number(currentMonth.limit);
  const remaining =
    currentMonth.remaining === 'unlimited'
      ? 'unlimited'
      : typeof currentMonth.remaining === 'number'
        ? currentMonth.remaining
        : limit === 'unlimited'
          ? 'unlimited'
          : Math.max(0, (limit as number) - used);
  return {
    plan,
    tier: publicTierForPlan(plan),
    used,
    limit,
    remaining,
    rateLimit: typeof body?.rateLimit?.requestsPer15Min === 'number' ? body!.rateLimit!.requestsPer15Min! : 0,
    nextResetAt: typeof body?.nextResetAt === 'string' ? body.nextResetAt : null,
    overageAllowed: body?.overageAllowed === true,
  };
}

// ─── Fetch helpers ──────────────────────────────────────────────

const SUMMARY_ENDPOINT = '/api/console/billing/summary';
const SUBSCRIBE_ENDPOINT = '/api/console/billing/subscribe';

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function throwOnErr(res: Response, body: unknown, fallback: string): never {
  const errBody = (body && typeof body === 'object' ? body : {}) as {
    error?: string;
    message?: string;
  };
  throw new ApiError(
    res.status,
    errBody.error ?? `http_${res.status}`,
    errBody.message ?? res.statusText ?? fallback,
    body,
  );
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * GET `/api/console/billing/summary`. Returns the tenant's current plan
 * + this-period usage + reset metadata. Throws `ApiError` on non-2xx;
 * consumers wrap this in TanStack Query and read `query.error`.
 */
export async function getBillingSummary(): Promise<BillingSummary> {
  const res = await fetch(SUMMARY_ENDPOINT, { method: 'GET', headers: buildHeaders() });
  const body = await readJson(res);
  if (!res.ok) throwOnErr(res, body, 'Failed to load billing summary.');
  return fromSummaryWire(body as ServerBillingSummary);
}

/**
 * POST `/api/console/billing/subscribe`. The picker calls this with a
 * `BillingPlanTier`; the server may respond with one of three branches
 * (applied / checkout / contact_sales). The page is expected to honour
 * the branch — performing a top-level navigation on `checkout` and
 * `contact_sales`, and refetching the summary on `applied`.
 */
export async function subscribeToTier(tier: BillingPlanTier): Promise<SubscribeResult> {
  const res = await fetch(SUBSCRIBE_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ tier }),
  });
  const body = await readJson(res);
  if (!res.ok) throwOnErr(res, body, 'Failed to update subscription.');
  const env = (body && typeof body === 'object' ? (body as ServerSubscribeResponse) : {}) as ServerSubscribeResponse;
  if (typeof env.checkoutUrl === 'string' && env.checkoutUrl.length > 0) {
    return { kind: 'checkout', plan: pickPlan(env.plan), checkoutUrl: env.checkoutUrl };
  }
  if (typeof env.contactUrl === 'string' && env.contactUrl.length > 0) {
    return { kind: 'contact_sales', contactUrl: env.contactUrl };
  }
  return { kind: 'applied', plan: pickPlan(env.plan) };
}

/**
 * Helper for the picker — given the tenant's current plan, returns the
 * `BillingPlanDescriptor` for the matching tier. Used to highlight
 * "Current plan" on the right card.
 */
export function descriptorForPlan(plan: Plan): BillingPlanDescriptor {
  const tier = publicTierForPlan(plan);
  return BILLING_PLANS.find((p) => p.tier === tier) ?? BILLING_PLANS[0];
}
