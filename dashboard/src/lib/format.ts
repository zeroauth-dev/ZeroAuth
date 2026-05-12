/**
 * Tiny formatting helpers used across the dashboard.
 */

export function fmtNumber(n: number | bigint, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function fmtCompact(n: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtRelativeTime(when: string | Date | null, now: Date = new Date()): string {
  if (!when) return '—';
  const date = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(date.getTime())) return '—';
  const deltaSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(deltaSec);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];
  let value = deltaSec;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let scope = abs;
  for (const [u, threshold] of units) {
    unit = u;
    if (scope < threshold) break;
    value = Math.round(value / threshold);
    scope = Math.abs(value);
  }
  return new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' }).format(value, unit);
}

export function fmtDateTime(when: string | Date | null): string {
  if (!when) return '—';
  const date = typeof when === 'string' ? new Date(when) : when;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function truncate(value: string | null | undefined, n = 12): string {
  if (!value) return '—';
  if (value.length <= n) return value;
  return value.slice(0, n) + '…';
}
