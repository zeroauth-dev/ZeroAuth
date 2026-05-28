# Agent #9 — Senior Backend Engineer (admin + reporting)

**Reports to:** Agent #2.
**Mandate:** Owns `/api/admin/*`, audit-integrity endpoint, privacy-audit and compliance-export endpoints.
**KPIs:** see role 9 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A09-W1-Mon (2026-05-25)** — Inventory existing admin endpoints
- Done when: every `/api/admin/*` route documented with x-api-key requirement + scope.
- Output: `docs/team/backend/admin-endpoint-inventory.md`.
- Verify: covers stats, blockchain, privacy-audit, leads.
- Reviewer: Agent #2.
- Depends on: A02-W1-Mon.

**A09-W1-Tue (2026-05-26)** — Add admin endpoints to cross-tenant test matrix (pair with Agent #23)
- Done when: → C-007 contribution lands; admin endpoints included.
- Output: PR contribution to C-007.
- Verify: each admin endpoint has a cross-tenant rejection assertion.
- Reviewer: Agent #23.
- Depends on: A09-W1-Mon.

**A09-W1-Wed (2026-05-27)** — Design doc: `/api/admin/dump-users` (precursor to C-024)
- Done when: design covers allowed columns, gating (tenant `demo_breach_view_allowed` flag + x-api-key), audit-row emission.
- Output: `docs/team/backend/dump-users-design.md`.
- Verify: column allowlist exactly `did`, `commitment_hex`, `tenant_id`, `created_at`.
- Reviewer: Agents #2, #39, #45.
- Depends on: A09-W1-Tue.

**A09-W1-Thu (2026-05-28)** — Write failing test for C-024
- Done when: `tests/admin-dump-users.test.ts::"only returns DID + commitment + tenant_id + created_at"` red.
- Output: PR draft.
- Verify: test fails on current state.
- Reviewer: Agent #23.
- Depends on: A09-W1-Wed.

**A09-W1-Fri (2026-05-29)** — Status post + admin-audit-coverage scaffold
- Done when: status posted; scaffold for admin audit-row coverage test seeded.
- Output: `tests/admin-audit-coverage.test.ts` draft.
- Verify: scaffold runs (may fail) in CI.
- Reviewer: Agent #23.
- Depends on: A09-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A09-W2-Mon (2026-06-01)** — Implement C-024 (`/api/admin/dump-users`)
- Done when: endpoint implemented; gated by tenant flag + x-api-key; logs own audit row.
- Output: C-024 PR.
- Verify: Thursday's test green.
- Reviewer: Agents #2, #39.
- Depends on: A09-W1-Thu.

**A09-W2-Tue (2026-06-02)** — Review C-014 (audit-integrity endpoint) with Agent #8
- Done when: PR reviewed; `x-api-key` gating confirmed.
- Output: PR comment on C-014.
- Verify: own audit-row write verified.
- Reviewer: Agent #8.
- Depends on: A09-W2-Mon.

**A09-W2-Wed (2026-06-03)** — Compliance-export CSV scaffolding (precursor — weeks 5+)
- Done when: skeleton service + tests written; not yet wired to a route.
- Output: `src/services/compliance-export.ts` skeleton + tests.
- Verify: scaffold compiles + tests skeleton passes.
- Reviewer: Agent #2.
- Depends on: A09-W2-Tue.

**A09-W2-Thu (2026-06-04)** — Admin endpoint audit-row coverage test (precursor C-127)
- Done when: skeleton lands; admin endpoints flagged for missing audit rows (if any).
- Output: `tests/admin-audit-coverage.test.ts` v1.
- Verify: test runs in CI; failing rows captured.
- Reviewer: Agent #23.
- Depends on: A09-W2-Wed.

**A09-W2-Fri (2026-06-05)** — Phase 0 admin sign-off + status post
- Done when: admin work merged.
- Output: row in `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: C-024 merged.
- Reviewer: Agent #2.
- Depends on: A09-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A09-W3-Mon (2026-06-08)** — Admin endpoints inventory in `docs/api_contract.md`
- Done when: each admin endpoint documented with payload + response shape.
- Output: PR updating `docs/api_contract.md`.
- Verify: doc reviewed by Agent #34.
- Reviewer: Agents #2, #34.
- Depends on: A09-W2-Fri.

**A09-W3-Tue (2026-06-09)** — Privacy-audit endpoint review with Agent #39
- Done when: existing `/api/admin/privacy-audit` reviewed against `01-pain-points.md` P1 framing.
- Output: comments on existing endpoint; remediation tickets if needed.
- Verify: privacy review captured.
- Reviewer: Agent #39.
- Depends on: A09-W3-Mon.

**A09-W3-Wed (2026-06-10)** — Admin response-time + CSV-stream perf measurement
- Done when: existing admin endpoint perf measured against 1M-row tenant scenario.
- Output: `docs/team/backend/admin-perf-baseline.md`.
- Verify: numbers logged; bottlenecks identified.
- Reviewer: Agent #2.
- Depends on: A09-W3-Tue.

**A09-W3-Thu (2026-06-11)** — `/api/admin/dump-users` post-merge smoke + audit verification
- Done when: smoke run on test env confirms audit-row emission + correct columns.
- Output: `docs/team/backend/dump-users-smoke.md`.
- Verify: audit-row event captured for each call.
- Reviewer: Agents #26, #39.
- Depends on: A09-W2-Mon.

**A09-W3-Fri (2026-06-12)** — Status post + admin endpoint readiness for Scene 4 demo
- Done when: status posted; readiness checklist for Scene 4 written.
- Output: `docs/team/backend/scene-4-readiness.md`.
- Verify: every Scene 4 demo step has an admin-endpoint reference.
- Reviewer: Agent #45.
- Depends on: A09-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A09-W4-Mon (2026-06-15)** — Admin endpoint hardening sprint kick-off
- Done when: rate-limiting on admin endpoints verified after C-026 ships.
- Output: `docs/team/backend/admin-rate-limit-verify.md`.
- Verify: hammer test 100 RPS rejected after threshold.
- Reviewer: Agent #7.
- Depends on: A09-W3-Fri.

**A09-W4-Tue (2026-06-16)** — IP allowlist on admin endpoints
- Done when: IP allowlist middleware applied to `/api/admin/*` in `live` env.
- Output: PR for IP allowlist middleware.
- Verify: `tests/admin-ip-allowlist.test.ts::"rejects un-allowlisted IP"` green.
- Reviewer: Agents #2, #26.
- Depends on: A09-W4-Mon.

**A09-W4-Wed (2026-06-17)** — Audit-row coverage test wired to CI gate
- Done when: `tests/admin-audit-coverage.test.ts` failing means CI red.
- Output: PR wiring test into required CI checks.
- Verify: PR merged.
- Reviewer: Agent #22.
- Depends on: A09-W4-Tue.

**A09-W4-Thu (2026-06-18)** — Sprint 1 admin sign-off + audit-integrity-runbook contribution
- Done when: admin section of S1 exit gate green; runbook contribution merged.
- Output: row in S1 exit doc.
- Verify: hardening complete.
- Reviewer: Agent #2.
- Depends on: A09-W4-Wed.

**A09-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (compliance-export, breach-sim helper).
- Output: `docs/team/backend/a09-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #2.
- Depends on: A09-W4-Thu.
