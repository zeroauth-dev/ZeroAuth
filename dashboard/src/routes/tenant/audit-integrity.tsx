/**
 * Audit-integrity view skeleton — precursor to C-123 (sprint 2 in
 * `docs/plan/bfsi-v1/04-commits.md`).
 *
 * What this view does:
 *
 *   1. Calls `checkAuditIntegrity(tenantId, environment?)` via TanStack
 *      Query.
 *   2. Renders an `IntegrityCheckCard` with the result (or a pending
 *      placeholder while the first fetch is in flight).
 *   3. Exposes a "Check now" button that triggers `refetch()`.
 *   4. Reserves a region below the card for the audit-anchors sub-view
 *      (C-124 — a separate ticket). The placeholder is a labelled empty
 *      panel so the visual layout is locked down before C-124 lands.
 *
 * Wiring contract:
 *
 *   - This file is NOT registered in `App.tsx` yet. C-123 lands the
 *     route under `/tenant/:tenantId/audit-integrity` and also extends
 *     the admin-side nav. The skeleton stays unrouted so the design and
 *     the test pin the structural contract before the routing decision.
 *
 *   - The `tenantId` and `environment` are accepted as props for ease
 *     of testing. When C-123 wires the router, it will read them from
 *     a route-param + a session-store value respectively. Defaults make
 *     the component renderable in isolation (storybook + tests).
 *
 * Demo Scene 5 reference: `docs/plan/bfsi-v1/02-bank-demo.md` — the
 * operator switches to this view and clicks "Re-run check" to demonstrate
 * tamper-evidence to the CRO + RBI auditor.
 *
 * Forbidden surfaces (defence in depth, asserted by the test):
 *
 *   - No `.full_name` reads.
 *   - No `.email` reads.
 *   - No `.phone` reads.
 *
 *   Even though the audit-integrity surface carries metadata only (no
 *   user rows), the test scans this file for the same PII-property reads
 *   that `routes/tenant/users.tsx` blacklists — so a future refactor that
 *   accidentally reaches across surfaces is caught at the boundary.
 */

import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardBody, CardHeader, EmptyState } from '../../components/ui';
import {
  IntegrityCheckCard,
  type IntegrityResult,
} from '../../components/IntegrityCheckCard';
import { checkAuditIntegrity } from '../../lib/audit-integrity-api';

export interface AuditIntegrityViewProps {
  /** Tenant whose chain to verify. C-123 will source this from route params. */
  tenantId?: string;
  /** Optional environment filter. Omit to verify both 'live' + 'test'. */
  environment?: 'live' | 'test';
}

// Sensible default for the storybook + skeleton-test surface. The Anchor
// Bank tenant id is the fixture across the bank-demo runbook.
const DEFAULT_TENANT_ID = 'tnt_anchor_bank_demo';

export function AuditIntegrityView({
  tenantId = DEFAULT_TENANT_ID,
  environment,
}: AuditIntegrityViewProps = {}) {
  const query = useQuery({
    queryKey: ['audit-integrity', { tenantId, environment }],
    queryFn: () => checkAuditIntegrity(tenantId, environment),
  });

  const result: IntegrityResult = query.data ?? { status: 'pending' };
  const isBusy = query.isFetching || query.isLoading;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit integrity</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Replay the audit hash chain for this tenant and compare each row's
            stored hash to a freshly recomputed value. Defined by ADR 0013;
            anchored on Base L2 per ADR 0014.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="md"
          loading={isBusy}
          disabled={isBusy}
          onClick={() => {
            void query.refetch();
          }}
          data-testid="audit-integrity-check-now"
        >
          Check now
        </Button>
      </header>

      {query.isError ? (
        <div
          className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]"
          role="alert"
          data-testid="audit-integrity-error"
        >
          Could not run integrity check. Try again in a moment.
        </div>
      ) : null}

      <IntegrityCheckCard result={result} />

      <AnchorsPlaceholder />
    </div>
  );
}

/**
 * Placeholder for the audit-anchors sub-view that lands in C-124.
 *
 * Renders a labelled empty panel so the visual layout is locked down.
 * The C-124 PR replaces the EmptyState body with a `<AnchorsTable />`
 * fed by `audit-anchors-api.ts` (TBD in C-124's scope).
 */
function AnchorsPlaceholder() {
  return (
    <Card data-testid="audit-anchors-placeholder">
      <CardHeader
        title="On-chain anchors"
        description="Daily terminal-hash anchors recorded on Base Sepolia."
      />
      <CardBody className="p-0">
        <EmptyState
          title="Anchor history loading next sprint."
          description="Implemented in C-124 — daily anchors with Basescan cross-references."
        />
      </CardBody>
    </Card>
  );
}

export default AuditIntegrityView;
