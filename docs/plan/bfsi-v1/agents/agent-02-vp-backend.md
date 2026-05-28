# Agent #2 — VP Engineering, Backend

**Reports to:** Agent #1.
**Mandate:** Owns the Node 20 + Express 4 + Postgres 16 + Redis stack and the `/v1/*`, `/api/console/*`, `/api/admin/*` surfaces.
**KPIs:** see role 2 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A02-W1-Mon (2026-05-25)** — Backend team kickoff + dependency-graph draft
- Done when: backend agents 6–10 briefed; week-1 ticket sequence + dependencies drawn.
- Output: `docs/team/backend/dep-graph-w1.md` (mermaid diagram).
- Verify: diagram linked from backend Slack channel; all 5 agents confirm.
- Reviewer: Agent #1.
- Depends on: A01-W1-Mon.

**A02-W1-Tue (2026-05-26)** — Review C-004 (demo bypass removal) — backend lead review
- Done when: PR reviewed with explicit grep-check comment; sub-agent reviews verified.
- Output: PR comment on C-004.
- Verify: `tests/proof-pairing.test.ts` test cases land in same PR.
- Reviewer: Agent #1.
- Depends on: C-004 opened by Agent #6.

**A02-W1-Wed (2026-05-27)** — Review C-005 (access_token query fallback removal)
- Done when: PR reviewed; CSRF approach for SSE cookie-auth confirmed.
- Output: PR comment on C-005; ADR-candidate noted for CSRF posture.
- Verify: `tests/console-auth.test.ts::"SSE rejects access_token in query string"` green.
- Reviewer: Agent #1, Agent #26.
- Depends on: C-005 opened by Agent #7.

**A02-W1-Thu (2026-05-28)** — Review C-007 (cross-tenant rejection matrix)
- Done when: PR reviewed; Express introspection mechanism approved.
- Output: PR comment.
- Verify: test enumerates every mounted `/v1/*` route; zero manual list.
- Reviewer: Agent #23.
- Depends on: C-007 opened.

**A02-W1-Fri (2026-05-29)** — Friday status read + weekend handoff
- Done when: 5 backend agent statuses (#6–#10) read; carryover items confirmed.
- Output: `docs/team/backend/w1-friday-handoff.md`.
- Verify: all 5 statuses logged; blocker list current.
- Reviewer: Agent #1.
- Depends on: A02-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A02-W2-Mon (2026-06-01)** — Review C-022 (zod adoption) + C-023 (ADR 0013 zod)
- Done when: ADR ratified; zod pinned version recorded.
- Output: PR comment on C-022, C-023.
- Verify: `package.json` shows zod fixed-SemVer; `scripts/check-dep-trail.sh` passes.
- Reviewer: Agent #1.
- Depends on: C-022, C-023 opened.

**A02-W2-Tue (2026-06-02)** — Review C-025 (Postgres session store)
- Done when: PR reviewed; `SESSION_STORE_BACKEND=memory` fallback documented.
- Output: PR comment.
- Verify: `tests/session-store-pg.test.ts` green; existing in-memory tests still green.
- Reviewer: Agent #1, Agent #21.
- Depends on: C-025 opened by Agent #7.

**A02-W2-Wed (2026-06-03)** — Review C-026 (Postgres-backed rate-limit)
- Done when: PR reviewed; bucket configuration per-route documented.
- Output: PR comment.
- Verify: `tests/rate-limit.test.ts` green; admin endpoint documents bucket overrides.
- Reviewer: Agent #1, Agent #9.
- Depends on: C-026 opened by Agent #7.

**A02-W2-Thu (2026-06-04)** — Review C-027 (CORS hardening) + C-028 (RS256 JWT)
- Done when: both PRs reviewed; tenant-`allowed_origins` model confirmed.
- Output: PR comments.
- Verify: `tests/cors.test.ts` and `tests/jwt-rs256.test.ts` green.
- Reviewer: Agent #1, Agent #12.
- Depends on: C-027, C-028 opened.

**A02-W2-Fri (2026-06-05)** — Phase 0 exit sign-off (backend domain)
- Done when: all backend P0 commits confirmed merged; backend test suite 100% green.
- Output: `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: backend section of exit gate green; sign-off row signed.
- Reviewer: Agent #1.
- Depends on: A02-W2-Thu, A01-W2-Fri.

## Week 3 (2026-06-08 → 2026-06-12)

**A02-W3-Mon (2026-06-08)** — Sprint 1 backend kickoff + API delta doc
- Done when: backend agents briefed on C-105/C-108 plan; API delta vs current `docs/api_contract.md` drafted.
- Output: `docs/team/backend/sprint-1-api-delta.md`.
- Verify: delta covers `/v1/identity/register` + `/v1/zkp/verify` payload changes.
- Reviewer: Agent #1, Agent #34 (tech writer).
- Depends on: A01-W3-Mon.

**A02-W3-Tue (2026-06-09)** — Review attestation library spike with Agent #12
- Done when: 1-hour sync done; library choice for Play Integrity verdict parsing confirmed.
- Output: `docs/team/backend/attestation-library-pick.md`.
- Verify: ADR candidate filed (0017) if new dep needed.
- Reviewer: Agent #12.
- Depends on: A02-W3-Mon.

**A02-W3-Wed (2026-06-10)** — Cross-line architecture sync
- Done when: attends Agent #1's sync; commits to mobile-server contract for `/v1/identity/register`.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A02-W3-Tue.

**A02-W3-Thu (2026-06-11)** — Begin review of C-105 (redesigned identity register)
- Done when: first-pass review submitted with comments; revision plan agreed with Agent #6.
- Output: PR comments on C-105.
- Verify: PR has reviewer thread with backlog of changes.
- Reviewer: Agent #6.
- Depends on: C-105 opened.

**A02-W3-Fri (2026-06-12)** — Friday backend status read + mid-sprint health
- Done when: backend agent statuses (#6–#10) read; risks logged.
- Output: `docs/team/backend/s1-mid-health.md`.
- Verify: 5 agent statuses logged; risks colour-coded.
- Reviewer: Agent #1.
- Depends on: A02-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A02-W4-Mon (2026-06-15)** — Final review C-105 (identity register)
- Done when: PR APPROVE; tests `tests/identity-register.test.ts` green; sub-agent sign-offs present.
- Output: PR APPROVE on C-105.
- Verify: merge to `dev`; CI green.
- Reviewer: Agent #1, Agent #26, Agent #27.
- Depends on: A02-W3-Thu, A02-W3-Tue.

**A02-W4-Tue (2026-06-16)** — Review C-108 (anchor_bank tenant seed)
- Done when: PR reviewed; seed script idempotency verified.
- Output: PR comment.
- Verify: `tests/seed-demo-tenants.test.ts` green; rerun produces zero diff.
- Reviewer: Agent #7.
- Depends on: C-108 opened.

**A02-W4-Wed (2026-06-17)** — API contract update PR + ADR-trail audit
- Done when: `docs/api_contract.md` updated for `/v1/identity/register` payload + attestation requirements; ADR trail checked.
- Output: PR updating `docs/api_contract.md`; `scripts/check-dep-trail.sh` invocation log.
- Verify: doc diff reviewed by tech writer Agent #34.
- Reviewer: Agent #34.
- Depends on: A02-W4-Mon.

**A02-W4-Thu (2026-06-18)** — Sprint 1 backend exit-gate sign-off
- Done when: backend section of sprint-1 exit-gate checklist green; sprint 2 backend plan confirmed.
- Output: `docs/team/sprint-exits/s1-backend.md`.
- Verify: every backend anchor commit referenced in `04-commits.md` is merged.
- Reviewer: Agent #1.
- Depends on: A01-W4-Thu.

**A02-W4-Fri (2026-06-19)** — Sprint 2 dispatch + Friday status read
- Done when: sprint-2 backend daily tickets generated for Agents #6–#10; statuses read.
- Output: `docs/team/backend/sprint-2-daily-dispatch.md`.
- Verify: each of 5 backend agents has 5 daily tickets for week 5.
- Reviewer: Agent #1.
- Depends on: A02-W4-Thu.
