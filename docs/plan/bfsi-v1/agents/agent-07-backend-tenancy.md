# Agent #7 — Senior Backend Engineer (multi-tenancy + API keys)

**Reports to:** Agent #2.
**Mandate:** Owns `(tenant_id, environment)` isolation, `api_keys` table, `za_{live,test}_*` keys, scope enforcement.
**KPIs:** see role 7 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A07-W1-Mon (2026-05-25)** — Write failing test for C-005 (SSE access_token rejection)
- Done when: `tests/console-auth.test.ts::"SSE rejects access_token in query string"` red.
- Output: PR draft with red test.
- Verify: test fails before fix.
- Reviewer: Agent #23.
- Depends on: A02-W1-Mon.

**A07-W1-Tue (2026-05-26)** — Implement C-005 — remove access_token query fallback
- Done when: middleware rejects `?access_token=`; cookie-based auth path verified for SSE.
- Output: C-005 PR opened.
- Verify: test now green; security-reviewer sub-agent posted review.
- Reviewer: Agents #2, #26.
- Depends on: A07-W1-Mon.

**A07-W1-Wed (2026-05-27)** — Implement C-007 (cross-tenant rejection matrix) with Agent #23
- Done when: test enumerates every mounted `/v1/*` route via Express introspection; cross-tenant 403 verified.
- Output: `tests/tenant-isolation.test.ts` v1.
- Verify: every route in router has a test row.
- Reviewer: Agent #23.
- Depends on: A07-W1-Tue.

**A07-W1-Thu (2026-05-28)** — Design doc for Postgres-backed session store (C-025)
- Done when: schema + migration strategy + fallback flag designed.
- Output: `docs/team/backend/postgres-session-store-design.md`.
- Verify: covers TTL, eviction, concurrent access, dev fallback.
- Reviewer: Agent #2.
- Depends on: A07-W1-Wed.

**A07-W1-Fri (2026-05-29)** — Status post + rate-limit design doc
- Done when: status posted; rate-limit design doc drafted.
- Output: `docs/team/backend/rate-limit-design.md`.
- Verify: covers per-key + per-IP buckets, configurable.
- Reviewer: Agent #2.
- Depends on: A07-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A07-W2-Mon (2026-06-01)** — Implement C-025 (Postgres session store) — first half
- Done when: session store schema migrated; service refactored.
- Output: PR draft.
- Verify: tests for persistence across process restart written.
- Reviewer: Agent #2.
- Depends on: A07-W1-Fri.

**A07-W2-Tue (2026-06-02)** — Implement C-025 — second half + ship
- Done when: PR merged; CI green; `SESSION_STORE_BACKEND=memory` fallback still works.
- Output: C-025 merge commit.
- Verify: `tests/session-store-pg.test.ts::"sessions persist across process restart"` green.
- Reviewer: Agents #2, #21.
- Depends on: A07-W2-Mon.

**A07-W2-Wed (2026-06-03)** — Implement C-026 (rate-limit middleware) — first half
- Done when: middleware skeleton + Postgres-backed bucket store landed.
- Output: PR draft for C-026.
- Verify: load smoke test of 100 RPS.
- Reviewer: Agent #2.
- Depends on: A07-W2-Tue.

**A07-W2-Thu (2026-06-04)** — Implement C-026 — second half + C-027 (CORS hardening)
- Done when: both PRs opened; tests green.
- Output: C-026 + C-027 PRs.
- Verify: `tests/rate-limit.test.ts` and `tests/cors.test.ts` green.
- Reviewer: Agents #2, #26.
- Depends on: A07-W2-Wed.

**A07-W2-Fri (2026-06-05)** — Phase 0 backend sign-off + status post
- Done when: tenant-isolation + session + rate-limit + CORS work confirmed green.
- Output: row in `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: each commit referenced + merged.
- Reviewer: Agent #2.
- Depends on: A07-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A07-W3-Mon (2026-06-08)** — Anchor Bank tenant-seed script design
- Done when: script idempotency + secret-handling design captured.
- Output: `docs/team/backend/anchor-bank-seed-design.md`.
- Verify: covers `live` + `test` envs; API keys printed only to operator, never committed.
- Reviewer: Agents #2, #45.
- Depends on: A07-W2-Fri.

**A07-W3-Tue (2026-06-09)** — Implement C-108 (anchor_bank tenant seed) — first half
- Done when: script scaffold + tenant row + webhook secret rotation written.
- Output: PR draft for C-108.
- Verify: `tests/seed-demo-tenants.test.ts` written.
- Reviewer: Agent #2.
- Depends on: A07-W3-Mon.

**A07-W3-Wed (2026-06-10)** — Implement C-108 — second half + ship
- Done when: PR opened; idempotency confirmed.
- Output: C-108 PR.
- Verify: `tests/seed-demo-tenants.test.ts::"anchor_bank tenant provisioned with right scopes"` green.
- Reviewer: Agent #2.
- Depends on: A07-W3-Tue.

**A07-W3-Thu (2026-06-11)** — Users-view API surface coordination with Agent #14
- Done when: API contract for users view confirmed (response shape, pagination, no PII).
- Output: API contract delta committed to `docs/api_contract.md`.
- Verify: Agent #14 confirms via PR comment.
- Reviewer: Agent #14, Agent #34.
- Depends on: A07-W3-Wed.

**A07-W3-Fri (2026-06-12)** — Status post + sprint-2 tenant feature-flag service spike
- Done when: status posted; feature-flag service refactor design drafted.
- Output: `docs/team/backend/tenant-feature-flags-design.md`.
- Verify: design covers workforce-mode toggle (precursor to C-189).
- Reviewer: Agent #2.
- Depends on: A07-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A07-W4-Mon (2026-06-15)** — Merge C-108 + post-merge smoke
- Done when: C-108 merged; smoke run on test env confirms tenant ready.
- Output: merge commit + smoke log.
- Verify: webhook signing key rotated successfully.
- Reviewer: Agent #2.
- Depends on: A07-W3-Wed.

**A07-W4-Tue (2026-06-16)** — Tenant-config docs (precursor to workforce-mode in sprint 2)
- Done when: `docs/operations/tenant-config.md` v1 drafted.
- Output: doc PR.
- Verify: covers `allowed_origins`, scopes, webhook URLs, feature flags.
- Reviewer: Agents #2, #34.
- Depends on: A07-W4-Mon.

**A07-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended; tenant-config alignment with mobile + frontend confirmed.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A07-W4-Tue.

**A07-W4-Thu (2026-06-18)** — Sprint 1 backend sign-off + spike for sprint-2 anchor commit C-122
- Done when: backend S1 exit-gate row signed; feature-flag enforcement spike written.
- Output: contribution to S1 exit doc; `docs/team/backend/a07-sprint-2-plan.md`.
- Verify: 5 daily tickets for week 5.
- Reviewer: Agent #2.
- Depends on: A02-W4-Thu.

**A07-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: tickets confirmed; status posted.
- Output: status post.
- Verify: week-5 tickets reference C-121 hash-chain backfill migration.
- Reviewer: Agent #2.
- Depends on: A07-W4-Thu.
