# Agent #46 — Customer Success Manager (BFSI)

**Reports to:** Agent #42.
**Mandate:** Owns post-sale BFSI relationships — pilots, QBRs, expansion, renewals.
**KPIs:** see role 46 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A46-W1-Mon (2026-05-25)** — Pilot lifecycle template draft
- Done when: lifecycle template covers kickoff → integration → soft launch → review → expansion.
- Output: `docs/gtm/pilot-lifecycle-template-v0.md`.
- Verify: 5 stages with deliverables.
- Reviewer: Agent #42.
- Depends on: A42-W1-Mon.

**A46-W1-Tue (2026-05-26)** — Bank-specific risk tracker template
- Done when: tracker template captures bank-specific delivery risks.
- Output: `docs/gtm/bank-risk-tracker-template.md`.
- Verify: covers integration, training, change-management risks.
- Reviewer: Agent #40.
- Depends on: A46-W1-Mon.

**A46-W1-Wed (2026-05-27)** — Quarterly business review (QBR) template
- Done when: QBR template drafted.
- Output: `docs/gtm/qbr-template-v0.md`.
- Verify: usage metrics, value delivered, roadmap section captured.
- Reviewer: Agent #42.
- Depends on: A46-W1-Tue.

**A46-W1-Thu (2026-05-28)** — Support escalation matrix
- Done when: 4-tier escalation matrix drafted.
- Output: `docs/gtm/support-escalation-matrix.md`.
- Verify: SLAs per tier.
- Reviewer: Agents #42, #21.
- Depends on: A46-W1-Wed.

**A46-W1-Fri (2026-05-29)** — Status post + customer-success measurement framework
- Done when: framework captures activation, adoption, retention, expansion metrics.
- Output: `docs/gtm/cs-metrics-framework.md`.
- Verify: 4 categories defined.
- Reviewer: Agent #42.
- Depends on: A46-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A46-W2-Mon (2026-06-01)** — Pilot kickoff agenda template
- Done when: kickoff agenda for bank pilot drafted.
- Output: `docs/gtm/pilot-kickoff-agenda-template.md`.
- Verify: stakeholder list + objectives + roadmap.
- Reviewer: Agent #42.
- Depends on: A46-W1-Fri.

**A46-W2-Tue (2026-06-02)** — Pilot scope drafting for first bank target
- Done when: pilot scope template populated for hypothetical first bank.
- Output: `docs/gtm/pilot-scope-template-first-bank.md`.
- Verify: scope reviewable.
- Reviewer: Agent #29.
- Depends on: A46-W2-Mon.

**A46-W2-Wed (2026-06-03)** — Customer-success playbook v0
- Done when: playbook captures per-stage activities + ownership.
- Output: `docs/gtm/cs-playbook-v0.md`.
- Verify: 5 stages × activities each.
- Reviewer: Agent #42.
- Depends on: A46-W2-Tue.

**A46-W2-Thu (2026-06-04)** — Healthcare deferral memo review (input)
- Done when: CS perspective added to memo.
- Output: contribution to `docs/product/healthcare-deferral-memo.md`.
- Verify: CS implications captured.
- Reviewer: Agent #30.
- Depends on: A30-W1-Fri.

**A46-W2-Fri (2026-06-05)** — Phase 0 CSM sign-off + status post
- Done when: pilot lifecycle + QBR + escalation matrix current.
- Output: row in Phase 0 exit doc.
- Verify: 6 templates published.
- Reviewer: Agent #42.
- Depends on: A46-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A46-W3-Mon (2026-06-08)** — CS-tooling decision (ChurnZero / Vitally / spreadsheet)
- Done when: tooling chosen for first pilot.
- Output: `docs/gtm/cs-tooling-decision.md`.
- Verify: rationale + cost captured.
- Reviewer: Agent #42.
- Depends on: A46-W2-Fri.

**A46-W3-Tue (2026-06-09)** — First pilot run-of-show simulation
- Done when: simulated full pilot run-of-show captured.
- Output: `docs/gtm/pilot-run-of-show-sim-1.md`.
- Verify: every stage simulated.
- Reviewer: Agent #42.
- Depends on: A46-W3-Mon.

**A46-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + onboarding-call template
- Done when: bank onboarding-call template drafted.
- Output: `docs/gtm/bank-onboarding-call-template.md`.
- Verify: covers SSO, webhook, IP allowlist, support contacts.
- Reviewer: Agent #10.
- Depends on: A46-W3-Tue.

**A46-W3-Thu (2026-06-11)** — CS playbook v1
- Done when: playbook refined post-simulation.
- Output: PR for v1.
- Verify: lessons applied.
- Reviewer: Agent #42.
- Depends on: A46-W3-Wed.

**A46-W3-Fri (2026-06-12)** — Status post + first pilot scope refinement
- Done when: pilot scope refined with engineering input.
- Output: PR.
- Verify: engineering capacity confirmed.
- Reviewer: Agents #1, #42.
- Depends on: A46-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A46-W4-Mon (2026-06-15)** — Health-score model design
- Done when: health-score model (1-10) per pilot drafted.
- Output: `docs/gtm/health-score-model.md`.
- Verify: input metrics defined.
- Reviewer: Agent #42.
- Depends on: A46-W3-Fri.

**A46-W4-Tue (2026-06-16)** — Bank-specific compliance pack template
- Done when: per-bank compliance evidence pack template drafted.
- Output: `docs/gtm/bank-compliance-pack-template.md`.
- Verify: covers SOC 2 report, ISO cert, DPDP memo links.
- Reviewer: Agents #36, #38.
- Depends on: A46-W4-Mon.

**A46-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + first pilot kickoff dry-run
- Done when: dry-run with mock bank kickoff agenda.
- Output: `docs/gtm/pilot-kickoff-dry-run.md`.
- Verify: 60-min run-through completed.
- Reviewer: Agent #42.
- Depends on: A46-W4-Tue.

**A46-W4-Thu (2026-06-18)** — Sprint 1 CSM sign-off
- Done when: CSM section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: playbook + scope + tooling + dry-run all current.
- Reviewer: Agent #42.
- Depends on: A42-W4-Thu.

**A46-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (pilot LoI follow-up support, post-demo CS prep).
- Output: `docs/gtm/a46-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #42.
- Depends on: A46-W4-Thu.
