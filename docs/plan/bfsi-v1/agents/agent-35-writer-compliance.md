# Agent #35 — Technical Writer (compliance + audit + legal docs)

**Reports to:** Agent #36.
**Mandate:** Owns `docs/threat_model.md`, `docs/compliance/`, SOC 2 + ISO 27001 evidence pack, regulator briefing pack.
**KPIs:** see role 35 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A35-W1-Mon (2026-05-25)** — Threat model audit
- Done when: existing `docs/threat_model.md` reviewed; gaps identified for Phase 0 changes.
- Output: `docs/team/writers/threat-model-audit-w1.md`.
- Verify: 5+ gaps identified.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A35-W1-Tue (2026-05-26)** — Audit-findings doc co-authorship with Agent #26
- Done when: `docs/security/audit-findings.md` structure refined.
- Output: PR contribution.
- Verify: table headers + format clean.
- Reviewer: Agent #26.
- Depends on: A35-W1-Mon.

**A35-W1-Wed (2026-05-27)** — Threat model update for demo-bypass removal (C-004)
- Done when: A-12 row updated to reflect closure.
- Output: PR (companion to C-004).
- Verify: A-12 references C-004 commit hash.
- Reviewer: Agents #6, #26.
- Depends on: A35-W1-Tue.

**A35-W1-Thu (2026-05-28)** — DPDP §2(t) legal memo skeleton
- Done when: skeleton for "ZeroAuth commitments under DPDP §2(t)" memo drafted.
- Output: `docs/compliance/dpdp-2t-commitments-memo-v0.md`.
- Verify: skeleton covers 5 sections (statute, definitions, commitment analysis, conclusion, citations).
- Reviewer: Agents #37, #41.
- Depends on: A35-W1-Wed.

**A35-W1-Fri (2026-05-29)** — Status post + threat model update for hash chain (C-017 precursor)
- Done when: A-14 row updated to reflect mitigation.
- Output: PR draft.
- Verify: A-14 references C-012 + C-016.
- Reviewer: Agents #8, #11.
- Depends on: A35-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A35-W2-Mon (2026-06-01)** — Threat model PR for hash chain + on-chain anchor (C-017)
- Done when: → C-017 PR opened.
- Output: PR.
- Verify: A-14 marked as mitigated; A-22 added (compromised DBA).
- Reviewer: Agents #8, #25.
- Depends on: A35-W1-Fri.

**A35-W2-Tue (2026-06-02)** — Compliance doc tree skeleton
- Done when: `docs/compliance/` structure stood up (soc2/, iso27001/, dpdp/, rbi/).
- Output: directory structure.
- Verify: each subdir has README.
- Reviewer: Agent #36.
- Depends on: A35-W2-Mon.

**A35-W2-Wed (2026-06-03)** — SOC 2 control narrative templates
- Done when: 30 control narrative templates drafted.
- Output: `docs/compliance/soc2/control-narratives/` v0.
- Verify: 30 markdown files seeded.
- Reviewer: Agent #38.
- Depends on: A35-W2-Tue.

**A35-W2-Thu (2026-06-04)** — Threat model update for RS256 JWT (C-028)
- Done when: A-17 (JWT signing compromise) updated.
- Output: PR.
- Verify: A-17 references C-028.
- Reviewer: Agent #12.
- Depends on: A35-W2-Wed.

**A35-W2-Fri (2026-06-05)** — Phase 0 compliance-writer sign-off + status post
- Done when: threat model current; compliance tree stood up.
- Output: row in Phase 0 exit doc.
- Verify: docs current.
- Reviewer: Agent #36.
- Depends on: A35-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A35-W3-Mon (2026-06-08)** — Anchor Bank demo runbook outline (precursor C-190)
- Done when: outline captures all 6 scenes with operator steps.
- Output: `docs/operations/anchor-bank-demo-runbook.md` v0.
- Verify: 6 sections present.
- Reviewer: Agent #45.
- Depends on: A35-W2-Fri.

**A35-W3-Tue (2026-06-09)** — DPDP §2(t) legal memo v1 (with external counsel engagement)
- Done when: v1 draft after first counsel review.
- Output: PR for `docs/compliance/dpdp-2t-commitments-memo-v1.md`.
- Verify: counsel comments addressed.
- Reviewer: Agents #37, #41.
- Depends on: A35-W1-Thu.

**A35-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + RBI MD compliance matrix skeleton
- Done when: matrix mapping RBI MD on IT Governance §6.4 → ZeroAuth controls.
- Output: `docs/compliance/rbi/it-governance-mapping.md`.
- Verify: §6.4 mapped + cited.
- Reviewer: Agent #37.
- Depends on: A35-W3-Tue.

**A35-W3-Thu (2026-06-11)** — Threat model update for device-attestation (post C-105)
- Done when: A-18 (device-compromise / cloned-device) row updated.
- Output: PR.
- Verify: A-18 references C-105.
- Reviewer: Agents #6, #27.
- Depends on: A06-W3-Thu.

**A35-W3-Fri (2026-06-12)** — Status post + ISO 27001 Annex A scope draft
- Done when: scope draft captures applicable controls vs out-of-scope.
- Output: `docs/compliance/iso27001/annex-a-scope.md` v0.
- Verify: covers 90+ Annex A controls.
- Reviewer: Agent #38.
- Depends on: A35-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A35-W4-Mon (2026-06-15)** — Demo runbook scene-by-scene script draft
- Done when: each scene has a full operator script.
- Output: PR.
- Verify: scripts reviewable.
- Reviewer: Agent #45.
- Depends on: A35-W3-Mon.

**A35-W4-Tue (2026-06-16)** — Anchor Bank case-study skeleton (post-demo) for marketing
- Done when: skeleton page with placeholder metrics + screenshots drafted.
- Output: `docs/case-studies/anchor-bank-case-study-v0.md`.
- Verify: skeleton ready for Phase 2 fill-in.
- Reviewer: Agent #48.
- Depends on: A35-W4-Mon.

**A35-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + threat model writer pass
- Done when: threat model reviewed for consistency.
- Output: PR.
- Verify: language consistent.
- Reviewer: Agent #34.
- Depends on: A35-W4-Tue.

**A35-W4-Thu (2026-06-18)** — Sprint 1 compliance-writer sign-off
- Done when: compliance-writer section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: threat model + DPDP memo + RBI matrix + demo runbook outline current.
- Reviewer: Agent #36.
- Depends on: A28-W4-Thu.

**A35-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted.
- Output: `docs/team/writers/a35-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A35-W4-Thu.
