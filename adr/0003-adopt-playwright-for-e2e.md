# ADR-0003 — Adopt Playwright for end-to-end dashboard testing

## Status
Accepted

## Context

ADR-0002 set up the dashboard SPA with vitest + @testing-library/react for unit and component coverage. The suite's `dashboard_CLAUDE.md` and B05 (dashboard bootstrap) call for Playwright on top of that for end-to-end coverage — exercising the full stack against a real browser and a real backend.

Unit + component tests already cover the API client, the format helpers, the primitives, and the Login flow with mocked `fetch`. Those tests run in 5 seconds and catch most regressions. They do **not** catch:

- the dashboard against the real Express server (CORS, helmet headers, the `/dashboard` base path)
- the SPA + console JWT flow against a real Postgres
- a cross-tenant query bug that survives mocking
- a Tailwind class that lints clean but renders wrong
- a router redirect loop introduced by `RequireAuth`

These gaps are exactly what Playwright is meant for.

## Decision

Adopt `@playwright/test` (single dev dependency) for the dashboard workspace. Write one E2E happy-path spec to start: signup → first-key reveal → mint a second key → register a device → see the audit events.

Scope expands over time, but always inside `dashboard/e2e/*.spec.ts`. Edge cases continue to live in vitest + supertest — Playwright is reserved for the journeys that prove the full stack works end-to-end.

## Consequences

- **Positive — flush detection of stack-level bugs.** Anything spanning React → fetch → Express → Postgres → audit row is now covered by one test that runs in CI on every PR.
- **Positive — the developer experience is real.** `npm --prefix dashboard run e2e:ui` opens the Playwright UI for stepping through a failure. `npm --prefix dashboard run e2e` runs headless against a local stack.
- **Negative — CI gets slower.** Playwright adds ~3-5 minutes (browser install + boot time). We mitigate by caching `~/.cache/ms-playwright` keyed on the `@playwright/test` lockfile entry.
- **Negative — flakiness risk.** E2E specs are inherently flakier than unit tests. We mitigate with: `fullyParallel: false`, `workers: 1` in CI, two retries, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`. If a spec is consistently flaky, the right answer is to delete + replace with a tighter test — not to disable.
- **Negative — CI needs a real Postgres.** We use GitHub Actions' `services.postgres:` container so the runner brings up an ephemeral 5432 with a fresh DB. No external infra.
- **Neutral — only Chromium.** Tested browsers can grow to Firefox + WebKit later. For the buyer profile (BFSI compliance teams on Windows + Chrome) Chromium covers the highest-value surface today.

## Alternatives considered

- **Cypress.** Decent DX, but the architecture (test runner runs inside the browser) makes interception of multi-tab flows or auth-stateful sessions awkward. Playwright is the modern default.
- **Selenium / WebdriverIO.** Heavier setup, more flakiness, no per-step trace viewer. Rejected.
- **Skip E2E entirely.** The vitest+supertest gates catch most regressions, but the buyer comparator (Auth0, Clerk, Stytch) all ship with E2E coverage for the signup flow. A dashboard that silently breaks at signup is unacceptable.

## Supply chain

- `@playwright/test@^1.60.0` — MIT, maintained by Microsoft, weekly releases, no `npm audit` advisories at this version.
- Bundled browser binaries (Chromium, Firefox, WebKit) installed via `playwright install`. We pin `chromium` only.

## Operational notes

- Local DX: `./scripts/deploy.sh dev` brings up Postgres + Redis + the app on `localhost:3000`. Then `cd dashboard && npm run e2e`.
- CI DX: workflow brings up a Postgres service container, builds the full stack, starts `node dist/server.js` in the background, then runs `npm --prefix dashboard run e2e`.
- The happy path spec creates a tenant whose email is `playwright+<timestamp>-<rand>@example.com` — recognizable for cleanup. In CI it doesn't matter (ephemeral DB). Locally, run:

  ```sql
  DELETE FROM tenants WHERE email LIKE 'playwright+%@example.com';
  ```

## References

- Suite spec: `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/CLAUDE_md/dashboard_CLAUDE.md` ("All E2E tests pass (Playwright)")
- B05 build prompt's quality bar
- ADR-0002 (dashboard stack)

---
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
