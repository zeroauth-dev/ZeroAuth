import { useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Input, Label, Card, pushToast } from '../components/ui';

type Mode = 'login' | 'signup';

export function LoginPage() {
  const { admin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signup') {
        await api.signup({ email, password, companyName, location: location || undefined });
      } else {
        await api.login({ email, password });
      }
      await qc.invalidateQueries({ queryKey: ['account'] });
      nav('/', { replace: true });
    } catch (err) {
      pushToast('danger', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-12">
      <div className="accent-glow pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="font-display text-2xl font-semibold">ZeroAuth</span>
            <span className="rounded-md bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-light)]">
              Attendance
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            Face-verified, on-network attendance for your team.
          </p>
        </div>

        <Card>
          <div className="flex border-b border-[var(--color-border-subtle)]">
            {(['login', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  mode === m ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create company'}
              </button>
            ))}
          </div>

          <form className="space-y-4 px-6 py-6" onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <div>
                  <Label>Company name</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Anchor Bank" required />
                </div>
                <div>
                  <Label>Office location <span className="normal-case text-[var(--color-text-dim)]">(optional)</span></Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Mumbai HQ" />
                </div>
              </>
            )}
            <div>
              <Label>Work email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hr@company.com" required />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} />
            </div>
            <Button type="submit" size="lg" loading={busy} className="w-full">
              {mode === 'login' ? 'Sign in' : 'Create company'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-[var(--color-text-dim)]">
          HR admin access only. Employees check in from the ZeroAuth app.
        </p>
      </div>
    </div>
  );
}
