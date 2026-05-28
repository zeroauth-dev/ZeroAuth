# Agent #40 — Risk & Audit Lead

**Reports to:** Agent #36.
**Mandate:** Owns risk register, incident-response process, audit-log integrity continuous verification, on-chain anchor SLA.
**KPIs:** see role 40 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A40-W1-Mon (2026-05-25)** — Enterprise risk register v1
- Done when: 10-item risk register drafted (concentration, supply-chain, compliance, key-loss, vendor, key person, ceremony, contract, on-chain, AML).
- Output: `docs/compliance/risk/enterprise-risk-register-v1.md`.
- Verify: each risk has likelihood + impact + owner + mitigation.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A40-W1-Tue (2026-05-26)** — Incident response runbook v0
- Done when: severity classification grid + escalation tree drafted.
- Output: `docs/operations/incident-response-runbook-v0.md`.
- Verify: 4 severity levels documented.
- Reviewer: Agents #5, #21.
- Depends on: A40-W1-Mon.

**A40-W1-Wed (2026-05-27)** — Audit-log integrity continuous-verification design
- Done when: design drafted (hourly drift, daily anchor reconciliation, weekly external proof).
- Output: `docs/compliance/risk/audit-integrity-verification-design.md`.
- Verify: 3-tier verification covered.
- Reviewer: Agents #8, #25.
- Depends on: A40-W1-Tue.

**A40-W1-Thu (2026-05-28)** — Vendor risk policy v0
- Done when: policy covers vendor onboarding, security questionnaire, annual review, exit.
- Output: `docs/compliance/risk/vendor-risk-policy-v0.md`.
- Verify: covers all current vendors.
- Reviewer: Agent #50.
- Depends on: A40-W1-Wed.

**A40-W1-Fri (2026-05-29)** — Status post + mobile risk register contribution
- Done when: mobile-specific risks added (USB-OTG failures, R307 capture failures, fallback path, BiometricPrompt errors).
- Output: contribution to `docs/team/mobile/risk-register-v0.md`.
- Verify: 4 mobile risks added.
- Reviewer: Agent #4.
- Depends on: A40-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A40-W2-Mon (2026-06-01)** — Risk register v2 with mitigations linked to commits
- Done when: register updated with commit hashes for closed mitigations.
- Output: PR.
- Verify: 6+ commit hashes referenced.
- Reviewer: Agent #36.
- Depends on: A40-W1-Fri.

**A40-W2-Tue (2026-06-02)** — Severity-1 alerting wired to incident response
- Done when: with Agent #21, severity-1 alerts trigger incident-response paging.
- Output: contribution to alert config.
- Verify: synthetic alert tested.
- Reviewer: Agent #21.
- Depends on: A40-W2-Mon.

**A40-W2-Wed (2026-06-03)** — Quarterly risk review cadence proposed
- Done when: cadence + review structure documented.
- Output: `docs/compliance/risk/quarterly-review-cadence.md`.
- Verify: cadence on calendar.
- Reviewer: Agent #36.
- Depends on: A40-W2-Tue.

**A40-W2-Thu (2026-06-04)** — Contract risk register contribution (with Agent #25)
- Done when: contributions to `docs/team/blockchain/contract-risk-register.md`.
- Output: PR contribution.
- Verify: 4 contract risks documented.
- Reviewer: Agent #25.
- Depends on: A40-W2-Wed.

**A40-W2-Fri (2026-06-05)** — Phase 0 risk sign-off + status post
- Done when: risk register + incident response v0 + vendor risk policy current.
- Output: row in Phase 0 exit doc.
- Verify: docs published.
- Reviewer: Agent #36.
- Depends on: A40-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A40-W3-Mon (2026-06-08)** — Drift-detection cron design review (with Agent #13)
- Done when: hourly drift design review; sampling strategy + alert threshold confirmed.
- Output: review comments on `docs/team/crypto/drift-detection-design.md`.
- Verify: design reviewable.
- Reviewer: Agent #13.
- Depends on: A13-W2-Wed.

**A40-W3-Tue (2026-06-09)** — Incident-response tabletop exercise v0
- Done when: tabletop plan for a severity-1 scenario (audit-chain tamper detected) drafted.
- Output: `docs/compliance/risk/tabletop-v0-audit-tamper.md`.
- Verify: plan reviewable.
- Reviewer: Agent #36.
- Depends on: A40-W3-Mon.

**A40-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #36.
- Depends on: A40-W3-Tue.

**A40-W3-Thu (2026-06-11)** — Annual access-review automation design
- Done when: design for quarterly + annual access review.
- Output: `docs/compliance/risk/access-review-design.md`.
- Verify: covers GitHub, VPS, dashboards.
- Reviewer: Agents #21, #50.
- Depends on: A40-W3-Wed.

**A40-W3-Fri (2026-06-12)** — Status post + IR runbook v1
- Done when: runbook v1 with Agent #5 + Agent #21 inputs.
- Output: PR for `docs/operations/incident-response-runbook.md` v1.
- Verify: 4 severity scenarios + runbooks.
- Reviewer: Agents #5, #21.
- Depends on: A40-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A40-W4-Mon (2026-06-15)** — Tabletop exercise run #1 (audit-chain tamper)
- Done when: exercise executed; lessons documented.
- Output: `docs/compliance/risk/tabletop-2026-06-15-results.md`.
- Verify: 3+ improvement actions.
- Reviewer: Agent #36.
- Depends on: A40-W3-Tue.

**A40-W4-Tue (2026-06-16)** — Tabletop exercise run #2 (key compromise)
- Done when: second tabletop run; lessons documented.
- Output: `docs/compliance/risk/tabletop-2026-06-16-key-compromise.md`.
- Verify: 3+ improvement actions.
- Reviewer: Agents #12, #36.
- Depends on: A40-W4-Mon.

**A40-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + risk-register quarterly milestone
- Done when: risk register reviewed against Q-end target.
- Output: contribution to `docs/compliance/risk/enterprise-risk-register-v1.md`.
- Verify: progress against mitigations recorded.
- Reviewer: Agent #36.
- Depends on: A40-W4-Tue.

**A40-W4-Thu (2026-06-18)** — Sprint 1 risk sign-off
- Done when: risk section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: register + IR v1 + tabletops current.
- Reviewer: Agent #36.
- Depends on: A36-W4-Thu.

**A40-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (more tabletops, IR runbook gaps).
- Output: `docs/compliance/risk/a40-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A40-W4-Thu.
