/**
 * Dashboard-side live-verifications stream client.
 *
 * Backs the `/dashboard/tenant/verifications` view. Wraps the
 * `GET /api/console/verifications/stream` SSE endpoint defined in
 * `src/routes/console.ts` and projects every wire-shape row into a
 * narrow `VerificationEvent` type that does NOT carry any PII.
 *
 * Two contracts this file owns:
 *
 *   1. **`VerificationEvent` is a structural blacklist of PII.**
 *      The type carries ONLY `did`, `environment`, `result`,
 *      `latencyMs`, `createdAt`, `proofHash`, `reason`, `auditId`,
 *      `action`. There is no `full_name`, no `email`, no `phone`,
 *      no `employee_code` — same allowlist shape as the users-view
 *      pattern in commit `6e06a14`. A component that imports
 *      `VerificationEvent` and tries to read `.full_name` will not
 *      compile.
 *
 *   2. **The strip is an explicit allowlist projection.** Whatever
 *      the server sends, the projection picks the nine allowed
 *      fields and drops everything else. `unknown` would be
 *      slightly safer; a loose record is a deliberate ergonomic
 *      tradeoff because the projection is the choke point — the
 *      consumer never touches the wire shape.
 *
 * ADR 0017 (blockchain-agnostic posture) lands an opt-in model for
 * the on-chain anchor; the verifications view itself is anchor-
 * provider-agnostic — it shows the audit row whether or not a chain
 * provider re-verifies the proof. The `proofHash` field is the
 * cross-reference the bank's auditor uses to look up the proof
 * archive regardless of anchor provider.
 *
 * The DPDP §2(t) memo skeleton at `docs/compliance/dpdp-2t-memo.md`
 * is the legal posture this type encodes: the data principal is
 * not identifiable from a Poseidon-commitment-backed DID + outcome
 * code + latency.
 *
 * Transport: per ADR 0013 / commit ee6aad4 ("remove access_token
 * query fallback from console SSE auth"), the EventSource uses
 * `withCredentials: true` and the HttpOnly `zeroauth_console_jwt`
 * cookie. No `?access_token=` query string.
 */

// ─── Public type ─────────────────────────────────────────────────

/**
 * The shape every dashboard component sees for a live verification.
 *
 * Adding a field here is an ADR-grade decision; the view's PII
 * blacklist test scans the rendered DOM for sensitive substrings
 * AND the source file for forbidden property reads.
 */
export interface VerificationEvent {
  /** Opaque audit-row id, stringified BIGSERIAL. */
  auditId: string;
  /** Full audit action verb, e.g. 'verification.verify_success'. */
  action: string;
  /** Opaque decentralised identifier; never derived from PII. */
  did: string;
  /** Environment scope — 'live' vs 'test'. */
  environment: 'live' | 'test';
  /** Final outcome of this verification. */
  result: 'success' | 'failure';
  /** Server-clock latency in ms, if measured upstream. */
  latencyMs: number | null;
  /** ISO-8601 timestamp at which the audit row committed. */
  createdAt: string;
  /** SHA-256 of the Groth16 proof, hex; cross-ref for the auditor. */
  proofHash: string | null;
  /** Verbatim failure reason; only populated when result === 'failure'. */
  reason: string | null;
}

// ─── Wire shape ──────────────────────────────────────────────────
//
// What the SSE endpoint emits. Wider than `VerificationEvent` on
// purpose — the projection narrows it. Forbidden fields are not
// listed; if they appear on the wire they pass through the
// allowlist projection unread.

interface WireVerificationEvent {
  tenant_id?: string;
  audit_id?: string;
  action?: string;
  status?: 'success' | 'failure';
  environment?: 'live' | 'test' | null;
  created_at?: string;
  did?: string | null;
  latency_ms?: number | null;
  proof_hash?: string | null;
  reason?: string | null;
  // Anything else the server sends is dropped on the floor.
  [extra: string]: unknown;
}

// ─── Projection ──────────────────────────────────────────────────

function projectWire(wire: WireVerificationEvent): VerificationEvent {
  return {
    auditId: typeof wire.audit_id === 'string' ? wire.audit_id : '',
    action: typeof wire.action === 'string' ? wire.action : 'verification.unknown',
    did: typeof wire.did === 'string' ? wire.did : '',
    environment: wire.environment === 'test' ? 'test' : 'live',
    result: wire.status === 'failure' ? 'failure' : 'success',
    latencyMs: typeof wire.latency_ms === 'number' ? wire.latency_ms : null,
    createdAt: typeof wire.created_at === 'string' ? wire.created_at : '',
    proofHash: typeof wire.proof_hash === 'string' ? wire.proof_hash : null,
    reason: typeof wire.reason === 'string' ? wire.reason : null,
  };
}

// ─── Stream client ───────────────────────────────────────────────

export interface VerificationStream {
  close(): void;
}

/**
 * Open an SSE subscription to `/api/console/verifications/stream`.
 *
 * `onEvent` receives the projected `VerificationEvent` shape per
 * row; the projection runs in this function, so the consumer
 * never sees the wire shape.
 *
 * Per ADR 0013, the request uses `withCredentials: true` to ship
 * the HttpOnly `zeroauth_console_jwt` cookie. No `?access_token=`
 * fallback — Caddy access logs include query strings, which would
 * turn the JWT into a session-replay primitive for the JWT's TTL.
 *
 * Returns a handle whose `close()` removes the EventSource. The
 * React route calls this on unmount.
 *
 * If `EventSource` is undefined (e.g. SSR, jsdom without a
 * polyfill, the vitest harness), the function returns a no-op
 * close handle. The test suite installs a controllable EventSource
 * mock before this code runs (see `kioskStream.ts` for the same
 * pattern).
 */
export function openVerificationStream(
  onEvent: (event: VerificationEvent) => void,
  options: { onError?: (code: string, message: string) => void } = {},
): VerificationStream {
  if (typeof EventSource === 'undefined') {
    return { close: () => {} };
  }

  const url = '/api/console/verifications/stream';
  const es = new EventSource(url, { withCredentials: true });

  const messageHandler = (raw: Event): void => {
    const data = (raw as MessageEvent).data;
    if (typeof data !== 'string' || data.length === 0) return;
    try {
      const wire = JSON.parse(data) as WireVerificationEvent;
      onEvent(projectWire(wire));
    } catch {
      // Malformed payload — swallow. The view's empty-state stays
      // up; the operator refreshes if the stream produces no events.
    }
  };

  const errorHandler = (raw: Event): void => {
    if (!options.onError) return;
    let code = 'sse_error';
    let message = 'Lost the connection to the verifications stream.';
    if ((raw as MessageEvent).data) {
      try {
        const parsed = JSON.parse((raw as MessageEvent).data) as {
          error?: string;
          message?: string;
        };
        code = parsed.error ?? code;
        message = parsed.message ?? message;
      } catch {
        // Defaults are fine.
      }
    }
    options.onError(code, message);
  };

  es.addEventListener('verification', messageHandler);
  es.addEventListener('verification.verify_success', messageHandler);
  es.addEventListener('verification.verify_failure', messageHandler);
  es.addEventListener('session_error', errorHandler);

  es.onerror = (): void => {
    // EventSource auto-retries on transient drops. Only the hard-
    // close ("CLOSED") is surfaced as an error to the consumer —
    // same shape as kioskStream.ts.
    if (es.readyState === EventSource.CLOSED && options.onError) {
      options.onError(
        'sse_disconnected',
        'Lost the connection to the verifications stream.',
      );
    }
  };

  return {
    close(): void {
      es.removeEventListener('verification', messageHandler);
      es.removeEventListener('verification.verify_success', messageHandler);
      es.removeEventListener('verification.verify_failure', messageHandler);
      es.removeEventListener('session_error', errorHandler);
      es.close();
    },
  };
}
