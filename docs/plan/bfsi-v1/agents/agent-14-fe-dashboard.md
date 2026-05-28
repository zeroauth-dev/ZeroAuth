# Agent #14 — Senior Frontend Engineer (admin dashboard)

**Reports to:** Agent #3.
**Mandate:** Owns the React admin dashboard — tenant overview, users view, audit events, audit integrity, billing.
**KPIs:** see role 14 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A14-W1-Mon (2026-05-25)** — Dashboard SSE migration design (precursor C-006)
- Done when: design covers `withCredentials: true`, CSRF token approach, reconnect logic.
- Output: `docs/team/frontend/dashboard-sse-migration-design.md`.
- Verify: design reviewed by Agent #3.
- Reviewer: Agents #3, #7.
- Depends on: A03-W1-Mon.

**A14-W1-Tue (2026-05-26)** — Write red tests for C-006
- Done when: `dashboard/src/lib/__tests__/sse.test.ts::"EventSource opened with withCredentials"` red.
- Output: PR draft.
- Verify: tests fail before implementation.
- Reviewer: Agent #23.
- Depends on: A14-W1-Mon.

**A14-W1-Wed (2026-05-27)** — Implement C-006 — first half (EventSource migration)
- Done when: `dashboard/src/lib/sse.ts` skeleton + refactor in api.ts.
- Output: PR draft.
- Verify: red tests now green.
- Reviewer: Agent #3.
- Depends on: A14-W1-Tue.

**A14-W1-Thu (2026-05-28)** — Implement C-006 — second half (QrProofLogin update)
- Done when: `dashboard/src/routes/demo/QrProofLogin.tsx` updated to use new SSE; no `?access_token=` in URL.
- Output: C-006 PR.
- Verify: end-to-end SSE smoke against test env.
- Reviewer: Agents #3, #7.
- Depends on: A14-W1-Wed.

**A14-W1-Fri (2026-05-29)** — Status post + storybook coverage of `sse.ts`
- Done when: status posted; storybook stories cover `sse.ts` consumer hook.
- Output: storybook stories committed.
- Verify: storybook builds clean.
- Reviewer: Agent #3.
- Depends on: A14-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A14-W2-Mon (2026-06-01)** — Audit-integrity dashboard view design
- Done when: design covers PASS/FAIL state, anchor tx hash + Basescan link, "integrity check now" button.
- Output: `docs/team/frontend/audit-integrity-view-design.md`.
- Verify: design tokens consumed; no PII rendered.
- Reviewer: Agents #3, #32.
- Depends on: A14-W1-Fri.

**A14-W2-Tue (2026-06-02)** — Audit-integrity view design review with Agent #32
- Done when: design review session; comments captured.
- Output: revised design.
- Verify: design tokens consumed.
- Reviewer: Agent #32.
- Depends on: A14-W2-Mon.

**A14-W2-Wed (2026-06-03)** — Polish PR triage + dashboard design-system audit follow-ups
- Done when: open polish PRs reviewed; backlog < 5.
- Output: PR comments.
- Verify: review backlog logged.
- Reviewer: Agent #3.
- Depends on: A14-W2-Tue.

**A14-W2-Thu (2026-06-04)** — Lighthouse baseline measurement for all dashboard routes
- Done when: Lighthouse run on every route; scores captured.
- Output: contribution to `docs/team/frontend/lighthouse-baseline-2026-06-04.md`.
- Verify: every route has a row.
- Reviewer: Agent #3.
- Depends on: A14-W2-Wed.

**A14-W2-Fri (2026-06-05)** — Phase 0 dashboard sign-off + status post
- Done when: dashboard section of Phase 0 exit green.
- Output: row in `docs/team/phase-exits/phase-0-frontend-signoff.md`.
- Verify: C-006 merged + storybook live.
- Reviewer: Agent #3.
- Depends on: A14-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A14-W3-Mon (2026-06-08)** — Users view design implementation kickoff
- Done when: `dashboard/src/routes/tenant/users.tsx` skeleton with allowed-columns enforcement.
- Output: PR draft for C-107.
- Verify: skeleton renders without server data.
- Reviewer: Agent #3.
- Depends on: A14-W2-Fri.

**A14-W3-Tue (2026-06-09)** — Users view API integration with Agent #7
- Done when: users API client landed; React Query hook scoped to tenant.
- Output: PR contribution to C-107.
- Verify: hook respects tenant_id + environment.
- Reviewer: Agent #7.
- Depends on: A14-W3-Mon.

**A14-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #3.
- Depends on: A14-W3-Tue.

**A14-W3-Thu (2026-06-11)** — C-107 PR opened + PII-blacklist Playwright assertion
- Done when: C-107 PR opened; Playwright assertion that no PII field is ever rendered green.
- Output: C-107 PR.
- Verify: `dashboard/src/routes/tenant/__tests__/users.test.tsx::"never renders an email or name field"` green.
- Reviewer: Agents #3, #39.
- Depends on: A14-W3-Wed.

**A14-W3-Fri (2026-06-12)** — Status post + Lighthouse re-check
- Done when: status posted; Lighthouse run post-users-view.
- Output: contribution to `docs/team/frontend/s1-mid-lighthouse.md`.
- Verify: no regression vs baseline.
- Reviewer: Agent #3.
- Depends on: A14-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A14-W4-Mon (2026-06-15)** — Address feedback on C-107
- Done when: feedback addressed; APPROVE secured.
- Output: PR updates.
- Verify: Playwright suite green.
- Reviewer: Agents #3, #39.
- Depends on: A14-W3-Thu.

**A14-W4-Tue (2026-06-16)** — Audit-integrity view component implementation (precursor to C-123)
- Done when: `IntegrityCheckCard` component + skeleton view landed in a feature branch.
- Output: PR draft.
- Verify: storybook stories show PASS + FAIL states.
- Reviewer: Agent #3.
- Depends on: A14-W4-Mon.

**A14-W4-Wed (2026-06-17)** — Storybook coverage + test-coverage diff review
- Done when: storybook covers all new components; coverage delta logged.
- Output: contribution to `docs/team/frontend/coverage-w4.md`.
- Verify: coverage ≥ baseline.
- Reviewer: Agent #3.
- Depends on: A14-W4-Tue.

**A14-W4-Thu (2026-06-18)** — Sprint 1 dashboard sign-off
- Done when: dashboard section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: C-107 merged; audit-integrity skeleton ready for sprint 2.
- Reviewer: Agent #3.
- Depends on: A14-W4-Wed.

**A14-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (C-123 audit-integrity view + C-124 audit-anchors sub-view).
- Output: `docs/team/frontend/a14-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #3.
- Depends on: A14-W4-Thu.
