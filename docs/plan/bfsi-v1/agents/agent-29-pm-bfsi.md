# Agent #29 — Senior PM (BFSI)

**Reports to:** Agent #28.
**Mandate:** Owns bank demo, BFSI pain-point research, bank-CISO/CFO/CRO narrative.
**KPIs:** see role 29 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A29-W1-Mon (2026-05-25)** — Per-bank intel pack kickoff (HDFC + ICICI)
- Done when: intel pack drafted: CISO name, recent breach/audit posture, RBI inspection cycle.
- Output: `docs/product/bank-intel/hdfc.md`, `icici.md`.
- Verify: 5 fields per bank: CISO, CFO, CRO, CIO, last RBI inspection date.
- Reviewer: Agent #28.
- Depends on: A28-W1-Mon.

**A29-W1-Tue (2026-05-26)** — Per-bank intel pack (Axis + SBI YONO)
- Done when: 2 more bank intel packs drafted.
- Output: `docs/product/bank-intel/axis.md`, `sbi-yono.md`.
- Verify: 5 fields per bank.
- Reviewer: Agent #28.
- Depends on: A29-W1-Mon.

**A29-W1-Wed (2026-05-27)** — Per-bank intel pack (IDFC First + RBL)
- Done when: 2 more bank intel packs drafted.
- Output: `docs/product/bank-intel/idfc-first.md`, `rbl.md`.
- Verify: 5 fields per bank.
- Reviewer: Agent #28.
- Depends on: A29-W1-Tue.

**A29-W1-Thu (2026-05-28)** — Bank-CISO Q&A bank expansion in `02-bank-demo.md`
- Done when: Q&A bank now has bank-specific lines (e.g., HDFC-style RBI question, ICICI-style breach question).
- Output: PR.
- Verify: 6 bank-specific questions added.
- Reviewer: Agent #28.
- Depends on: A29-W1-Wed.

**A29-W1-Fri (2026-05-29)** — Status post + pain-point quantification cross-check
- Done when: cost-of-pain numbers validated against 2 industry analyst sources.
- Output: `docs/product/pain-point-validation.md`.
- Verify: every cost figure cited.
- Reviewer: Agent #28.
- Depends on: A29-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A29-W2-Mon (2026-06-01)** — Pain-points v1.1 PR
- Done when: → `01-pain-points.md` updated with validation; new sources cited.
- Output: PR.
- Verify: every pain has at least 1 cited source.
- Reviewer: Agent #28.
- Depends on: A29-W1-Fri.

**A29-W2-Tue (2026-06-02)** — Bank-CISO interview pre-work
- Done when: 3 banker-CISO interview scripts drafted for upcoming first calls.
- Output: `docs/product/banker-interview-scripts.md`.
- Verify: each script ~10 questions.
- Reviewer: Agent #28.
- Depends on: A29-W2-Mon.

**A29-W2-Wed (2026-06-03)** — Working session with Agent #28 on CRO Q&A bank
- Done when: CRO-grade Q&A captured + integrated into `02-bank-demo.md`.
- Output: PR contribution.
- Verify: 10+ CRO questions answered.
- Reviewer: Agent #28.
- Depends on: A29-W2-Tue.

**A29-W2-Thu (2026-06-04)** — Demo Scene 4 (breach simulation) review with Agent #45
- Done when: Scene 4 script reviewed; corner cases captured.
- Output: review comments.
- Verify: legal disclaimer + DPDP §2(t) reference confirmed.
- Reviewer: Agent #45.
- Depends on: A29-W2-Wed.

**A29-W2-Fri (2026-06-05)** — Phase 0 PM sign-off + status post
- Done when: PM section of Phase 0 exit green.
- Output: row in Phase 0 exit doc.
- Verify: 6 bank intel packs + pain-points v1.1.
- Reviewer: Agent #28.
- Depends on: A29-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A29-W3-Mon (2026-06-08)** — Sprint 1 BFSI kickoff + outreach calendar
- Done when: per-bank outreach calendar drafted for weeks 13–14.
- Output: `docs/product/bfsi-outreach-calendar.md`.
- Verify: 6 banks scheduled.
- Reviewer: Agents #28, #42.
- Depends on: A28-W3-Mon.

**A29-W3-Tue (2026-06-09)** — Pain-points v1.2 with field-research increments
- Done when: 3 new bank conversations folded into pain-point doc.
- Output: PR.
- Verify: every increment cited.
- Reviewer: Agent #28.
- Depends on: A29-W3-Mon.

**A29-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #28.
- Depends on: A29-W3-Tue.

**A29-W3-Thu (2026-06-11)** — Bank-pitch deck v1 review (with Agent #48)
- Done when: deck reviewed; pain-point coverage confirmed.
- Output: deck comments.
- Verify: pitch matches pain-points doc.
- Reviewer: Agent #48.
- Depends on: A29-W3-Wed.

**A29-W3-Fri (2026-06-12)** — Status post + first-demo-invitation drafts
- Done when: invitations to top-3 banks drafted.
- Output: `docs/product/first-demo-invitations.md`.
- Verify: 3 invitations + legal LoI review pending.
- Reviewer: Agents #28, #42, #45.
- Depends on: A29-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A29-W4-Mon (2026-06-15)** — Legal LoI template review (with Agent #42)
- Done when: LoI template legally reviewed; ready for first demo follow-ups.
- Output: signed-off template.
- Verify: external legal review attached.
- Reviewer: Agent #42.
- Depends on: A29-W3-Fri.

**A29-W4-Tue (2026-06-16)** — Demo invitation drafts sent to Agents #43, #44 for personalisation
- Done when: drafts handed off; per-bank personalisation steps documented.
- Output: handover notes.
- Verify: each AE has their 3 invitations.
- Reviewer: Agents #43, #44.
- Depends on: A29-W4-Mon.

**A29-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + demo runbook contribution
- Done when: scene narrative refinements based on PM judgement.
- Output: contribution to `docs/operations/anchor-bank-demo-runbook.md`.
- Verify: PM voice present in operator script.
- Reviewer: Agent #45.
- Depends on: A29-W4-Tue.

**A29-W4-Thu (2026-06-18)** — Sprint 1 PM sign-off
- Done when: BFSI PM section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: pain-points v1.2 + invitations + LoI ready.
- Reviewer: Agent #28.
- Depends on: A28-W4-Thu.

**A29-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (demo execution support, post-demo follow-ups).
- Output: `docs/product/a29-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #28.
- Depends on: A29-W4-Thu.
