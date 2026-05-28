/**
 * Tenant live-verifications view — DPDP §2(t)-compliant live tail of
 * the verification audit stream.
 *
 * What this view does:
 *
 *   1. Opens an SSE subscription to `/api/console/verifications/stream`
 *      on mount via `openVerificationStream` (per ADR 0013, the
 *      EventSource carries the HttpOnly `zeroauth_console_jwt`
 *      cookie — no `?access_token=` query string).
 *   2. Buffers up to MAX_BUFFER events client-side (newest first).
 *      Older events fall off the tail; the view is intentionally a
 *      live tail, not a paginated history (the existing
 *      `/api/console/verifications` REST endpoint owns history).
 *   3. Renders a counter row (success / failure / total) plus a
 *      table of the buffered events with timestamp, DID,
 *      environment chip, result chip, latency badge.
 *   4. Closes the stream on unmount.
 *
 * The DPDP §2(t) no-PII contract:
 *
 *   - Forbidden source-level surfaces (asserted by the test file
 *     at `__tests__/verifications.test.tsx`):
 *       - No `.full_name` reads.
 *       - No `.email` reads.
 *       - No `.phone` reads.
 *   - Allowed surfaces on each row:
 *       - DID (truncated; opaque identifier).
 *       - Commitment is not rendered (this view shows verification
 *         outcomes, not enrolled identities — the users view at
 *         `routes/tenant/users.tsx` is the place for commitments).
 *       - Environment.
 *       - Result.
 *       - Latency.
 *       - Timestamp.
 *
 *   The DPDP §2(t) memo at `docs/compliance/dpdp-2t-memo.md`
 *   argues the data principal is not identifiable from a Poseidon-
 *   commitment-backed DID + outcome code + latency. This view's
 *   surface area is bounded by the `VerificationEvent` type at
 *   `dashboard/src/lib/verifications-api.ts` — see commit
 *   `6e06a14` for the same pattern on the users view.
 *
 * ADR 0017 (blockchain-agnostic posture) is the operating frame:
 * the view shows verification outcomes regardless of whether the
 * tenant has opted into an on-chain anchor provider. The
 * `proofHash` column (the auditor's cross-reference into the proof
 * archive) is anchor-provider-agnostic.
 *
 * Routing:
 *
 *   The route registration in App.tsx is a follow-up commit per
 *   the C-107 sprint pattern (see commit `6e06a14` for the
 *   precedent). This commit ships the component + its test in
 *   isolation; the structural no-PII contract is locked down
 *   before any wiring lands.
 */

import { useEffect, useRef, useState } from 'react';
import {
  openVerificationStream,
  type VerificationEvent,
} from '../../lib/verifications-api';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '../../components/ui';
import { EventStreamCounter } from '../../components/EventStreamCounter';
import { fmtDateTime, fmtMs, truncate } from '../../lib/format';

// ─── Tokens ─────────────────────────────────────────────────────
//
// Column allowlist defined as a const tuple. Adding a column
// requires adding it here first, which forces the reviewer through
// the comment block above before broadening the no-PII surface.

const ALLOWED_COLUMNS = [
  'Timestamp',
  'DID',
  'Environment',
  'Result',
  'Latency',
] as const;

/** How many rows the rolling buffer keeps before dropping the tail. */
const MAX_BUFFER = 100;

// ─── Counters ────────────────────────────────────────────────────

interface Counters {
  success: number;
  failure: number;
  total: number;
}

const ZERO_COUNTERS: Counters = { success: 0, failure: 0, total: 0 };

// ─── The view ───────────────────────────────────────────────────

export interface VerificationsViewProps {
  /**
   * Test-only override for the stream opener. Defaults to the live
   * `openVerificationStream`. Tests pass a synthetic opener that
   * captures the consumer's `onEvent` so they can drive events
   * without a real EventSource.
   */
  streamOpener?: typeof openVerificationStream;
}

export function VerificationsView({
  streamOpener = openVerificationStream,
}: VerificationsViewProps = {}) {
  const [events, setEvents] = useState<VerificationEvent[]>([]);
  const [counters, setCounters] = useState<Counters>(ZERO_COUNTERS);
  const [streamError, setStreamError] = useState<string | null>(null);

  // useRef shields the openSubscription against StrictMode double-
  // mount; the second mount tears down its own stream on cleanup
  // and the ref points at the surviving instance.
  const subscriptionRef = useRef<{ close: () => void } | null>(null);

  useEffect(() => {
    const subscription = streamOpener(
      (event) => {
        setEvents((prev) => [event, ...prev].slice(0, MAX_BUFFER));
        setCounters((prev) => ({
          success: prev.success + (event.result === 'success' ? 1 : 0),
          failure: prev.failure + (event.result === 'failure' ? 1 : 0),
          total: prev.total + 1,
        }));
      },
      {
        onError: (_code, message) => setStreamError(message),
      },
    );
    subscriptionRef.current = subscription;
    return () => {
      subscription.close();
      if (subscriptionRef.current === subscription) {
        subscriptionRef.current = null;
      }
    };
  }, [streamOpener]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Live verifications</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Real-time stream of verification outcomes for this tenant. Only the
          opaque DID, environment, result, and latency surface here — no
          personal data is rendered on this view (DPDP §2(t)).
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="verifications-counter-row">
        <EventStreamCounter
          label="Success"
          count={counters.success}
          tone="success"
          testId="verifications-counter-success"
        />
        <EventStreamCounter
          label="Failure"
          count={counters.failure}
          tone="danger"
          testId="verifications-counter-failure"
        />
        <EventStreamCounter
          label="Total (this session)"
          count={counters.total}
          tone="neutral"
          testId="verifications-counter-total"
        />
      </div>

      <Card>
        <CardHeader
          title="Recent events"
          description={`Showing up to ${MAX_BUFFER} most recent events. The history endpoint covers older rows.`}
          action={
            <span data-testid="verifications-live-chip">
              <Badge tone="brand">Live</Badge>
            </span>
          }
        />
        <CardBody className="p-0">
          {streamError ? (
            <div
              className="m-5 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-4 py-3 text-sm text-[var(--color-warn)]"
              role="alert"
              data-testid="verifications-stream-error"
            >
              {streamError}
            </div>
          ) : null}
          {events.length === 0 ? (
            <EmptyState
              title="Waiting for live verifications…"
              description="The stream is open. When the next verification lands, it will appear here."
              action={<WaitingSpinner />}
            />
          ) : (
            <VerificationsTable rows={events} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────

function VerificationsTable({ rows }: { rows: VerificationEvent[] }) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-sm"
        data-testid="verifications-table"
      >
        <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
          <tr>
            {ALLOWED_COLUMNS.map((col) => (
              <th key={col} className="px-5 py-2 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)]">
          {rows.map((row) => (
            <tr
              key={row.auditId}
              className="text-[var(--color-text-secondary)]"
              data-testid="verifications-row"
            >
              <td
                className="px-5 py-2 text-xs"
                data-testid="verifications-row-timestamp"
              >
                {fmtDateTime(row.createdAt)}
              </td>
              <td
                className="px-5 py-2 font-mono text-xs text-[var(--color-text)]"
                data-testid="verifications-row-did"
              >
                {truncate(row.did, 24)}
              </td>
              <td className="px-5 py-2" data-testid="verifications-row-environment">
                <Badge tone={row.environment === 'live' ? 'success' : 'neutral'}>
                  {row.environment}
                </Badge>
              </td>
              <td className="px-5 py-2" data-testid="verifications-row-result">
                <Badge tone={row.result === 'success' ? 'success' : 'danger'}>
                  {row.result}
                </Badge>
              </td>
              <td className="px-5 py-2" data-testid="verifications-row-latency">
                <LatencyBadge latencyMs={row.latencyMs} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Latency badge ──────────────────────────────────────────────

function LatencyBadge({ latencyMs }: { latencyMs: number | null }) {
  if (latencyMs === null) {
    return <span className="text-xs text-[var(--color-text-dim)]">—</span>;
  }
  // Thresholds picked to match the proof-pairing demo expectations:
  // sub-2 s is green, 2-5 s amber, >5 s red. The Anchor Bank demo
  // runbook targets <2 s for the proof-pairing scene.
  const tone: 'success' | 'warn' | 'danger' =
    latencyMs < 2000 ? 'success' : latencyMs < 5000 ? 'warn' : 'danger';
  return <Badge tone={tone}>{fmtMs(latencyMs)}</Badge>;
}

// ─── Empty-state spinner ────────────────────────────────────────

function WaitingSpinner() {
  return (
    <div
      className="size-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-r-transparent"
      data-testid="verifications-waiting-spinner"
      aria-hidden="true"
    />
  );
}

export default VerificationsView;
