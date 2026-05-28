# Agent #30 — PM (Healthcare)

**Reports to:** Agent #28.
**Mandate:** Owns healthcare vertical roadmap, ABDM integration spec, hospital chain pilot research.
**KPIs:** see role 30 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A30-W1-Mon (2026-05-25)** — ABDM landscape review
- Done when: ABDM (Ayushman Bharat Digital Mission) architecture studied; HRP (Health Record Provider) + HIP (Health Information Provider) + HIU (Health Information User) roles understood.
- Output: `docs/product/healthcare/abdm-landscape.md`.
- Verify: covers ABHA, M3 milestones, regulatory body (NHA).
- Reviewer: Agent #28.
- Depends on: A28-W1-Mon.

**A30-W1-Tue (2026-05-26)** — Healthcare regulatory inventory
- Done when: HMIS regulations, DPDP §8 healthcare-specific provisions, NDHB act review.
- Output: `docs/product/healthcare/regulatory-inventory.md`.
- Verify: cross-references DPDP + DISHA bill (if applicable).
- Reviewer: Agent #37.
- Depends on: A30-W1-Mon.

**A30-W1-Wed (2026-05-27)** — Target healthcare partners shortlist
- Done when: 5 hospital chains identified (Apollo, Manipal, Fortis, Narayana, Max).
- Output: `docs/product/healthcare/target-partner-shortlist.md`.
- Verify: each partner has decision-maker contact + technical posture.
- Reviewer: Agent #28.
- Depends on: A30-W1-Tue.

**A30-W1-Thu (2026-05-28)** — Healthcare pain-points draft v0
- Done when: top-7 healthcare pain points listed (patient identity, ABHA linkage, lab-report fraud, prescription tampering, doctor authentication, EMR access logs, telemedicine identity).
- Output: `docs/product/healthcare/pain-points-v0.md`.
- Verify: 7 pains with cost-of-pain numbers.
- Reviewer: Agent #28.
- Depends on: A30-W1-Wed.

**A30-W1-Fri (2026-05-29)** — Status post + healthcare deferral memo input
- Done when: healthcare scope for Phase 2 finalised; input to Agent #28's deferral memo.
- Output: contribution to `docs/product/healthcare-deferral-memo.md`.
- Verify: clear scope + revisit date.
- Reviewer: Agent #28.
- Depends on: A30-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A30-W2-Mon (2026-06-01)** — Healthcare deferral memo published
- Done when: memo distributed to Agents #36, #42, #46.
- Output: published memo.
- Verify: revisit date scheduled.
- Reviewer: Agent #28.
- Depends on: A30-W1-Fri.

**A30-W2-Tue (2026-06-02)** — ABDM integration architecture v0
- Done when: draft architecture for ZeroAuth as ABHA-bridge captured.
- Output: `docs/product/healthcare/abdm-integration-architecture-v0.md`.
- Verify: covers ABHA → DID linkage scenario.
- Reviewer: Agents #10, #11.
- Depends on: A30-W2-Mon.

**A30-W2-Wed (2026-06-03)** — Hospital pilot scoping (Apollo + Manipal)
- Done when: pilot scope for 2 hospital chains drafted (60-day pilot, OPD only, doctor-auth focus).
- Output: `docs/product/healthcare/pilot-scope-apollo-manipal.md`.
- Verify: scope reviewable.
- Reviewer: Agents #28, #46.
- Depends on: A30-W2-Tue.

**A30-W2-Thu (2026-06-04)** — Healthcare-vs-BFSI feature differential
- Done when: feature differential matrix drafted.
- Output: `docs/product/healthcare/feature-differential.md`.
- Verify: identifies healthcare-specific features (ABHA linkage, EMR access scope).
- Reviewer: Agent #28.
- Depends on: A30-W2-Wed.

**A30-W2-Fri (2026-06-05)** — Phase 0 healthcare PM sign-off + status post
- Done when: healthcare pre-work landed in `docs/product/healthcare/`.
- Output: row in Phase 0 exit doc.
- Verify: doc tree current.
- Reviewer: Agent #28.
- Depends on: A30-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A30-W3-Mon (2026-06-08)** — Healthcare pain-points v1
- Done when: pain-points v1 with cost-of-pain numbers validated by 1 industry analyst.
- Output: PR for `docs/product/healthcare/pain-points-v1.md`.
- Verify: every pain has citation.
- Reviewer: Agent #28.
- Depends on: A30-W2-Fri.

**A30-W3-Tue (2026-06-09)** — Target healthcare partners outreach plan
- Done when: outreach calendar for 5 partners drafted for Phase 2 (weeks 13+).
- Output: `docs/product/healthcare/outreach-calendar.md`.
- Verify: 5 partners with dates.
- Reviewer: Agent #28.
- Depends on: A30-W3-Mon.

**A30-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #28.
- Depends on: A30-W3-Tue.

**A30-W3-Thu (2026-06-11)** — Healthcare demo storyboard draft
- Done when: storyboard for healthcare demo drafted (scene 1: patient ABHA linkage, scene 2: doctor auth at OPD, scene 3: EMR access).
- Output: `docs/product/healthcare/demo-storyboard.md`.
- Verify: 3 scenes captured.
- Reviewer: Agent #28.
- Depends on: A30-W3-Wed.

**A30-W3-Fri (2026-06-12)** — Status post + ABDM technical contact established
- Done when: technical contact at NHA / ABDM Sandbox identified.
- Output: `docs/product/healthcare/abdm-technical-contacts.md`.
- Verify: contact + interaction log.
- Reviewer: Agent #28.
- Depends on: A30-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A30-W4-Mon (2026-06-15)** — ABDM sandbox account creation
- Done when: ZeroAuth tagged HIU sandbox account created.
- Output: sandbox account ref.
- Verify: sandbox accessible.
- Reviewer: Agent #28.
- Depends on: A30-W3-Fri.

**A30-W4-Tue (2026-06-16)** — Healthcare demo storyboard v0.1 with pilots input
- Done when: storyboard refined with 1 hospital partner conversation.
- Output: PR.
- Verify: feedback applied.
- Reviewer: Agent #28.
- Depends on: A30-W4-Mon.

**A30-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #28.
- Depends on: A30-W4-Tue.

**A30-W4-Thu (2026-06-18)** — Sprint 1 healthcare PM sign-off
- Done when: healthcare PM section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: pain-points v1 + outreach calendar + storyboard ready.
- Reviewer: Agent #28.
- Depends on: A28-W4-Thu.

**A30-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (ABDM sandbox integration spike).
- Output: `docs/product/healthcare/a30-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #28.
- Depends on: A30-W4-Thu.
