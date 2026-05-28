/**
 * Per-tenant verification event fan-out (in-process pub/sub).
 *
 * Backs the live verifications dashboard view at
 * `/dashboard/tenant/verifications`. Every audit row written through
 * `src/services/audit.ts::appendAuditEvent` whose `action` is one of
 * the verification-class actions is also emitted on a per-tenant
 * EventEmitter so any open SSE subscriber for that tenant receives
 * the row in real time.
 *
 * Design constraints + non-goals:
 *
 *   1. **Single source of truth.** The DB INSERT is the source of
 *      truth — this emitter fires only AFTER the audit row commits,
 *      so a subscriber never sees an event that did not also land in
 *      `audit_events`. The opposite (commit succeeds, emit silently
 *      drops) is acceptable: the dashboard view is a live tail, not
 *      a transactional sink, so a drop costs at most a missed row in
 *      the in-session counter, which the operator can refresh past.
 *
 *   2. **Tenant scoping.** Listeners subscribe with a `tenantId` and
 *      see ONLY their own tenant's events. There is no cross-tenant
 *      fan-out path. The emitter key is the tenant id; the payload
 *      itself also carries `tenant_id` so a misconfigured subscriber
 *      can self-check.
 *
 *   3. **In-process only.** This is a single-Node-process emitter.
 *      Multi-instance scale-out (two API pods behind a load balancer)
 *      requires a Redis pub/sub backing — that's the v2 roadmap.
 *      Today the production deployment runs a single API pod (see
 *      `docker-compose.yml`); when we add a second pod a subscriber
 *      on pod A will miss verifications written on pod B until the
 *      Redis migration lands. The dashboard view is honest about
 *      this — it presents itself as a per-process live tail, not a
 *      durable feed.
 *
 *   4. **Bounded memory.** The emitter does NOT buffer past events.
 *      A subscriber that connects mid-session sees only events from
 *      its connect time forward. The dashboard view keeps its own
 *      rolling 100-event buffer client-side; backfill of older rows
 *      is the job of the existing `/api/console/verifications` REST
 *      endpoint, not this stream.
 *
 *   5. **No PII.** The payload shape is restricted to fields that
 *      survive the DPDP §2(t) "no PII" review: DID, environment,
 *      result, latency_ms, created_at, audit_id, proof_hash, reason.
 *      No full name, no email, no phone, no biometric-derived data.
 *      The DPDP §2(t) memo at `docs/compliance/dpdp-2t-memo.md`
 *      argues the data principal is not identifiable from this
 *      surface; the dashboard-side `verifications-api.ts` projection
 *      provides defence in depth (see commit `6e06a14` for the same
 *      pattern on the users view).
 *
 * Verification-class actions that trigger an emit:
 *
 *   - `verification.recorded` — written by `recordVerificationEvent`
 *     in `src/services/platform.ts` whenever a tenant calls
 *     `/v1/verifications`. Status is `success` for `pass`/`challenge`
 *     and `failure` for `fail`.
 *   - `verification.verify_success` — written by the W3 proof-pairing
 *     flow when a Groth16 proof verifies cleanly.
 *   - `verification.verify_failure` — proof-pairing rejection.
 *   - `auth.verify_success`, `auth.verify_failure` — legacy
 *     `/api/auth/*` surface; still emitted for completeness.
 *
 * The action list is a const tuple at the top of this file. The
 * audit-chain commit hook calls `isVerificationAction(payload.action)`
 * and the emit is a no-op for non-matching actions, so widening the
 * list is a one-line change here, not a refactor across the audit
 * service.
 */

import { EventEmitter } from 'events';

// ─── Public types ───────────────────────────────────────────────

/**
 * The payload shape every subscriber receives.
 *
 * Fields are deliberately the small subset of the audit row that
 * survives the DPDP §2(t) "no PII" filter. The dashboard-side
 * `verifications-api.ts` projects this further (timestamp + DID +
 * environment + result + latency + reason) before the data reaches
 * any React component.
 *
 * Adding a field here is an ADR-grade decision; the schema-purity
 * test at `tests/schema-purity.test.ts` plus the dashboard's
 * `verifications.test.tsx` PII-blacklist guard the surface.
 */
export interface VerificationEventPayload {
  /**
   * The tenant id this verification belongs to. Subscribers also
   * gate on this in the listener side, but we include it in the
   * payload so a misconfigured subscriber self-checks.
   */
  tenant_id: string;
  /** Audit row id (BIGSERIAL stringified) — joins back to `audit_events`. */
  audit_id: string;
  /** 'live' or 'test', mirroring the audit row. May be null. */
  environment: 'live' | 'test' | null;
  /** Full audit action verb, e.g. 'verification.recorded'. */
  action: string;
  /** 'success' | 'failure' — taken directly from the audit row. */
  status: 'success' | 'failure';
  /** Server-clock timestamp at which the audit row committed. */
  created_at: string;
  /**
   * Opaque decentralised identifier. The DID is the only "who" field
   * the platform exposes on the verifications surface — there is no
   * `user_id`, no name, no email. May be null for verification rows
   * that pre-date DID issuance.
   */
  did: string | null;
  /**
   * Wall-clock latency in milliseconds from request receipt to
   * verification outcome, if the upstream surface measured it. The
   * dashboard renders this as a per-row badge.
   */
  latency_ms: number | null;
  /**
   * SHA-256 hash of the Groth16 proof, hex. The bank's auditor uses
   * this to cross-reference the proof archive (P3 of the BFSI
   * pain-point map). May be null for non-ZKP verifications.
   */
  proof_hash: string | null;
  /**
   * Failure reason — verbatim machine code from the verifier. Only
   * populated when `status === 'failure'`.
   */
  reason: string | null;
}

/**
 * Subscriber handle returned by `subscribeVerifications`. Callers
 * invoke `close()` when they're done — the SSE route does this on
 * the `req.on('close')` callback.
 */
export interface VerificationSubscription {
  close(): void;
}

// ─── Action allowlist ────────────────────────────────────────────

/**
 * The audit-action verbs that trigger a verification-events emit.
 *
 * Any other action (e.g. `device.created`, `tenant.login`) passes
 * straight through `appendAuditEvent` without an emit. Widening
 * this list is a one-line change.
 */
const VERIFICATION_ACTIONS = new Set<string>([
  'verification.recorded',
  'verification.verify_success',
  'verification.verify_failure',
  'auth.verify_success',
  'auth.verify_failure',
]);

/**
 * Returns true if the audit action should produce a verification
 * event emit. Exported for the audit-service hook.
 */
export function isVerificationAction(action: string): boolean {
  return VERIFICATION_ACTIONS.has(action);
}

// ─── Per-tenant emitter (module-level, single process) ───────────

/**
 * Module-scoped emitter. Listeners are keyed by tenant id so a
 * subscriber for tenant A never gets tenant B's events. The emitter
 * uses Node's stock EventEmitter; max listeners is bumped because
 * the dashboard view may have many simultaneous operator sessions.
 *
 * For v2 multi-instance scale-out this is the seam where Redis
 * pub/sub plugs in: replace the EventEmitter call sites with a
 * Redis-channel publish + a Redis-channel subscribe, and the
 * dashboard surface stays unchanged. The migration is intentionally
 * one file deep.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(256);

/**
 * Emit a verification event for the given tenant. Called by the
 * audit-service hook after the audit-row INSERT commits.
 *
 * Synchronous — Node's EventEmitter fires listeners in-order in
 * the caller's microtask. The audit hook awaits the INSERT, then
 * calls this, so the emit can never beat the commit.
 *
 * Failure mode: a listener that throws does NOT propagate the
 * throw to the audit caller. Node EventEmitter swallows listener
 * errors by default in our handler, so the caller sees emit() as
 * always-succeeding. The dashboard view is best-effort by design.
 */
export function emitVerificationEvent(payload: VerificationEventPayload): void {
  try {
    emitter.emit(payload.tenant_id, payload);
  } catch {
    // Don't let a bad listener take down the audit caller. The audit
    // row is already committed; we're just fanning out a notification.
  }
}

/**
 * Subscribe to verification events for a specific tenant.
 *
 * Returns a handle whose `close()` removes the listener. Callers
 * MUST call `close()` when they're done; otherwise the listener
 * leaks until the process exits. The SSE route registers the close
 * on `req.on('close')` so a client disconnect cleans up.
 *
 * Tenant isolation is enforced HERE: each subscriber gets a
 * listener wired to ONLY their tenant id. A misconfigured caller
 * cannot listen to a different tenant's events through this API.
 */
export function subscribeVerifications(
  tenantId: string,
  handler: (payload: VerificationEventPayload) => void,
): VerificationSubscription {
  const wrapped = (payload: VerificationEventPayload): void => {
    // Defence in depth — the emitter key already isolates by tenant,
    // but a future refactor that broadcasts on a shared channel
    // should still see this guard catch a cross-tenant leak.
    if (payload.tenant_id !== tenantId) return;
    try {
      handler(payload);
    } catch {
      // Bad subscriber — drop on the floor, keep the rest of the
      // pipeline alive.
    }
  };
  emitter.on(tenantId, wrapped);
  return {
    close(): void {
      emitter.removeListener(tenantId, wrapped);
    },
  };
}

/**
 * Test-only: clear every listener. Used by the unit tests to keep
 * one test's subscribers from leaking into the next. Production
 * code never calls this.
 */
export function __resetVerificationEmitterForTests(): void {
  emitter.removeAllListeners();
}
