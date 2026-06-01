/**
 * Tenant Billing view.
 *
 * Three logical zones:
 *
 *   1. **Current plan + monthly usage.** A summary card pulled from
 *      `/api/console/billing/summary`. Shows the tenant's current SKU,
 *      the bar of "verifications used / limit", the rate-limit knob,
 *      and the next-reset timestamp. The plan label here always reflects
 *      what the SERVER thinks the tenant is on — it's the source of
 *      truth, and the picker below highlights the matching tier.
 *
 *   2. **Plan picker.** Three side-by-side cards (Free / Pro /
 *      Enterprise). Each card lists features + headline price; the
 *      "Current plan" card is decorated and the CTA on it is disabled
 *      ("You're on this plan"). The CTAs on the other cards call
 *      `subscribeToTier`, which can resolve into one of three branches:
 *        - `applied`        → the page refetches the summary + toasts.
 *        - `checkout`       → top-level navigation to the hosted page.
 *        - `contact_sales`  → opens the contact-sales link in a new tab.
 *
 *   3. **Footer help.** A small block of links — "How does billing
 *      work?", "Compare all plans", "Volume pricing for Enterprise" —
 *      so an operator who is on the fence can find more context without
 *      pinging support.
 *
 * Non-goals on this page:
 *   - Payment method management (cards, UPI, NACH) lives on the hosted
 *     checkout page; the dashboard never sees a PAN.
 *   - Invoice history. A separate `/billing/invoices` page will land
 *     when the server-side invoice endpoint ships.
 *   - Per-environment limits. Live + test share a single quota for now;
 *     ADR 0019 will track environment-scoped quotas.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Skeleton,
  pushToast,
} from '../../components/ui';
import { ApiError } from '../../lib/api';
import { fmtDateTime, fmtNumber } from '../../lib/format';
import {
  BILLING_PLANS,
  type BillingPlanDescriptor,
  type BillingPlanTier,
  type BillingSummary,
  getBillingSummary,
  subscribeToTier,
} from '../../lib/billing-api';

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Pick the badge tone based on quota burn. Below 60% → success; 60-90%
 * → warn (visibility into "you'll probably need to upgrade soon"); over
 * 90% → danger. Unlimited tiers always read as neutral.
 */
function quotaTone(used: number, limit: number | 'unlimited'): 'success' | 'warn' | 'danger' | 'neutral' {
  if (limit === 'unlimited') return 'neutral';
  if (limit <= 0) return 'neutral';
  const pct = (used / limit) * 100;
  if (pct >= 90) return 'danger';
  if (pct >= 60) return 'warn';
  return 'success';
}

/** Linear progress bar for "used / limit". Caps at 100%. */
function UsageBar({ used, limit }: { used: number; limit: number | 'unlimited' }) {
  if (limit === 'unlimited' || limit <= 0) {
    return (
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-surface)]">
        <div className="h-full w-full bg-[var(--color-success)]/30" />
      </div>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const fill =
    pct >= 90
      ? 'bg-[var(--color-danger)]'
      : pct >= 60
        ? 'bg-[var(--color-warn)]'
        : 'bg-[var(--color-success)]';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-surface)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} data-testid="billing-usage-bar">
      <div className={`h-full transition-all ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Page component ────────────────────────────────────────────

export function Billing() {
  const qc = useQueryClient();
  const [pendingTier, setPendingTier] = useState<BillingPlanTier | null>(null);

  const summary = useQuery({
    queryKey: ['billing-summary'],
    queryFn: getBillingSummary,
  });

  const subscribe = useMutation({
    mutationFn: subscribeToTier,
    onMutate: (tier) => { setPendingTier(tier); },
    onSuccess: (result) => {
      if (result.kind === 'checkout') {
        // Hosted checkout — top-level nav. Don't optimistically update
        // the cache; the operator must complete the payment provider
        // step before the server flips the plan.
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.kind === 'contact_sales') {
        window.open(result.contactUrl, '_blank', 'noopener,noreferrer');
        pushToast('info', 'Opened sales contact in a new tab.');
        return;
      }
      // applied — refresh the summary so the "Current plan" highlight
      // moves to the new tier.
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      pushToast('success', 'Plan updated.');
    },
    onError: (err) => {
      pushToast('danger', err instanceof ApiError ? err.message : 'Could not update plan.');
    },
    onSettled: () => { setPendingTier(null); },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Your current plan, this month&rsquo;s usage, and how to switch tiers. All plan changes are
          audited; Pro and Enterprise switches route through a hosted checkout or sales contact.
        </p>
      </header>

      <CurrentPlanCard query={summary} />

      <PlanPicker
        currentTier={summary.data?.tier ?? 'free'}
        loading={summary.isLoading}
        pendingTier={subscribe.isPending ? pendingTier : null}
        onSubscribe={(tier) => subscribe.mutate(tier)}
      />

      <FooterHelp />
    </div>
  );
}

// ─── Current plan + usage card ─────────────────────────────────

function CurrentPlanCard({
  query,
}: {
  query: ReturnType<typeof useQuery<BillingSummary>>;
}) {
  return (
    <Card>
      <CardHeader
        title="Current plan + usage"
        description="Verifications consumed against your monthly quota. Resets at the end of the billing period."
        action={
          query.data ? (
            <Badge tone="brand" className="capitalize" data-testid="billing-current-tier-badge">
              {query.data.tier}
            </Badge>
          ) : null
        }
      />
      <CardBody>
        {query.isLoading ? (
          <div className="space-y-3" data-testid="billing-summary-loading">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : query.isError ? (
          <div
            className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
            role="alert"
            data-testid="billing-summary-error"
          >
            Could not load billing summary. The plan picker below still works; try refreshing in a
            moment.
          </div>
        ) : query.data ? (
          <div className="space-y-4" data-testid="billing-summary">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="text-3xl font-semibold text-[var(--color-text)]" data-testid="billing-used">
                {fmtNumber(query.data.used)}
              </div>
              <div className="text-sm text-[var(--color-text-secondary)]">
                of {query.data.limit === 'unlimited' ? 'unlimited' : fmtNumber(query.data.limit)} verifications this month
              </div>
              <Badge tone={quotaTone(query.data.used, query.data.limit)}>
                {query.data.limit === 'unlimited'
                  ? 'metered'
                  : query.data.remaining === 'unlimited'
                    ? 'unlimited remaining'
                    : `${fmtNumber(query.data.remaining)} left`}
              </Badge>
            </div>

            <UsageBar used={query.data.used} limit={query.data.limit} />

            <dl className="grid grid-cols-1 gap-y-2 sm:grid-cols-3 sm:gap-x-6 text-xs">
              <div>
                <dt className="text-[var(--color-text-dim)] uppercase tracking-wide">Rate limit</dt>
                <dd className="mt-1 text-[var(--color-text)]" data-testid="billing-rate-limit">
                  {query.data.rateLimit > 0 ? `${fmtNumber(query.data.rateLimit)} req / 15 min` : 'custom'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-dim)] uppercase tracking-wide">Next reset</dt>
                <dd className="mt-1 text-[var(--color-text)]" data-testid="billing-next-reset">
                  {fmtDateTime(query.data.nextResetAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-text-dim)] uppercase tracking-wide">Overage</dt>
                <dd className="mt-1 text-[var(--color-text)]" data-testid="billing-overage">
                  {query.data.overageAllowed ? 'Allowed (metered)' : 'Blocked at quota'}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ─── Plan picker ───────────────────────────────────────────────

function PlanPicker({
  currentTier,
  loading,
  pendingTier,
  onSubscribe,
}: {
  currentTier: BillingPlanTier;
  loading: boolean;
  pendingTier: BillingPlanTier | null;
  onSubscribe: (tier: BillingPlanTier) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Plans"
        description="Pick the tier that matches your verification volume. You can switch any time."
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3" data-testid="billing-plan-grid">
          {BILLING_PLANS.map((plan) => (
            <PlanCard
              key={plan.tier}
              plan={plan}
              isCurrent={!loading && plan.tier === currentTier}
              busy={pendingTier === plan.tier}
              onSubscribe={() => onSubscribe(plan.tier)}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function PlanCard({
  plan,
  isCurrent,
  busy,
  onSubscribe,
}: {
  plan: BillingPlanDescriptor;
  isCurrent: boolean;
  busy: boolean;
  onSubscribe: () => void;
}) {
  return (
    <div
      data-testid={`billing-plan-${plan.tier}`}
      className={
        'flex flex-col rounded-lg border p-5 transition-colors ' +
        (isCurrent
          ? 'border-[var(--color-brand)]/60 bg-[var(--color-brand)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-bg-surface)]')
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--color-text)]">{plan.name}</h3>
        {isCurrent ? <Badge tone="brand">Current plan</Badge> : null}
      </div>
      <div className="text-2xl font-semibold text-[var(--color-text)]" data-testid={`billing-plan-${plan.tier}-price`}>
        {plan.price}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{plan.tagline}</p>

      <ul className="my-4 space-y-1.5 text-xs text-[var(--color-text-secondary)]">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 text-[var(--color-success)]">
              {/* Inline check — no icon-font dependency. */}
              <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6.5l2.5 2.5L10 3.5" />
              </svg>
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        <Button
          type="button"
          variant={isCurrent ? 'secondary' : 'primary'}
          size="md"
          disabled={isCurrent || busy}
          loading={busy}
          onClick={onSubscribe}
          data-testid={`billing-subscribe-${plan.tier}`}
          className="w-full"
        >
          {isCurrent ? "You're on this plan" : plan.ctaLabel}
        </Button>
      </div>
    </div>
  );
}

// ─── Footer help ───────────────────────────────────────────────

function FooterHelp() {
  return (
    <div
      className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 py-3 text-xs text-[var(--color-text-secondary)]"
      data-testid="billing-footer-help"
    >
      <strong className="text-[var(--color-text)]">Need help picking?</strong>{' '}
      Pro fits most production tenants under 100k verifications/month. Enterprise unlocks on-chain
      audit anchoring, custom quotas, and a dedicated success engineer — book a call if you have
      regulatory commitments (DPDP, RBI, SOC 2) that need contractual coverage.{' '}
      <a
        href="https://docs.zeroauth.dev/pricing"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-[var(--color-text)]"
      >
        Compare all plans &rarr;
      </a>
    </div>
  );
}

export default Billing;
