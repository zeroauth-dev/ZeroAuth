# ADR-0002 — Build the developer console as a Vite + React 19 SPA, not Next.js 15

## Status
Accepted

## Context

The prompt suite's `dashboard_CLAUDE.md` calls for a Next.js 15 App-Router dashboard with server components, server actions, middleware-enforced auth, and Tailwind + shadcn/ui. The repo as it exists today ships a tiny Vite + React 18 single-page app at `dashboard/` that is served as static files by the same Express process that hosts the API.

We need to deliver a high-quality developer console covering every endpoint the central API exposes — overview, API keys, users, devices, verifications, attendance, audit, settings — with unit + integration tests and automated linting. The buyer-facing comparator is Auth0, Clerk, Stytch, WorkOS.

Two paths:

**Path A — adopt the suite's spec literally.** Replace the Vite scaffold with Next.js 15. Migrate the existing Express-mounted dashboard to a separate Next.js server (either co-deployed on the VPS at `:3001` and proxied by Caddy, or replacing the Express static-file mount entirely). Adopt App Router, server components, server actions, middleware, shadcn/ui, React Query.

**Path B — keep Vite, build the same quality bar.** Replace the existing dashboard `App.tsx` with a Vite + React 19 + React Router + React Query + Tailwind app. Tenant scoping is still enforced server-side by Express middleware (`authenticateTenantApiKey`); the SPA only ever reads its own tenant's data via the console JWT. Keep the existing static-file mount so the deploy story is unchanged.

## Decision

**Path B.** Stick with Vite + React 19. Adopt React Router, React Query, Tailwind CSS, vitest + React Testing Library, ESLint 9. Build the entire console surface there.

The suite's `dashboard_CLAUDE.md` is reconciled to match this choice in `CLAUDE.md` at the repo root: the path-mention "Next.js App Router under `/app/`" is replaced with "React Router under `dashboard/src/routes/`", and the `/api/console/*` proxy that Next.js would do via server components is replaced with direct `fetch()` from the SPA to the same Express endpoints with the console JWT in the `Authorization` header.

## Consequences

- **Positive — speed.** The Vite build pipeline already works, deploys via the existing Dockerfile, and lives behind the same Caddy reverse proxy. Adding routing + data fetching + Tailwind is a one-day change; migrating to Next.js is a multi-day change with new build pipeline, new deploy story, new auth-middleware location, and a re-think of how Express co-exists with the Next.js server. DP8 (the 60-day clock) penalises the migration.
- **Positive — single auth layer.** All authorization lives in `src/middleware/tenant-auth.ts` and the console JWT verifier in `src/routes/console.ts`. The dashboard never holds private logic; it sends bearer tokens to the same API every external SDK uses. This matches the suite's standing instruction #1 ("The dashboard reads; it does not own data").
- **Positive — testability.** Vitest + React Testing Library + jsdom is the standard stack for Vite SPAs. Console-API integration tests stay in the root Jest suite using supertest against `createApp()`.
- **Negative — no server components.** Tenant-scoped data goes over the wire to the client, decrypted by the same JWT the client uses. We mitigate by (a) refusing to render anything before the JWT is verified by the API on the first `/api/console/account` call, and (b) keeping every API call tenant-scoped on the server.
- **Negative — initial paint shows the login skeleton briefly.** A Next.js server-component flow could redirect to `/login` before any HTML hits the wire. The SPA momentarily shows an empty layout before deciding to render `<Login />` vs `<App />`. This is a UX cosmetic issue, not a security issue — no tenant data is ever exposed before auth.
- **Negative — owe an exit path.** If the dashboard needs SSR for SEO or first-paint reasons later, we have to migrate. We mark the deferral here so we can revisit during Vanguard-tier hardening.
- **Neutral — no shadcn/ui.** Replaced with Tailwind + a small set of hand-written primitives (`Button`, `Input`, `Card`, `Table`, `Badge`, `Modal`, `Toast`). Total UI primitive surface is ~300 lines; the radix-ui transitive footprint is avoided. If shadcn/ui adoption becomes worth it later, the primitives are a drop-in replacement.

## Alternatives considered (and rejected)

- **Next.js 15 migration today.** Rejected per DP8. Reopen post-Vanguard if SSR becomes load-bearing for buyer demos.
- **Add server-side rendering via Vite SSR.** Considered. The complexity-to-value ratio is poor for a tenant-private dashboard that's not crawled by search engines.
- **Stay on the existing tiny App.tsx and extend it inline.** Rejected. The file is already 520 lines of inline styles; a real console needs routing, data caching, forms with validation, and a primitive UI layer. Going wider on the same file gets us a 5,000-line `App.tsx` that nobody can review.

## Tooling adopted (one batch — see "Consequences" for justification of each)

| Dependency | Workspace | Purpose |
|---|---|---|
| `react-router-dom` | dashboard | Client-side routing |
| `@tanstack/react-query` | dashboard | Server-state caching + dedupe + invalidation |
| `tailwindcss` | dashboard | Utility-first styling |
| `@tailwindcss/vite` | dashboard | Tailwind v4 Vite plugin (replaces postcss/autoprefixer in v4) |
| `@vitest/coverage-v8` | dashboard | V8 coverage reporter for vitest |
| `clsx` | dashboard | Class-name helper for conditional Tailwind |
| `vitest` | dashboard | Unit test runner (matches Vite) |
| `@testing-library/react` | dashboard | Component testing |
| `@testing-library/user-event` | dashboard | User-interaction simulation |
| `@testing-library/jest-dom` | dashboard | DOM matchers |
| `jsdom` | dashboard | DOM for vitest |
| `eslint` | dashboard | Lint, sharing flat-config style with root |
| `eslint-plugin-react-hooks` | dashboard | React-specific lint rules |
| `eslint-plugin-react-refresh` | dashboard | Vite Fast Refresh hygiene |

Supply-chain audit on all the above: `npm audit --omit=dev` is run against the dashboard workspace after install; no high/critical findings in this set as of 2026-05-12.

License survey: all MIT or Apache-2.0.

## Migration plan (in this commit chain)

1. This ADR.
2. Reconcile `CLAUDE.md` at the repo root: dashboard stack section now reads "Vite + React 19 + React Router + React Query + Tailwind + vitest + RTL + ESLint 9".
3. `dashboard/package.json` upgrades: React 18 → 19, Vite 5 → 7, plus the new deps above.
4. Restructure `dashboard/src/` into routes, layout, components, lib, hooks.
5. Reauthor `App.tsx` as a router root. Keep zero behavior from the old single-page admin viewer; that view migrates to the new `/admin` page.
6. Add `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `eslint.config.js` to dashboard workspace.
7. Build the eight console pages (login, signup, overview, api keys, users, devices, verifications, attendance, audit, settings).
8. Unit tests for primitives + page-level happy paths. Integration tests in root Jest suite for the console JWT flow + tenant scoping.
9. Wire dashboard `npm run lint` + `npm run typecheck` + `npm test` into root CI.

## References

- Suite spec: `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/CLAUDE_md/dashboard_CLAUDE.md` (Next.js path)
- Suite build prompt: `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/build_prompts/B05_dashboard_bootstrap.md`
- ADR-0000 grandfather list (current dashboard deps)
- Auth0, Clerk, Stytch, WorkOS — buyer-facing comparators for console UX

---
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
