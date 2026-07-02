import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ApiError,
  bankSignup,
  bankSignupStatus,
  type BankSignupState,
} from '../lib/api';

/**
 * NeoBank /signup — "open an account" → details + password → ZeroAuth 2FA.
 *
 * Two real phases, no fakes:
 *
 *   1. DETAILS — the applicant enters name, email and picks a password
 *      (the bank's own first factor, scrypt-hashed server-side). On
 *      submit we POST to /api/demo-portal/bank/signup, which creates the
 *      pending bank account AND opens a real ZeroAuth enrollment
 *      ceremony in one shot.
 *
 *   2. ZEROAUTH — the three-QR ceremony. We poll
 *      /api/demo-portal/bank/signup/:id and render QR1→QR2→QR3 as the
 *      phone advances (pair → capture face → prove with a Groth16
 *      proof). On `completed` the ceremony's DID binds onto the bank
 *      account (accountStatus → active); we show success and route to
 *      sign-in.
 *
 * Every QR triggers a real ZeroAuth API call; the biometric never leaves
 * the phone — only zero-knowledge proofs cross the wire.
 */
type Phase = 'details' | 'ceremony';
type State = BankSignupState;

const ACCENT = '#0066FF';

const STEP_LABEL: Record<State, string> = {
  awaiting_device: 'Scan 1 of 3 — pair your phone',
  awaiting_commitment: 'Scan 2 of 3 — capture your face',
  awaiting_verification: 'Scan 3 of 3 — prove it’s you',
  completed: 'Account created — secured by ZeroAuth',
  failed: 'Registration failed',
};
const STEP_HELP: Record<State, string> = {
  awaiting_device: 'Open the ZeroAuth app, tap “Create your ZeroAuth identity”, then scan the code below.',
  awaiting_commitment: 'Now scan this code — your phone captures your face locally and derives a zero-knowledge commitment.',
  awaiting_verification: 'Final scan. Your phone generates a Groth16 proof that you own your face — without revealing it.',
  completed: 'Your face is now the second factor on every sign-in. Taking you to sign in…',
  failed: 'Something went wrong. Refresh to start over.',
};

function passwordStrong(pw: string): boolean {
  return pw.length >= 8 && /[a-zA-Z]/.test(pw) && /[0-9]/.test(pw);
}

export default function SignUp() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('details');

  // form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ceremony
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [currentDeeplink, setCurrentDeeplink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const passwordValid = passwordStrong(password);
  const confirmValid = confirm === password;
  const formValid = name.trim().length >= 2 && emailValid && passwordValid && confirmValid;

  async function openAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await bankSignup({
        name: name.trim(),
        customerId: email.trim(),
        password,
      });
      setSessionId(data.signupId);
      setCurrentDeeplink(data.pairDeeplink);
      setState('awaiting_device');
      setPhase('ceremony');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'customer_id_taken') {
        setError('An account already exists for that email. Try signing in instead.');
      } else if (err instanceof ApiError && err.code === 'weak_password') {
        setError('Password must be 8+ characters with at least one letter and one digit.');
      } else {
        setError((err as Error).message || 'Could not start signup.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Poll ceremony state once the ceremony begins.
  useEffect(() => {
    if (phase !== 'ceremony' || !sessionId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await bankSignupStatus(sessionId);
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
        <p className="mt-3 text-slate-600">Pick a password, then make your face the second factor — verified with ZeroAuth on your phone.</p>

        <form onSubmit={openAccount} className="mt-8 space-y-4">
          <Field label="Full name" value={name} onChange={setName} placeholder="Asha Sharma" autoFocus />
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="asha@example.com"
                 invalid={email.length > 0 && !emailValid} />
          <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="8+ characters, letters + digits"
                 invalid={password.length > 0 && !passwordValid}
                 hint={password.length > 0 && !passwordValid
                   ? 'Use 8+ characters with at least one letter and one digit.'
                   : undefined} />
          <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="Same password again"
                 invalid={confirm.length > 0 && !confirmValid}
                 hint={confirm.length > 0 && !confirmValid ? 'Passwords don’t match.' : undefined} />

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
  hint?: string;
}
function Field({ label, value, onChange, type = 'text', placeholder, autoFocus, invalid, hint }: FieldProps) {
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
      {hint && <span className="mt-1.5 block text-xs text-rose-600">{hint}</span>}
    </label>
  );
}
