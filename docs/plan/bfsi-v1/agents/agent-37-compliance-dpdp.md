# Agent #37 — Senior Compliance Lead (DPDP + RBI)

**Reports to:** Agent #36.
**Mandate:** Owns DPDP Act mapping, RBI Master Directions mapping, RBI Digital Lending Guidelines, regulator queries.
**KPIs:** see role 37 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A37-W1-Mon (2026-05-25)** — DPDP Act §§ mapping kickoff
- Done when: every DPDP §§ that bind ZeroAuth (§§2, 4, 8, 13, 17, 33) mapped to our controls.
- Output: `docs/compliance/dpdp/section-mapping-v0.md`.
- Verify: 6+ sections covered.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A37-W1-Tue (2026-05-26)** — RBI MD on IT Governance §6.4 deep-dive
- Done when: §6.4 (audit logs, segregation of duties) requirements catalogued.
- Output: `docs/compliance/rbi/it-governance-6-4-deep-dive.md`.
- Verify: ZeroAuth-relevant items highlighted.
- Reviewer: Agent #36.
- Depends on: A37-W1-Mon.

**A37-W1-Wed (2026-05-27)** — RBI Digital Lending Guidelines mapping kickoff
- Done when: consent capture + audit + LSP/co-lending requirements mapped.
- Output: `docs/compliance/rbi/digital-lending-mapping-v0.md`.
- Verify: 5+ paragraphs mapped.
- Reviewer: Agent #10.
- Depends on: A37-W1-Tue.

**A37-W1-Thu (2026-05-28)** — DPDP §2(t) external counsel engagement scoped
- Done when: counsel scope agreed (commitments + DID under §2(t)).
- Output: `docs/compliance/dpdp/2t-counsel-scope.md`.
- Verify: scope captures deliverable: memo + verbal opinion.
- Reviewer: Agents #36, #41.
- Depends on: A37-W1-Wed.

**A37-W1-Fri (2026-05-29)** — Status post + consent-data-model collaboration with Agent #10
- Done when: data-model spec aligns RBI Digital Lending requirements.
- Output: contribution to `docs/team/backend/consent-data-model.md`.
- Verify: scope dictionary covers 5+ categories.
- Reviewer: Agent #10.
- Depends on: A37-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A37-W2-Mon (2026-06-01)** — DPDP §§ mapping v1
- Done when: mapping updated; controls referenced with commit hashes.
- Output: PR.
- Verify: every §§ has a control + commit reference.
- Reviewer: Agent #36.
- Depends on: A37-W1-Fri.

**A37-W2-Tue (2026-06-02)** — RBI MD on Digital Payment Security Controls — applicable sections
- Done when: applicable sections (§§5.3 high-value txn auth, §§6 user awareness) catalogued.
- Output: `docs/compliance/rbi/dps-controls-mapping.md`.
- Verify: 4+ sections mapped.
- Reviewer: Agent #36.
- Depends on: A37-W2-Mon.

**A37-W2-Wed (2026-06-03)** — Consent-capture compliance spec
- Done when: spec captures consent-text variants + scope dictionary.
- Output: contribution to `docs/team/backend/consent-spec-w1.md`.
- Verify: covers RBI requirements + DPDP consent rules.
- Reviewer: Agent #10.
- Depends on: A37-W2-Tue.

**A37-W2-Thu (2026-06-04)** — RBI Master Direction on KYC review
- Done when: KYC requirements for video-KYC, periodic refresh, and AML transactions catalogued.
- Output: `docs/compliance/rbi/kyc-mapping.md`.
- Verify: identifies anchor point in ZeroAuth enrollment.
- Reviewer: Agent #29.
- Depends on: A37-W2-Wed.

**A37-W2-Fri (2026-06-05)** — Phase 0 DPDP+RBI sign-off + status post
- Done when: DPDP + RBI mappings v1 published.
- Output: row in Phase 0 exit doc.
- Verify: 4 mapping docs current.
- Reviewer: Agent #36.
- Depends on: A37-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A37-W3-Mon (2026-06-08)** — RBI MD compliance matrix v0 published (with Agent #35)
- Done when: matrix mapping RBI MDs → ZeroAuth controls published.
- Output: PR for `docs/compliance/rbi/it-governance-mapping.md`.
- Verify: 6 sections mapped.
- Reviewer: Agent #36.
- Depends on: A37-W2-Fri.

**A37-W3-Tue (2026-06-09)** — DPDP §8 (breach reporting) playbook v0
- Done when: playbook drafted (detection → DPB notification within 72 h → user comms).
- Output: `docs/compliance/dpdp/breach-reporting-playbook-v0.md`.
- Verify: 72 h SLA captured.
- Reviewer: Agents #36, #41.
- Depends on: A37-W3-Mon.

**A37-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + DPDP §2(t) counsel call
- Done when: 1st call with external counsel; memo outline aligned.
- Output: meeting notes.
- Verify: counsel briefed.
- Reviewer: Agent #36.
- Depends on: A37-W3-Tue.

**A37-W3-Thu (2026-06-11)** — DPDP §13 cross-border transfer treatment
- Done when: cross-border treatment of commitments + DIDs analysed.
- Output: `docs/compliance/dpdp/section-13-cross-border.md`.
- Verify: links to §2(t) memo.
- Reviewer: Agent #41.
- Depends on: A37-W3-Wed.

**A37-W3-Fri (2026-06-12)** — Status post + RBI Digital Lending consent-flow review (with Agent #10)
- Done when: consent-flow design reviewed.
- Output: comments.
- Verify: every RBI requirement addressed.
- Reviewer: Agent #10.
- Depends on: A37-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A37-W4-Mon (2026-06-15)** — DPDP §2(t) counsel v1 memo review
- Done when: v1 memo received from counsel; comments captured.
- Output: contribution to `docs/compliance/dpdp-2t-commitments-memo-v1.md`.
- Verify: substantive comments captured.
- Reviewer: Agents #35, #41.
- Depends on: A35-W3-Tue.

**A37-W4-Tue (2026-06-16)** — RBI Master Direction inspection-readiness checklist
- Done when: checklist for RBI inspector covers audit logs, IAM, change mgmt.
- Output: `docs/compliance/rbi/inspection-readiness-checklist.md`.
- Verify: 30+ items.
- Reviewer: Agent #36.
- Depends on: A37-W4-Mon.

**A37-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + RBI sandbox application precursor
- Done when: RBI sandbox application content drafted.
- Output: contribution to `docs/compliance/rbi/sandbox-application-prework.md`.
- Verify: every required field has source.
- Reviewer: Agent #36.
- Depends on: A37-W4-Tue.

**A37-W4-Thu (2026-06-18)** — Sprint 1 DPDP+RBI sign-off
- Done when: DPDP/RBI section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: 6 compliance docs current.
- Reviewer: Agent #36.
- Depends on: A36-W4-Thu.

**A37-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (RBI sandbox application, DPDP §2(t) memo v2 finalisation).
- Output: `docs/compliance/dpdp/a37-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A37-W4-Thu.
