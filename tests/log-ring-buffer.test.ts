/**
 * Unit tests for `src/services/log-ring-buffer.ts`.
 *
 * The ring buffer is the in-process tail-source for the admin "live API
 * logs" SSE panel (Anchor Bank demo Scene 5, see
 * docs/plan/bfsi-v1/02-bank-demo.md). The contract these tests pin
 * down:
 *
 *   1. push/tail behave as a FIFO — oldest entry first, newest last.
 *   2. at capacity, push silently drops the OLDEST entry, never the
 *      newest. (Operators tailing logs want recent activity, not stale
 *      activity, when the process is hot.)
 *   3. subscribers attached via `subscribe()` receive every subsequent
 *      `push()` as a live event.
 *   4. the disposer returned from `subscribe()` stops further deliveries
 *      to that listener (so SSE-route disconnect doesn't leak listeners
 *      forever).
 *
 * The redaction path (banned biometric meta keys → "[redacted]") is
 * covered incidentally where it makes the FIFO assertions cleaner; the
 * dedicated redaction suite lives elsewhere.
 */

import { LogRingBuffer, type LogEntry } from '../src/services/log-ring-buffer';

const entry = (overrides: Partial<LogEntry> = {}): LogEntry => ({
  ts: '2026-06-01T00:00:00.000Z',
  level: 'info',
  message: 'hello',
  meta: {},
  ...overrides,
});

describe('LogRingBuffer — construction', () => {
  it('rejects non-positive capacity', () => {
    expect(() => new LogRingBuffer(0)).toThrow(/positive integer/);
    expect(() => new LogRingBuffer(-1)).toThrow(/positive integer/);
  });

  it('rejects non-integer capacity', () => {
    expect(() => new LogRingBuffer(1.5)).toThrow(/positive integer/);
  });

  it('reports its capacity and starts empty', () => {
    const ring = new LogRingBuffer(8);
    expect(ring.getCapacity()).toBe(8);
    expect(ring.size()).toBe(0);
    expect(ring.tail()).toEqual([]);
  });
});

describe('LogRingBuffer — FIFO push/tail', () => {
  it('returns entries in insertion order (oldest first)', () => {
    const ring = new LogRingBuffer(4);
    ring.push(entry({ message: 'a' }));
    ring.push(entry({ message: 'b' }));
    ring.push(entry({ message: 'c' }));

    expect(ring.size()).toBe(3);
    expect(ring.tail().map(e => e.message)).toEqual(['a', 'b', 'c']);
  });

  it('tail(n) returns the LAST n entries when n < count', () => {
    const ring = new LogRingBuffer(10);
    for (let i = 0; i < 5; i += 1) ring.push(entry({ message: `m${i}` }));

    expect(ring.tail(2).map(e => e.message)).toEqual(['m3', 'm4']);
    expect(ring.tail(3).map(e => e.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('tail(n) is clamped to the number of stored entries', () => {
    const ring = new LogRingBuffer(10);
    ring.push(entry({ message: 'only' }));
    expect(ring.tail(50).map(e => e.message)).toEqual(['only']);
  });

  it('tail(0) and tail on an empty buffer both return an empty array', () => {
    const ring = new LogRingBuffer(4);
    expect(ring.tail(0)).toEqual([]);
    expect(ring.tail()).toEqual([]);
    ring.push(entry({ message: 'x' }));
    expect(ring.tail(0)).toEqual([]);
  });

  it('clear() resets size and tail back to empty', () => {
    const ring = new LogRingBuffer(4);
    ring.push(entry({ message: 'a' }));
    ring.push(entry({ message: 'b' }));
    ring.clear();
    expect(ring.size()).toBe(0);
    expect(ring.tail()).toEqual([]);
  });
});

describe('LogRingBuffer — capacity overflow drops oldest', () => {
  it('drops the oldest entry once capacity is exceeded', () => {
    const ring = new LogRingBuffer(3);
    ring.push(entry({ message: 'a' }));
    ring.push(entry({ message: 'b' }));
    ring.push(entry({ message: 'c' }));
    ring.push(entry({ message: 'd' })); // evicts 'a'

    expect(ring.size()).toBe(3);
    expect(ring.tail().map(e => e.message)).toEqual(['b', 'c', 'd']);
  });

  it('continues dropping oldest across many wraparounds', () => {
    const ring = new LogRingBuffer(3);
    for (let i = 0; i < 10; i += 1) ring.push(entry({ message: `m${i}` }));

    // After 10 pushes into a 3-slot ring we keep only the last 3.
    expect(ring.size()).toBe(3);
    expect(ring.tail().map(e => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('size never exceeds capacity', () => {
    const ring = new LogRingBuffer(2);
    for (let i = 0; i < 100; i += 1) {
      ring.push(entry({ message: `m${i}` }));
      expect(ring.size()).toBeLessThanOrEqual(2);
    }
    expect(ring.size()).toBe(2);
  });
});

describe('LogRingBuffer — subscribers', () => {
  it('delivers every subsequent push to the subscriber', () => {
    const ring = new LogRingBuffer(8);
    const received: string[] = [];
    ring.subscribe(e => received.push(e.message));

    ring.push(entry({ message: 'a' }));
    ring.push(entry({ message: 'b' }));
    ring.push(entry({ message: 'c' }));

    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('does NOT replay entries pushed before subscription', () => {
    const ring = new LogRingBuffer(8);
    ring.push(entry({ message: 'before' }));

    const received: string[] = [];
    ring.subscribe(e => received.push(e.message));
    ring.push(entry({ message: 'after' }));

    expect(received).toEqual(['after']);
  });

  it('fans out a single push to multiple subscribers', () => {
    const ring = new LogRingBuffer(8);
    const a: string[] = [];
    const b: string[] = [];
    ring.subscribe(e => a.push(e.message));
    ring.subscribe(e => b.push(e.message));

    ring.push(entry({ message: 'x' }));

    expect(a).toEqual(['x']);
    expect(b).toEqual(['x']);
  });

  it('delivers the redacted (buffered) shape, not the caller object', () => {
    const ring = new LogRingBuffer(8);
    let delivered: LogEntry | undefined;
    ring.subscribe(e => { delivered = e; });

    ring.push(entry({
      message: 'face capture',
      meta: { traceId: 'abc', imageBytes: 'AAAA==' },
    }));

    expect(delivered).toBeDefined();
    expect(delivered!.meta.traceId).toBe('abc');
    expect(delivered!.meta.imageBytes).toBe('[redacted]');
  });

  it('one subscriber throwing does not block other subscribers', () => {
    const ring = new LogRingBuffer(8);
    const good: string[] = [];
    ring.subscribe(() => { throw new Error('boom'); });
    ring.subscribe(e => good.push(e.message));

    expect(() => ring.push(entry({ message: 'survives' }))).not.toThrow();
    expect(good).toEqual(['survives']);
  });
});

describe('LogRingBuffer — unsubscribe', () => {
  it('stops delivery after close() is called', () => {
    const ring = new LogRingBuffer(8);
    const received: string[] = [];
    const sub = ring.subscribe(e => received.push(e.message));

    ring.push(entry({ message: 'first' }));
    sub.close();
    ring.push(entry({ message: 'second' }));
    ring.push(entry({ message: 'third' }));

    expect(received).toEqual(['first']);
  });

  it('closing one subscriber leaves the others intact', () => {
    const ring = new LogRingBuffer(8);
    const a: string[] = [];
    const b: string[] = [];
    const subA = ring.subscribe(e => a.push(e.message));
    ring.subscribe(e => b.push(e.message));

    ring.push(entry({ message: '1' }));
    subA.close();
    ring.push(entry({ message: '2' }));

    expect(a).toEqual(['1']);
    expect(b).toEqual(['1', '2']);
  });

  it('close() is idempotent and safe to call after the buffer has churned', () => {
    const ring = new LogRingBuffer(2);
    const received: string[] = [];
    const sub = ring.subscribe(e => received.push(e.message));

    for (let i = 0; i < 5; i += 1) ring.push(entry({ message: `m${i}` }));
    sub.close();
    expect(() => sub.close()).not.toThrow();
    ring.push(entry({ message: 'post-close' }));

    expect(received).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
  });
});
