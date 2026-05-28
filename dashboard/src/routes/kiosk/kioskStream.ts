/**
 * Kiosk-local SSE consumer (ADR 0013: cookie auth only).
 *
 * Listens for the two events Scene 2 cares about: `pairing.consumed`
 * and `pairing.expired`. The backend has historically emitted these
 * under both the legacy names (`session_bound`, `session_expired`) and
 * the new demo-facing names — we wire both so the kiosk works against
 * any version of the proof-pairing service that sprint-2 integration
 * picks up.
 *
 * Important: this is NOT a wrapper around api.pairing.subscribeStream.
 * The shared helper in dashboard/src/lib/api.ts still ships an
 * `?access_token=` query fallback for back-compat with consumers that
 * haven't migrated yet; per ADR 0013 the kiosk MUST send the JWT
 * through the HttpOnly `zeroauth_console_jwt` cookie only
 * (`withCredentials: true`). Constructing the EventSource here, with
 * no query string, makes that contract enforceable from a single file.
 */

export interface KioskSseHandlers {
  onConsumed: () => void;
  onExpired: () => void;
  onError: (code: string, message: string) => void;
}

export function openKioskStream(
  sessionId: string,
  handlers: KioskSseHandlers,
): () => void {
  if (typeof EventSource === 'undefined') {
    // jsdom doesn't ship EventSource. The test harness replaces this
    // path with a polyfill; in a real browser this branch never fires.
    return () => {};
  }

  // No `?access_token=` — ADR 0013 / commit ee6aad4.
  const url = `/api/console/proof-pairing/sessions/${encodeURIComponent(sessionId)}/stream`;
  const es = new EventSource(url, { withCredentials: true });

  const consumedHandler = () => handlers.onConsumed();
  const expiredHandler = () => handlers.onExpired();
  const errorHandler = (raw: Event) => {
    let code = 'sse_error';
    let message = 'Lost the connection to the pairing stream.';
    if ((raw as MessageEvent).data) {
      try {
        const parsed = JSON.parse((raw as MessageEvent).data) as {
          error?: string;
          message?: string;
        };
        code = parsed.error ?? code;
        message = parsed.message ?? message;
      } catch {
        // fall through with defaults
      }
    }
    handlers.onError(code, message);
  };

  es.addEventListener('pairing.consumed', consumedHandler);
  es.addEventListener('session_bound', consumedHandler);
  es.addEventListener('pairing.expired', expiredHandler);
  es.addEventListener('session_expired', expiredHandler);
  es.addEventListener('session_error', errorHandler);

  es.onerror = () => {
    // EventSource auto-retries on transient drops; only the hard-close
    // is worth surfacing. For the kiosk we don't transition to the
    // error card on retryable drops — the demo would look broken if a
    // five-minute kiosk session blipped because Wi-Fi roamed.
    if (es.readyState === EventSource.CLOSED) {
      handlers.onError('sse_disconnected', 'Lost the connection to the pairing stream.');
    }
  };

  return () => {
    es.removeEventListener('pairing.consumed', consumedHandler);
    es.removeEventListener('session_bound', consumedHandler);
    es.removeEventListener('pairing.expired', expiredHandler);
    es.removeEventListener('session_expired', expiredHandler);
    es.removeEventListener('session_error', errorHandler);
    es.close();
  };
}
