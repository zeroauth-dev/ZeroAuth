/**
 * Admin-only Server-Sent Events feed of the API's last 1k log lines
 * plus every new line as it lands.
 *
 * Mount path: /api/admin/logs (mounted in src/app.ts).
 * Auth: x-api-key header, same gate as the rest of /api/admin/* —
 *   `authenticateAdmin` reads `req.headers['x-api-key']` and 403s on
 *   mismatch. Because EventSource (the native browser SSE client)
 *   cannot send custom headers, callers MUST use `fetch()` with a
 *   ReadableStream consumer or any other HTTP client that lets them
 *   set request headers. This is intentional: the alternative — an
 *   `?api_key=` query param — would burn the admin key into proxy
 *   access logs and browser history. The dashboard's ops console
 *   reads this stream via fetch+TextDecoder; see the matching client
 *   when it lands.
 *
 * On connect:
 *   1. The route writes SSE headers and flushes a `: connected`
 *      comment so the client sees the connection open immediately.
 *   2. It replays the last 100 entries from the ring buffer as
 *      individual `event: log` frames, oldest first. This is
 *      explicit context for the operator — when they open the panel
 *      mid-incident the first thing they see is "what was going on
 *      a moment ago" rather than an empty pane until the next log
 *      line happens to fire.
 *   3. It subscribes to the ring buffer and forwards every new
 *      entry until the client disconnects.
 *
 * Cadence:
 *   - 25 s heartbeat (`: ping`) — matches the project's other SSE
 *     streams (`src/routes/console.ts` line ~1048,
 *     `src/services/proof-pairing.ts` heartbeat). Keeps Caddy and
 *     other middleboxes from idling the socket out at 60 s.
 *
 * Lifecycle:
 *   - `req.on('close')` and `req.on('aborted')` both run cleanup,
 *     which clears the heartbeat, disposes the ring subscription,
 *     and `res.end()`s if still open. The double-binding is
 *     belt-and-braces — `close` is the canonical "client went away"
 *     signal, `aborted` covers the older path some proxies emit.
 *     Without cleanup every closed connection leaks a listener until
 *     the process exits.
 *
 * Out of scope (deliberately):
 *   - Filtering by level or substring. The buffer holds 1k lines —
 *     the client filters. A server-side query API would just push
 *     us toward reimplementing grep over SSE.
 *   - Durable history beyond the in-memory ring. Anything that
 *     belongs in long-term storage goes through `audit_events`
 *     (hash-chained, on disk) — see CLAUDE.md non-goal #3 and
 *     `src/services/audit.ts`.
 *   - Multi-pod coordination. Single-pod deployment today; tracked
 *     alongside Redis pub/sub for verification events.
 */

import { Router, Request, Response } from 'express';
import { authenticateAdmin } from '../middleware/auth';
import { logRingBuffer, LogEntry } from '../services/log-ring-buffer';
import { logger } from '../services/logger';

const router = Router();

// Same x-api-key gate as src/routes/admin.ts. Applied via use() so
// every route on this router inherits it — today there's only one,
// but if we ever add /api/admin/logs/tail (a snapshot REST variant)
// it picks up the same auth without re-wiring.
router.use(authenticateAdmin);

/** SSE heartbeat cadence — match the other streams in this codebase. */
const HEARTBEAT_MS = 25_000;
/** Number of historical entries replayed on connect. */
const TAIL_ON_CONNECT = 100;

/**
 * Format a single LogEntry as an SSE `event: log` frame. SSE requires
 * one `data:` line per logical line in the payload, but since we're
 * shipping JSON (which is single-line by JSON.stringify default) one
 * `data:` line is enough. The trailing `\n\n` terminates the event.
 */
function frame(entry: LogEntry): string {
  // JSON.stringify never produces a bare `\n` in strings (it escapes
  // them), so the one-data-line invariant holds. No need for the
  // line-splitter dance that some SSE helpers do.
  return `event: log\ndata: ${JSON.stringify(entry)}\n\n`;
}

/**
 * GET /api/admin/logs/stream
 *
 * Live tail of the API's structured logs. See module docstring above
 * for the contract.
 */
router.get('/stream', (req: Request, res: Response) => {
  // SSE headers. `X-Accel-Buffering: no` tells nginx (and any
  // Caddy/NGINX-compatible reverse proxy) not to buffer; without it
  // the operator sees no output until the response stream closes.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Flush headers + tell the client we're alive. SSE comment frames
  // (lines prefixed with `:`) are parsed and discarded by the client
  // but cause Node to put the headers on the wire.
  res.write(': connected\n\n');

  // 1) Replay the tail. Oldest first preserves chronological order
  //    when the operator scrolls the panel from the top down.
  const tail = logRingBuffer.tail(TAIL_ON_CONNECT);
  for (const entry of tail) {
    // writableEnded can flip true mid-loop if the client bailed out
    // during the connect handshake — bail out fast to avoid filling
    // the kernel buffer for a dead socket.
    if (res.writableEnded) return;
    try {
      res.write(frame(entry));
    } catch {
      // Socket closed between the check and the write. The close
      // handler will run cleanup; stop replaying.
      return;
    }
  }

  // 2) Heartbeat. Comment-only, parsed-and-discarded by the client.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      try { res.write(': ping\n\n'); } catch { /* socket closed */ }
    }
  }, HEARTBEAT_MS);

  // 3) Live subscription. Every push to the ring buffer fires the
  //    listener; we serialise into an SSE frame and ship it. If the
  //    socket closed between the writableEnded check and the actual
  //    write call (race on slow networks), the write throws — we
  //    swallow because the close handler will tear down the rest.
  const subscription = logRingBuffer.subscribe((entry) => {
    if (res.writableEnded) return;
    try {
      res.write(frame(entry));
    } catch {
      // ignore — cleanup runs from the req.close handler.
    }
  });

  // 4) Tear-down. Bound to both `close` and `aborted` because some
  //    Node + proxy combinations only emit one of the two reliably.
  //    The cleanup function is idempotent — calling it twice clears
  //    an already-cleared interval and unsubscribes an already-
  //    unsubscribed listener (a no-op in EventEmitter), then no-ops
  //    on the writableEnded res.end().
  let torndown = false;
  const cleanup = (): void => {
    if (torndown) return;
    torndown = true;
    clearInterval(heartbeat);
    subscription.close();
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);

  // Also tear down on the response side, in case Express ends the
  // response without firing the request-level events (defensive —
  // observed once in the proof-pairing stream under load).
  res.on('close', cleanup);

  logger.debug('admin log SSE opened', {
    remoteAddr: req.ip,
    tailReplayed: tail.length,
  });
});

export default router;
