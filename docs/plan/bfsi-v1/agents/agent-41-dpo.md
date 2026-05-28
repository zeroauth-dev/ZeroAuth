# Agent #41 — Data Protection Officer (DPO)

**Reports to:** Agent #36.
**Mandate:** Owns DPO function under DPDP §10, customer data-subject requests, regulator notifications, breach response.
**KPIs:** see role 41 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A41-W1-Mon (2026-05-25)** — DPO appointment prep
- Done when: DPO appointment paperwork prepared for filing with Data Protection Board.
- Output: `docs/compliance/dpdp/dpo-appointment-prep.md`.
- Verify: DPB filing requirements catalogued.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A41-W1-Tue (2026-05-26)** — DSR handling SOP v0
- Done when: SOP for data-subject requests (access, correction, deletion, portability) drafted.
- Output: `docs/compliance/dpdp/dsr-sop-v0.md`.
- Verify: 30-day SLA captured.
- Reviewer: Agent #36.
- Depends on: A41-W1-Mon.

**A41-W1-Wed (2026-05-27)** — Privacy notice v0
- Done when: customer-facing privacy notice drafted.
- Output: `docs/compliance/dpdp/privacy-notice-v0.md`.
- Verify: covers DPDP §5 requirements.
- Reviewer: Agents #36, #37.
- Depends on: A41-W1-Tue.

**A41-W1-Thu (2026-05-28)** — DPDP §2(t) memo collaboration with Agents #35 + #37
- Done when: contributions to memo skeleton.
- Output: PR contribution.
- Verify: DPO perspective captured.
- Reviewer: Agents #35, #37.
- Depends on: A41-W1-Wed.

**A41-W1-Fri (2026-05-29)** — Status post + breach-notification SOP draft
- Done when: SOP drafted (detection → triage → DPB notification within 72 h → user comms).
- Output: `docs/compliance/dpdp/breach-notification-sop-v0.md`.
- Verify: 72 h SLA + DPB notification path.
- Reviewer: Agent #36.
- Depends on: A41-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A41-W2-Mon (2026-06-01)** — DSR endpoint design (precursor — Phase 2 deliverable)
- Done when: `/v1/dsr/*` endpoints designed (access, correction, deletion).
- Output: `docs/compliance/dpdp/dsr-endpoint-design.md`.
- Verify: design covers verification, response time, audit row.
- Reviewer: Agents #6, #36.
- Depends on: A41-W1-Fri.

**A41-W2-Tue (2026-06-02)** — Data-localisation audit on current stack
- Done when: data flows audited; cross-border flows identified (none in `live` env).
- Output: `docs/compliance/dpdp/data-localisation-audit.md`.
- Verify: 100 % `live` env in ap-south-1 confirmed.
- Reviewer: Agents #5, #21.
- Depends on: A41-W2-Mon.

**A41-W2-Wed (2026-06-03)** — Vendor DPA inventory
- Done when: every vendor with personal-data access has a DPA on file (or path to one).
- Output: `docs/compliance/dpdp/vendor-dpa-inventory.md`.
- Verify: covers all vendors.
- Reviewer: Agent #50.
- Depends on: A41-W2-Tue.

**A41-W2-Thu (2026-06-04)** — Privacy notice v1
- Done when: notice updated with sources of personal data, recipients, retention, rights.
- Output: PR.
- Verify: notice ready for publication on landing page.
- Reviewer: Agent #16.
- Depends on: A41-W2-Wed.

**A41-W2-Fri (2026-06-05)** — Phase 0 DPO sign-off + status post
- Done when: DPO docs in place; DPB filing scheduled.
- Output: row in Phase 0 exit doc.
- Verify: documents ready for filing.
- Reviewer: Agent #36.
- Depends on: A41-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A41-W3-Mon (2026-06-08)** — Privacy notice published on landing page (with Agent #16)
- Done when: privacy notice live.
- Output: published page.
- Verify: linked from every landing page footer.
- Reviewer: Agent #16.
- Depends on: A41-W2-Thu.

**A41-W3-Tue (2026-06-09)** — DSR handling SOP v1 (with input from Agent #6)
- Done when: SOP refined post-design review.
- Output: PR for `docs/compliance/dpdp/dsr-sop-v1.md`.
- Verify: 30-day SLA + escalation captured.
- Reviewer: Agent #36.
- Depends on: A41-W3-Mon.

**A41-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + DPDP §13 cross-border review
- Done when: cross-border treatment reviewed with Agent #37.
- Output: review comments.
- Verify: aligns with §2(t) treatment.
- Reviewer: Agent #37.
- Depends on: A41-W3-Tue.

**A41-W3-Thu (2026-06-11)** — Breach-notification table-top with Agent #40
- Done when: breach-notification scenario tabletop run.
- Output: contribution to `docs/compliance/risk/tabletop-v0-audit-tamper.md`.
- Verify: notification path tested.
- Reviewer: Agent #40.
- Depends on: A40-W3-Tue.

**A41-W3-Fri (2026-06-12)** — Status post + DPB filing executed
- Done when: DPO filing submitted to DPB.
- Output: filing ref.
- Verify: ref logged.
- Reviewer: Agent #36.
- Depends on: A41-W3-Mon.

## Week 4 (2026-06-15 → 2026-06-19)

**A41-W4-Mon (2026-06-15)** — DPDP §2(t) memo v1 review with Agent #37
- Done when: memo reviewed; DPO perspective added.
- Output: review comments.
- Verify: addresses DPDP §2(t) treatment + commitments.
- Reviewer: Agents #35, #37.
- Depends on: A35-W3-Tue.

**A41-W4-Tue (2026-06-16)** — DPO escalation register
- Done when: register set up to track regulator queries + DSR escalations.
- Output: `docs/compliance/dpdp/dpo-escalation-register.md`.
- Verify: structure ready for use.
- Reviewer: Agent #36.
- Depends on: A41-W4-Mon.

**A41-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + RBI DPO interface
- Done when: RBI interface for DPO matters captured (where DPO role intersects with RBI inspections).
- Output: `docs/compliance/dpdp/dpo-rbi-interface.md`.
- Verify: 3 intersections documented.
- Reviewer: Agent #37.
- Depends on: A41-W4-Tue.

**A41-W4-Thu (2026-06-18)** — Sprint 1 DPO sign-off
- Done when: DPO section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: DPB filing submitted + DSR SOP live + privacy notice published.
- Reviewer: Agent #36.
- Depends on: A36-W4-Thu.

**A41-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (DSR endpoint implementation oversight, breach tabletop run #2).
- Output: `docs/compliance/dpdp/a41-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A41-W4-Thu.
