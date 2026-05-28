/**
 * AuditIntegrityView — skeleton tests (precursor to C-123).
 *
 * Five assertion blocks:
 *
 *   1. Pending — the initial mount shows the pending card before the
 *      mocked API resolves.
 *   2. PASS — `checkAuditIntegrity` resolves to `{ status: 'pass', ... }`,
 *      the view renders the PASS card with the row count.
 *   3. FAIL — `checkAuditIntegrity` resolves to `{ status: 'fail', ... }`,
 *      the view renders the FAIL card with `brokenAt` and the verbatim
 *      reason.
 *   4. Refetch — clicking "Check now" calls the API client a second time.
 *   5. Source-file PII-property-read scan — the component source must
 *      not contain `.full_name`, `.email`, or `.phone`. Even though the
 *      audit-integrity surface is metadata-only, this is the same
 *      defence-in-depth shape used by `users.test.tsx`, so a future
 *      refactor that bridges surfaces is caught at the file boundary.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuditIntegrityView } from '../audit-integrity';
import type { IntegrityResult } from '../../../components/IntegrityCheckCard';

// ─── Mock the client module so the component sees fixture data ───

vi.mock('../../../lib/audit-integrity-api', () => ({
  checkAuditIntegrity: vi.fn(),
}));

import { checkAuditIntegrity } from '../../../lib/audit-integrity-api';

// ─── Fixtures ────────────────────────────────────────────────────

const PASS_RESULT: IntegrityResult = {
  status: 'pass',
  tenantId: 'tnt_anchor_bank_demo',
  environment: 'live',
  rowsChecked: 23456,
  lastChecked: '2026-05-28T07:00:00.000Z',
};

const FAIL_REASON =
  'Hash mismatch at row 12345. Stored current_hash was 0x4f8b...c233. Recomputed current_hash from event_data + previous_hash is 0x9e21...0f7a.';

const FAIL_RESULT: IntegrityResult = {
  status: 'fail',
  tenantId: 'tnt_anchor_bank_demo',
  environment: 'live',
  brokenAt: '12345',
  reason: FAIL_REASON,
  lastChecked: '2026-05-28T07:01:00.000Z',
};

// ─── Render helper ───────────────────────────────────────────────

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuditIntegrityView />
    </QueryClientProvider>,
  );
}

describe('<AuditIntegrityView />', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Assertion 1 — initial pending state ───────────────────────

  it('renders the pending state on initial mount', () => {
    // Resolve to a never-completing promise so the first render is pending.
    vi.mocked(checkAuditIntegrity).mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByTestId('integrity-pending')).toBeInTheDocument();
    expect(screen.getByText(/running integrity check/i)).toBeInTheDocument();
  });

  // ── Assertion 2 — PASS state ──────────────────────────────────

  it('renders the PASS state when the API returns status="pass"', async () => {
    vi.mocked(checkAuditIntegrity).mockResolvedValue(PASS_RESULT);

    renderView();

    expect(await screen.findByTestId('integrity-pass')).toBeInTheDocument();
    expect(screen.getByText(/chain intact/i)).toBeInTheDocument();
    expect(screen.getByTestId('integrity-rows-checked').textContent ?? '').toMatch(/23[,.]?456/);
    expect(checkAuditIntegrity).toHaveBeenCalledTimes(1);
  });

  // ── Assertion 3 — FAIL state ──────────────────────────────────

  it('renders the FAIL state with brokenAt + verbatim reason visible', async () => {
    vi.mocked(checkAuditIntegrity).mockResolvedValue(FAIL_RESULT);

    renderView();

    expect(await screen.findByTestId('integrity-fail')).toBeInTheDocument();
    // Row id visible.
    expect(screen.getByTestId('integrity-broken-at').textContent).toBe('12345');
    // Reason rendered verbatim (Scene 5 of the bank demo needs the
    // operator to read the literal hash strings off the panel).
    expect(screen.getByTestId('integrity-reason').textContent).toBe(FAIL_REASON);
  });

  // ── Assertion 4 — Check now triggers refetch ─────────────────

  it('clicking "Check now" triggers a refetch (mock invoked again)', async () => {
    vi.mocked(checkAuditIntegrity).mockResolvedValue(PASS_RESULT);

    renderView();

    // Wait for the initial fetch to land.
    await screen.findByTestId('integrity-pass');
    expect(checkAuditIntegrity).toHaveBeenCalledTimes(1);

    const button = screen.getByTestId('audit-integrity-check-now');
    await userEvent.click(button);

    // React Query may re-invoke synchronously or after a microtask; wait
    // for the second call to land.
    await waitFor(() => {
      expect(checkAuditIntegrity).toHaveBeenCalledTimes(2);
    });
  });

  // ── Assertion 5 — Source-file PII scan ───────────────────────

  it('audit-integrity.tsx contains zero PII property reads (defence in depth)', () => {
    const componentPath = path.resolve(__dirname, '../audit-integrity.tsx');
    const src = fs.readFileSync(componentPath, 'utf8');

    // Strip the header docstring before the scan — the header may name
    // the forbidden fields as the "must not appear" allowlist guidance,
    // which is exactly the kind of self-documenting comment we want to
    // preserve. Everything from the first top-level `import` line is
    // real code.
    const firstImport = src.indexOf('\nimport ');
    const codeOnly = firstImport > 0 ? src.slice(firstImport) : src;

    const FORBIDDEN_PII_READS = ['.full_name', '.email', '.phone'] as const;
    for (const forbidden of FORBIDDEN_PII_READS) {
      expect(
        codeOnly,
        `audit-integrity.tsx code body must not contain the substring "${forbidden}".`,
      ).not.toContain(forbidden);
    }
  });
});
