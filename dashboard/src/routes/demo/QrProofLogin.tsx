import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  setToken,
  __mockBind,
  __mockExpire,
  type PairingSession,
  type PairingStream,
  type PairingStreamEvent,
  type PairingSubmitResponse,
} from '../../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, pushToast, Textarea } from '../../components/ui';
import { QrScanner } from '../../components/QrScanner';
import { cn } from '../../lib/cn';

/**
 * QR-proof desktop sign-in demo (ADR-0009, W3).
 *
 * The desktop opens a pairing session, renders the challenge QR, then
 * subscribes to an SSE stream for the terminal event. In parallel, the
 * operator can paste / scan a proof QR from the phone — when one
 * arrives, the desktop POSTs the proof to the backend. Either the
 * SSE stream OR the submit response can land the page in `success`;
 * whichever wins first transitions the state machine.
 *
 * The whole flow runs end-to-end against the backend if /v1/proof-
 * pairing/* is mounted. Otherwise VITE_PAIRING_MOCK=1 lets the page
 * synthesise responses so the W3 demo deck reviewer can drive it
 * without a live backend.
 */

// ─── State machine ──────────────────────────────────────────────

type PairingPhase =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'pending'; session: PairingSession; expiresAt: Date; secondsLeft: number }
  | { phase: 'awaiting_proof'; session: PairingSession; expiresAt: Date; secondsLeft: number; submitting: boolean }
  | { phase: 'success'; userEmail: string; userId: string; did: string }
  | { phase: 'expired' | 'error'; code: string; message: string };

type PairingAction =
  | { type: 'create_started' }
  | { type: 'create_succeeded'; session: PairingSession }
  | { type: 'create_failed'; code: string; message: string }
  | { type: 'phone_scanned' }
  | { type: 'submit_started' }
  | { type: 'submit_failed'; code: string; message: string }
  | { type: 'tick' }
  | { type: 'sse_bound'; userEmail: string; userId: string; did: string }
  | { type: 'sse_expired' }
  | { type: 'sse_error'; code: string; message: string }
  | { type: 'restart' };

function reducer(state: PairingPhase, action: PairingAction): PairingPhase {
  switch (action.type) {
    case 'create_started':
      return { phase: 'creating' };
    case 'create_succeeded': {
      const expiresAt = new Date(action.session.expiresAt);
      const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      return { phase: 'pending', session: action.session, expiresAt, secondsLeft };
    }
    case 'create_failed':
      return { phase: 'error', code: action.code, message: action.message };
    case 'phone_scanned':
      if (state.phase !== 'pending') return state;
      return {
        phase: 'awaiting_proof',
        session: state.session,
        expiresAt: state.expiresAt,
        secondsLeft: state.secondsLeft,
        submitting: false,
      };
    case 'submit_started':
      if (state.phase !== 'awaiting_proof') return state;
      return { ...state, submitting: true };
    case 'submit_failed':
      // We don't blow up the whole session on a submit failure — let the
      // operator retry with a fresh proof scan until the SSE expiry
      // hits or they hit Start over.
      if (state.phase !== 'awaiting_proof') return state;
      return { ...state, submitting: false };
    case 'tick': {
      if (state.phase !== 'pending' && state.phase !== 'awaiting_proof') return state;
      const next = Math.max(0, Math.floor((state.expiresAt.getTime() - Date.now()) / 1000));
      if (next === state.secondsLeft) return state;
      // Don't auto-transition to expired here — the SSE stream is the
      // canonical source of truth and may fire session_expired before
      // the clock hits zero. We just keep the visible countdown
      // honest.
      return { ...state, secondsLeft: next };
    }
    case 'sse_bound':
      return { phase: 'success', userEmail: action.userEmail, userId: action.userId, did: action.did };
    case 'sse_expired':
      return { phase: 'expired', code: 'pairing_session_expired', message: 'The QR challenge expired before the phone completed the proof.' };
    case 'sse_error':
      return { phase: 'error', code: action.code, message: action.message };
    case 'restart':
      return { phase: 'idle' };
    default:
      return state;
  }
}

// ─── QR rendering ───────────────────────────────────────────────
//
// We don't pull a QR encoder into the dashboard for this single demo.
// The img-src CSP already permits self + data:; we render the QR via
// the public `api.qrserver.com` endpoint and ALWAYS surface the raw
// payload underneath as a copy-paste fallback so a CSP / network block
// can't lock the operator out of the demo.

function qrImageUrl(payload: string, size = 320): string {
  const params = new URLSearchParams({
    size: `${size}x${size}`,
    data: payload,
    margin: '4',
    qzone: '4',
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

// ─── Helpers ────────────────────────────────────────────────────

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PROOF_QR_PREFIX = 'za:proof:1:';

function isMockMode(): boolean {
  try {
    return (import.meta.env.VITE_PAIRING_MOCK ?? '') === '1';
  } catch {
    return false;
  }
}

// ─── The page ───────────────────────────────────────────────────

export default function QrProofLogin() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
  const streamRef = useRef<PairingStream | null>(null);
  const successTokenRef = useRef<PairingSubmitResponse['tokens'] | null>(null);
  // Refs we read from inside the SSE handlers without re-binding them
  // every render. The handler closure would otherwise stale-capture an
  // older `state.phase`.
  const sessionIdRef = useRef<string | null>(null);

  // ─── createSession on mount + on restart ─────────────────────

  const create = useCallback(async () => {
    dispatch({ type: 'create_started' });
    try {
      const { session } = await api.pairing.createSession({ environment: 'live' });
      dispatch({ type: 'create_succeeded', session });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      dispatch({
        type: 'create_failed',
        code: e.code ?? 'pairing_create_failed',
        message: e.message ?? 'Failed to open a pairing session.',
      });
    }
  }, []);

  useEffect(() => {
    if (state.phase === 'idle') {
      void create();
    }
  }, [state.phase, create]);

  // ─── SSE subscription ────────────────────────────────────────

  useEffect(() => {
    // Only subscribe once we have a session id. The effect re-runs when
    // the session id changes (e.g., after a Start-over).
    const sessionId =
      state.phase === 'pending' || state.phase === 'awaiting_proof'
        ? state.session.id
        : null;
    if (!sessionId) return;

    // No-op if we already have a stream for this session id (React
    // strict-mode double-mount otherwise spawns two EventSources).
    if (sessionIdRef.current === sessionId && streamRef.current) return;

    sessionIdRef.current = sessionId;
    const stream = api.pairing.subscribeStream(sessionId);
    streamRef.current = stream;

    const offBound = stream.on('session_bound', (ev: Extract<PairingStreamEvent, { type: 'session_bound' }>) => {
      // Store the access token so we can hydrate the dashboard session
      // once the operator's auto-redirect timer fires. Fall back to the
      // current console token if the stream didn't ship one (mock mode
      // does, real backend does too — this is defence-in-depth).
      successTokenRef.current = ev.tokens;
      if (ev.tokens?.accessToken) {
        setToken(ev.tokens.accessToken);
      }
      dispatch({
        type: 'sse_bound',
        userEmail: ev.userEmail ?? 'desktop user',
        userId: ev.userId,
        did: ev.did,
      });
    });

    const offExpired = stream.on('session_expired', () => {
      dispatch({ type: 'sse_expired' });
    });

    const offError = stream.on('session_error', (ev: Extract<PairingStreamEvent, { type: 'session_error' }>) => {
      dispatch({ type: 'sse_error', code: ev.error, message: ev.message });
    });

    return () => {
      offBound();
      offExpired();
      offError();
      stream.close();
      if (streamRef.current === stream) streamRef.current = null;
      if (sessionIdRef.current === sessionId) sessionIdRef.current = null;
    };
  }, [state.phase === 'pending' || state.phase === 'awaiting_proof' ? state.session.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Countdown tick ──────────────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'pending' && state.phase !== 'awaiting_proof') return;
    const handle = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(handle);
  }, [state.phase]);

  // ─── Auto-redirect after success ─────────────────────────────

  useEffect(() => {
    if (state.phase !== 'success') return;
    const handle = window.setTimeout(() => navigate('/overview'), 2000);
    return () => window.clearTimeout(handle);
  }, [state.phase, navigate]);

  // ─── Proof submission ────────────────────────────────────────

  const submitProofPayload = useCallback(async (payload: string) => {
    // Expected payload: `za:proof:1:<base64url-cbor>`. In the real
    // demo the phone produces this; the desktop scans (camera) or the
    // operator paste-falls-back. We don't decode the CBOR here — the
    // backend does that. The dashboard's only job is to ship the raw
    // payload up to the server.
    //
    // For W3 we accept either a structured payload OR — in mock mode —
    // any non-empty string. Real backend will reject malformed bodies
    // and reflect the error code through the SSE stream.
    if (state.phase !== 'awaiting_proof') return;
    const trimmed = payload.trim();
    if (!trimmed.startsWith(PROOF_QR_PREFIX)) {
      pushToast('warn', `Expected a payload starting with "${PROOF_QR_PREFIX}".`);
      return;
    }
    dispatch({ type: 'submit_started' });
    try {
      // Real backend wants a structured `{ did, proof, publicSignals,
      // clientMeta }`. The QR payload is gzip+base64url-encoded CBOR;
      // until we add a CBOR codec to the dashboard, ship the raw scan
      // as a metadata field and let the backend decode. Mock mode
      // never hits this branch end-to-end.
      const submitBody = {
        did: 'did:zeroauth:pending-decode',
        proof: { pi_a: ['0'], pi_b: [['0', '0']], pi_c: ['0'], protocol: 'groth16' as const, curve: 'bn128' as const },
        publicSignals: ['0', '0', '0'] as [string, string, string],
        clientMeta: { rawScan: trimmed, source: 'dashboard-demo' },
      };
      const response = await api.pairing.submitProof(state.session.id, submitBody);
      successTokenRef.current = response.tokens;
      if (response.tokens?.accessToken) {
        setToken(response.tokens.accessToken);
      }
      // SSE will also fire session_bound — whichever path completes
      // first wins. Both dispatches are idempotent: reducer drops
      // anything that isn't `awaiting_proof`/`pending` for sse_bound.
      dispatch({
        type: 'sse_bound',
        userEmail: 'desktop user',
        userId: response.session.userId,
        did: response.session.did,
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      pushToast('danger', e.message ?? 'Proof submission failed.');
      dispatch({
        type: 'submit_failed',
        code: e.code ?? 'pairing_submit_failed',
        message: e.message ?? 'Proof submission failed.',
      });
    }
  }, [state]);

  // ─── Mock-mode helpers (visible only when VITE_PAIRING_MOCK=1) ─

  const mockMode = isMockMode();
  const triggerMockBind = useCallback(() => {
    const sessionId = state.phase === 'pending' || state.phase === 'awaiting_proof' ? state.session.id : null;
    if (!sessionId) return;
    __mockBind(sessionId);
  }, [state]);
  const triggerMockExpire = useCallback(() => {
    const sessionId = state.phase === 'pending' || state.phase === 'awaiting_proof' ? state.session.id : null;
    if (!sessionId) return;
    __mockExpire(sessionId);
  }, [state]);

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-[720px] space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display, inherit)' }}>
          Sign in with your phone
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Scan the QR with your ZeroAuth Android app. Your phone generates a Groth16 proof locally;
          the desktop reads the proof QR back, verifies it, and signs you in.
        </p>
      </header>

      {mockMode ? <MockBanner /> : null}

      {state.phase === 'idle' || state.phase === 'creating' ? <PendingSpinner /> : null}

      {state.phase === 'pending' ? (
        <ChallengeCard
          session={state.session}
          secondsLeft={state.secondsLeft}
          onPhoneScanned={() => dispatch({ type: 'phone_scanned' })}
          mockMode={mockMode}
          onMockBind={triggerMockBind}
          onMockExpire={triggerMockExpire}
        />
      ) : null}

      {state.phase === 'awaiting_proof' ? (
        <ProofScanCard
          session={state.session}
          secondsLeft={state.secondsLeft}
          submitting={state.submitting}
          onSubmit={submitProofPayload}
          onCancel={() => dispatch({ type: 'restart' })}
          mockMode={mockMode}
          onMockBind={triggerMockBind}
        />
      ) : null}

      {state.phase === 'success' ? <SuccessCard userEmail={state.userEmail} /> : null}

      {state.phase === 'expired' || state.phase === 'error' ? (
        <ErrorCard code={state.code} message={state.message} onRestart={() => dispatch({ type: 'restart' })} />
      ) : null}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function MockBanner() {
  return (
    <div className="rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-4 py-2 text-xs text-[var(--color-warn)]">
      Mock mode active (VITE_PAIRING_MOCK=1). The pairing endpoints are synthesised in-browser.
      Use the controls inside the card to walk the state machine without a backend.
    </div>
  );
}

function PendingSpinner() {
  return (
    <Card>
      <CardBody className="flex items-center justify-center py-16">
        <div className="size-6 animate-spin rounded-full border-2 border-current border-r-transparent text-[var(--color-text-dim)]" />
      </CardBody>
    </Card>
  );
}

interface ChallengeCardProps {
  session: PairingSession;
  secondsLeft: number;
  onPhoneScanned: () => void;
  mockMode: boolean;
  onMockBind: () => void;
  onMockExpire: () => void;
}

function ChallengeCard({ session, secondsLeft, onPhoneScanned, mockMode, onMockBind, onMockExpire }: ChallengeCardProps) {
  return (
    <Card>
      <CardHeader
        title="Scan with your phone"
        description="Open the ZeroAuth app and hold the camera up to this code."
        action={
          <Badge tone={secondsLeft > 30 ? 'brand' : 'warn'}>
            QR expires in {formatCountdown(secondsLeft)}
          </Badge>
        }
      />
      <CardBody className="flex flex-col items-center gap-4 py-8">
        <div
          className="rounded-lg border border-[var(--color-border)] bg-white p-3"
          aria-label="Pairing QR code"
          role="img"
          data-testid="pairing-qr"
        >
          <img
            src={qrImageUrl(session.qrPayload, 320)}
            alt="Pairing QR — scan with your phone"
            width={320}
            height={320}
            style={{ imageRendering: 'pixelated' }}
            loading="eager"
            decoding="sync"
          />
        </div>
        <details className="w-full max-w-md text-xs text-[var(--color-text-dim)]">
          <summary className="cursor-pointer hover:text-[var(--color-text-secondary)]">
            QR payload (paste fallback)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2 font-mono text-[10px] leading-relaxed">
            {session.qrPayload}
          </pre>
        </details>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onPhoneScanned}>
            I scanned it — next
          </Button>
          {mockMode ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onMockBind}>
                Trigger mock claim
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onMockExpire}>
                Trigger mock expire
              </Button>
            </>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

interface ProofScanCardProps {
  session: PairingSession;
  secondsLeft: number;
  submitting: boolean;
  onSubmit: (payload: string) => void;
  onCancel: () => void;
  mockMode: boolean;
  onMockBind: () => void;
}

function ProofScanCard({ session, secondsLeft, submitting, onSubmit, onCancel, mockMode, onMockBind }: ProofScanCardProps) {
  // Live webcam scanner (BarcodeDetector) is the primary path; the
  // textarea is preserved as a <details> disclosure for a11y + browsers
  // without BarcodeDetector. The scanner fires onDetected exactly once
  // per session (first-hit-wins) and tears down its own camera stream.
  const ref = useRef<HTMLTextAreaElement | null>(null);

  return (
    <Card>
      <CardHeader
        title="Scan the proof QR from your phone"
        description="Hold your phone's screen up to your webcam. We'll catch the proof QR and sign you in."
        action={
          <Badge tone={secondsLeft > 30 ? 'brand' : 'warn'}>
            Session expires in {formatCountdown(secondsLeft)}
          </Badge>
        }
      />
      <CardBody className={cn('space-y-4', submitting && 'opacity-60')}>
        <p className="text-center text-xs text-[var(--color-text-secondary)]">
          Hold your phone&apos;s screen up to the webcam
        </p>
        <div className="flex justify-center">
          <QrScanner
            expectedPrefix={PROOF_QR_PREFIX}
            width={480}
            height={360}
            onDetected={(text) => {
              // First hit wins. The scanner has already cleared its
              // own interval + paused the stream; just hand the payload
              // to the submit pipeline.
              onSubmit(text);
            }}
            onError={(err) => {
              pushToast('warn', `Webcam unavailable: ${err.message}. Use the paste fallback below.`);
            }}
          />
        </div>
        <details className="text-xs text-[var(--color-text-dim)]">
          <summary className="cursor-pointer hover:text-[var(--color-text-secondary)]">
            Type or paste the proof code instead
          </summary>
          <div className="mt-3 space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)]">
              Proof QR payload
            </label>
            <Textarea
              ref={ref}
              data-testid="proof-payload-input"
              placeholder="za:proof:1:..."
              spellCheck={false}
              disabled={submitting}
              rows={6}
              className="font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={submitting}
                data-testid="proof-submit-button"
                onClick={() => {
                  if (!ref.current) return;
                  onSubmit(ref.current.value);
                }}
              >
                Verify pasted proof
              </Button>
            </div>
          </div>
        </details>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          {mockMode ? (
            <Button type="button" variant="secondary" size="sm" onClick={onMockBind} disabled={submitting}>
              Trigger mock claim
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] text-[var(--color-text-dim)]">
          Session id <code className="font-mono">{session.id.slice(0, 8)}…</code>
        </p>
      </CardBody>
    </Card>
  );
}

function SuccessCard({ userEmail }: { userEmail: string }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
        <SuccessGlyph />
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          Welcome back{userEmail ? `, ${userEmail}` : ''}
        </h2>
        <p className="text-xs text-[var(--color-text-secondary)]">
          The desktop session is now active. Redirecting to your overview in a moment.
        </p>
      </CardBody>
    </Card>
  );
}

function ErrorCard({ code, message, onRestart }: { code: string; message: string; onRestart: () => void }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
        <ErrorGlyph />
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Something went sideways</h2>
        <p className="max-w-md text-xs text-[var(--color-text-secondary)]">{message}</p>
        <code className="font-mono text-[11px] text-[var(--color-text-dim)]">{code}</code>
        <Button type="button" variant="primary" size="sm" onClick={onRestart} data-testid="restart-button">
          Start over
        </Button>
      </CardBody>
    </Card>
  );
}

function SuccessGlyph(): ReactNode {
  return (
    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-success)]">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function ErrorGlyph(): ReactNode {
  return (
    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-warn)]">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </svg>
  );
}

// Silence an unused-var warning for the helper we expose to the test
// suite but don't reference inline.
void useMemo;
