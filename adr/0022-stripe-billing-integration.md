# ADR 0022 — Stripe-backed billing for tenant subscriptions and verify-call metering

- **Status:** Proposed
- **Date:** 2026-06-01
- **Phase:** Phase 1 sprint 4 (enables the BFSI demo "self-serve plan upgrade" scene; required before public beta opens billing self-service)
- **Related:** ADR 0013 (audit chain — every plan change writes an audit row), ADR 0017 (blockchain-agnostic posture — plan tiers gate which providers a tenant may select), ADR 0021 (RS256 JWT — console session tokens authorise plan changes), ADR 0016 (zod validation — webhook payloads must be validated before any DB write)

## Context

ZeroAuth is preparing for public beta. The current state of "billing" in the repo is the empty set: every tenant is on an implicit unlimited-everything plan, there is no plan column in the tenants table, no notion of "this tenant exceeded their quota," no surface to upgrade or downgrade, and no invoice infrastructure of any kind. The console signup flow at `POST /api/console/signup` mints a tenant + a `za_test_*` API key and that is it.

Three pressures force the question now:

1. **Public beta needs a paywall.** The Phase 1 exit gate (the Anchor Bank demo) is internal; Phase 2 opens self-serve signups to the world, and we cannot accept "anyone can mint a tenant and call `/v1/identity/verify` a million times for free" as the floor. The pain-point doc ([docs/plan/bfsi-v1/01-pain-points.md](../docs/plan/bfsi-v1/01-pain-points.md)) entries P-7 ("commercials are opaque — bank procurement needs a price list before pilot signoff") and P-8 ("incumbents lock pricing behind 6-week sales cycles — we want self-serve") both trace to the absence of a billing surface.

2. **Three distinct charging models in the same product.** Tenants pay a recurring base fee (the plan tier — Starter, Growth, Scale) AND pay metered overage on `/v1/identity/verify` calls above the plan's included envelope AND, for enterprise tenants, pay one-time setup fees (DID-provider deployment, on-chain anchor bootstrap). A single bespoke invoice generator would be five months of work; Stripe does all three out of the box.

3. **Operator burden today is unbounded.** When a customer wants to upgrade Starter → Growth, the only path is "email amit@zeroauth.dev, wait for someone to flip a flag." This does not scale past ten tenants. We need the console to own the upgrade flow end-to-end so the operator only handles exceptions (failed payments, custom contracts).

The non-trivial constraint: ZeroAuth deployments run **in the customer's VPC** for BFSI tenants (per [docs/compliance/rbi-sandbox.md](../docs/compliance/rbi-sandbox.md)). A bank's regulator will not tolerate "this Indian bank's billing state lives in Stripe's US-hosted database." So Stripe is the **default-tenant billing provider**, not a hard dependency — exactly the shape ADR 0017 established for the blockchain layer.

## Decision

Adopt Stripe as the **default** billing provider, keyed on `tenant.billing_provider`, with the same opt-out shape as ADR 0017's `did_provider` and `verifier_provider` policy knobs. Tenants pick a plan in the console; the platform mints a Stripe customer + subscription via the Stripe API; metered overage on `/v1/identity/verify` is reported nightly via Stripe's usage-record API; failed payments downgrade the tenant via webhook.

### Provider taxonomy

A new column on `tenants`: `billing_provider VARCHAR(32) NOT NULL DEFAULT 'stripe'` with allowed values:

- `stripe` — **default**. Platform owns the Stripe customer + subscription + price IDs; webhook drives plan state.
- `manual` — **enterprise / BFSI**. Plan + status are set by the operator via an admin endpoint. No Stripe customer is minted. Used for tenants that pay by purchase order, wire transfer, or whose regulator forbids US-hosted billing state. The Anchor Bank demo tenant ships on `manual`.
- `none` — internal / test tenants. No billing surface; verify-call meter still runs (for telemetry) but produces no invoice. Used by the test harness and the `demo` tenant.

A default tenant boots with zero `STRIPE_SECRET_KEY` and zero webhook secret. The platform must remain operable on `billing_provider=none` end-to-end so CI, local dev, and self-hosted deployments never need a Stripe account.

### Plan tiers (initial)

| Plan         | Monthly fee | Included verifies | Overage rate          | Stripe price ID (env)              |
|--------------|-------------|-------------------|-----------------------|------------------------------------|
| Starter      | $0          | 1,000             | $0.01 / verify        | `STRIPE_PRICE_STARTER`             |
| Growth       | $199        | 50,000            | $0.005 / verify       | `STRIPE_PRICE_GROWTH`              |
| Scale        | $999        | 500,000           | $0.002 / verify       | `STRIPE_PRICE_SCALE`               |
| Enterprise   | custom      | custom            | custom                | (not in Stripe; `manual` provider) |

Tiers are configuration, not code. The four price IDs above are loaded from env at boot; switching tiers is an env change + restart, not a code deploy. The plan list itself lives in `src/config/plans.ts` so that the console can render it and so tests can fixture against it without the env being set.

### Schema

New table `tenant_billing` (one row per tenant, FK to tenants):

```sql
CREATE TABLE IF NOT EXISTS tenant_billing (
  tenant_id            UUID         PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id   VARCHAR(64)  UNIQUE,            -- NULL when billing_provider != 'stripe'
  stripe_subscription_id VARCHAR(64) UNIQUE,           -- NULL until first plan selected
  plan                 VARCHAR(32)  NOT NULL DEFAULT 'starter',  -- 'starter' | 'growth' | 'scale' | 'enterprise'
  status               VARCHAR(32)  NOT NULL DEFAULT 'active',   -- see status state machine below
  current_period_start TIMESTAMPTZ,                              -- mirrored from Stripe; used for overage windowing
  current_period_end   TIMESTAMPTZ,                              -- mirrored from Stripe; nightly meter reports use this
  trial_ends_at        TIMESTAMPTZ,                              -- optional; Stripe drives this
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_billing_status ON tenant_billing(status);
CREATE INDEX IF NOT EXISTS idx_tenant_billing_stripe_customer ON tenant_billing(stripe_customer_id);
```

The row is created at tenant signup with `plan='starter'`, `status='active'`, and (if `STRIPE_SECRET_KEY` is configured) a fresh `stripe_customer_id`. If Stripe is not configured, the columns stay NULL — the rest of the platform reads `plan` + `status` from this table regardless of provider, so the rate-limit and quota code never branches on "is Stripe wired up."

### Status state machine

`tenant_billing.status` values:

| Status                | Meaning                                                                                | API behaviour                                          |
|-----------------------|----------------------------------------------------------------------------------------|--------------------------------------------------------|
| `active`              | Subscription is current; all surfaces work.                                            | All endpoints work.                                    |
| `trialing`            | Stripe trial is in progress; usage is recorded but no overage billed until trial ends. | All endpoints work; overage suppressed.                |
| `past_due`            | Stripe reported a failed payment; tenant has a grace window (default 7 days).          | Verify works; console shows banner; webhook downgrades.|
| `unpaid`              | Grace expired; subscription was downgraded by Stripe smart retries.                    | Verify returns 402 with `payment_required` error code. |
| `canceled`            | Tenant or operator canceled the subscription.                                          | Verify returns 402; tenant data retained 90 days.      |
| `incomplete`          | Initial payment never succeeded (e.g. card was declined at signup).                    | Verify returns 402; console forces card update.        |

Transitions are driven exclusively by Stripe webhook events — the platform never sets a non-`active` status by itself, with one exception: the `POST /api/admin/tenants/:id/billing/override` admin endpoint sets `status` on `manual`-provider tenants. Every transition writes a row to `audit_events` per the ADR 0013 hash chain.

### API surface

Three new console endpoints (tenant-JWT-authed; live under `/api/console/billing/*`):

- `GET /api/console/billing/plan` → returns `{ plan, status, current_period_end, included_verifies, used_verifies, overage_rate }`. Reads only `tenant_billing` + the usage meter; never calls Stripe.
- `POST /api/console/billing/checkout` → creates a Stripe Checkout Session for the requested plan, returns `{ url }` for the frontend to redirect to. Stripe Checkout owns card collection; we never see the PAN.
- `POST /api/console/billing/portal` → creates a Stripe Customer Portal session, returns `{ url }`. The portal owns "update card," "cancel subscription," "download invoices."

One new admin endpoint:

- `POST /api/admin/tenants/:id/billing/override` (x-api-key authed) — sets `plan` + `status` on a `manual`-provider tenant. Writes an audit row. The only way to flip a `manual` tenant's plan.

One new webhook endpoint:

- `POST /v1/billing/webhook` — receives Stripe events; signature-verified against `STRIPE_WEBHOOK_SECRET`; payload validated with zod per ADR 0016; idempotent against the Stripe event ID. Handled events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. The webhook is the **only** caller that may transition `status` for `stripe`-provider tenants — neither the console nor admin endpoints may set status directly for Stripe tenants; they only mint Stripe API calls and let the resulting webhook drive state.

### Metering

`/v1/identity/verify` increments an in-process counter today (see `src/services/usage.ts`). The change: at the existing increment point, also append a row to a new `verify_usage_records` table:

```sql
CREATE TABLE IF NOT EXISTS verify_usage_records (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reported_at  TIMESTAMPTZ,                                 -- NULL until nightly job reports to Stripe
  stripe_record_id VARCHAR(64)                              -- Stripe usage record ID for idempotency
);
CREATE INDEX IF NOT EXISTS idx_verify_usage_unreported
  ON verify_usage_records(tenant_id, occurred_at)
  WHERE reported_at IS NULL;
```

A nightly job (cron at 02:00 UTC, owned by `src/jobs/report-stripe-usage.ts`) aggregates unreported rows per tenant, computes the count above each plan's included envelope (read from `src/config/plans.ts`), and calls Stripe's `subscriptionItems.createUsageRecord` once per tenant with `quantity = overage_count` and `action = 'set'` (idempotent against the period — re-running the job in the same period is a no-op). On success the job stamps `reported_at` on every aggregated row. Failures are logged and retried the next night; nothing is dropped.

The job is a no-op for `billing_provider IN ('manual', 'none')` tenants.

### Failure modes and degradation

- **Stripe down at signup:** signup completes anyway; the `tenant_billing` row is created with `stripe_customer_id = NULL` and `status = 'incomplete'`. A background job (`src/jobs/backfill-stripe-customers.ts`) retries customer creation hourly. The tenant can use the test API key immediately; the live key + paid features are gated on `status = 'active'`.
- **Stripe down at checkout:** the console returns a 503 with `billing_provider_unavailable`; no DB state changes.
- **Webhook delivery failure:** Stripe retries for 3 days with exponential backoff. Our handler is idempotent against `event.id` (stored in a `stripe_events_seen` deduplication table), so duplicate deliveries are safe.
- **Nightly meter job crashes:** unreported rows accumulate with `reported_at IS NULL`; the next run picks them up. The query uses the partial index above so it stays cheap.
- **Tenant deletes themselves:** `DELETE` on the tenants table cascades to `tenant_billing` and `verify_usage_records`; an out-of-band reconciliation script then cancels the Stripe subscription. The deletion is audit-logged.

### Secret handling — NO REAL STRIPE KEYS COMMITTED

**This is a hard rule:** no real Stripe key — neither the secret API key, the publishable key, the webhook secret, nor any price ID from a real Stripe account — appears in the repo. Not in `.env`, not in `.env.example`, not in test fixtures, not in CI secrets accessed during PR runs, not in commit messages, not in ADRs.

The `.env.example` file is updated with **shape only**, using clearly fake values:

```bash
# Stripe billing (ADR 0022). Leave blank to disable Stripe; the platform falls back to billing_provider='none'.
STRIPE_SECRET_KEY=                       # sk_test_... or sk_live_... — never commit a real value
STRIPE_PUBLISHABLE_KEY=                  # pk_test_... or pk_live_... — safe to expose to the dashboard
STRIPE_WEBHOOK_SECRET=                   # whsec_... rotated quarterly; lives in the prod secret manager
STRIPE_PRICE_STARTER=                    # price_... — set by operator after creating plans in Stripe dashboard
STRIPE_PRICE_GROWTH=                     # price_...
STRIPE_PRICE_SCALE=                      # price_...
STRIPE_CHECKOUT_SUCCESS_URL=https://zeroauth.dev/dashboard/billing/success
STRIPE_CHECKOUT_CANCEL_URL=https://zeroauth.dev/dashboard/billing
```

The `src/config/stripe.ts` loader reads these at boot; if any required value is missing AND any tenant in the DB has `billing_provider='stripe'`, the loader logs a single warning and the affected endpoints return `503 billing_provider_unavailable`. The platform does NOT refuse to boot — a self-hosted deployment with all `manual`-provider tenants must come up cleanly with zero Stripe env vars set.

Tests use Stripe's official test-mode keys, loaded from a local-only `.env.test` (already gitignored, just like `.env`). The CI workflow exposes those test keys through a GitHub Actions secret named `STRIPE_TEST_SECRET_KEY`; the secret is injected at runtime and never echoed into logs. PR-from-fork runs skip the Stripe integration tests (they can't access org secrets) and run a mock-server fallback in `tests/__mocks__/stripe.ts` instead.

### What this does NOT do

- It does NOT add HSM-backed Stripe key storage. The secret manager (VPS `/opt/zeroauth/.env`) is the source of truth. HSM-backed signing for the webhook verification step is on the Phase 4 roadmap if a customer demands it.
- It does NOT introduce per-tenant Stripe accounts (Stripe Connect). All tenants are subscribers on the single ZeroAuth platform account. Stripe Connect is a Phase 3 ticket if we onboard reseller partners.
- It does NOT bill for anything other than the verify call. Other metered surfaces (audit-event ingestion volume, DID anchor on-chain costs) will get their own usage records when the schema stabilises. The `verify_usage_records` table name is intentionally narrow.
- It does NOT migrate any existing tenants. On first deploy, all tenants are inserted into `tenant_billing` with `billing_provider` derived from a one-time migration: `demo` tenant → `none`, the Anchor Bank tenant → `manual`, every other extant tenant → `stripe` + `plan='starter'`. The operator may then upgrade by hand via the override endpoint before flipping the public beta toggle.
- It does NOT touch the `/v1/identity/verify` hot path beyond the existing usage-counter increment. The new `verify_usage_records` INSERT is fire-and-forget against a separate pool; verify latency must stay under the existing SLO (p99 < 80 ms).

## Consequences

**Positive**

- Closes Phase 2 open-beta blocker. Self-serve plan selection no longer requires operator intervention.
- Three-tier metered billing with one industry-standard provider; no bespoke invoice code.
- BFSI tenants stay on `manual` provider and never touch Stripe — addresses the data-residency objection head-on.
- The `billing_provider` knob is the same shape as ADR 0017's blockchain knobs, so the operator mental model is consistent.
- Failed-payment downgrade is automatic; no operator action required for the common case.

**Negative**

- New external dependency (Stripe API + webhook delivery) introduced. Mitigation: every Stripe call path has a documented degraded mode (see "Failure modes" above), and the platform must remain operable with `billing_provider=none` for self-hosted deployments.
- Webhook signature verification adds a public unauthenticated endpoint (`POST /v1/billing/webhook`). Mitigation: zod-validate payload, signature-verify against `STRIPE_WEBHOOK_SECRET`, idempotency-dedupe by `event.id`, rate-limit per-source-IP (Stripe publishes their CIDR ranges; we allowlist).
- One new nightly cron job to operate. Mitigation: the job is idempotent and the partial index makes the unreported-rows query cheap even at 10M records.
- `tenant_billing` is a singleton table per tenant; if it disagrees with Stripe (e.g. webhook missed), a reconciliation script is required. Mitigation: the `scripts/reconcile-stripe.ts` script (lands in the same commit) iterates all `stripe`-provider tenants nightly and fixes drift; it runs after the meter-reporting job.
- The plan tiers + prices are baked into env. Mitigation: the operator owns the Stripe dashboard; price changes are an env + restart, not a code deploy. Long-term, a `plans` table is on the roadmap if marketing wants A/B-tested prices.

## Test impact

- `tests/billing-schema.test.ts` — new. Asserts the table exists with the expected columns, defaults, and constraints; asserts the migration is idempotent (re-running it is a no-op).
- `tests/billing-webhook.test.ts` — new. Mocks Stripe; asserts: signature verification rejects unsigned payloads; valid `customer.subscription.updated` flips `status`; replay of the same `event.id` is a no-op; unknown event types are 200-OK no-ops.
- `tests/billing-checkout.test.ts` — new. Asserts `POST /api/console/billing/checkout` requires console JWT, returns 503 when Stripe is not configured, returns a Checkout URL when it is.
- `tests/billing-meter.test.ts` — new. Asserts the nightly job aggregates correctly, skips `manual`/`none` tenants, stamps `reported_at`, is idempotent against repeat runs in the same period.
- `tests/billing-tenant-isolation.test.ts` — new. Asserts a tenant cannot read or modify another tenant's `tenant_billing` row through any console endpoint.
- `tests/billing-degraded.test.ts` — new. Asserts that with all `STRIPE_*` env vars unset, the platform boots, all `manual`-provider tenant routes work, and Stripe routes return 503 with the documented error code.

## Open questions deferred

- Stripe Tax integration (we currently don't compute VAT/GST). Phase 2 ticket; legal review pending.
- Annual billing with prepay discount. Marketing requirement; not in initial launch.
- Per-tenant credit notes / promotional codes. Operator-applied only via Stripe dashboard for now; surfaced in the console in Phase 2.
- Refund flow. Operator-initiated via Stripe dashboard; the platform reads the resulting webhook and updates `status`/audit; no console UI in initial launch.
- Self-hosted / on-prem licensing (the BFSI tenants who run ZeroAuth in their own VPC). That is a sales-led contract today; an automated licensing surface is Phase 4 if we add resellers.
- Multi-currency. INR support is required before Indian BFSI tenants leave `manual`; tracked separately because it requires Stripe-India onboarding (a regulated-entity exercise).
- Dunning / soft-decline UX in the console. Stripe's smart retries cover the recovery loop today, but the console banner copy + email cadence are owned by marketing; tracked in the Phase 2 design queue.
- SCA / 3-D Secure exemption strategy. Stripe Radar handles authentication routing today; if our merchant-of-record posture changes (e.g. Stripe Connect adoption), revisit per-region SCA tuning.

## Rollout plan

The change ships across three commits on a single PR (`feat/billing-stripe`), gated by feature flag `BILLING_ENABLED`:

1. **Schema + types.** Adds `tenant_billing` + `verify_usage_records` + `stripe_events_seen` to `src/services/db.ts`, adds the migration to `tests/schema-purity.test.ts`, adds the config loader at `src/config/stripe.ts`. No route surface yet. Passes CI with zero Stripe env vars set.
2. **Routes + webhook.** Adds the four new endpoints (`/api/console/billing/plan|checkout|portal`, `/api/admin/tenants/:id/billing/override`, `/v1/billing/webhook`). Adds the six test files listed under "Test impact." All routes are gated on `BILLING_ENABLED=true`; default-off.
3. **Nightly job + reconciliation.** Adds `src/jobs/report-stripe-usage.ts` and `scripts/reconcile-stripe.ts`. Wires the job into the existing cron scheduler (the same surface the audit-anchor job already lives in). Adds runbook entry to [docs/operations/](../docs/operations/).

After the PR merges to `main`, the operator manually enables `BILLING_ENABLED=true` on the production VPS env, runs the one-time migration that backfills `tenant_billing` rows for existing tenants, and confirms the `/api/console/billing/plan` endpoint returns expected values for the demo tenant before flipping the public-beta toggle. Rollback is `BILLING_ENABLED=false` + restart; the schema additions are forward-compatible and don't need to be reverted.

LAST_UPDATED: 2026-06-01
OWNER: Agent #18 (Senior Backend — billing + tenant lifecycle) + Agent #4 (Product — pricing)
