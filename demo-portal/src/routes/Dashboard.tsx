import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ApiError,
  bankOverview,
  bankTransfer,
  bankTransferStatus,
  type BankOverviewResponse,
  type BankOverviewTransaction,
} from '../lib/api';

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
        const body = (await res.json()) as Partial<DemoSession> & {
          user?: { displayName?: string };
        };
        if (cancelled) return;
        // /me sends a dual shape: flat `name` plus nested `user.displayName`
        // (the api.ts contract). Prefer flat, fall back to nested.
        const displayName = body.name ?? body.user?.displayName;
        setState({
          data: {
            userId: body.userId ?? MOCK_SESSION.userId,
            name: displayName && displayName.trim().length > 0 ? displayName : MOCK_SESSION.name,
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

// ─── Overview data (server-backed, with a static fallback) ───────
//
// GET /api/demo-portal/bank/overview is the source of truth: real
// balance, real accounts, real seeded ledger, real DID. If the route
// isn't wired yet (404 no_account) or the request errors, we drop to
// MOCK_OVERVIEW so the page still renders in isolation and the pitch
// never stalls on a missing route.

const STEP_UP_THRESHOLD_INR = 10_000;

const MOCK_OVERVIEW: BankOverviewResponse = {
  fullName: MOCK_SESSION.name,
  did: MOCK_SESSION.did,
  primaryBalancePaise: 482316 * 100,
  primaryBalanceDisplay: '₹4,82,316',
  stepUpThresholdDisplay: '₹10,000',
  accounts: [
    {
      id: 'acc-primary',
      kind: 'savings',
      maskedNumber: '•••• 4291',
      balancePaise: 482316 * 100,
      balanceDisplay: '₹4,82,316',
    },
  ],
  transactions: [
    { id: 't1',  direction: 'debit',  counterparty: 'Swiggy',               amountPaise:    28400, amountDisplay: '₹284',    note: '', category: 'food',       status: 'completed', createdAt: '2026-07-02T08:00:00.000Z' },
    { id: 't2',  direction: 'credit', counterparty: 'Salary credit',        amountPaise:  8500000, amountDisplay: '₹85,000', note: '', category: 'salary',     status: 'completed', createdAt: '2026-06-30T09:00:00.000Z' },
    { id: 't3',  direction: 'debit',  counterparty: 'Rent',                 amountPaise:  3200000, amountDisplay: '₹32,000', note: '', category: 'rent',       status: 'completed', createdAt: '2026-06-27T09:00:00.000Z' },
    { id: 't4',  direction: 'debit',  counterparty: 'BESCOM (electricity)', amountPaise:   245000, amountDisplay: '₹2,450',  note: '', category: 'utility',    status: 'completed', createdAt: '2026-06-25T09:00:00.000Z' },
    { id: 't5',  direction: 'debit',  counterparty: 'Mutual fund SIP',      amountPaise:  1000000, amountDisplay: '₹10,000', note: '', category: 'investment', status: 'completed', createdAt: '2026-06-25T09:00:00.000Z' },
    { id: 't6',  direction: 'debit',  counterparty: 'Amazon',               amountPaise:   189900, amountDisplay: '₹1,899',  note: '', category: 'shopping',    status: 'completed', createdAt: '2026-06-18T09:00:00.000Z' },
    { id: 't7',  direction: 'debit',  counterparty: 'Uber',                 amountPaise:    41200, amountDisplay: '₹412',    note: '', category: 'transport',   status: 'completed', createdAt: '2026-06-18T09:00:00.000Z' },
    { id: 't8',  direction: 'debit',  counterparty: 'Zerodha — equity buy', amountPaise:  1500000, amountDisplay: '₹15,000', note: '', category: 'investment', status: 'completed', createdAt: '2026-06-11T09:00:00.000Z' },
    { id: 't9',  direction: 'debit',  counterparty: 'BigBasket',            amountPaise:   237500, amountDisplay: '₹2,375',  note: '', category: 'shopping',    status: 'completed', createdAt: '2026-06-11T09:00:00.000Z' },
    { id: 't10', direction: 'credit', counterparty: 'Refund — Myntra',      amountPaise:   129900, amountDisplay: '₹1,299',  note: '', category: 'transfer',    status: 'completed', createdAt: '2026-06-04T09:00:00.000Z' },
  ],
};

interface OverviewState {
  data: BankOverviewResponse;
  loading: boolean;
}

/**
 * useOverview — fetches the bank overview, falls back to MOCK_OVERVIEW
 * on 404/error (same rule as useSession). Exposes a `refetch` so the
 * transfer flow can pull the fresh balance + ledger after a payment.
 */
function useOverview(): OverviewState & { refetch: () => Promise<void> } {
  const [state, setState] = useState<OverviewState>({ data: MOCK_OVERVIEW, loading: true });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await bankOverview({ signal });
      if (signal?.aborted) return;
      setState({ data, loading: false });
    } catch {
      if (signal?.aborted) return;
      // 404 no_account / network error → keep the demo alive on mock data.
      setState({ data: MOCK_OVERVIEW, loading: false });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const refetch = useCallback(() => load(), [load]);

  return { ...state, refetch };
}

// ─── Formatting ──────────────────────────────────────────────────

function truncateDid(did: string, lead = 24): string {
  if (did.length <= lead + 4) return did;
  return `${did.slice(0, lead)}…`;
}

/** Coarse "2h ago" / "3 days ago" label from an ISO timestamp. */
function relativeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** m:ss countdown, mirrors SignIn's formatCountdown. */
function formatCountdown(secs: number): string {
  if (secs <= 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const NEUTRAL_CATEGORY = 'bg-slate-100 text-slate-600';

// Category → avatar chip color. Keyed by the server's free-form category
// string; unknown categories fall back to NEUTRAL_CATEGORY.
const CATEGORY_COLORS: Record<string, string> = {
  food:       'bg-orange-100 text-orange-700',
  salary:     'bg-emerald-100 text-emerald-700',
  rent:       'bg-rose-100 text-rose-700',
  utility:    'bg-amber-100 text-amber-700',
  investment: 'bg-violet-100 text-violet-700',
  shopping:   'bg-sky-100 text-sky-700',
  transport:  'bg-teal-100 text-teal-700',
  transfer:   'bg-blue-100 text-blue-700',
};

function categoryColor(category: string): string {
  return CATEGORY_COLORS[category] ?? NEUTRAL_CATEGORY;
}

// ─── Component ───────────────────────────────────────────────────

export function Dashboard() {
  const session = useSession();
  const { data: overview, refetch: refetchOverview } = useOverview();
  const navigate = useNavigate();

  const [sendOpen, setSendOpen] = useState(false);

  // Prefer the bank overview's real fullName/DID; fall back to the /me
  // session (which itself falls back to the mock) so nothing renders blank.
  const userName =
    overview.fullName && overview.fullName.trim().length > 0
      ? overview.fullName
      : session.data?.name ?? MOCK_SESSION.name;
  const did = overview.did || session.data?.did || MOCK_SESSION.did;
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
            <BalanceCard
              balanceDisplay={overview.primaryBalanceDisplay}
              maskedNumber={overview.accounts[0]?.maskedNumber ?? '•••• 4291'}
            />
            <QuickActions onSendMoney={() => setSendOpen(true)} />
            <RecentTransactions items={overview.transactions} />
          </div>

          {/* Right column — identity card */}
          <div className="space-y-6">
            <IdentityCard did={did} sessionsLast24h={sessionsLast24h} />
            <SecurityNudge />
          </div>
        </div>

        <Footer />
      </main>

      {sendOpen && (
        <SendMoneyModal
          stepUpThresholdDisplay={overview.stepUpThresholdDisplay || '₹10,000'}
          onClose={() => setSendOpen(false)}
          onSettled={refetchOverview}
        />
      )}
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

function BalanceCard({
  balanceDisplay,
  maskedNumber,
}: {
  balanceDisplay: string;
  maskedNumber: string;
}) {
  return (
    <section
      aria-label="Account balance"
      className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-blue-700 p-6 text-white shadow-lg shadow-blue-600/20 sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-blue-100/90">Available balance</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
            {balanceDisplay}
          </p>
          <p className="mt-2 text-sm text-blue-100/90">Savings · {maskedNumber} · INR</p>
        </div>
        <div className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
          Primary account
        </div>
      </div>
    </section>
  );
}

function QuickActions({ onSendMoney }: { onSendMoney: () => void }) {
  const actions: Array<{ label: string; icon: React.ReactNode; onClick?: () => void }> = [
    {
      label: 'Send money',
      onClick: onSendMoney,
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
          onClick={a.onClick}
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

function RecentTransactions({ items }: { items: BankOverviewTransaction[] }) {
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
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No transactions yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => {
            const isCredit = t.direction === 'credit';
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={clsx(
                      'grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      categoryColor(t.category),
                    )}
                    aria-hidden
                  >
                    {t.counterparty.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {t.counterparty}
                      </span>
                      {t.status !== 'completed' && <StatusPill status={t.status} />}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.note ? `${t.note} · ` : ''}
                      {relativeWhen(t.createdAt)}
                    </div>
                  </div>
                </div>
                <div
                  className={clsx(
                    'whitespace-nowrap text-sm font-semibold tabular-nums',
                    isCredit ? 'text-emerald-600' : 'text-slate-900',
                  )}
                >
                  {isCredit ? '+' : '−'} {t.amountDisplay}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Small pill shown on the ledger row when a txn isn't 'completed'. */
function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ');
  const tone =
    status === 'declined'
      ? 'bg-rose-100 text-rose-700'
      : status === 'pending_approval' || status === 'pending'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-600';
  return (
    <span
      className={clsx(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
        tone,
      )}
    >
      {label}
    </span>
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

// ─── Send-money modal ────────────────────────────────────────────
//
// Three phases:
//   'form'      — payee + amount + note, client-validated.
//   'approval'  — the ≥ ₹10,000 step-up: the transfer opened a DID-pinned
//                 "Payment approval" session; we poll /bank/transfer/:id
//                 every 1.5s until the enrolled face consumes (or declines/
//                 expires) it. A collapsed QR is the phone-offline fallback.
//   'success'   — paid; refetch overview and auto-close.
// The < ₹10,000 path skips 'approval' and lands straight on 'success'.

const POLL_INTERVAL_MS = 1500;

type SendPhase = 'form' | 'approval' | 'success';

interface StepUpState {
  transferId: string;
  qrPayload: string;
  contextLabel: string;
  amountDisplay: string;
  payeeName: string;
  expiresAt: string;
}

function SendMoneyModal({
  stepUpThresholdDisplay,
  onClose,
  onSettled,
}: {
  stepUpThresholdDisplay: string;
  onClose: () => void;
  onSettled: () => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<SendPhase>('form');

  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [stepUp, setStepUp] = useState<StepUpState | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Close on Escape (unless a submit / poll is in flight, so we never
  // orphan a pending network action mid-keystroke).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const parsedAmount = Number(amount);
  const amountValid = Number.isInteger(parsedAmount) && parsedAmount > 0;
  const payeeValid = payee.trim().length >= 2;
  const willStepUp = amountValid && parsedAmount >= STEP_UP_THRESHOLD_INR;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!payeeValid) {
      setFormError('Enter a payee name (at least 2 characters).');
      return;
    }
    if (!amountValid) {
      setFormError('Enter a whole rupee amount greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await bankTransfer({
        amount: parsedAmount,
        payeeName: payee.trim(),
        note: note.trim() || undefined,
      });

      if (res.requiresApproval) {
        setStepUp({
          transferId: res.transferId,
          qrPayload: res.qrPayload,
          contextLabel: res.contextLabel,
          amountDisplay: res.amountDisplay,
          payeeName: res.payeeName,
          expiresAt: res.expiresAt,
        });
        setPhase('approval');
      } else {
        setSuccessMsg(`Paid ${res.amountDisplay} to ${res.payeeName}`);
        setPhase('success');
        void onSettled();
        window.setTimeout(onClose, 1500);
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'insufficient_funds') {
        setFormError("You don't have enough balance for this transfer.");
      } else if (err instanceof ApiError && err.code === 'invalid_request') {
        setFormError('That transfer looks invalid. Check the amount and payee.');
      } else {
        setFormError('Could not send the payment. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproved = useCallback(
    (amountDisplay: string) => {
      setSuccessMsg(`Payment sent · ${amountDisplay}`);
      setPhase('success');
      void onSettled();
      window.setTimeout(onClose, 1500);
    },
    [onClose, onSettled],
  );

  const handleDeclined = useCallback(() => {
    setApprovalError('Payment declined or expired.');
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Send money"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {phase === 'approval' ? 'Approve payment' : 'Send money'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-5 py-5">
          {phase === 'form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="send-payee" className="mb-1 block text-xs font-medium text-slate-700">
                  Payee name
                </label>
                <input
                  id="send-payee"
                  type="text"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              <div>
                <label htmlFor="send-amount" className="mb-1 block text-xs font-medium text-slate-700">
                  Amount (₹)
                </label>
                <input
                  id="send-amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Amounts over {stepUpThresholdDisplay} need a face approval on your ZeroAuth app.
                  {willStepUp && (
                    <span className="ml-1 font-medium text-blue-600">
                      This one will.
                    </span>
                  )}
                </p>
              </div>

              <div>
                <label htmlFor="send-note" className="mb-1 block text-xs font-medium text-slate-700">
                  Note <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  id="send-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Dinner split"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                />
              </div>

              {formError && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting || !amountValid || !payeeValid}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting && (
                  <span
                    aria-hidden
                    className="inline-block size-3.5 animate-spin rounded-full border-2 border-white border-r-transparent"
                  />
                )}
                {submitting ? 'Sending…' : 'Send money'}
              </button>
            </form>
          )}

          {phase === 'approval' && stepUp && (
            <ApprovalPhase
              stepUp={stepUp}
              error={approvalError}
              onApproved={handleApproved}
              onDeclined={handleDeclined}
              onCancel={onClose}
            />
          )}

          {phase === 'success' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <p className="text-sm font-semibold text-slate-900">{successMsg}</p>
              <p className="text-xs text-slate-500">Updating your balance…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ApprovalPhase — the ≥ ₹10,000 step-up waiting screen. Polls
 * /bank/transfer/:id every 1.5s; renders the "approve on your phone"
 * cue, a live countdown to expiry, and a collapsed QR fallback.
 */
function ApprovalPhase({
  stepUp,
  error,
  onApproved,
  onDeclined,
  onCancel,
}: {
  stepUp: StepUpState;
  error: string | null;
  onApproved: (amountDisplay: string) => void;
  onDeclined: () => void;
  onCancel: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.round((new Date(stepUp.expiresAt).getTime() - Date.now()) / 1000)),
  );
  const settledRef = useRef(false);

  // Countdown tick.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft(
        Math.max(0, Math.round((new Date(stepUp.expiresAt).getTime() - Date.now()) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [stepUp.expiresAt]);

  // Poll for settlement.
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number | undefined;

    const poll = async () => {
      if (settledRef.current) return;
      try {
        const res = await bankTransferStatus(stepUp.transferId, { signal: ctrl.signal });
        if (settledRef.current) return;
        if (res.status === 'completed') {
          settledRef.current = true;
          onApproved(res.amountDisplay || stepUp.amountDisplay);
          return;
        }
        if (res.status === 'declined') {
          settledRef.current = true;
          onDeclined();
          return;
        }
      } catch {
        // Transient error — keep polling until settled or expired.
      }
      if (!settledRef.current) {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      ctrl.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [stepUp.transferId, stepUp.amountDisplay, onApproved, onDeclined]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-rose-100 text-rose-600">
          <svg viewBox="0 0 24 24" width={28} height={28} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </span>
        <p className="text-sm font-semibold text-slate-900">{error}</p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="rounded-xl bg-blue-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-blue-500">{stepUp.contextLabel}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
          {stepUp.amountDisplay}
        </p>
        <p className="text-sm text-slate-600">to {stepUp.payeeName}</p>
      </div>

      <PhonePulseGlyph />

      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Approve in your ZeroAuth app
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          We sent a payment-approval request to your enrolled phone. Verify with your face there —
          nothing biometric touches this browser.
        </p>
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
          Approve by QR instead
        </summary>
        <div className="mt-3 flex flex-col items-center gap-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <QRCodeCanvas value={stepUp.qrPayload} size={180} level="M" marginSize={2} bgColor="#ffffff" fgColor="#0f172a" />
          </div>
          <p className="text-xs text-slate-500">
            Open ZeroAuth, scan this — same payment, same approval.
          </p>
        </div>
      </details>

      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700"
      >
        Cancel
      </button>
    </div>
  );
}

/** Pulsing phone with radiating rings — "look at your handset" cue. */
function PhonePulseGlyph() {
  return (
    <div className="relative grid size-20 place-items-center" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-blue-200/70 [animation-duration:1.8s]" />
      <span className="absolute inset-2 animate-ping rounded-full bg-blue-200 [animation-delay:0.4s] [animation-duration:1.8s]" />
      <span className="relative grid size-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg">
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      </span>
    </div>
  );
}

export default Dashboard;
