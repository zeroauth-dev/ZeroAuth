/**
 * In-memory ring buffer of the last N structured log lines, plus the
 * Winston transport that feeds it.
 *
 * Why this exists:
 *   The bank operators on the Anchor Bank demo (see
 *   docs/plan/bfsi-v1/02-bank-demo.md, Scene 5) need a "tail the API
 *   logs" panel that works without giving them shell access to the VPS.
 *   A 1k-entry circular buffer in the API process is the smallest
 *   thing that does this without dragging in a separate log shipper.
 *
 *   The buffer is intentionally process-local and ephemeral:
 *     - it is NOT a substitute for the audit log
 *       (`src/services/audit.ts` — append-only, hash-chained, on disk).
 *     - it is NOT durable across restarts.
 *     - it is NOT multi-pod aware. Today the deployment is single-pod;
 *       multi-pod ops tailing belongs on a separate work item with
 *       Redis pub/sub, same as `src/services/verification-events.ts`.
 *
 * Privacy posture:
 *   CLAUDE.md non-goal: "Never log biometric-derived raw data." The
 *   logger upstream should never receive such fields, but this buffer
 *   is the last hop before raw log payloads surface on an admin SSE
 *   stream. Defense in depth: any meta key matching the banned-name
 *   list from the project constitution (image, template, pixel, depth,
 *   frame, embedding) is replaced with the sentinel string
 *   "[redacted]" before the entry lands in the buffer. The redaction
 *   only mutates the buffered copy; the original log line that already
 *   went to stdout/Winston is untouched.
 */

import TransportStream from 'winston-transport';
import { EventEmitter } from 'events';

/** Single structured log line as it appears on the SSE stream. */
export interface LogEntry {
  /** ISO 8601 timestamp the record was buffered (server clock). */
  ts: string;
  /** Winston level — error | warn | info | http | verbose | debug | silly. */
  level: string;
  /** The log message string. */
  message: string;
  /** Arbitrary structured metadata, post-redaction. */
  meta: Record<string, unknown>;
}

/**
 * Lowercased substrings we never let into the buffered meta. Matches
 * the banned input keys from CLAUDE.md ("Reject any payload containing
 * keys named image, template, pixel, depth, frame"). `embedding` is
 * added because the on-device pipeline computes 128-dim embeddings —
 * none should ever cross the wire, but if a stray debug log includes
 * one we'd rather drop it on the floor than ship it out the admin
 * SSE.
 */
const REDACT_KEY_SUBSTRINGS = [
  'image',
  'template',
  'pixel',
  'depth',
  'frame',
  'embedding',
];

/**
 * Replace any biometric-shaped field in `meta` with a sentinel. The
 * match is case-insensitive substring match on the key name — so
 * `imageBytes`, `Image`, `face_template`, `depthMap` all hit.
 *
 * Returns a new object; never mutates the caller's reference.
 */
function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    const lc = k.toLowerCase();
    const banned = REDACT_KEY_SUBSTRINGS.some(sub => lc.includes(sub));
    out[k] = banned ? '[redacted]' : v;
  }
  return out;
}

/**
 * Fixed-capacity circular buffer of LogEntry rows.
 *
 * Storage is a plain array of length `capacity`. `head` points at the
 * slot the NEXT push will overwrite; `count` is the number of valid
 * slots filled so far (clamped at capacity). Reads walk the array in
 * insertion order.
 */
export class LogRingBuffer {
  private readonly capacity: number;
  private readonly slots: (LogEntry | undefined)[];
  private head = 0;
  private count = 0;
  private readonly emitter = new EventEmitter();

  constructor(capacity = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LogRingBuffer capacity must be a positive integer; got ${capacity}`);
    }
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(undefined);
    // Many subscribers can attach (one per open SSE connection). The
    // default limit of 10 trips a warning that looks like a leak to
    // anyone tailing the logs. Lift to a reasonable ceiling.
    this.emitter.setMaxListeners(200);
  }

  /** Number of entries currently held (≤ capacity). */
  size(): number {
    return this.count;
  }

  /** Maximum number of entries this buffer can hold. */
  getCapacity(): number {
    return this.capacity;
  }

  /**
   * Append a new log entry. Overwrites the oldest slot once full.
   * Emits a `'log'` event to any subscriber. Returns the (redacted)
   * entry as buffered, so callers (e.g. tests) can assert on the
   * actual stored shape.
   */
  push(entry: LogEntry): LogEntry {
    const buffered: LogEntry = {
      ts: entry.ts,
      level: entry.level,
      message: entry.message,
      meta: redactMeta(entry.meta ?? {}),
    };
    this.slots[this.head] = buffered;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    // Listener errors must not crash the logger pipeline AND must not
    // block the rest of the subscriber chain. Winston calls
    // `transport.log(info, next)` synchronously and we hand control to
    // `next()` immediately after this push — a thrown listener would
    // bubble back into the caller's logger.warn call site.
    //
    // We deliberately do NOT use `emitter.emit('log', ...)` here:
    // EventEmitter invokes listeners synchronously in registration
    // order and the first throw short-circuits the rest, so a single
    // broken SSE subscriber would silently starve every other open
    // tail-session of new entries. Iterate the listener list ourselves
    // and isolate each invocation in its own try/catch.
    const listeners = this.emitter.listeners('log') as Array<(e: LogEntry) => void>;
    for (const listener of listeners) {
      try {
        listener(buffered);
      } catch (err) {
        // Swallow + surface. We can't go through the Winston logger
        // here without risking re-entrancy (this method is itself on
        // the Winston transport path), so write straight to stderr.
        // eslint-disable-next-line no-console
        console.error('LogRingBuffer: subscriber threw', err);
      }
    }
    return buffered;
  }

  /**
   * Return the last `n` entries in insertion order (oldest first),
   * clamped to whatever is available. n defaults to the full buffer.
   */
  tail(n: number = this.capacity): LogEntry[] {
    if (n <= 0 || this.count === 0) return [];
    const take = Math.min(n, this.count);
    const out: LogEntry[] = new Array(take);
    // Oldest valid index walks back `count` slots from `head`.
    const start = (this.head - this.count + this.capacity) % this.capacity;
    // We want the LAST `take` of the count entries; skip the front
    // (count - take) entries.
    const skip = this.count - take;
    for (let i = 0; i < take; i += 1) {
      const idx = (start + skip + i) % this.capacity;
      const slot = this.slots[idx];
      // `slot` is defined for any index inside [0, count); the cast
      // documents the invariant rather than introducing a runtime
      // check we don't need.
      out[i] = slot as LogEntry;
    }
    return out;
  }

  /**
   * Subscribe to live log entries. Returns a disposer the SSE route
   * MUST call on disconnect; without it every closed connection leaks
   * a listener until the process exits.
   */
  subscribe(listener: (entry: LogEntry) => void): { close: () => void } {
    this.emitter.on('log', listener);
    return {
      close: (): void => {
        this.emitter.off('log', listener);
      },
    };
  }

  /** Reset the buffer. Test-only — not used in production code paths. */
  clear(): void {
    for (let i = 0; i < this.capacity; i += 1) this.slots[i] = undefined;
    this.head = 0;
    this.count = 0;
  }
}

/**
 * Process-wide singleton. The Winston transport pushes here; the SSE
 * route reads + subscribes here. Exporting a single instance keeps
 * the wiring trivial — no DI container needed for what is, in the
 * end, a single in-memory queue.
 */
export const logRingBuffer = new LogRingBuffer(1000);

/**
 * Winston transport that funnels every log line through the ring.
 *
 * Winston hands the transport an `info` object whose shape depends on
 * the formatter chain. With the formatter set in
 * `src/services/logger.ts` (`timestamp() + errors({ stack: true }) +
 * (json|simple)`), `info` always carries:
 *   - `level` (string),
 *   - `message` (string or anything stringifiable),
 *   - `timestamp` (ISO string from the timestamp() formatter),
 *   - plus every key the caller passed as the meta object.
 *
 * The `Symbol.for('level')` and `Symbol.for('message')` symbol keys
 * are formatter internals — strip them out of meta so the SSE
 * consumer sees a clean object.
 */
class RingBufferTransport extends TransportStream {
  private readonly ring: LogRingBuffer;

  constructor(ring: LogRingBuffer) {
    super();
    this.ring = ring;
  }

  log(info: Record<string, unknown>, next: () => void): void {
    // Winston expects us to fire the `logged` event on the same tick
    // as the call. Doing it here (before the push) keeps the transport
    // contract simple — even if the ring throws downstream, Winston
    // doesn't get wedged.
    setImmediate(() => this.emit('logged', info));

    try {
      const level = typeof info.level === 'string' ? info.level : 'info';
      const message = typeof info.message === 'string'
        ? info.message
        : String(info.message ?? '');
      const ts = typeof info.timestamp === 'string'
        ? info.timestamp
        : new Date().toISOString();

      // Build the meta object: everything on `info` minus the fields
      // we've promoted to top-level, minus Winston's symbol-keyed
      // internals (which Object.entries won't enumerate anyway, but
      // `level` / `message` show up as both string and symbol keys).
      const meta: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(info)) {
        if (k === 'level' || k === 'message' || k === 'timestamp') continue;
        meta[k] = v;
      }

      this.ring.push({ ts, level, message, meta });
    } catch {
      // A broken transport must never block the Winston pipeline.
      // Swallow — the original log line already went to stdout via
      // the Console transport, so observability is preserved.
    }

    next();
  }
}

/**
 * Wire the ring buffer into a Winston logger instance. Call exactly
 * once at boot, from `src/app.ts` (or a module imported by it). Safe
 * to call again — the second call returns the same singleton
 * transport instance.
 */
let attached: RingBufferTransport | undefined;
export function attachRingBufferTransport(
  logger: { add: (t: TransportStream) => void },
): TransportStream {
  if (!attached) {
    attached = new RingBufferTransport(logRingBuffer);
    logger.add(attached);
  }
  return attached;
}
