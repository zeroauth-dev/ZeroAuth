/**
 * NeoBank investor-facing landing page.
 *
 * NeoBank is the fake bank used in the BFSI v1 Anchor Bank demo
 * (see docs/plan/bfsi-v1/02-bank-demo.md). The page exists to land an
 * investor inside the demo and, within ~8 seconds of scroll, communicate:
 *
 *   1. NeoBank does not use passwords.
 *   2. NeoBank uses ZeroAuth (the actual product) for biometric auth.
 *   3. The flow is dramatically shorter than legacy bank onboarding.
 *
 * Both CTAs route to /signin because the ZeroAuth demo uses one unified
 * face-first flow for sign-up and sign-in alike (ADR 0017): there is no
 * password reset path and no separate "create account" flow to maintain.
 *
 * Style: white background, generous typography, single accent colour
 * (#0066FF, "electric blue"), Tailwind utility classes only. No design
 * tokens are introduced here because demo-portal is a standalone Vite
 * surface and intentionally does not import the dashboard primitives.
 */

import { Link } from 'react-router-dom';

/** Accent colour. Defined once and referenced via arbitrary Tailwind values
 *  so a future swap (e.g. for a tenant-branded variant) is a one-line edit. */
const ACCENT = '#0066FF';

/** Single-line marketing claims used in the three-column "why" strip.
 *  Kept as data, not JSX, so the strip stays a pure map without copy-paste. */
const WHY_PILLARS = [
  {
    title: 'Nothing to remember',
    body: 'Your biometric stays on your phone. There is no password to forget, share, or leak.',
  },
  {
    title: 'Login anywhere',
    body: 'One registration works on every bank, every device, every app that accepts ZeroAuth.',
  },
  {
    title: 'Breach-proof',
    body: 'Even if our servers are stolen, attackers get math, not your face. Commitments are one-way.',
  },
] as const;

/** Step-by-step comparison rows. Each tuple is [legacy step, NeoBank step].
 *  Empty strings render as a spacer so the columns stay aligned visually. */
const COMPARISON_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['Fill 14 personal-detail fields', 'Scan QR on phone'],
  ['Invent a password (8+ chars, 1 symbol, 1 number, ...)', 'Look at the camera'],
  ['Wait for OTP, type it back', 'Done'],
  ['Upload PAN + Aadhaar photos', ''],
  ['Wait for KYC review', ''],
  ['~6 minutes', '~12 seconds'],
];

/**
 * Top navigation bar.
 *
 * NeoBank wordmark on the left, four-item nav on the right. The wordmark
 * uses the accent colour deliberately so the "this is NeoBank, not
 * ZeroAuth" framing reads instantly to a first-time investor. The
 * sign-in link is the only nav item that goes anywhere real; the others
 * are anchors to keep the demo browser's URL bar clean.
 */
function TopBar() {
  return (
    <header className="border-b border-slate-100 bg-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          to="/"
          className="text-2xl font-semibold tracking-tight"
          style={{ color: ACCENT }}
        >
          NeoBank
        </Link>
        <ul className="flex items-center gap-8 text-sm text-slate-700">
          <li>
            <a href="#personal" className="hover:text-slate-900">
              Personal
            </a>
          </li>
          <li>
            <a href="#business" className="hover:text-slate-900">
              Business
            </a>
          </li>
          <li>
            <a href="#about" className="hover:text-slate-900">
              About
            </a>
          </li>
          <li>
            <Link
              to="/signin"
              className="rounded-md px-4 py-2 font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: ACCENT }}
            >
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}

/**
 * Hero section.
 *
 * The investor's first eight seconds. Two short sentences, two CTAs.
 * Both CTAs deep-link to /signin: the demo flow handles both first-time
 * registration and returning sign-in via the same QR/biometric path,
 * so giving the user a second button labelled "Sign in" is purely
 * cosmetic — it lets the page feel like a real bank without forking
 * the demo state machine.
 */
function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24 md:py-32">
      <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight text-slate-900 md:text-7xl">
        The bank without passwords.
      </h1>
      <p className="mt-6 max-w-2xl text-xl leading-relaxed text-slate-600 md:text-2xl">
        NeoBank uses ZeroAuth — one face, every device, zero secrets stored.
      </p>
      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          to="/signin"
          className="rounded-md px-7 py-3.5 text-base font-medium text-white shadow-sm transition hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Open an account
        </Link>
        <Link
          to="/signin"
          className="rounded-md border border-slate-300 bg-white px-7 py-3.5 text-base font-medium text-slate-900 transition hover:border-slate-400"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}

/**
 * Three-column "why" strip.
 *
 * The titles do the work; the body text is for the investor who reads
 * one column carefully and skims the rest. Kept on a light-grey band so
 * it visually separates from the hero without breaking the white theme.
 */
function WhyStrip() {
  return (
    <section className="border-y border-slate-100 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-3">
        {WHY_PILLARS.map((pillar) => (
          <div key={pillar.title}>
            <div
              className="mb-4 h-1 w-10 rounded-full"
              style={{ backgroundColor: ACCENT }}
              aria-hidden="true"
            />
            <h3 className="text-xl font-semibold text-slate-900">
              {pillar.title}
            </h3>
            <p className="mt-3 text-base leading-relaxed text-slate-600">
              {pillar.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Side-by-side signup comparison.
 *
 * Left column: a deliberately tedious legacy flow. Right column: the
 * NeoBank flow. Both columns share the same row count for vertical
 * alignment; empty strings on the right render as spacer rows so the
 * visual "and we're done much sooner" effect lands without resorting
 * to absolute positioning.
 */
function Comparison() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
        Same outcome. Different journey.
      </h2>
      <p className="mt-3 max-w-2xl text-base text-slate-600">
        Two ways to open a bank account today. One of them is NeoBank.
      </p>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Traditional signup
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900">
            ~6 minutes
          </h3>
          <ul className="mt-6 space-y-3">
            {COMPARISON_ROWS.map(([legacy], i) => (
              <li
                key={i}
                className={`flex items-start gap-3 text-base ${
                  legacy ? 'text-slate-700' : 'text-transparent select-none'
                }`}
              >
                <span className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-300" />
                <span>{legacy || 'placeholder'}</span>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="rounded-2xl border-2 bg-white p-8"
          style={{ borderColor: ACCENT }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: ACCENT }}
          >
            NeoBank with ZeroAuth
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900">
            ~12 seconds
          </h3>
          <ul className="mt-6 space-y-3">
            {COMPARISON_ROWS.map(([, neo], i) => (
              <li
                key={i}
                className={`flex items-start gap-3 text-base ${
                  neo ? 'text-slate-900' : 'text-transparent select-none'
                }`}
              >
                <span
                  className="mt-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: neo ? ACCENT : 'transparent' }}
                />
                <span>{neo || 'placeholder'}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * Footer.
 *
 * Intentionally small — investors who care about the underlying tech
 * follow the "Built on ZeroAuth" link to /how-it-works (placeholder
 * route, lives in a future commit). Everyone else sees a clean break.
 */
function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-slate-500">
        <p>&copy; NeoBank — a ZeroAuth demonstration</p>
        <Link
          to="/how-it-works"
          className="hover:underline"
          style={{ color: ACCENT }}
        >
          Built on ZeroAuth — see how it works
        </Link>
      </div>
    </footer>
  );
}

/**
 * Default-exported page component.
 *
 * Composes the five sections in scroll order. Each subcomponent is
 * self-contained so a designer can rearrange them without prop wiring.
 */
export default function Landing() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 antialiased">
      <TopBar />
      <main>
        <Hero />
        <WhyStrip />
        <Comparison />
      </main>
      <Footer />
    </div>
  );
}
