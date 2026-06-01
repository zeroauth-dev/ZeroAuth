import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';

/**
 * NeoBank — post-login fake-bank dashboard (investor demo).
 *
 * This is the "moment of arrival" screen in the demo deck: the user
 * has just authenticated with one face (zero passwords, zero OTPs,
 * zero biometric data on the wire) and lands inside a working bank
 * account. Everything here is fabricated — no real money, no real
 * KYC — but it has to *feel* real for the pitch.
 *
 * Stack:
 *   - React 19 + react-router-dom v7 (sibling of dashboard/)
 *   - Tailwind v4 utility classes only (no UI primitive library)
 *   - electric-blue (#0066ff family) accent on white cards
 *
 * Session is read from /api/demo-portal/me (planned in the server-
 * bridge wave). If the endpoint isn't wired yet (or returns 404),
 * we fall back to a mocked session so the page renders in isolation
 * and the pitch never stalls on a missing route.
 *
 * NON-GOAL: this page does NOT do real banking. There is a footer
 * disclaimer; nothing here writes to a tenant, no /v1/* call is
 * made, no audit row is produced. It is intentionally a static-ish
 * surface so investors can see the *outcome* of the login flow.
 */

// ─── Session ─────────────────────────────────────────────────────

interface DemoSession {
  userId: string;
  name: string;
  did: string;
  sessionsLast24h: number;
}

const MOCK_SESSION: DemoSession = {
  userId: 'demo-user-9e50',
  name: 'demo user',
  did: 'did:zeroauth:face:9e50b2eb4f7a8c1d3e6f9a2b5c8d7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
  sessionsLast24h: 3,
};

interface SessionState {
  data: DemoSession | null;
  loading: boolean;
  error: string | null;
}

/**
 * useSession — fetches /api/demo-portal/me, falls back to mocked
 * data if the endpoint isn't wired or the request fails. We never
 * surface the fallback as an error in the UI; the investor demo
 * has to keep rendering.
 */
function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/demo-portal/me', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as Partial<DemoSession>;
        if (cancelled) return;
        setState({
          data: {
            userId: body.userId ?? MOCK_SESSION.userId,
            name: body.name && body.name.trim().length > 0 ? body.name : MOCK_SESSION.name,
            did: body.did ?? MOCK_SESSION.did,
            sessionsLast24h: body.sessionsLast24h ?? MOCK_SESSION.sessionsLast24h,
          },
          loading: false,
          error: null,
        });
      } catch {
        if (cancelled) return;
        setState({ data: MOCK_SESSION, loading: false, error: null });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── Static demo data ────────────────────────────────────────────

interface Transaction {
  id: string;
  merchant: string;
  amount: number; // negative = debit, positive = credit
  whenLabel: string;
  category: 'food' | 'salary' | 'rent' | 'utility' | 'investment' | 'shopping' | 'transport' | 'transfer';
}

const TRANSACTIONS: Transaction[] = [
  { id: 't1', merchant: 'Swiggy',                   amount:    -284, whenLabel: '2h ago',      category: 'food' },
  { id: 't2', merchant: 'Salary credit',            amount:  +85000, whenLabel: '2 days ago',  category: 'salary' },
  { id: 't3', merchant: 'Rent',                     amount:  -32000, whenLabel: '5 days ago',  category: 'rent' },
  { id: 't4', merchant: 'BESCOM (electricity)',     amount:   -2450, whenLabel: '1 week ago',  category: 'utility' },
  { id: 't5', merchant: 'Mutual fund SIP',          amount:  -10000, whenLabel: '1 week ago',  category: 'investment' },
  { id: 't6', merchant: 'Amazon',                   amount:   -1899, whenLabel: '2 weeks ago', category: 'shopping' },
  { id: 't7', merchant: 'Uber',                     amount:    -412, whenLabel: '2 weeks ago', category: 'transport' },
  { id: 't8', merchant: 'Zerodha — equity buy',     amount:  -15000, whenLabel: '3 weeks ago', category: 'investment' },
  { id: 't9', merchant: 'BigBasket',                amount:   -2375, whenLabel: '3 weeks ago', category: 'shopping' },
  { id: 't10', merchant: 'Refund — Myntra',         amount:   +1299, whenLabel: '4 weeks ago', category: 'transfer' },
];

const BALANCE_INR = 482316;

// ─── Formatting ──────────────────────────────────────────────────

function formatINR(amountInRupees: number): string {
  // Indian numbering (lakh/crore comma grouping) via en-IN locale.
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
  return formatter.format(amountInRupees);
}

function truncateDid(did: string, lead = 24): string {
  if (did.length <= lead + 4) return did;
  return `${did.slice(0, lead)}…`;
}

const CATEGORY_COLORS: Record<Transaction['category'], string> = {
  food:       'bg-orange-100 text-orange-700',
  salary:     'bg-emerald-100 text-emerald-700',
  rent:       'bg-rose-100 text-rose-700',
  utility:    'bg-amber-100 text-amber-700',
  investment: 'bg-violet-100 text-violet-700',
  shopping:   'bg-sky-100 text-sky-700',
  transport:  'bg-teal-100 text-teal-700',
  transfer:   'bg-blue-100 text-blue-700',
};

// ─── Component ───────────────────────────────────────────────────

export function Dashboard() {
  const session = useSession();
  const navigate = useNavigate();
  const userName = session.data?.name ?? 'demo user';
  const did = session.data?.did ?? MOCK_SESSION.did;
  const sessionsLast24h = session.data?.sessionsLast24h ?? MOCK_SESSION.sessionsLast24h;

  const handleSignOut = async () => {
    try {
      await fetch('/api/demo-portal/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore — demo flow continues regardless.
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TopBar userName={userName} onSignOut={handleSignOut} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left + middle column — balance, quick actions, transactions */}
          <div className="space-y-6 lg:col-span-2">
            <BalanceCard amount={BALANCE_INR} />
            <QuickActions />
            <RecentTransactions items={TRANSACTIONS} />
          </div>

          {/* Right column — identity card */}
          <div className="space-y-6">
            <IdentityCard did={did} sessionsLast24h={sessionsLast24h} />
            <SecurityNudge />
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function TopBar({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight text-slate-900">NeoBank</span>
        </div>
        <div className="hidden text-sm text-slate-600 sm:block">
          Welcome back, <span className="font-medium text-slate-900">{userName}</span>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm">
      <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 10l9-6 9 6" />
        <path d="M5 9v11h14V9" />
        <path d="M9 20v-6h6v6" />
      </svg>
    </div>
  );
}

function BalanceCard({ amount }: { amount: number }) {
  return (
    <section
      aria-label="Account balance"
      className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-blue-700 p-6 text-white shadow-lg shadow-blue-600/20 sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-blue-100/90">Available balance</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
            {formatINR(amount)}
          </p>
          <p className="mt-2 text-sm text-blue-100/90">Savings · XXXX 4291 · INR</p>
        </div>
        <div className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
          Primary account
        </div>
      </div>
    </section>
  );
}

function QuickActions() {
  const actions: Array<{ label: string; icon: React.ReactNode }> = [
    {
      label: 'Send money',
      icon: (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
        </svg>
      ),
    },
    {
      label: 'Pay bill',
      icon: (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 4h16v16H4z" /><path d="M8 9h8" /><path d="M8 13h8" /><path d="M8 17h4" />
        </svg>
      ),
    },
    {
      label: 'Add money',
      icon: (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14" /><path d="M5 12h14" />
        </svg>
      ),
    },
    {
      label: 'Card controls',
      icon: (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" />
        </svg>
      ),
    },
  ];

  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
            {a.icon}
          </span>
          <span className="text-sm font-medium text-slate-800">{a.label}</span>
        </button>
      ))}
    </section>
  );
}

function RecentTransactions({ items }: { items: Transaction[] }) {
  return (
    <section
      aria-label="Recent transactions"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Recent transactions</h2>
          <p className="text-xs text-slate-500">Last 30 days</p>
        </div>
        <Link
          to="#"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
          onClick={(e) => e.preventDefault()}
        >
          View all
        </Link>
      </header>
      <ul className="divide-y divide-slate-100">
        {items.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={clsx(
                  'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  CATEGORY_COLORS[t.category],
                )}
                aria-hidden
              >
                {t.merchant.charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{t.merchant}</div>
                <div className="text-xs text-slate-500">{t.whenLabel}</div>
              </div>
            </div>
            <div
              className={clsx(
                'whitespace-nowrap text-sm font-semibold tabular-nums',
                t.amount >= 0 ? 'text-emerald-600' : 'text-slate-900',
              )}
            >
              {t.amount >= 0 ? '+' : '−'} {formatINR(Math.abs(t.amount))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IdentityCard({ did, sessionsLast24h }: { did: string; sessionsLast24h: number }) {
  return (
    <section
      aria-label="Your ZeroAuth identity"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Your ZeroAuth identity</h2>
          <p className="text-xs text-slate-500">Powered by zero-knowledge proofs</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
          Verified
        </span>
      </header>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500">DID</dt>
          <dd
            className="mt-1 break-all font-mono text-xs text-slate-800"
            title={did}
          >
            {truncateDid(did)}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-wider text-slate-500">Sessions · 24h</dt>
          <dd className="text-base font-semibold tabular-nums text-slate-900">{sessionsLast24h}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => {/* no-op placeholder */}}
        className="mt-4 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        View login history
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14" /><path d="M13 5l7 7-7 7" />
        </svg>
      </button>
    </section>
  );
}

function SecurityNudge() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">No password to forget</h2>
      <p className="mt-1 text-xs text-slate-600">
        You logged in with one face. Your biometric never left your device — we only saw a
        zero-knowledge proof.
      </p>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
        <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-blue-600" aria-hidden>
          <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
        </svg>
        DPDP-aligned · audit-logged · revocable
      </div>
    </section>
  );
}

function Footer() {
  return (
    <p className="mt-10 text-center text-xs text-slate-400">
      This is a demo — no real banking happens here. Powered by{' '}
      <span className="font-medium text-slate-500">ZeroAuth</span>.
    </p>
  );
}

export default Dashboard;
