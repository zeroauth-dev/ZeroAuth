import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import { Button, CopyButton, Input, Label, Modal } from '../../components/ui';
import { AuthLayout } from './Login';

interface FirstKeyState {
  key: string;
  warning: string;
}

export function Signup() {
  const { status, signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstKey, setFirstKey] = useState<FirstKeyState | null>(null);
  const [confirmedReveal, setConfirmedReveal] = useState(false);

  if (status === 'authenticated' && !firstKey) {
    return <Navigate to="/overview" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signup({
        email: email.trim(),
        password,
        companyName: companyName.trim() || undefined,
      });
      setFirstKey({ key: res.apiKey, warning: res.warning });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Sign-up failed.';
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <>
      <AuthLayout title="Create your account" subtitle="Sign up to start issuing API keys, registering devices, and verifying identities.">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dev@yourcompany.com"
            />
          </div>
          <div>
            <Label htmlFor="company">Company name (optional)</Label>
            <Input
              id="company"
              type="text"
              autoComplete="organization"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="mt-1.5 text-[11px] text-[var(--color-text-dim)]">
              At least 12 characters, with a letter and a digit. No common passwords.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Button type="submit" loading={busy} className="w-full" size="lg">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>

          <div className="text-center text-xs text-[var(--color-text-secondary)]">
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-[var(--color-brand)] hover:underline">
              Sign in
            </Link>
          </div>
        </form>
      </AuthLayout>

      <Modal
        open={firstKey !== null}
        onClose={() => { /* keep open until user confirms */ }}
        title="Save your first API key"
        description="This is the only time you'll see it. Treat it like a password."
        footer={
          <>
            <Button
              variant="primary"
              disabled={!confirmedReveal}
              onClick={() => {
                setFirstKey(null);
                navigate('/overview', { replace: true });
              }}
            >
              I've saved it, take me to the console
            </Button>
          </>
        }
      >
        {firstKey ? (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-xs break-all">
              {firstKey.key}
            </div>
            <div className="flex justify-end">
              <CopyButton value={firstKey.key} label="Copy key" />
            </div>
            <div className="rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
              {firstKey.warning}
            </div>
            <label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={confirmedReveal}
                onChange={(e) => setConfirmedReveal(e.target.checked)}
              />
              <span>I have saved this key in a secure location. I understand it cannot be recovered.</span>
            </label>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
