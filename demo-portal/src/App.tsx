import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import Landing from './routes/Landing';

// NeoBank — three-route investor demo:
//   /          marketing landing ("login everywhere, no passwords") —
//              lives in routes/Landing.tsx so the design surface is
//              easy to iterate on without touching the router
//   /signin    biometric sign-in ceremony (placeholder until the real
//              QR/face flow is wired through to the ZeroAuth API)
//   /dashboard signed-in account home (balances, cards, transfers)
//
// Everything here is fictional. NeoBank does not exist; it's a stand-in
// so investors can see what a consumer surface looks like once ZeroAuth
// replaces username/password. All API calls in the real demo terminate
// at zeroauth.dev/v1/identity/*.

function SignIn() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-dim)]">
        NeoBank · sign in
      </p>
      <h1 className="mt-4 font-display text-3xl font-medium">
        Look at your phone
      </h1>
      <p className="mt-4 text-[var(--color-text-dim)]">
        Open the NeoBank app on your registered device and approve the sign-in
        prompt. Nothing leaves your phone except a zero-knowledge proof.
      </p>
      <div className="mt-8 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-raised)] p-8 text-center">
        <p className="font-mono text-sm text-[var(--color-text-dim)]">
          QR pairing placeholder
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-dim)]">
          (wires up to /v1/proof-pairing in the live demo)
        </p>
      </div>
      <Link
        to="/dashboard"
        className="mt-6 text-center text-sm text-[var(--color-text-dim)] underline hover:text-[var(--color-text)]"
      >
        Skip to dashboard (demo only)
      </Link>
    </main>
  );
}

function Dashboard() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-16">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-dim)]">
            NeoBank
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium">
            Good evening, Asha.
          </h1>
        </div>
        <Link
          to="/"
          className="text-sm text-[var(--color-text-dim)] underline hover:text-[var(--color-text)]"
        >
          Sign out
        </Link>
      </header>
      <section className="mt-10 grid gap-4 md:grid-cols-3">
        <Card label="Savings" amount="₹ 1,84,520.40" sub="•••• 4421" />
        <Card label="Current" amount="₹ 12,300.00" sub="•••• 8810" />
        <Card label="Credit card" amount="₹ 3,210.55 due" sub="•••• 0017" />
      </section>
      <p className="mt-12 text-sm text-[var(--color-text-dim)]">
        This dashboard is a static mock. No real money moved. The point of
        the demo is the sign-in ceremony you just walked through — that is
        ZeroAuth in production.
      </p>
    </main>
  );
}

function Card({ label, amount, sub }: { label: string; amount: string; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-raised)] p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-dim)]">
        {label}
      </p>
      <p className="mt-3 font-display text-2xl">{amount}</p>
      <p className="mt-1 font-mono text-xs text-[var(--color-text-dim)]">{sub}</p>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename="/demo">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
