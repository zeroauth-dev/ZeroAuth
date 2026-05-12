import { describe, it, expect } from 'vitest';
import { fmtCompact, fmtMs, fmtNumber, fmtRelativeTime, truncate } from './format';

describe('format helpers', () => {
  it('fmtNumber formats with thousand separators', () => {
    expect(fmtNumber(1234567)).toBe('1,234,567');
  });

  it('fmtCompact uses k/M notation', () => {
    expect(fmtCompact(2500)).toBe('2.5K');
    expect(fmtCompact(1_300_000)).toBe('1.3M');
  });

  it('fmtMs renders ms vs s', () => {
    expect(fmtMs(450)).toBe('450 ms');
    expect(fmtMs(1500)).toBe('1.50 s');
    expect(fmtMs(null)).toBe('—');
  });

  it('fmtRelativeTime handles past + future + bad input', () => {
    const now = new Date('2026-05-12T12:00:00Z');
    expect(fmtRelativeTime(null, now)).toBe('—');
    expect(fmtRelativeTime('not-a-date', now)).toBe('—');
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    // Locale strings can vary slightly across runtimes — just check the
    // direction + magnitude.
    expect(fmtRelativeTime(tenMinAgo.toISOString(), now)).toMatch(/(10 minutes ago|minutes ago)/);
  });

  it('truncate keeps short strings and ellipsises long ones', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghijklm', 5)).toBe('abcde…');
    expect(truncate(null)).toBe('—');
  });
});
