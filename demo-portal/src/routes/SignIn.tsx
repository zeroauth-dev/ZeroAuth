import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { Button } from '../components/Button';
import { ApiError, bankLogin, type BankLoginResponse } from '../lib/api';

/**
 * NeoBank — Sign-in page (bank 2FA).
 *
 * Password-first: the default view is a customer-id (email) + password
 * form. POST /api/demo-portal/bank/login runs the bank's first factor;
 * on 201 a DID-pinned pairing session is already open server-side and
 * the ZeroAuth app on the enrolled phone receives it as an approval
 * request (UPI-collect style). The page then sits in `awaiting_approval`
 * with the same SSE → claim → /dashboard machinery the QR flow uses. The
 * returned qrPayload is surfaced only behind a "phone not receiving it?"
 * expander as the offline fallback.
 *
 * The original QR-only flow (POST /api/demo-portal/init-login) remains
 * reachable via the "Sign in by QR instead" link and is unchanged.
 *
 * Either way the page subscribes to /api/demo-portal/sessions/:id/events
 * over SSE, and on the terminal `session_bound` event claims the desktop
 * cookie and navigates to /dashboard.
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
  | { phase: 'credentials' }
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
  | {
      phase: 'awaiting_approval';
      sessionId: string;
      qrPayload: string;
      expiresAt: Date;
      secondsLeft: number;
    }
  | { phase: 'success'; userEmail: string }
  | { phase: 'expired' | 'error'; code: string; message: string };

type SignInAction =
  | { type: 'create_started' }
  | { type: 'create_succeeded'; payload: InitLoginResponse }
  | { type: 'create_failed'; code: string; message: string }
  | { type: 'login_succeeded'; payload: BankLoginResponse }
  | { type: 'use_qr_flow' }
  | { type: 'tick' }
  | { type: 'sse_bound'; userEmail: string }
  | { type: 'sse_expired' }
  | { type: 'sse_error'; code: string; message: string }
  | { type: 'restart' };

function secondsUntil(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

function reducer(state: SignInPhase, action: SignInAction): SignInPhase {
  switch (action.type) {
    case 'create_started':
      return { phase: 'creating' };
    case 'create_succeeded': {
      const expiresAt = new Date(action.payload.expiresAt);
      return {
        phase: 'pending',
        sessionId: action.payload.sessionId,
        qrPayload: action.payload.qrPayload,
        deeplink: action.payload.deeplink,
        expiresAt,
        secondsLeft: secondsUntil(expiresAt),
      };
    }
    case 'create_failed':
      return { phase: 'error', code: action.code, message: action.message };
    case 'login_succeeded': {
      // Bank first factor accepted — a DID-pinned approval request is
      // already sitting in the ZeroAuth app. Wait for it over SSE.
      const expiresAt = new Date(action.payload.expiresAt);
      return {
        phase: 'awaiting_approval',
        sessionId: action.payload.sessionId,
        qrPayload: action.payload.qrPayload,
        expiresAt,
        secondsLeft: secondsUntil(expiresAt),
      };
    }
    case 'use_qr_flow':
      // 'idle' is the QR flow's bootstrap state — the mount effect
      // fires initLogin for it.
      return { phase: 'idle' };
    case 'tick': {
      if (state.phase !== 'pending' && state.phase !== 'awaiting_approval') return state;
      const next = secondsUntil(state.expiresAt);
      return next === state.secondsLeft ? state : { ...state, secondsLeft: next };
    }
    case 'sse_bound':
      return { phase: 'success', userEmail: action.userEmail };
    case 'sse_expired':
      return {
        phase: 'expired',
        code: 'session_expired',
        message: 'The sign-in request expired before it was approved on your phone. Try again.',
      };
    case 'sse_error':
      return { phase: 'error', code: action.code, message: action.message };
    case 'restart':
      return { phase: 'credentials' };
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

/**
 * POST /api/demo-portal/submit-proof with the raw proof-QR string the
 * operator pasted or the webcam decoded. Throws an Error with an
 * additional `code` field on any non-2xx so the caller can branch on
 * the documented submitProof failure classes (proof_failed,
 * pairing_session_expired, pairing_session_already_bound, etc).
 */
async function submitProofPayload(
  sessionId: string,
  qrPayload: string,
): Promise<{ ok: true; redirect: string }> {
  const res = await fetch('/api/demo-portal/submit-proof', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, qr_payload: qrPayload }),
  });
  if (!res.ok) {
    let code = 'proof_failed';
    let message = `Proof submission failed (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch { /* body wasn't JSON — fall through */ }
    const err = new Error(message) as Error & { code: string };
    err.code = code;
    throw err;
  }
  return (await res.json()) as { ok: true; redirect: string };
}

/**
 * POST /api/demo-portal/sessions/:id/claim — desktop-side cookie claim
 * for the phone-push flow. After the phone submits its proof directly,
 * the pairing row is `consumed` but the desktop has no cookie yet. This
 * call mints the demo_portal_session cookie on the DESKTOP's response so
 * the subsequent /me (on the dashboard) authenticates. Idempotent + does
 * no crypto — see the route's doc in src/routes/demo-portal.ts.
 */
async function claimSession(sessionId: string): Promise<void> {
  const res = await fetch(
    `/api/demo-portal/sessions/${encodeURIComponent(sessionId)}/claim`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    let message = `Could not finish signing in (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch { /* non-JSON body — fall through */ }
    const err = new Error(message) as Error & { code: string };
    err.code = 'claim_failed';
    throw err;
  }
}

const PROOF_QR_PREFIX = 'za:proof:1:';

// ─── The page ──────────────────────────────────────────────────

export default function SignIn() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, { phase: 'credentials' });
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
  // Covers both the QR flow (`pending`) and the password-first push
  // flow (`awaiting_approval`) — same pairing session either way.
  useEffect(() => {
    const sessionId =
      state.phase === 'pending' || state.phase === 'awaiting_approval'
        ? state.sessionId
        : null;
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

    // NOTE: the backend route is `/events` (src/routes/demo-portal.ts).
    // This previously pointed at `/stream`, which 404'd — so the SSE
    // channel never connected and the desktop could only sign in via the
    // manual webcam/paste fallback. With the phone-push flow the phone
    // POSTs its proof directly; this stream is how the desktop hears
    // "you're in" and auto-navigates to the dashboard.
    const url = `/api/demo-portal/sessions/${encodeURIComponent(sessionId)}/events`;
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
      // Phone-push: the proof was submitted by the phone, so the demo
      // cookie was set on the PHONE's response — the desktop has none
      // yet. Claim it on a desktop-originated request before navigating,
      // otherwise /me on the dashboard 401s. Idempotent: if the SSE
      // Phase-1 fast path already delivered the cookie, this just
      // re-mints the same one.
      void claimSession(sessionId)
        .then(() => {
          dispatch({ type: 'sse_bound', userEmail: ev.userEmail ?? 'demo user' });
        })
        .catch((err: Error & { code?: string }) => {
          dispatch({
            type: 'sse_error',
            code: err.code ?? 'claim_failed',
            message: err.message ?? 'Could not finish signing in. Try again.',
          });
        });
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
  }, [
    state.phase === 'pending' || state.phase === 'awaiting_approval'
      ? state.sessionId
      : null,
  ]);

  // 1Hz countdown — visual only; SSE remains the source of truth.
  useEffect(() => {
    if (state.phase !== 'pending' && state.phase !== 'awaiting_approval') return;
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
          <p className="text-sm text-slate-600">{subtitleFor(state.phase)}</p>
        </header>

        {state.phase === 'credentials' && (
          <CredentialsForm
            onSuccess={(payload) => dispatch({ type: 'login_succeeded', payload })}
            onUseQr={() => dispatch({ type: 'use_qr_flow' })}
          />
        )}
        {(state.phase === 'idle' || state.phase === 'creating') && <PendingState />}
        {state.phase === 'pending' && (
          <>
            <PendingCard qrPayload={state.qrPayload} secondsLeft={state.secondsLeft} />
            <ProofCaptureCard
              sessionId={state.sessionId}
              onBound={() => dispatch({ type: 'sse_bound', userEmail: 'demo user' })}
            />
            <button
              type="button"
              onClick={() => dispatch({ type: 'restart' })}
              className="mt-4 text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
              data-testid="signin-use-password"
            >
              Use email &amp; password instead
            </button>
          </>
        )}
        {state.phase === 'awaiting_approval' && (
          <ApprovalCard
            qrPayload={state.qrPayload}
            secondsLeft={state.secondsLeft}
            onCancel={() => dispatch({ type: 'restart' })}
          />
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
          First time?{' '}
          <Link to="/signup" className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">
            Open an account
          </Link>{' '}
          — takes a minute with ZeroAuth.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function subtitleFor(phase: SignInPhase['phase']): string {
  switch (phase) {
    case 'credentials':
      return 'Enter your email and password — then approve on your phone.';
    case 'awaiting_approval':
      return 'Password accepted. One approval left on your phone.';
    case 'success':
      return 'Verified with a zero-knowledge proof.';
    case 'expired':
    case 'error':
      return 'Something interrupted the sign-in.';
    default:
      // idle / creating / pending — the QR ceremony.
      return 'Open ZeroAuth, tap Sign in, scan this code.';
  }
}

// ─── Password-first form (bank first factor) ───────────────────

interface CredentialsFormProps {
  onSuccess: (payload: BankLoginResponse) => void;
  onUseQr: () => void;
}

type CredentialsError =
  | { kind: 'inline'; message: string }
  | { kind: 'enrollment_pending'; message: string };

function mapLoginError(err: unknown): CredentialsError {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return { kind: 'inline', message: 'Incorrect email or password.' };
      case 'enrollment_pending':
        return {
          kind: 'enrollment_pending',
          message: 'This account hasn’t finished ZeroAuth enrollment yet.',
        };
      case 'account_locked':
        return {
          kind: 'inline',
          message: 'This account is locked after repeated failed attempts. Try again later.',
        };
      case 'too_many_pending_sessions':
        return {
          kind: 'inline',
          message: 'Too many sign-in requests are already pending. Wait a moment, then try again.',
        };
      default:
        return { kind: 'inline', message: err.message || 'Sign-in failed. Try again.' };
    }
  }
  return {
    kind: 'inline',
    message: (err as Error)?.message || 'Sign-in failed. Try again.',
  };
}

function CredentialsForm({ onSuccess, onUseQr }: CredentialsFormProps): ReactNode {
  const [customerId, setCustomerId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<CredentialsError | null>(null);

  const canSubmit = customerId.trim().length > 0 && password.length > 0 && !submitting;

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = await bankLogin({ customerId: customerId.trim(), password });
      onSuccess(payload);
    } catch (err) {
      setError(mapLoginError(err));
      setSubmitting(false);
    }
    // On success the component unmounts (phase → awaiting_approval);
    // no need to reset `submitting`.
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-left" data-testid="signin-credentials">
      <Field
        id="signin-email"
        label="Email"
        type="email"
        autoComplete="username"
        value={customerId}
        onChange={setCustomerId}
        placeholder="asha@example.com"
        autoFocus
      />
      <Field
        id="signin-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        placeholder="Your NeoBank password"
      />

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          data-testid="signin-credentials-error"
        >
          <p>{error.message}</p>
          {error.kind === 'enrollment_pending' && (
            <p className="mt-1">
              <Link to="/signup" className="font-medium underline underline-offset-2">
                Finish opening your account
              </Link>{' '}
              to activate sign-in.
            </p>
          )}
        </div>
      )}

      <Button
        type="submit"
        size="md"
        loading={submitting}
        disabled={!canSubmit}
        className="w-full"
        data-testid="signin-credentials-submit"
      >
        {submitting ? 'Checking…' : 'Continue'}
      </Button>

      <p className="text-center">
        <button
          type="button"
          onClick={onUseQr}
          className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
          data-testid="signin-use-qr"
        >
          Sign in by QR instead
        </button>
      </p>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
}

function Field({ id, label, value, onChange, type = 'text', placeholder, autoFocus, autoComplete }: FieldProps): ReactNode {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-700">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
      />
    </label>
  );
}

// ─── Awaiting approval (second factor on the phone) ────────────

interface ApprovalCardProps {
  qrPayload: string;
  secondsLeft: number;
  onCancel: () => void;
}

function ApprovalCard({ qrPayload, secondsLeft, onCancel }: ApprovalCardProps): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4" data-testid="signin-awaiting-approval">
      <div className="flex h-[180px] flex-col items-center justify-center gap-4">
        <PhonePulseGlyph />
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Approve the sign-in in your ZeroAuth app
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            We sent an approval request to your enrolled phone. Verify with your
            face there — nothing biometric touches this browser.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
        <span
          className="size-2 animate-pulse rounded-full"
          style={{ backgroundColor: secondsLeft > 30 ? '#10b981' : '#f59e0b' }}
        />
        Request expires in {formatCountdown(secondsLeft)}
      </div>

      <details className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
        <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
          Phone not receiving it? Scan this QR
        </summary>
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="signin-approval-qr">
            <QRCodeCanvas value={qrPayload} size={192} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f172a" />
          </div>
          <p className="text-xs text-slate-500">
            Open ZeroAuth, tap Sign in, and scan — same session, same approval.
          </p>
        </div>
      </details>

      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
        data-testid="signin-approval-cancel"
      >
        Cancel and start over
      </button>
    </div>
  );
}

/** Pulsing phone with radiating rings — "look at your handset" cue. */
function PhonePulseGlyph(): ReactNode {
  return (
    <div className="relative grid size-20 place-items-center" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-slate-200/70 [animation-duration:1.8s]" />
      <span className="absolute inset-2 animate-ping rounded-full bg-slate-200 [animation-delay:0.4s] [animation-duration:1.8s]" />
      <span className="relative grid size-12 place-items-center rounded-2xl bg-slate-900 text-white shadow-lg">
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      </span>
    </div>
  );
}

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

// ─── Proof-QR capture (paste + optional webcam) ────────────────────────
//
// The "air-gap loop without a webcam" path: after the phone generates
// the Groth16 proof and renders it as a QR, the operator either pastes
// the QR text into this textarea OR holds the phone up to the laptop
// camera and the browser's BarcodeDetector reads it. Either way, the
// raw `za:proof:1:...` string goes to /api/demo-portal/submit-proof,
// the server decodes the embedded CBOR + Groth16 proof, runs the full
// submitProof crypto chain, and on success mints the demo_portal
// session cookie inline. The SSE stream may also fire `session_bound`
// independently — both paths end at /dashboard.
//
// We DON'T pull a QR-decoding library into the demo-portal bundle. The
// native BarcodeDetector API is enough for Chromium + Safari 17+ — for
// every other browser the paste textarea is the supported path.

interface ProofCaptureCardProps {
  sessionId: string;
  onBound: () => void;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorLike;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

function ProofCaptureCard({ sessionId, onBound }: ProofCaptureCardProps): ReactNode {
  const navigate = useNavigate();
  const [pasteValue, setPasteValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ code: string; message: string } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const detectedRef = useRef(false);

  // Submit handler — shared by paste + webcam paths. Throws errors back
  // to the caller as `code` + `message` so the UI can branch on the
  // documented submitProof failure classes.
  const submit = useCallback(
    async (qrPayload: string): Promise<void> => {
      if (submitting) return;
      const trimmed = qrPayload.trim();
      if (!trimmed.startsWith(PROOF_QR_PREFIX)) {
        setSubmitError({
          code: 'invalid_payload',
          message: `Expected a payload starting with "${PROOF_QR_PREFIX}".`,
        });
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submitProofPayload(sessionId, trimmed);
        onBound();
        // Brief delay so the operator sees the "Welcome back" splash
        // before /dashboard renders. SSE may also fire — both are safe.
        window.setTimeout(() => navigate('/dashboard'), 1000);
      } catch (err) {
        const e = err as { code?: string; message?: string };
        setSubmitError({
          code: e.code ?? 'proof_failed',
          message: e.message ?? 'Proof submission failed.',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [sessionId, submitting, onBound, navigate],
  );

  // Webcam teardown — used by both stop button + unmount.
  const stopCamera = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        try { t.stop(); } catch { /* best-effort */ }
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const startCamera = useCallback(async () => {
    if (cameraActive) return;
    setCameraError(null);
    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setCameraError(
        "This browser can't scan QRs natively. Paste the code from your phone instead.",
      );
      return;
    }
    try {
      detectorRef.current = new Ctor({ formats: ['qr_code'] });
    } catch {
      setCameraError(
        "This browser can't scan QRs natively. Paste the code from your phone instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      detectedRef.current = false;
      setCameraActive(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch { /* best-effort */ }
      }
      intervalRef.current = setInterval(async () => {
        if (detectedRef.current) return;
        const v = videoRef.current;
        const c = canvasRef.current;
        const d = detectorRef.current;
        if (!v || !c || !d || v.readyState < 2) return;
        const vw = v.videoWidth || 640;
        const vh = v.videoHeight || 480;
        if (c.width !== vw) c.width = vw;
        if (c.height !== vh) c.height = vh;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, vw, vh);
        let hits: Array<{ rawValue: string }> = [];
        try {
          hits = await d.detect(c);
        } catch {
          return;
        }
        if (detectedRef.current) return;
        for (const hit of hits) {
          const text = (hit?.rawValue ?? '').trim();
          if (!text.startsWith(PROOF_QR_PREFIX)) continue;
          detectedRef.current = true;
          stopCamera();
          void submit(text);
          return;
        }
      }, 250);
    } catch (err) {
      const e = err as Error;
      const denied = /Permission|NotAllowed|denied/i.test(`${e.name} ${e.message}`);
      setCameraError(
        denied
          ? 'Camera access was denied. Allow access in your browser settings or paste the code instead.'
          : e.message || 'Camera unavailable. Paste the code instead.',
      );
      setCameraActive(false);
    }
  }, [cameraActive, stopCamera, submit]);

  const onPasteSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void submit(pasteValue);
    },
    [submit, pasteValue],
  );

  const supportsNativeQr = getBarcodeDetectorCtor() !== null;

  return (
    <details
      className="mt-6 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
      data-testid="signin-proof-capture"
    >
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
        Phone offline? Capture its proof-QR here instead
      </summary>
      <div className="mt-3 space-y-3 text-sm text-slate-700">
        <p className="text-xs text-slate-500">
          Normally your phone sends the proof itself and this page signs in automatically —
          just tap <span className="font-medium">Authorize sign-in</span> on the handset.
          {' '}If your phone has no internet, tap “No internet on phone?” there to show a QR,
          then scan it with the laptop camera or paste the text below.
        </p>

        {supportsNativeQr && (
          <div className="space-y-2">
            {!cameraActive && (
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={submitting}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="signin-scan-start"
              >
                Use laptop camera
              </button>
            )}
            {cameraActive && (
              <div className="space-y-2">
                <div className="relative overflow-hidden rounded-md border border-slate-300 bg-black" style={{ maxWidth: 320 }}>
                  <video
                    ref={videoRef}
                    style={{ transform: 'scaleX(-1)', width: '100%', height: 'auto', display: 'block' }}
                    playsInline
                    muted
                    autoPlay
                    aria-label="Webcam preview for QR scanning"
                    data-testid="signin-scan-video"
                  />
                  <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
                </div>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100"
                >
                  Stop camera
                </button>
              </div>
            )}
            {cameraError && (
              <p className="text-xs text-amber-600">{cameraError}</p>
            )}
          </div>
        )}

        <form onSubmit={onPasteSubmit} className="space-y-2">
          <label htmlFor="signin-proof-paste" className="block text-xs font-medium text-slate-700">
            Or paste the proof text from your phone
          </label>
          <textarea
            id="signin-proof-paste"
            data-testid="signin-proof-paste"
            value={pasteValue}
            onChange={(ev) => setPasteValue(ev.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="za:proof:1:..."
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-[11px] text-slate-800 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={submitting || pasteValue.trim().length === 0}
            data-testid="signin-proof-submit"
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Submit proof'}
          </button>
        </form>

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            data-testid="signin-proof-error"
          >
            <p>{submitError.message}</p>
            <code className="mt-1 block font-mono text-[10px] text-rose-500">{submitError.code}</code>
          </div>
        )}
      </div>
    </details>
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
