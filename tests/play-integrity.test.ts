import { describe, it, expect } from '@jest/globals';
import { evaluateVerdict, requiredRank } from '../src/services/play-integrity';
import { verdictRank } from '../src/types';

describe('verdictRank', () => {
  it('orders verdicts strongest to weakest', () => {
    expect(verdictRank('MEETS_STRONG_INTEGRITY')).toBe(4);
    expect(verdictRank('MEETS_DEVICE_INTEGRITY')).toBe(3);
    expect(verdictRank('MEETS_BASIC_INTEGRITY')).toBe(2);
    expect(verdictRank('INTEGRITY_NOT_EVALUATED')).toBe(1);
    expect(verdictRank('UNKNOWN')).toBe(0);
    expect(verdictRank(undefined)).toBe(0);
    expect(verdictRank(null)).toBe(0);
    expect(verdictRank('garbage_value')).toBe(0);
  });
});

describe('requiredRank', () => {
  it('returns 0 for a permissive policy', () => {
    expect(requiredRank(undefined)).toBe(0);
    expect(requiredRank(null)).toBe(0);
    expect(requiredRank({})).toBe(0);
  });

  it('returns the highest set requirement (strong > device > basic)', () => {
    expect(requiredRank({ require_basic_integrity: true })).toBe(2);
    expect(requiredRank({ require_device_integrity: true })).toBe(3);
    expect(requiredRank({ require_strong_integrity: true })).toBe(4);
    // strong wins when multiple flags are set
    expect(requiredRank({
      require_strong_integrity: true,
      require_device_integrity: true,
      require_basic_integrity: true,
    })).toBe(4);
  });
});

describe('evaluateVerdict', () => {
  it('permissive policy accepts every verdict, including absent', () => {
    expect(evaluateVerdict('MEETS_STRONG_INTEGRITY', {})).toEqual({ ok: true });
    expect(evaluateVerdict('MEETS_BASIC_INTEGRITY', {})).toEqual({ ok: true });
    expect(evaluateVerdict(undefined, {})).toEqual({ ok: true });
    expect(evaluateVerdict('', null)).toEqual({ ok: true });
    expect(evaluateVerdict('garbage', undefined)).toEqual({ ok: true });
  });

  it('require_strong + MEETS_STRONG → ok', () => {
    expect(evaluateVerdict('MEETS_STRONG_INTEGRITY', {
      require_strong_integrity: true,
    })).toEqual({ ok: true });
  });

  it('require_strong + MEETS_DEVICE → 401 insufficient', () => {
    const result = evaluateVerdict('MEETS_DEVICE_INTEGRITY', {
      require_strong_integrity: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('play_integrity_insufficient');
    }
  });

  it('require_strong + absent → 400 required (default)', () => {
    const result = evaluateVerdict(undefined, {
      require_strong_integrity: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('play_integrity_required');
    }
  });

  it('require_strong + absent + allow_absent → ok', () => {
    expect(evaluateVerdict(undefined, {
      require_strong_integrity: true,
      allow_play_integrity_absent: true,
    })).toEqual({ ok: true });
  });

  it('require_basic + UNKNOWN → 401 insufficient', () => {
    const result = evaluateVerdict('UNKNOWN', { require_basic_integrity: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('play_integrity_insufficient');
    }
  });

  it('require_basic + INTEGRITY_NOT_EVALUATED → 401 (rank 1 < 2)', () => {
    const result = evaluateVerdict('INTEGRITY_NOT_EVALUATED', {
      require_basic_integrity: true,
    });
    expect(result.ok).toBe(false);
  });

  it('require_basic + MEETS_BASIC → ok (rank 2 == 2)', () => {
    expect(evaluateVerdict('MEETS_BASIC_INTEGRITY', {
      require_basic_integrity: true,
    })).toEqual({ ok: true });
  });

  it('whitespace-only verdict treated as absent', () => {
    const result = evaluateVerdict('   ', { require_strong_integrity: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('play_integrity_required');
    }
  });
});
