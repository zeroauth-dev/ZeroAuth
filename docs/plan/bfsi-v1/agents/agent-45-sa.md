# Agent #45 — Solutions Architect (pre-sales)

**Reports to:** Agent #42.
**Mandate:** Owns technical pre-sales — runs live demos, drafts integration architecture, signs technical SOW.
**KPIs:** see role 45 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A45-W1-Mon (2026-05-25)** — Integration architecture template draft
- Done when: 3 reference architectures (net-banking, branch teller, txn step-up) drafted.
- Output: `docs/integrations/reference-architectures.md` v0.
- Verify: each architecture diagrammed.
- Reviewer: Agent #10.
- Depends on: A42-W1-Mon.

**A45-W1-Tue (2026-05-26)** — Bank-demo spec deep review (`02-bank-demo.md`)
- Done when: spec reviewed end-to-end; gaps flagged.
- Output: review comments.
- Verify: every scene reviewed.
- Reviewer: Agent #28.
- Depends on: A45-W1-Mon.

**A45-W1-Wed (2026-05-27)** — Demo equipment kit specced
- Done when: laptop, Pixel 7, Samsung S22, R307 sensor, OTG cable, projection adapters specced.
- Output: `docs/gtm/demo-equipment-kit.md`.
- Verify: every item has SKU + vendor.
- Reviewer: Agent #50.
- Depends on: A45-W1-Tue.

**A45-W1-Thu (2026-05-28)** — Demo equipment ordered
- Done when: order placed; ETA confirmed.
- Output: order ref.
- Verify: items in pipeline.
- Reviewer: Agent #50.
- Depends on: A45-W1-Wed.

**A45-W1-Fri (2026-05-29)** — Status post + Scene 1 + 2 demo dry-run prep
- Done when: prep notes for scenes 1 + 2 dry run with engineering.
- Output: `docs/gtm/scene-1-2-dry-run-prep.md`.
- Verify: schedule + script ready.
- Reviewer: Agent #29.
- Depends on: A45-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A45-W2-Mon (2026-06-01)** — Reference architectures v1
- Done when: architectures updated with engineering inputs.
- Output: PR.
- Verify: reviewed by Agent #10.
- Reviewer: Agent #10.
- Depends on: A45-W1-Fri.

**A45-W2-Tue (2026-06-02)** — Scene 4 (breach simulation) script v1
- Done when: operator script for Scene 4 drafted.
- Output: contribution to `02-bank-demo.md`.
- Verify: legal disclaimer + DPDP §2(t) reference.
- Reviewer: Agents #29, #37.
- Depends on: A45-W2-Mon.

**A45-W2-Wed (2026-06-03)** — Scene 5 (audit-integrity tamper) script v1
- Done when: operator script for Scene 5 drafted.
- Output: contribution to `02-bank-demo.md`.
- Verify: tamper demo path safe (sandbox schema only).
- Reviewer: Agents #8, #25.
- Depends on: A45-W2-Tue.

**A45-W2-Thu (2026-06-04)** — Demo equipment kit assembled
- Done when: kit items received; inventory checked.
- Output: `docs/gtm/demo-kit-inventory-2026-06-04.md`.
- Verify: every item logged.
- Reviewer: Agent #50.
- Depends on: A45-W1-Thu.

**A45-W2-Fri (2026-06-05)** — Phase 0 SA sign-off + status post
- Done when: reference architectures + demo equipment + scene scripts current.
- Output: row in Phase 0 exit doc.
- Verify: assets ready.
- Reviewer: Agent #42.
- Depends on: A45-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A45-W3-Mon (2026-06-08)** — Demo dry-run with engineering team — Scenes 1 + 2
- Done when: scenes 1 + 2 dry-run; gaps captured.
- Output: `docs/gtm/dry-run-scenes-1-2-2026-06-08.md`.
- Verify: each scene runs in script.
- Reviewer: Agents #1, #4, #17.
- Depends on: A45-W2-Fri.

**A45-W3-Tue (2026-06-09)** — Bank-CISO Q&A bank contribution
- Done when: SA contributions to Q&A bank.
- Output: PR contribution to `02-bank-demo.md`.
- Verify: technical answers complete.
- Reviewer: Agent #29.
- Depends on: A45-W3-Mon.

**A45-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + integration SOW template
- Done when: SOW template for integration phase drafted.
- Output: `docs/gtm/integration-sow-template.md`.
- Verify: scope + timeline + deliverables captured.
- Reviewer: Agent #42.
- Depends on: A45-W3-Tue.

**A45-W3-Thu (2026-06-11)** — Intro-call prep with Agents #43 + #44
- Done when: SA briefs prepped for first AE intro calls.
- Output: prep notes.
- Verify: 2 prep sessions held.
- Reviewer: Agent #42.
- Depends on: A45-W3-Wed.

**A45-W3-Fri (2026-06-12)** — Status post + Anchor Bank runbook outline contribution
- Done when: contribution to Agent #35's runbook outline.
- Output: PR contribution.
- Verify: SA voice present.
- Reviewer: Agent #35.
- Depends on: A45-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A45-W4-Mon (2026-06-15)** — Demo dry-run #2 with engineering — Scenes 3 + 4 + 5
- Done when: scenes 3-5 dry-run.
- Output: `docs/gtm/dry-run-scenes-3-5-2026-06-15.md`.
- Verify: each scene runs in script.
- Reviewer: Agents #1, #6, #8.
- Depends on: A45-W3-Mon.

**A45-W4-Tue (2026-06-16)** — Demo dry-run #3 (full 22-min run)
- Done when: full demo dry-run executed.
- Output: `docs/gtm/dry-run-full-2026-06-16.md`.
- Verify: 22-min runtime achieved.
- Reviewer: Agents #1, #28, #42.
- Depends on: A45-W4-Mon.

**A45-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + first AE intro call SA presence
- Done when: SA present on Agent #43's or #44's intro call.
- Output: contribution notes.
- Verify: SA on call.
- Reviewer: Agent #42.
- Depends on: A43-W4-Mon.

**A45-W4-Thu (2026-06-18)** — Sprint 1 SA sign-off
- Done when: SA section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: 3 dry-runs completed; SOW template + reference architectures current.
- Reviewer: Agent #42.
- Depends on: A42-W4-Thu.

**A45-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (dry-runs cont., first demo execution support).
- Output: `docs/gtm/a45-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #42.
- Depends on: A45-W4-Thu.
