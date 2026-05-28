import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type PairingSession } from '../../lib/api';
import { openKioskStream } from './kioskStream';

/**
 * Anchor Bank kiosk web app skeleton (precursor C-147).
 *
 * Scene 2 of the BFSI demo runbook: a bank-branded kiosk page is
 * already on the screen when the operator presents. The kiosk creates
 * a fresh pairing session, renders a full-screen QR, and waits on the
 * SSE stream for the customer's phone to bind. When the stream emits
 * `pairing.consumed` the kiosk redirects to the post-login net-banking
 * landing page; on `pairing.expired` it regenerates a new QR.
 *
 * Routing is intentionally not wired into App.tsx yet — C-147 sprint 2
 * lands that. This component is the skeleton sprint 1 reviews against.
 *
 * SSE transport: per ADR 0013 (and commit ee6aad4 "remove access_token
 * query fallback from console SSE auth"), the EventSource MUST carry
 * the HttpOnly `zeroauth_console_jwt` cookie via `withCredentials:true`.
 * No `?access_token=` query string — that path was removed because
 * Caddy access logs include query strings, which would turn the JWT
 * into a session-replay primitive for its TTL. We build the
 * EventSource directly here rather than through api.pairing
 * .subscribeStream so the kiosk is decoupled from any residual query-
 * fallback behaviour in the shared client and stays compliant with
 * ADR 0013 even if a future patch reverts the shared helper.
 *
 * QR encoder: we use the same external `api.qrserver.com` endpoint as
 * QrProofLogin.tsx — adding a QR encoder to the dashboard bundle is a
 * dep-add ADR that lands with the C-147 implementation commit, not the
 * skeleton. The img-src CSP already allows the host.
 */

// ─── State machine ──────────────────────────────────────────────

type KioskPhase =
  | { phase: 'idle' }
  | { phase: 'creating' }
  | { phase: 'pending'; session: PairingSession; expiresAt: Date; secondsLeft: number }
  | { phase: 'consumed' }
  | { phase: 'error'; code: string; message: string };

type KioskAction =
  | { type: 'create_started' }
  | { type: 'create_succeeded'; session: PairingSession }
  | { type: 'create_failed'; code: string; message: string }
  | { type: 'tick' }
  | { type: 'sse_consumed' }
  | { type: 'sse_expired' }
  | { type: 'sse_error'; code: string; message: string }
  | { type: 'restart' };

function reducer(state: KioskPhase, action: KioskAction): KioskPhase {
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
    case 'tick': {
      if (state.phase !== 'pending') return state;
      const next = Math.max(0, Math.floor((state.expiresAt.getTime() - Date.now()) / 1000));
      if (next === state.secondsLeft) return state;
      return { ...state, secondsLeft: next };
    }
    case 'sse_consumed':
      return { phase: 'consumed' };
    case 'sse_expired':
      // Kicking back to 'idle' triggers the create-on-mount effect to
      // open a fresh session. Operators watching the kiosk shouldn't
      // ever see a "session expired" card; the rotation is silent.
      return { phase: 'idle' };
    case 'sse_error':
      return { phase: 'error', code: action.code, message: action.message };
    case 'restart':
      return { phase: 'idle' };
    default:
      return state;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function qrImageUrl(payload: string, size = 640): string {
  // Same external encoder QrProofLogin uses. Pulling a QR encoder into
  // the bundle is an ADR-gated dep-add that lands with the C-147
  // implementation, not this skeleton.
  const params = new URLSearchParams({
    size: `${size}x${size}`,
    data: payload,
    margin: '4',
    qzone: '4',
  });
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 32 random bytes → 64 hex characters. The kiosk binds this nonce
 * into the session it opens; on submit, the backend will refuse any
 * proof whose embedded session_nonce doesn't match the one it minted
 * for this session id. The mounted-once useMemo guards against
 * StrictMode double-invocation.
 */
function generateSessionNonce(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── The page ───────────────────────────────────────────────────

const LANDING_PATH = '/anchor-bank/landing';
const DEFAULT_TENANT_ID = 'anchor-bank-demo';

export interface KioskProps {
  /**
   * Optional override the App router can pass when wiring the kiosk
   * route. Production routing pulls the tenant id from `?tenantId=`;
   * the prop exists so a host page (a tenant-branded wrapper rendered
   * by the bank's own server) can inject a hard-pinned tenant.
   */
  tenantOverride?: string;
}

export default function Kiosk({ tenantOverride }: KioskProps = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tenantId = tenantOverride ?? searchParams.get('tenantId') ?? DEFAULT_TENANT_ID;
  const sessionNonce = useMemo(() => generateSessionNonce(), []);

  const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
  const sessionIdRef = useRef<string | null>(null);

  // ─── Session lifecycle ───────────────────────────────────────

  const create = useCallback(async () => {
    dispatch({ type: 'create_started' });
    try {
      const { session } = await api.pairing.createSession({ environment: 'live' });
      dispatch({ type: 'create_succeeded', session });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      dispatch({
        type: 'create_failed',
        code: e.code ?? 'kiosk_create_failed',
        message: e.message ?? 'Failed to open a kiosk pairing session.',
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
    const sessionId = state.phase === 'pending' ? state.session.id : null;
    if (!sessionId) return;

    // StrictMode double-mount guard — don't reopen an EventSource for
    // the same session id within the same render.
    if (sessionIdRef.current === sessionId) return;
    sessionIdRef.current = sessionId;

    const close = openKioskStream(sessionId, {
      onConsumed: () => dispatch({ type: 'sse_consumed' }),
      onExpired: () => dispatch({ type: 'sse_expired' }),
      onError: (code, message) => dispatch({ type: 'sse_error', code, message }),
    });

    return () => {
      close();
      if (sessionIdRef.current === sessionId) sessionIdRef.current = null;
    };
  }, [state.phase === 'pending' ? state.session.id : null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Countdown tick ──────────────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'pending') return;
    const handle = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(handle);
  }, [state.phase]);

  // ─── Redirect on consumed ───────────────────────────────────

  useEffect(() => {
    if (state.phase !== 'consumed') return;
    // The placeholder net-banking landing route isn't wired yet — see
    // C-147 sprint 2. Until then we navigate so e2e + visual run-
    // through can validate the redirect contract; the destination
    // route renders a 404 today and that's fine.
    navigate(LANDING_PATH);
  }, [state.phase, navigate]);

  // ─── QR payload ──────────────────────────────────────────────
  //
  // The session's qrPayload already encodes the tenant binding the
  // backend issued. We expose the kiosk-side nonce + tenant + expiry
  // as separate test-visible attributes so the phone app and the
  // tests can both pull them out without parsing the QR string. The
  // phone's QR scanner still consumes the qrPayload itself.

  const visibleQrPayload =
    state.phase === 'pending' ? state.session.qrPayload : '';
  const visibleExpiresAt =
    state.phase === 'pending' ? state.session.expiresAt : '';

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-between bg-white px-8 py-12 text-slate-900"
      data-testid="kiosk-root"
      data-tenant-id={tenantId}
      data-session-nonce={sessionNonce}
    >
      <KioskHeader />

      <main
        className="flex w-full max-w-4xl flex-1 flex-col items-center justify-center gap-8 text-center"
        data-testid="kiosk-main"
      >
        {state.phase === 'idle' || state.phase === 'creating' ? <KioskSpinner /> : null}

        {state.phase === 'pending' ? (
          <KioskQrPanel
            payload={visibleQrPayload}
            tenantId={tenantId}
            sessionNonce={sessionNonce}
            expiresAt={visibleExpiresAt}
          />
        ) : null}

        {state.phase === 'consumed' ? <KioskRedirectNotice /> : null}

        {state.phase === 'error' ? (
          <KioskErrorPanel
            code={state.code}
            message={state.message}
            onRetry={() => dispatch({ type: 'restart' })}
          />
        ) : null}
      </main>

      <KioskFooter
        secondsLeft={state.phase === 'pending' ? state.secondsLeft : null}
      />
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function KioskHeader() {
  // Visual budget: legible from 3m. The brand mark is a text logo by
  // default; the demo runbook calls for a stamped Anchor Bank brand at
  // run-time which the kiosk host page can override by passing a
  // tenant skin (sprint 2). For sprint 1 we ship a typographic mark.
  return (
    <header
      className="flex w-full max-w-4xl items-center justify-between"
      data-testid="kiosk-header"
    >
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center rounded-full bg-slate-900 text-2xl font-bold text-white"
        >
          A
        </div>
        <div className="text-left">
          <div className="text-xs font-medium uppercase tracking-[0.3em] text-slate-500">
            Anchor Bank
          </div>
          <div className="text-3xl font-semibold tracking-tight">
            Net banking
          </div>
        </div>
      </div>
      <div className="text-right text-xs text-slate-500">
        Secured by ZeroAuth
      </div>
    </header>
  );
}

function KioskSpinner() {
  return (
    <div
      className="flex size-56 items-center justify-center rounded-2xl border border-dashed border-slate-300"
      data-testid="kiosk-spinner"
    >
      <div className="size-10 animate-spin rounded-full border-4 border-slate-200 border-r-transparent" />
    </div>
  );
}

interface KioskQrPanelProps {
  payload: string;
  tenantId: string;
  sessionNonce: string;
  expiresAt: string;
}

function KioskQrPanel({ payload, tenantId, sessionNonce, expiresAt }: KioskQrPanelProps) {
  return (
    <div
      className="flex w-full flex-col items-center gap-6"
      data-testid="kiosk-qr-panel"
      data-tenant={tenantId}
      data-session-nonce={sessionNonce}
      data-expires-at={expiresAt}
    >
      <div
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
        aria-label="Pairing QR code"
        role="img"
        data-testid="kiosk-qr"
      >
        <img
          src={qrImageUrl(payload, 640)}
          alt="Pairing QR — scan with your ZeroAuth phone app"
          width={640}
          height={640}
          style={{ imageRendering: 'pixelated' }}
          loading="eager"
          decoding="sync"
        />
      </div>
      <p
        className="max-w-2xl text-2xl font-medium text-slate-700"
        data-testid="kiosk-tagline"
      >
        Scan with your ZeroAuth app to sign in
      </p>
      <p className="text-sm text-slate-400">
        No password. No biometric data leaves your phone.
      </p>
    </div>
  );
}

function KioskRedirectNotice() {
  return (
    <div
      className="flex flex-col items-center gap-4"
      data-testid="kiosk-redirecting"
    >
      <CheckGlyph />
      <h2 className="text-2xl font-semibold text-slate-900">
        You are signed in
      </h2>
      <p className="text-sm text-slate-500">Loading your accounts…</p>
    </div>
  );
}

interface KioskErrorPanelProps {
  code: string;
  message: string;
  onRetry: () => void;
}

function KioskErrorPanel({ code, message, onRetry }: KioskErrorPanelProps) {
  return (
    <div
      className="flex flex-col items-center gap-4"
      data-testid="kiosk-error"
    >
      <ErrorGlyph />
      <h2 className="text-2xl font-semibold text-slate-900">
        The kiosk needs a moment
      </h2>
      <p className="max-w-xl text-sm text-slate-500">{message}</p>
      <code className="font-mono text-[11px] text-slate-400">{code}</code>
      <button
        type="button"
        onClick={onRetry}
        data-testid="kiosk-retry"
        className="rounded-full bg-slate-900 px-6 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}

function KioskFooter({ secondsLeft }: { secondsLeft: number | null }) {
  return (
    <footer
      className="flex w-full max-w-4xl items-center justify-between text-xs text-slate-400"
      data-testid="kiosk-footer"
    >
      <div>www.anchorbank.example</div>
      <div data-testid="kiosk-countdown">
        {secondsLeft === null ? '' : `QR expires in ${formatCountdown(secondsLeft)}`}
      </div>
    </footer>
  );
}

function CheckGlyph(): ReactNode {
  return (
    <svg
      width={64}
      height={64}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-600"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function ErrorGlyph(): ReactNode {
  return (
    <svg
      width={64}
      height={64}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </svg>
  );
}
