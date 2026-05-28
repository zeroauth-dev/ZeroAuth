/**
 * EventStreamCounter — small numeric + label tile.
 *
 * Used in the live verifications view to surface the per-session
 * counters (success / failure / total). Three counters in a row,
 * each rendered through this primitive, so the visual rhythm stays
 * consistent and the test can find them by stable test ids.
 *
 * The tile is dumb on purpose: no state, no formatting beyond the
 * Intl.NumberFormat call. The view owns the state and passes the
 * count down. That makes the component reusable for the audit-
 * integrity counter row that lands in C-123 sprint 2.
 *
 * No PII surfaces here — the only inputs are numbers + a static
 * label string. The component does not receive a user row, an
 * audit row, or a session row, so the no-PII contract is
 * structurally trivial.
 */

import { fmtNumber } from '../lib/format';
import { cn } from '../lib/cn';

type CounterTone = 'neutral' | 'success' | 'danger';

const toneClasses: Record<CounterTone, { text: string; border: string }> = {
  neutral: {
    text: 'text-[var(--color-text)]',
    border: 'border-[var(--color-border)]',
  },
  success: {
    text: 'text-[var(--color-success)]',
    border: 'border-[var(--color-success)]/30',
  },
  danger: {
    text: 'text-[var(--color-danger)]',
    border: 'border-[var(--color-danger)]/30',
  },
};

export interface EventStreamCounterProps {
  label: string;
  count: number;
  tone?: CounterTone;
  /** Stable test hook for the live-verifications test suite. */
  testId?: string;
  className?: string;
}

export function EventStreamCounter({
  label,
  count,
  tone = 'neutral',
  testId,
  className,
}: EventStreamCounterProps) {
  const tones = toneClasses[tone];
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-col gap-1 rounded-lg border bg-[var(--color-bg-raised)] px-5 py-4 shadow-sm',
        tones.border,
        className,
      )}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-dim)]">
        {label}
      </span>
      <span
        data-testid={testId ? `${testId}-value` : undefined}
        className={cn('text-3xl font-semibold tabular-nums', tones.text)}
      >
        {fmtNumber(count)}
      </span>
    </div>
  );
}

export default EventStreamCounter;
