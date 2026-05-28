# Agent #3 — VP Engineering, Frontend

**Reports to:** Agent #1.
**Mandate:** Owns the React 19 + Vite 7 dashboard, the developer console, the Docusaurus docs site.
**KPIs:** see role 3 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A03-W1-Mon (2026-05-25)** — Frontend team kickoff + design-system audit kickoff
- Done when: frontend agents 14–16 briefed; current design-token inventory snapshotted.
- Output: `docs/team/frontend/design-token-audit-w1.md`.
- Verify: audit covers spacing, typography, colour, motion tokens.
- Reviewer: Agent #1, Agent #32.
- Depends on: A01-W1-Mon.

**A03-W1-Tue (2026-05-26)** — Frontend ticket-graph for weeks 1–4 drafted
- Done when: ticket graph identifies all frontend touchpoints in `04-commits.md` weeks 1–4.
- Output: `docs/team/frontend/ticket-graph-w1-w4.md`.
- Verify: includes C-006, C-024, C-107 explicitly.
- Reviewer: Agent #1.
- Depends on: A03-W1-Mon.

**A03-W1-Wed (2026-05-27)** — Focus block: SSE cookie+CSRF spec review with Agent #14
- Done when: spec agreed; CSRF mode (double-submit token vs SameSite cookie) chosen.
- Output: `docs/team/frontend/sse-csrf-spec.md`.
- Verify: spec referenced from C-006 PR.
- Reviewer: Agent #2, Agent #7.
- Depends on: A03-W1-Tue.

**A03-W1-Thu (2026-05-28)** — Review C-006 (dashboard EventSource migration)
- Done when: PR reviewed; `withCredentials: true` in EventSource confirmed.
- Output: PR comment on C-006.
- Verify: `dashboard/src/lib/__tests__/sse.test.ts` green.
- Reviewer: Agent #14.
- Depends on: A03-W1-Wed.

**A03-W1-Fri (2026-05-29)** — Friday status read (Agents #14, #15, #16) + brand-aligned demo-day theme spike
- Done when: 3 statuses read; demo-theme palette spike sent to Agent #32.
- Output: `docs/team/frontend/w1-friday-handoff.md`.
- Verify: handoff doc links statuses + theme spike.
- Reviewer: Agent #32.
- Depends on: A03-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A03-W2-Mon (2026-06-01)** — Frontend sprint planning for Phase 1 Sprint 1 frontend touchpoints
- Done when: C-107 (users view), C-108-frontend (anchor-bank dashboard polish) scoped.
- Output: `docs/team/frontend/sprint-1-scope.md`.
- Verify: links C-107 to design files from Agent #32.
- Reviewer: Agent #14, Agent #32.
- Depends on: A03-W1-Fri.

**A03-W2-Tue (2026-06-02)** — Audit-integrity view design review with Agent #32
- Done when: design review session held; comments captured.
- Output: `docs/team/frontend/audit-integrity-review.md`.
- Verify: design tokens consumed; PII never displayed.
- Reviewer: Agent #14, Agent #32.
- Depends on: A03-W2-Mon.

**A03-W2-Wed (2026-06-03)** — Polish PR review queue triage
- Done when: open frontend polish PRs reviewed; staleness flagged.
- Output: PR review thread comments.
- Verify: PR review backlog under 5.
- Reviewer: Agent #14, Agent #15, Agent #16.
- Depends on: A03-W2-Tue.

**A03-W2-Thu (2026-06-04)** — Lighthouse perf baseline measured
- Done when: Lighthouse scores captured for all dashboard routes.
- Output: `docs/team/frontend/lighthouse-baseline-2026-06-04.md`.
- Verify: every route has a row; baseline targets set (≥ 90 by phase 1 exit).
- Reviewer: Agent #14.
- Depends on: A03-W2-Wed.

**A03-W2-Fri (2026-06-05)** — Phase 0 frontend exit sign-off + Friday status read
- Done when: frontend P0 deliverables green; 3 statuses read.
- Output: `docs/team/phase-exits/phase-0-frontend-signoff.md`.
- Verify: C-006 merged in `dev`.
- Reviewer: Agent #1.
- Depends on: A03-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A03-W3-Mon (2026-06-08)** — Sprint 1 frontend kickoff + kiosk web app spec sync
- Done when: Agent #15 briefed on kiosk skeleton plan.
- Output: `docs/team/frontend/kiosk-spec-v0.md`.
- Verify: includes SSE consumer flow + QR generator design.
- Reviewer: Agent #15, Agent #32.
- Depends on: A01-W3-Mon.

**A03-W3-Tue (2026-06-09)** — Anchor Bank dashboard branded skin pass
- Done when: branded skin tokens drafted with Agent #32.
- Output: `docs/team/frontend/anchor-bank-skin.md`.
- Verify: design-token diff vs default theme captured.
- Reviewer: Agent #32.
- Depends on: A03-W3-Mon.

**A03-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + mobile-frontend handoff
- Done when: sync attended; QR-pairing protocol agreed for mobile + kiosk.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1, Agent #4.
- Depends on: A03-W3-Tue.

**A03-W3-Thu (2026-06-11)** — Begin review of C-107 (users view)
- Done when: first-pass review submitted.
- Output: PR comments on C-107.
- Verify: PII-blacklist Playwright assertion mentioned in review.
- Reviewer: Agent #14, Agent #39.
- Depends on: C-107 opened.

**A03-W3-Fri (2026-06-12)** — Friday status read + Lighthouse re-check
- Done when: 3 statuses read; Lighthouse run post-skin work.
- Output: `docs/team/frontend/s1-mid-lighthouse.md`.
- Verify: no regression vs baseline.
- Reviewer: Agent #14.
- Depends on: A03-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A03-W4-Mon (2026-06-15)** — Final review C-107
- Done when: PR APPROVE; users-view PII-blacklist test green.
- Output: PR APPROVE.
- Verify: merge to `dev`.
- Reviewer: Agent #14, Agent #39.
- Depends on: A03-W3-Thu.

**A03-W4-Tue (2026-06-16)** — Kiosk skeleton PR pre-review with Agent #15
- Done when: kiosk skeleton PR draft reviewed pre-merge.
- Output: PR comments on draft.
- Verify: kiosk skeleton renders an authenticated QR.
- Reviewer: Agent #15.
- Depends on: A03-W3-Mon.

**A03-W4-Wed (2026-06-17)** — Storybook coverage check + frontend test-coverage diff
- Done when: storybook covers each new component; test coverage delta logged.
- Output: `docs/team/frontend/coverage-w4.md`.
- Verify: coverage ≥ baseline.
- Reviewer: Agent #14.
- Depends on: A03-W4-Mon.

**A03-W4-Thu (2026-06-18)** — Sprint 1 frontend exit-gate sign-off
- Done when: frontend section of S1 exit gate green.
- Output: `docs/team/sprint-exits/s1-frontend.md`.
- Verify: C-006, C-107 merged.
- Reviewer: Agent #1.
- Depends on: A01-W4-Thu.

**A03-W4-Fri (2026-06-19)** — Sprint 2 dispatch + Friday status read
- Done when: sprint-2 daily tickets generated for Agents #14, #15, #16.
- Output: `docs/team/frontend/sprint-2-daily-dispatch.md`.
- Verify: each agent has 5 daily tickets for week 5.
- Reviewer: Agent #1.
- Depends on: A03-W4-Thu.
