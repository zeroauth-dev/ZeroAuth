/**
 * IntegrityCheckCard — presentational tests, one per terminal state.
 *
 * Three assertion blocks:
 *
 *   1. PENDING — spinner + "Running integrity check…" copy.
 *   2. PASS    — green check, row count, last-checked timestamp, tenant id.
 *   3. FAIL    — red X, brokenAt row id, verbatim server reason, Investigate
 *                button. The verbatim-reason assertion is the load-bearing
 *                one for the bank demo: Scene 5's narrative depends on the
 *                operator reading the actual hash-mismatch reason off the
 *                screen.
 *
 * The card does NOT render PII under any state. The view-level test
 * (`routes/tenant/__tests__/audit-integrity.test.tsx`) covers the
 * defence-in-depth PII-property-read scan on the source file.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  IntegrityCheckCard,
  type IntegrityResult,
} from '../IntegrityCheckCard';

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

describe('<IntegrityCheckCard />', () => {
  it('renders the PENDING state with a spinner and progress copy', () => {
    render(<IntegrityCheckCard result={{ status: 'pending' }} />);

    expect(screen.getByTestId('integrity-pending')).toBeInTheDocument();
    expect(screen.getByTestId('integrity-spinner')).toBeInTheDocument();
    expect(screen.getByText(/running integrity check/i)).toBeInTheDocument();
    expect(screen.queryByTestId('integrity-pass')).not.toBeInTheDocument();
    expect(screen.queryByTestId('integrity-fail')).not.toBeInTheDocument();
  });

  it('renders the PASS state with chain-intact headline, row count, and timestamp', () => {
    render(<IntegrityCheckCard result={PASS_RESULT} />);

    expect(screen.getByTestId('integrity-pass')).toBeInTheDocument();
    expect(screen.getByText(/chain intact/i)).toBeInTheDocument();
    // 23,456 rendered via toLocaleString — accept either form.
    expect(screen.getByTestId('integrity-rows-checked').textContent ?? '').toMatch(/23[,.]?456/);
    // Tenant id surfaces somewhere on the card.
    expect(screen.getByText(/tnt_anchor_bank_demo/)).toBeInTheDocument();
    // Timestamp is formatted; we just assert the testid is present + populated.
    expect(screen.getByTestId('integrity-last-checked').textContent ?? '').not.toEqual('');
    // PASS badge appears.
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('renders the FAIL state with brokenAt, the verbatim reason, and an Investigate button', async () => {
    const onInvestigate = vi.fn();
    render(<IntegrityCheckCard result={FAIL_RESULT} onInvestigate={onInvestigate} />);

    expect(screen.getByTestId('integrity-fail')).toBeInTheDocument();
    // "Chain broken at row #12345"
    expect(screen.getByText(/chain broken at row/i)).toBeInTheDocument();
    expect(screen.getByTestId('integrity-broken-at').textContent).toBe('12345');
    // The reason is rendered verbatim — Scene 5's narrative needs the literal hash strings to appear.
    expect(screen.getByTestId('integrity-reason').textContent).toBe(FAIL_REASON);
    // Investigate button is present and wired.
    const button = screen.getByTestId('integrity-investigate');
    expect(button).toBeInTheDocument();
    await userEvent.click(button);
    expect(onInvestigate).toHaveBeenCalledTimes(1);
    // FAIL badge appears.
    expect(screen.getByText('FAIL')).toBeInTheDocument();
  });
});
