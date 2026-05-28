# Agent #32 — Senior Designer (Dashboard UX)

**Reports to:** Agent #28.
**Mandate:** Owns dashboard visual + interaction design, design system, demo's projector aesthetics.
**KPIs:** see role 32 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A32-W1-Mon (2026-05-25)** — Design-system audit kickoff (with Agent #3)
- Done when: existing tokens (spacing, typography, colour, motion) inventoried.
- Output: contribution to `docs/team/frontend/design-token-audit-w1.md`.
- Verify: every token has a Figma reference.
- Reviewer: Agent #3.
- Depends on: A03-W1-Mon.

**A32-W1-Tue (2026-05-26)** — Anchor Bank demo-friendly theme palette exploration
- Done when: 3 palette options drafted with high-contrast + projector-friendly variants.
- Output: Figma file + `docs/team/design/anchor-bank-palette.md`.
- Verify: each palette tested against contrast ratios.
- Reviewer: Agent #3.
- Depends on: A32-W1-Mon.

**A32-W1-Wed (2026-05-27)** — Users-view mock with allowed-columns-only treatment
- Done when: users-view mock in Figma with only DID, commitment, tenant, created_at columns.
- Output: Figma file.
- Verify: no PII shown; column allowlist respected.
- Reviewer: Agents #14, #39.
- Depends on: A32-W1-Tue.

**A32-W1-Thu (2026-05-28)** — Audit-events table density study
- Done when: streaming row density + colour-coded severity bands explored.
- Output: Figma file.
- Verify: reads at 5 rows/sec without strobing.
- Reviewer: Agent #14.
- Depends on: A32-W1-Wed.

**A32-W1-Fri (2026-05-29)** — Status post + projector-friendly demo-day theme finalised
- Done when: final theme + variants ready.
- Output: design-tokens commit + Figma file.
- Verify: theme renders well at 3m projection distance.
- Reviewer: Agent #45.
- Depends on: A32-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A32-W2-Mon (2026-06-01)** — Audit-integrity view mock
- Done when: PASS / FAIL state mocks + on-chain anchor link treatment in Figma.
- Output: Figma file.
- Verify: clear semantic colour use; Basescan logo treatment.
- Reviewer: Agents #3, #14.
- Depends on: A32-W1-Fri.

**A32-W2-Tue (2026-06-02)** — Audit-anchors sub-view mock
- Done when: anchors table mock with status + tx hash + Basescan link.
- Output: Figma file.
- Verify: spacing consistent with tokens.
- Reviewer: Agent #14.
- Depends on: A32-W2-Mon.

**A32-W2-Wed (2026-06-03)** — Design review session with Agent #14 + Agent #3
- Done when: audit-integrity + audit-anchors mocks reviewed.
- Output: revised mocks.
- Verify: feedback applied.
- Reviewer: Agents #3, #14.
- Depends on: A32-W2-Tue.

**A32-W2-Thu (2026-06-04)** — Accessibility audit on dashboard
- Done when: Lighthouse accessibility ≥ 95 target tracked across critical routes.
- Output: `docs/team/design/dashboard-a11y-audit.md`.
- Verify: each route has score.
- Reviewer: Agent #3.
- Depends on: A32-W2-Wed.

**A32-W2-Fri (2026-06-05)** — Phase 0 design sign-off + status post
- Done when: tokens + Anchor Bank palette + users view mock + audit-integrity mock ready.
- Output: row in Phase 0 exit doc.
- Verify: design assets in Figma + referenced.
- Reviewer: Agent #28.
- Depends on: A32-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A32-W3-Mon (2026-06-08)** — Kiosk demo design v0
- Done when: kiosk full-screen QR layout + post-verify success state designed.
- Output: Figma file.
- Verify: layout works on 22"+ kiosk displays.
- Reviewer: Agents #15, #20.
- Depends on: A32-W2-Fri.

**A32-W3-Tue (2026-06-09)** — Anchor Bank skin tokens drafted with Agent #3
- Done when: branded skin tokens diffed from default.
- Output: contribution to `docs/team/frontend/anchor-bank-skin.md`.
- Verify: tokens captured.
- Reviewer: Agent #3.
- Depends on: A32-W3-Mon.

**A32-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #3.
- Depends on: A32-W3-Tue.

**A32-W3-Thu (2026-06-11)** — Bank-CISO usability test plan
- Done when: usability test plan for Scene 4 (breach simulation) view designed.
- Output: `docs/team/design/scene-4-usability-test-plan.md`.
- Verify: covers psql admin shell layout + DPDP §2(t) reading flow.
- Reviewer: Agent #29.
- Depends on: A32-W3-Wed.

**A32-W3-Fri (2026-06-12)** — Status post + first usability test run with mock CISO
- Done when: 1 internal usability test run; insights captured.
- Output: `docs/team/design/usability-test-2026-06-12.md`.
- Verify: top-3 insights logged.
- Reviewer: Agent #29.
- Depends on: A32-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A32-W4-Mon (2026-06-15)** — Operator console helpers design (precursor C-187 + C-188)
- Done when: operator console helpers (breach-sim toggle, audit-tamper-demo toggle) designed.
- Output: Figma file.
- Verify: helpers clearly demarcated as operator-only.
- Reviewer: Agents #14, #15, #45.
- Depends on: A32-W3-Fri.

**A32-W4-Tue (2026-06-16)** — Kiosk demo-day UX run-through with Agent #15
- Done when: visual run-through done; final fixes captured.
- Output: revised Figma + notes.
- Verify: Anchor Bank skin renders on projection.
- Reviewer: Agent #15.
- Depends on: A32-W4-Mon.

**A32-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + workforce-mode tile design (precursor C-189)
- Done when: workforce-mode tenant tile mock drafted.
- Output: Figma file.
- Verify: design hints workforce vs consumer mode visually.
- Reviewer: Agent #14.
- Depends on: A32-W4-Tue.

**A32-W4-Thu (2026-06-18)** — Sprint 1 design sign-off
- Done when: design section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: kiosk + audit-integrity + Anchor Bank skin all ready.
- Reviewer: Agent #28.
- Depends on: A28-W4-Thu.

**A32-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted.
- Output: `docs/team/design/a32-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #28.
- Depends on: A32-W4-Thu.
