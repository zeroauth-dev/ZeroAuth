/**
 * IntegrityCheckCard — presentational component for the audit-integrity view.
 *
 * Precursor to C-123 (sprint 2 in `docs/plan/bfsi-v1/04-commits.md`). The
 * card has three terminal states, one for each value of `IntegrityResult.status`:
 *
 *   - 'pass'    — green check, "Chain intact", rows-checked count, last-checked.
 *   - 'fail'    — red X, "Chain broken at row #<brokenAt>", verbatim reason,
 *                 "Investigate" no-op button.
 *   - 'pending' — spinner, used during the initial fetch and on refetch.
 *
 * Anchor data is optional. When present, an "Anchor: tx <hash>" sub-row renders
 * a clickable Basescan link. When absent (the default for the skeleton), the
 * sub-row is hidden entirely so the card stays compact. The anchor proves the
 * chain's terminal hash is independently verifiable per ADR 0014 — the bank's
 * auditor follows the link, queries the contract, and compares the on-chain
 * `terminalHash` to the verifier's recomputed value.
 *
 * This file ships ZERO PII reads. The card's contract is purely audit metadata
 * (status, brokenAt row id, reason string, row count, timestamp, tx hash). The
 * "no PII" defence is asserted by `__tests__/IntegrityCheckCard.test.tsx` and
 * by the source-file scan in `routes/tenant/__tests__/audit-integrity.test.tsx`.
 *
 * Tied to demo Scene 5 in `docs/plan/bfsi-v1/02-bank-demo.md` — the operator
 * flips between PASS and FAIL on stage by tampering with one row in psql.
 */

import type { ReactNode } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton } from './ui';
import { fmtDateTime } from '../lib/format';

// ─── Public type ─────────────────────────────────────────────────
//
// `IntegrityResult` is the only shape `IntegrityCheckCard` ever consumes.
// Narrow discriminated union: the `status` literal picks the branch.
// Adding a new variant is an ADR-grade decision — the bank demo's narrative
// rests on exactly three observable states (pass / fail / pending).

export type IntegrityResult =
  | {
      status: 'pass';
      tenantId: string;
      environment: string | null;
      rowsChecked: number;
      lastChecked: string;
    }
  | {
      status: 'fail';
      tenantId: string;
      environment: string | null;
      brokenAt: string;
      reason: string;
      lastChecked: string;
    }
  | { status: 'pending' };

/**
 * Optional on-chain anchor metadata. Hidden when undefined.
 *
 * `txHash` is rendered as a monospaced truncated string with a clickable
 * link to `https://sepolia.basescan.org/tx/<hash>`. The link target is a
 * fixed external host — there is no string interpolation that could lead
 * to an open redirect.
 */
export interface AnchorInfo {
  txHash: string;
  /** Optional anchored-at ISO timestamp, rendered next to the link if set. */
  anchoredAt?: string;
}

export interface IntegrityCheckCardProps {
  result: IntegrityResult;
  anchor?: AnchorInfo;
  /** Optional click handler for the "Investigate" button on the FAIL state. */
  onInvestigate?: () => void;
}

// ─── Tokens ─────────────────────────────────────────────────────

const BASESCAN_TX_BASE = 'https://sepolia.basescan.org/tx/';

function truncateTxHash(hash: string): string {
  if (!hash) return '—';
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

// ─── Component ───────────────────────────────────────────────────

export function IntegrityCheckCard({ result, anchor, onInvestigate }: IntegrityCheckCardProps) {
  return (
    <Card data-testid="integrity-check-card">
      <CardHeader title="Audit chain integrity" />
      <CardBody>
        {result.status === 'pending' ? (
          <PendingState />
        ) : result.status === 'pass' ? (
          <PassState result={result} />
        ) : (
          <FailState result={result} onInvestigate={onInvestigate} />
        )}
        {anchor ? <AnchorRow anchor={anchor} /> : null}
      </CardBody>
    </Card>
  );
}

// ─── Pending ────────────────────────────────────────────────────

function PendingState() {
  return (
    <div className="space-y-3" data-testid="integrity-pending">
      <div className="flex items-center gap-3">
        <Spinner />
        <div className="text-sm text-[var(--color-text-secondary)]">
          Running integrity check…
        </div>
      </div>
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      data-testid="integrity-spinner"
      className="inline-block size-4 animate-spin rounded-full border-2 border-[var(--color-text-dim)] border-r-transparent"
    />
  );
}

// ─── Pass ───────────────────────────────────────────────────────

function PassState({
  result,
}: {
  result: Extract<IntegrityResult, { status: 'pass' }>;
}) {
  return (
    <div className="space-y-3" data-testid="integrity-pass">
      <div className="flex items-center gap-3">
        <CheckIcon />
        <div>
          <div className="text-base font-semibold text-[var(--color-success)]">
            Chain intact
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            Hash chain verified end-to-end.
          </div>
        </div>
        <Badge tone="success" className="ml-auto">
          PASS
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <MetaCell label="Rows checked">
          <span data-testid="integrity-rows-checked">{result.rowsChecked.toLocaleString()}</span>
        </MetaCell>
        <MetaCell label="Last checked">
          <span data-testid="integrity-last-checked">{fmtDateTime(result.lastChecked)}</span>
        </MetaCell>
        <MetaCell label="Tenant">
          <span className="font-mono">{result.tenantId}</span>
        </MetaCell>
        <MetaCell label="Environment">
          <Badge tone={result.environment === 'live' ? 'success' : 'neutral'}>
            {result.environment ?? 'both'}
          </Badge>
        </MetaCell>
      </dl>
    </div>
  );
}

// ─── Fail ───────────────────────────────────────────────────────

function FailState({
  result,
  onInvestigate,
}: {
  result: Extract<IntegrityResult, { status: 'fail' }>;
  onInvestigate?: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="integrity-fail">
      <div className="flex items-center gap-3">
        <XIcon />
        <div>
          <div className="text-base font-semibold text-[var(--color-danger)]">
            Chain broken at row #
            <span data-testid="integrity-broken-at">{result.brokenAt}</span>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            Recomputed hash diverged from stored value.
          </div>
        </div>
        <Badge tone="danger" className="ml-auto">
          FAIL
        </Badge>
      </div>

      <div
        className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
        data-testid="integrity-reason"
        role="alert"
      >
        {result.reason}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <MetaCell label="Last checked">
          <span data-testid="integrity-last-checked">{fmtDateTime(result.lastChecked)}</span>
        </MetaCell>
        <MetaCell label="Tenant">
          <span className="font-mono">{result.tenantId}</span>
        </MetaCell>
      </dl>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onInvestigate}
          data-testid="integrity-investigate"
        >
          Investigate
        </Button>
      </div>
    </div>
  );
}

// ─── Anchor sub-row ─────────────────────────────────────────────

function AnchorRow({ anchor }: { anchor: AnchorInfo }) {
  const href = `${BASESCAN_TX_BASE}${encodeURIComponent(anchor.txHash)}`;
  return (
    <div
      className="mt-4 border-t border-[var(--color-border-subtle)] pt-3 text-xs text-[var(--color-text-secondary)]"
      data-testid="integrity-anchor"
    >
      <span className="text-[var(--color-text-dim)]">Anchor:</span>{' '}
      <span>tx </span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[var(--color-brand)] underline-offset-2 hover:underline"
        data-testid="integrity-anchor-link"
      >
        {truncateTxHash(anchor.txHash)}
      </a>
      {anchor.anchoredAt ? (
        <span className="ml-2 text-[var(--color-text-dim)]">
          anchored {fmtDateTime(anchor.anchoredAt)}
        </span>
      ) : null}
    </div>
  );
}

// ─── Atoms ──────────────────────────────────────────────────────

function MetaCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--color-text-dim)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--color-text)]">{children}</dd>
    </div>
  );
}

function CheckIcon() {
  return (
    <span
      aria-hidden="true"
      data-testid="integrity-check-icon"
      className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 10.5l3.5 3.5L15 7" />
      </svg>
    </span>
  );
}

function XIcon() {
  return (
    <span
      aria-hidden="true"
      data-testid="integrity-x-icon"
      className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)]"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 6l8 8M14 6l-8 8" />
      </svg>
    </span>
  );
}

export default IntegrityCheckCard;
