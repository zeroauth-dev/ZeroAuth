# Agent #23 — Senior QA / SDET (E2E + load + security regression)

**Reports to:** Agent #1.
**Mandate:** Owns E2E test suite (Playwright), load test suite, security regression suite.
**KPIs:** see role 23 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A23-W1-Mon (2026-05-25)** — Implement C-003 (schema-purity test)
- Done when: `tests/schema-purity.test.ts` written; test asserts allowed columns enumerated.
- Output: C-003 PR.
- Verify: test fails on any extra column.
- Reviewer: Agents #2, #39.
- Depends on: A01-W1-Mon.

**A23-W1-Tue (2026-05-26)** — Implement C-007 (cross-tenant matrix) — first half
- Done when: Express router introspection helper landed; test scaffold writes a row per `/v1/*` route.
- Output: PR draft for C-007.
- Verify: helper enumerates all routes.
- Reviewer: Agent #7.
- Depends on: A23-W1-Mon.

**A23-W1-Wed (2026-05-27)** — Implement C-007 — second half (full matrix green)
- Done when: every `/v1/*` endpoint passes wrong-tenant-rejection assertion.
- Output: C-007 PR.
- Verify: zero manual list of routes.
- Reviewer: Agent #7.
- Depends on: A23-W1-Tue.

**A23-W1-Thu (2026-05-28)** — Implement C-021 (biometric-rejection test) — first half
- Done when: forbidden-key blocklist enumerated; per-route test loop scaffolded.
- Output: PR draft for C-021.
- Verify: scaffold runs on a route.
- Reviewer: Agent #6.
- Depends on: A23-W1-Wed.

**A23-W1-Fri (2026-05-29)** — Implement C-021 — second half + status post
- Done when: every POST `/v1/*` endpoint rejects payloads with forbidden keys.
- Output: C-021 PR.
- Verify: test green.
- Reviewer: Agent #6.
- Depends on: A23-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A23-W2-Mon (2026-06-01)** — Audit-coverage test scaffolding (precursor C-127)
- Done when: scaffold enumerates mutating endpoints + checks for audit-row write.
- Output: `tests/audit-coverage.test.ts` v0.
- Verify: scaffold runs.
- Reviewer: Agent #8.
- Depends on: A23-W1-Fri.

**A23-W2-Tue (2026-06-02)** — Tenant-isolation matrix expansion to admin + console (precursor C-126)
- Done when: admin + console endpoints added to the matrix.
- Output: `tests/tenant-isolation.test.ts` expanded.
- Verify: 100 % route coverage by introspection.
- Reviewer: Agent #9.
- Depends on: A23-W2-Mon.

**A23-W2-Wed (2026-06-03)** — Demo-bypass-blocker test (no-fake-prover precursor)
- Done when: grep-style test rejects re-introduction of `FakeMobileProver`, `FakeKeystoreManager`, `FakeBiometricGate` in production code.
- Output: PR for `tests/no-fake-prover.test.ts` (scaffold).
- Verify: test fails on planted offending code.
- Reviewer: Agent #26.
- Depends on: A23-W2-Tue.

**A23-W2-Thu (2026-06-04)** — Verifier-path coverage tooling
- Done when: coverage tooling configured for `src/services/zkp.ts` + `src/routes/v1/zkp.ts`.
- Output: PR.
- Verify: coverage report generated.
- Reviewer: Agent #6.
- Depends on: A23-W2-Wed.

**A23-W2-Fri (2026-06-05)** — Phase 0 QA sign-off + status post
- Done when: C-003, C-007, C-021 merged; audit-coverage scaffold landed.
- Output: row in `docs/team/phase-exits/phase-0-qa-signoff.md`.
- Verify: backend tests 100 % green.
- Reviewer: Agent #1.
- Depends on: A23-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A23-W3-Mon (2026-06-08)** — E2E test suite scaffolding (Playwright)
- Done when: Playwright project initialised; one smoke test runs against test env.
- Output: `tests/e2e/` skeleton.
- Verify: workflow runs in CI.
- Reviewer: Agent #22.
- Depends on: A23-W2-Fri.

**A23-W3-Tue (2026-06-09)** — E2E test for enrollment flow against test env (precursor)
- Done when: scenario simulates QR scan + (fake) attestation post + DID register.
- Output: `tests/e2e/enrollment.spec.ts` (uses test attestation fixture).
- Verify: test green.
- Reviewer: Agent #6.
- Depends on: A23-W3-Mon.

**A23-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + Playwright fleet sizing
- Done when: parallelism + sharding strategy chosen.
- Output: `docs/team/qa/playwright-fleet-sizing.md`.
- Verify: covers CI cost vs runtime.
- Reviewer: Agent #22.
- Depends on: A23-W3-Tue.

**A23-W3-Thu (2026-06-11)** — E2E test for login flow against test env
- Done when: scenario simulates QR scan + proof post + session create.
- Output: `tests/e2e/login.spec.ts` (uses test proof fixture).
- Verify: test green.
- Reviewer: Agent #6.
- Depends on: A23-W3-Wed.

**A23-W3-Fri (2026-06-12)** — Status post + QA risk register for Anchor Bank demo
- Done when: risk register drafted; top-10 demo risks listed with mitigations.
- Output: `docs/team/qa/anchor-bank-demo-risks.md`.
- Verify: each risk has owner.
- Reviewer: Agents #28, #45.
- Depends on: A23-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A23-W4-Mon (2026-06-15)** — Load-test scaffolding (precursor C-191)
- Done when: k6 script + workflow drafted; smoke run 10 RPS for 60 s green.
- Output: `tests/load/` skeleton.
- Verify: results visible in dashboard.
- Reviewer: Agent #21.
- Depends on: A23-W3-Fri.

**A23-W4-Tue (2026-06-16)** — Security regression suite scaffolding
- Done when: scaffold enumerates closed P0 audit findings + asserts no regression.
- Output: `tests/security/regression.spec.ts`.
- Verify: each closed finding has a check.
- Reviewer: Agent #26.
- Depends on: A23-W4-Mon.

**A23-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + E2E test fixture review
- Done when: fixture inventory reviewed; gaps for sprint 2 (attestation fixtures) tracked.
- Output: `docs/team/qa/e2e-fixture-inventory.md`.
- Verify: gaps logged.
- Reviewer: Agent #12.
- Depends on: A23-W4-Tue.

**A23-W4-Thu (2026-06-18)** — Sprint 1 QA sign-off
- Done when: QA section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: E2E suite covers enrollment + login; load-test scaffold + security-regression scaffold landed.
- Reviewer: Agent #1.
- Depends on: A23-W4-Wed.

**A23-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted.
- Output: `docs/team/qa/a23-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A23-W4-Thu.
