# Agent #39 — Senior Privacy Engineer

**Reports to:** Agent #36.
**Mandate:** Owns privacy-by-design audits, data inventory, data minimisation, DPDP impact assessment per release.
**KPIs:** see role 39 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A39-W1-Mon (2026-05-25)** — Data inventory v1
- Done when: every data element processed by ZeroAuth catalogued (with classification + sensitivity).
- Output: `docs/compliance/privacy/data-inventory-v1.md`.
- Verify: each DB column + each log field + each API payload field captured.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A39-W1-Tue (2026-05-26)** — Schema purity test review (with Agent #23)
- Done when: C-003 `tests/schema-purity.test.ts` reviewed against data inventory.
- Output: PR comment.
- Verify: column allowlist matches inventory.
- Reviewer: Agent #23.
- Depends on: A39-W1-Mon.

**A39-W1-Wed (2026-05-27)** — Privacy review on demo-bypass-removal (C-004)
- Done when: C-004 PR reviewed for privacy implications.
- Output: PR comment.
- Verify: confirms no PII path re-introduced.
- Reviewer: Agent #26.
- Depends on: A39-W1-Tue.

**A39-W1-Thu (2026-05-28)** — Privacy review on access_token-removal (C-005)
- Done when: C-005 PR reviewed; tokens-in-URL → tokens-in-cookie privacy improvement confirmed.
- Output: PR comment.
- Verify: comment links to relevant DPDP/SOC 2 controls.
- Reviewer: Agent #26.
- Depends on: A39-W1-Wed.

**A39-W1-Fri (2026-05-29)** — Status post + PIA template draft
- Done when: privacy-impact-assessment template drafted.
- Output: `docs/compliance/privacy/pia-template-v0.md`.
- Verify: template covers data flows, retention, third parties, lawful basis.
- Reviewer: Agent #36.
- Depends on: A39-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A39-W2-Mon (2026-06-01)** — Privacy review on zod validators (C-022) — biometric-key blocklist
- Done when: PR reviewed; blocklist completeness verified.
- Output: PR comment.
- Verify: every biometric-payload key in `image|template|pixel|depth|frame|raw_face|raw_finger` is blocked.
- Reviewer: Agent #6.
- Depends on: A39-W1-Fri.

**A39-W2-Tue (2026-06-02)** — First PIA against current state
- Done when: PIA executed; current state assessed.
- Output: `docs/compliance/privacy/pia-current-state.md`.
- Verify: identifies 5+ privacy risks + mitigations.
- Reviewer: Agent #36.
- Depends on: A39-W2-Mon.

**A39-W2-Wed (2026-06-03)** — Data-retention policy v0
- Done when: per-table retention rules drafted.
- Output: `docs/compliance/privacy/data-retention-policy-v0.md`.
- Verify: each table has a retention period.
- Reviewer: Agent #36.
- Depends on: A39-W2-Tue.

**A39-W2-Thu (2026-06-04)** — Threat-model privacy section update
- Done when: A-15 (PII exfil), A-16 (browser-log token leak) updated.
- Output: contribution to threat-model PR.
- Verify: updates reference C-003, C-005, C-022.
- Reviewer: Agent #35.
- Depends on: A39-W2-Wed.

**A39-W2-Fri (2026-06-05)** — Phase 0 privacy sign-off + status post
- Done when: data inventory + PIA template + retention policy current.
- Output: row in Phase 0 exit doc.
- Verify: docs published.
- Reviewer: Agent #36.
- Depends on: A39-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A39-W3-Mon (2026-06-08)** — Cookie / consent banner privacy review (with Agent #16)
- Done when: cookie banner reviewed against DPDP consent best practices.
- Output: review comments.
- Verify: reject-all option clear + persistent.
- Reviewer: Agent #16.
- Depends on: A16-W2-Thu.

**A39-W3-Tue (2026-06-09)** — Privacy review on attestation library (C-105 precursor)
- Done when: library + integration design reviewed for privacy.
- Output: review comments.
- Verify: no PII captured in attestation flow.
- Reviewer: Agents #6, #12.
- Depends on: A12-W3-Mon.

**A39-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #36.
- Depends on: A39-W3-Tue.

**A39-W3-Thu (2026-06-11)** — Mobile telemetry payload review (with Agent #19)
- Done when: telemetry schema reviewed; allowlist confirmed.
- Output: PR comments.
- Verify: no DID, no commitment, no biometric data in telemetry.
- Reviewer: Agent #19.
- Depends on: A19-W2-Thu.

**A39-W3-Fri (2026-06-12)** — Status post + dashboard users view PII assertion review
- Done when: review the no-PII Playwright assertion in C-107.
- Output: PR comment.
- Verify: assertion comprehensive.
- Reviewer: Agent #14.
- Depends on: A14-W3-Mon.

## Week 4 (2026-06-15 → 2026-06-19)

**A39-W4-Mon (2026-06-15)** — PIA refresh post-C-105 (identity register)
- Done when: PIA updated for attestation flow.
- Output: `docs/compliance/privacy/pia-post-c105.md`.
- Verify: covers Play Integrity + StrongBox flows.
- Reviewer: Agent #36.
- Depends on: A06-W3-Thu.

**A39-W4-Tue (2026-06-16)** — Privacy review on C-107 (users view PII-blacklist Playwright assertion)
- Done when: PR reviewed; assertion comprehensive.
- Output: PR comment.
- Verify: assertion green.
- Reviewer: Agent #14.
- Depends on: A14-W4-Mon.

**A39-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + DPDP §13 cross-border review (with Agent #37)
- Done when: cross-border treatment reviewed.
- Output: review comments on `docs/compliance/dpdp/section-13-cross-border.md`.
- Verify: review applied.
- Reviewer: Agent #37.
- Depends on: A37-W3-Thu.

**A39-W4-Thu (2026-06-18)** — Sprint 1 privacy sign-off
- Done when: privacy section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: PIAs current; data inventory current; retention policy live.
- Reviewer: Agent #36.
- Depends on: A36-W4-Thu.

**A39-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (per-release PIA cadence, DSR handling tests).
- Output: `docs/compliance/privacy/a39-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A39-W4-Thu.
