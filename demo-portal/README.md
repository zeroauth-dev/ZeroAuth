# NeoBank — a ZeroAuth demo

This package is the **investor-facing demo** of the ZeroAuth identity layer.
"NeoBank" is a fictional consumer bank used as a stage to show what changes
when a bank replaces username + password with the ZeroAuth flow:

> One biometric registration on your phone. Sign in to every NeoBank
> surface — app, web, ATM, partner — from then on. Zero passwords. No
> raw biometric ever leaves the device.

It is **not** a real bank, has no real customers, and never touches money.

## Stack

Same toolchain as `../dashboard/` so changes ripple cleanly between the
two surfaces:

- Vite 7 + React 19 + TypeScript strict
- react-router-dom 7
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Vitest + Testing Library

## Routes

| Path         | Purpose                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `/`          | Marketing landing — the "no passwords" pitch                            |
| `/signin`    | Sign-in ceremony — QR pairing placeholder (wires to `/v1/proof-pairing`) |
| `/dashboard` | Signed-in account home — balances, cards, statements (static mock)      |

## Local development

```bash
# from the repo root
cd demo-portal
cp .env.example .env # one-time — the file ships with a working dev key
npm install          # or pnpm install — not run by the scaffold
npm run dev          # starts on http://localhost:5174/demo/
```

The dev server proxies `/api` and `/v1` to `http://localhost:3000` so the
demo can hit the local ZeroAuth backend when one is running. Run
`npm run dev` in the repo root in another terminal to bring up the API.

## Seeded tenant + API key

The demo-portal runs against its own ZeroAuth tenant. To avoid an
operator-coupling step on every `docker compose up`, the tenant + API
key are both **deterministic** and seeded on dev boot by
[`scripts/seed-demo-portal.ts`](../scripts/seed-demo-portal.ts):

| Field                  | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| Tenant name            | `NeoBank Demo Portal`                                                 |
| Tenant id (UUID)       | `67ef58b3-683b-4033-83be-0b90d6dee38c`                                |
| Tenant email           | `demo-portal@zeroauth.dev`                                            |
| API key (DEV ONLY)     | printed by `npm run seed:demo-portal` (deterministic — not in docs)   |
| `did_provider`         | `off-chain` (no DID registry contract)                                |
| `verifier_provider`    | `off-chain` (snarkjs only)                                            |
| `audit_anchor_provider`| `none` (hash-chained transcript, no on-chain anchor)                  |

The key is **deterministic** — every dev box derives the same value
from a domain-separator hash (`src/services/demo-portal-seed.ts ::
deterministicLiveKey`). It survives DB resets — wipe the Postgres
volume, restart, and the same key works. The literal hex is kept out of
this README + `.env.example` so the secret-pattern scanner in
`scripts/pre-commit-checks.sh` doesn't flag the documentation; run
`npm run seed:demo-portal` to print it. To seed by hand on a non-dev
environment:

```bash
npx tsx scripts/seed-demo-portal.ts
# or
npm run seed:demo-portal
```

The script is a no-op when the seed already ran (`ON CONFLICT DO
NOTHING` on both inserts).

Why the static key is safe in this repo:

- It only authorises a tenant whose security policy disables every
  blockchain provider and which has no real users enrolled. The
  worst-case blast radius is an attacker creating verifications against
  an empty demo tenant on someone else's localhost.
- Production deploys never run the seed — `seedDemoPortalIfDev` in
  `scripts/seed-demo-portal.ts` no-ops when `NODE_ENV=production`.
- The hash stored in `api_keys` is SHA-256 of the raw key, so the value
  in the table is a one-way derivative; the raw key in this README is
  the source of truth.

## Production build

```bash
npm run build        # tsc --noEmit && vite build → dist/
npm run preview      # serve the built bundle on a local port
```

The output is mounted under `/demo/` (see `vite.config.ts → base`). When
this ships into the platform, the Express static handler will serve
`demo-portal/dist/` at `/demo/*` the same way it serves `dashboard/dist/`
at `/dashboard/*`.

## What lives where

```
demo-portal/
├── index.html              ← <title>NeoBank — a ZeroAuth demo</title>
├── package.json            ← name: zeroauth-demo-portal
├── vite.config.ts          ← base: '/demo/', port 5174
├── tsconfig.json
├── tailwind.config.js      ← editor-discovery only; theme tokens live in src/index.css
├── postcss.config.js       ← intentionally empty (Vite plugin owns the pipeline)
└── src/
    ├── main.tsx            ← React root
    ├── App.tsx             ← <BrowserRouter basename="/demo"> + 3 routes
    └── index.css           ← Tailwind v4 import + NeoBank design tokens
```

## Conventions inherited from the parent repo

- Never mention "AI-powered", "deepfake-immune" without qualifier, or
  "production stack". See `../CLAUDE.md`.
- Never paste a real biometric template into this app — even a mock.
  The whole point of ZeroAuth is that the bank never sees one.
- Keep the demo charm-first and screenshot-friendly. Investors land
  here from a deck.
