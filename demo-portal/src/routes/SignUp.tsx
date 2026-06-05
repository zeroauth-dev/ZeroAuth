import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';

/**
 * NeoBank /signup — investor-facing three-QR registration page.
 *
 * Calls POST /api/demo-portal/signup-init to open a registration
 * session and get QR1's deeplink (`zeroauth://reg?step=pair&...`).
 * Polls GET /api/demo-portal/signup/:id every second to advance
 * through state transitions:
 *
 *   awaiting_device       → render QR1 (pair)
 *   awaiting_commitment   → render QR2 (enroll)
 *   awaiting_verification → render QR3 (verify + challenge_nonce)
 *   completed             → redirect to /signin so they can log in
 *
 * Each QR is rendered fresh from the server-supplied deeplink. The
 * user scans QR1 with the ZeroAuth app → phone calls /pair-device →
 * server mints enroll_code → SPA's next poll sees QR2 → user scans →
 * /submit-commitment → QR3 → /complete. End-to-end real ceremony.
 */
type State = 'awaiting_device' | 'awaiting_commitment' | 'awaiting_verification' | 'completed' | 'failed';

const STEP_LABEL: Record<State, string> = {
  awaiting_device: 'Scan 1 of 3 — pair this device',
  awaiting_commitment: 'Scan 2 of 3 — capture biometric',
  awaiting_verification: 'Scan 3 of 3 — prove identity',
  completed: 'Account created',
  failed: 'Registration failed',
};

const STEP_HELP: Record<State, string> = {
  awaiting_device: 'Open the ZeroAuth app, tap "Create a new account (3-QR signup)", then point your camera at the code below.',
  awaiting_commitment: 'Great. Now scan this second code — your phone will capture your biometric locally and derive a zero-knowledge commitment.',
  awaiting_verification: 'Final scan. Your phone generates a Groth16 proof that you own the biometric, without revealing it.',
  completed: 'Welcome to NeoBank. Redirecting you to sign in…',
  failed: 'Something went wrong. Refresh to start over.',
};

export default function SignUp() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [currentDeeplink, setCurrentDeeplink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open the registration session once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-portal/signup-init', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!res.ok) throw new Error(`signup-init failed: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setSessionId(data.session_id);
        setCurrentDeeplink(data.pair_deeplink);
        setState('awaiting_device');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll session state once we have a session.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/demo-portal/signup/${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setState(data.state);
        if (data.currentDeeplink) setCurrentDeeplink(data.currentDeeplink);
        if (data.state === 'completed') {
          setTimeout(() => navigate('/signin'), 1500);
        }
      } catch { /* keep polling */ }
    };
    const id = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [sessionId, navigate]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-rose-600">
          NeoBank · sign up
        </p>
        <h1 className="mt-4 font-display text-3xl font-medium">Could not start signup</h1>
        <p className="mt-4 text-sm text-slate-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
        NeoBank · open an account
      </p>
      <h1 className="mt-4 font-display text-3xl font-medium">
        {state ? STEP_LABEL[state] : 'Preparing…'}
      </h1>
      <p className="mt-4 text-slate-600">
        {state ? STEP_HELP[state] : 'Opening a fresh registration session against ZeroAuth…'}
      </p>

      <div className="mt-8 flex justify-center rounded-2xl border border-slate-200 bg-white p-8">
        {currentDeeplink && state !== 'completed' ? (
          <QRCodeCanvas
            value={currentDeeplink}
            size={256}
            level="M"
            marginSize={2}
            bgColor="#ffffff"
            fgColor="#0f172a"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center text-slate-400">
            {state === 'completed' ? '✓ Done' : 'Loading…'}
          </div>
        )}
      </div>

      <p className="mt-6 text-center font-mono text-xs uppercase tracking-wider text-slate-400">
        {state === 'awaiting_device' && 'Step 1 / 3'}
        {state === 'awaiting_commitment' && 'Step 2 / 3'}
        {state === 'awaiting_verification' && 'Step 3 / 3'}
        {state === 'completed' && 'Done · redirecting to sign in'}
      </p>

      <p className="mt-12 text-center text-xs text-slate-400">
        Every scan triggers a real ZeroAuth API call. Your biometric never leaves
        your phone — only a zero-knowledge proof does.
      </p>
    </main>
  );
}
