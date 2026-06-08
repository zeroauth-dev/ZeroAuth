import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';

/**
 * NeoBank /signup — "open an account" → details → create ZeroAuth identity.
 *
 * Two real phases, no fakes:
 *
 *   1. DETAILS — the applicant enters name, email, phone (exactly like
 *      opening any bank account). On submit we POST those to
 *      /api/demo-portal/signup-init, which opens a real registration
 *      session against the ZeroAuth tenant and stores the details on the
 *      created user's profile.
 *
 *   2. ZEROAUTH — the three-QR ceremony. We poll
 *      /api/demo-portal/signup/:id and render QR1→QR2→QR3 as the phone
 *      advances (pair → capture face → prove with a Groth16 proof).
 *      On `completed` the account exists; we route to sign-in.
 *
 * Every QR triggers a real ZeroAuth API call; the biometric never leaves
 * the phone — only zero-knowledge proofs cross the wire.
 */
type Phase = 'details' | 'ceremony';
type State = 'awaiting_device' | 'awaiting_commitment' | 'awaiting_verification' | 'completed' | 'failed';

const ACCENT = '#0066FF';

const STEP_LABEL: Record<State, string> = {
  awaiting_device: 'Scan 1 of 3 — pair your phone',
  awaiting_commitment: 'Scan 2 of 3 — capture your face',
  awaiting_verification: 'Scan 3 of 3 — prove it’s you',
  completed: 'Account created',
  failed: 'Registration failed',
};
const STEP_HELP: Record<State, string> = {
  awaiting_device: 'Open the ZeroAuth app, tap “Create your ZeroAuth identity”, then scan the code below.',
  awaiting_commitment: 'Now scan this code — your phone captures your face locally and derives a zero-knowledge commitment.',
  awaiting_verification: 'Final scan. Your phone generates a Groth16 proof that you own your face — without revealing it.',
  completed: 'Welcome to NeoBank. Taking you to sign in…',
  failed: 'Something went wrong. Refresh to start over.',
};

export default function SignUp() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('details');

  // form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ceremony
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [currentDeeplink, setCurrentDeeplink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const formValid = name.trim().length >= 2 && emailValid;

  async function openAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/demo-portal/signup-init', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim() }),
      });
      if (!res.ok) throw new Error(`Could not start signup (${res.status})`);
      const data = await res.json();
      setSessionId(data.session_id);
      setCurrentDeeplink(data.pair_deeplink);
      setState('awaiting_device');
      setPhase('ceremony');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Poll session state once the ceremony begins.
  useEffect(() => {
    if (phase !== 'ceremony' || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/demo-portal/signup/${sessionId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setState(data.state);
        if (data.currentDeeplink) setCurrentDeeplink(data.currentDeeplink);
        if (data.state === 'completed') setTimeout(() => navigate('/signin'), 1600);
      } catch { /* keep polling */ }
    };
    const id = window.setInterval(tick, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [phase, sessionId, navigate]);

  // ─── Phase 1: details form ───────────────────────────────────────
  if (phase === 'details') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <button onClick={() => navigate('/')} className="mb-8 self-start text-sm text-slate-400 hover:text-slate-600">← NeoBank</button>
        <p className="font-mono text-xs uppercase tracking-widest text-slate-500">Open an account</p>
        <h1 className="mt-3 font-display text-4xl font-medium leading-tight">A few details, then your face.</h1>
        <p className="mt-3 text-slate-600">No password to invent. You’ll finish in seconds by verifying with ZeroAuth on your phone.</p>

        <form onSubmit={openAccount} className="mt-8 space-y-4">
          <Field label="Full name" value={name} onChange={setName} placeholder="Asha Sharma" autoFocus />
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="asha@example.com"
                 invalid={email.length > 0 && !emailValid} />
          <Field label="Phone (optional)" type="tel" value={phone} onChange={setPhone} placeholder="+91 98765 43210" />

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={!formValid || submitting}
            className="mt-2 w-full rounded-xl px-5 py-4 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: ACCENT }}
          >
            {submitting ? 'Starting…' : 'Continue with ZeroAuth →'}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-slate-400">
          Your biometric never leaves your phone. NeoBank only ever receives a
          zero-knowledge proof — never your face.
        </p>
      </main>
    );
  }

  // ─── Phase 2: ZeroAuth three-QR ceremony ─────────────────────────
  const order: State[] = ['awaiting_device', 'awaiting_commitment', 'awaiting_verification'];
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
        NeoBank · verify with ZeroAuth
      </p>
      <h1 className="mt-3 font-display text-3xl font-medium">
        {state ? STEP_LABEL[state] : 'Preparing…'}
      </h1>
      <p className="mt-3 text-slate-600">
        {state ? STEP_HELP[state] : 'Opening a fresh registration session against ZeroAuth…'}
      </p>

      <div className="mt-8 flex justify-center rounded-2xl border border-slate-200 bg-white p-8">
        {currentDeeplink && state !== 'completed' ? (
          <QRCodeCanvas value={currentDeeplink} size={256} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f172a" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center text-3xl text-emerald-500">
            {state === 'completed' ? '✓' : <span className="text-base text-slate-400">Loading…</span>}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2">
        {order.map((s, i) => {
          const done = state === 'completed' || order.indexOf(state as State) > i;
          const active = state === s;
          return <span key={s} className="h-1.5 rounded-full transition-all"
            style={{ width: active ? 34 : 22, backgroundColor: done || active ? ACCENT : '#e2e8f0' }} />;
        })}
        <span className="ml-2 font-mono text-xs uppercase tracking-wider text-slate-400">
          {state === 'completed' ? 'done' : `step ${Math.max(1, order.indexOf(state as State) + 1)} / 3`}
        </span>
      </div>

      <p className="mt-10 text-center text-xs text-slate-400">
        Every scan triggers a real ZeroAuth API call. Your biometric never leaves
        your phone — only a zero-knowledge proof does.
      </p>
    </main>
  );
}

interface FieldProps {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; autoFocus?: boolean; invalid?: boolean;
}
function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, invalid }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border bg-white px-4 py-3 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
          invalid ? 'border-rose-300 focus:ring-rose-200' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-100'
        }`}
      />
    </label>
  );
}
