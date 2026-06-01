import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';

/**
 * NeoBank — Sign-in page.
 *
 * On mount we open a pairing session via POST /api/demo-portal/init-login
 * (the server-bridge wave will land that endpoint; the response shape
 * mirrors /v1/proof-pairing/sessions so this page works end-to-end the
 * moment the bridge is wired in).
 *
 * The QR is rendered locally with qrcode.react, the page subscribes to
 * /api/demo-portal/sessions/:id/stream over SSE, and on the terminal
 * `session_bound` event we navigate to /dashboard.
 *
 * SSE + state-machine shape mirrors dashboard/src/routes/demo/QrProofLogin.tsx —
 * see that file for the canonical reducer; this is the customer-facing twin.
 */

// ─── API types (compatible with /v1/proof-pairing/sessions) ────

interface InitLoginResponse {
  sessionId: string;
  deeplink: string;
  qrPayload: string;
  expiresAt: string;
}

type SessionStreamEvent =
  | {
      type: 'session_bound';
      userId: string;
      did: string;
      userEmail?: string;
      tokens?: { accessToken?: string };
    }
  | { type: 'session_expired' }
  | { type: 'session_error'; error: string; message: string };

// ─── Reducer ───────────────────────────────────────────────────

type SignInPhase =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | {
      phase: 'pending';
      sessionId: string;
      qrPayload: string;
      deeplink: string;
      expiresAt: Date;
      secondsLeft: number;
    }
  | { phase: 'success'; userEmail: string }
  | { phase: 'expired' | 'error'; code: string; message: string };

type SignInAction =
  | { type: 'create_started' }
  | { type: 'create_succeeded'; payload: InitLoginResponse }
  | { type: 'create_failed'; code: string; message: string }
  | { type: 'tick' }
  | { type: 'sse_bound'; userEmail: string }
  | { type: 'sse_expired' }
  | { type: 'sse_error'; code: string; message: string }
  | { type: 'restart' };

function reducer(state: SignInPhase, action: SignInAction): SignInPhase {
  switch (action.type) {
    case 'create_started':
      return { phase: 'creating' };
    case 'create_succeeded': {
      const expiresAt = new Date(action.payload.expiresAt);
      const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      return {
        phase: 'pending',
        sessionId: action.payload.sessionId,
        qrPayload: action.payload.qrPayload,
        deeplink: action.payload.deeplink,
        expiresAt,
        secondsLeft,
      };
    }
    case 'create_failed':
      return { phase: 'error', code: action.code, message: action.message };
    case 'tick': {
      if (state.phase !== 'pending') return state;
      const next = Math.max(0, Math.floor((state.expiresAt.getTime() - Date.now()) / 1000));
      return next === state.secondsLeft ? state : { ...state, secondsLeft: next };
    }
    case 'sse_bound':
      return { phase: 'success', userEmail: action.userEmail };
    case 'sse_expired':
      return {
        phase: 'expired',
        code: 'session_expired',
        message: 'The login QR expired before your phone finished the proof. Try again.',
      };
    case 'sse_error':
      return { phase: 'error', code: action.code, message: action.message };
    case 'restart':
      return { phase: 'idle' };
    default:
      return state;
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function initLogin(): Promise<InitLoginResponse> {
  const res = await fetch('/api/demo-portal/init-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let code = 'init_login_failed';
    let message = `Failed to open a sign-in session (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch { /* body wasn't JSON — fall through */ }
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    throw err;
  }
  return (await res.json()) as InitLoginResponse;
}

// ─── The page ──────────────────────────────────────────────────

export default function SignIn() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
  const sessionIdRef = useRef<string | null>(null);

  const create = useCallback(async () => {
    dispatch({ type: 'create_started' });
    try {
      const payload = await initLogin();
      dispatch({ type: 'create_succeeded', payload });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      dispatch({
        type: 'create_failed',
        code: e.code ?? 'init_login_failed',
        message: e.message ?? 'Failed to open a sign-in session.',
      });
    }
  }, []);

  useEffect(() => {
    if (state.phase === 'idle') void create();
  }, [state.phase, create]);

  // SSE subscription — mirrors QrProofLogin.tsx. The terminal events
  // (`session_bound`, `session_expired`, `session_error`) are named so
  // the EventSource listener can dispatch directly into the reducer.
  useEffect(() => {
    const sessionId = state.phase === 'pending' ? state.sessionId : null;
    if (!sessionId) return;
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;

    if (typeof EventSource === 'undefined') {
      dispatch({
        type: 'sse_error',
        code: 'sse_unsupported',
        message:
          'This browser does not support live updates. Try a recent Chrome, Edge, Firefox, or Safari.',
      });
      return;
    }

    const url = `/api/demo-portal/sessions/${encodeURIComponent(sessionId)}/stream`;
    const es = new EventSource(url, { withCredentials: true });

    const wire = <T extends SessionStreamEvent['type']>(
      name: T,
      handler: (ev: Extract<SessionStreamEvent, { type: T }>) => void,
    ) => {
      const listener = (raw: MessageEvent) => {
        try {
          const parsed = JSON.parse(raw.data) as Omit<SessionStreamEvent, 'type'>;
          handler({ ...parsed, type: name } as Extract<SessionStreamEvent, { type: T }>);
        } catch { /* malformed payload — demo shouldn't tour console.error */ }
      };
      es.addEventListener(name, listener as EventListener);
      return () => es.removeEventListener(name, listener as EventListener);
    };

    const offBound = wire('session_bound', (ev) => {
      if (ev.tokens?.accessToken) {
        // Hand the desktop session off to the dashboard shell. Private-
        // mode Safari throws on localStorage writes — non-fatal here.
        try {
          localStorage.setItem('za_demo_token', ev.tokens.accessToken);
        } catch {
          /* ignore */
        }
      }
      dispatch({ type: 'sse_bound', userEmail: ev.userEmail ?? 'demo user' });
    });
    const offExpired = wire('session_expired', () => {
      dispatch({ type: 'sse_expired' });
    });
    const offError = wire('session_error', (ev) => {
      dispatch({ type: 'sse_error', code: ev.error, message: ev.message });
    });

    return () => {
      offBound();
      offExpired();
      offError();
      es.close();
      if (sessionIdRef.current === sessionId) sessionIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase === 'pending' ? state.sessionId : null]);

  // 1Hz countdown — visual only; SSE remains the source of truth.
  useEffect(() => {
    if (state.phase !== 'pending') return;
    const handle = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(handle);
  }, [state.phase]);

  // Auto-navigate to /dashboard once bound. Short delay so the success
  // glyph is readable on a projector during the pitch.
  useEffect(() => {
    if (state.phase !== 'success') return;
    const handle = window.setTimeout(() => navigate('/dashboard'), 1200);
    return () => window.clearTimeout(handle);
  }, [state.phase, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12" style={{ backgroundColor: '#f4f5f7' }}>
      <style>{dottedBorderKeyframes}</style>
      <div
        className="w-full max-w-md rounded-2xl bg-white px-8 py-10 text-center shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18)]"
        role="region"
        aria-label="Sign in with ZeroAuth"
      >
        <header className="mb-6 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">NeoBank</p>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="text-sm text-slate-600">Open ZeroAuth, tap Sign in, scan this code.</p>
        </header>

        {(state.phase === 'idle' || state.phase === 'creating') && <PendingState />}
        {state.phase === 'pending' && (
          <PendingCard qrPayload={state.qrPayload} secondsLeft={state.secondsLeft} />
        )}
        {state.phase === 'success' && <SuccessState userEmail={state.userEmail} />}
        {(state.phase === 'expired' || state.phase === 'error') && (
          <ErrorState
            code={state.code}
            message={state.message}
            onRetry={() => dispatch({ type: 'restart' })}
          />
        )}

        <p className="mt-8 text-xs text-slate-500">
          First time? You&apos;ll be prompted to create an account on your phone — takes 30 seconds.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function PendingState(): ReactNode {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-3 text-slate-500">
      <div className="size-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      <p className="text-sm">Opening a secure sign-in session…</p>
    </div>
  );
}

interface PendingCardProps {
  qrPayload: string;
  secondsLeft: number;
}

function PendingCard({ qrPayload, secondsLeft }: PendingCardProps): ReactNode {
  // Animated dashed border drawn as a background SVG — the QR canvas
  // underneath stays sharp at any DPR.
  const borderStyle = {
    backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(dottedBorderSvg)}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    animation: 'zaDottedDance 14s linear infinite',
  } as const;
  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative rounded-2xl bg-white p-4"
        aria-label="ZeroAuth sign-in QR code"
        role="img"
        data-testid="signin-qr"
        style={borderStyle}
      >
        <QRCodeCanvas value={qrPayload} size={256} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f172a" />
      </div>
      <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ backgroundColor: secondsLeft > 30 ? '#10b981' : '#f59e0b' }}
        />
        QR expires in {formatCountdown(secondsLeft)}
      </div>
    </div>
  );
}

function SuccessState({ userEmail }: { userEmail: string }): ReactNode {
  return (
    <div className="flex h-[280px] flex-col items-center justify-center gap-3">
      <Glyph kind="check" className="text-emerald-500" size={56} />
      <h2 className="text-lg font-semibold text-slate-900">
        Welcome back{userEmail ? `, ${userEmail}` : ''}
      </h2>
      <p className="text-xs text-slate-500">Taking you to your dashboard…</p>
    </div>
  );
}

interface ErrorStateProps {
  code: string;
  message: string;
  onRetry: () => void;
}

function ErrorState({ code, message, onRetry }: ErrorStateProps): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Glyph kind="warn" className="text-amber-500" size={48} />
      <h2 className="text-base font-semibold text-slate-900">
        Sign-in didn&apos;t complete
      </h2>
      <p className="max-w-sm text-xs text-slate-600">{message}</p>
      <code className="font-mono text-[11px] text-slate-400">{code}</code>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
        data-testid="signin-retry"
      >
        Try again
      </button>
    </div>
  );
}

function Glyph({ kind, size, className }: { kind: 'check' | 'warn'; size: number; className: string }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      {kind === 'check' ? <path d="m8 12 3 3 5-6" /> : <path d="M12 7v6M12 17h.01" />}
    </svg>
  );
}

// ─── Animated dotted border ────────────────────────────────────

const dottedBorderSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><rect x='1.5' y='1.5' width='97' height='97' rx='8' ry='8' fill='none' stroke='%230f172a' stroke-width='1.6' stroke-dasharray='4 4'/></svg>`;

const dottedBorderKeyframes = `
@keyframes zaDottedDance {
  0%   { background-position: 0 0; }
  100% { background-position: 100% 0; }
}
`;
