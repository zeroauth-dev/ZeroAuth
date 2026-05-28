# Agent #38 — Senior Compliance Lead (SOC 2 + ISO 27001)

**Reports to:** Agent #36.
**Mandate:** Owns SOC 2 Type I + II evidence, ISO 27001 Stage 1 + 2 audits, auditor relationship.
**KPIs:** see role 38 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A38-W1-Mon (2026-05-25)** — SOC 2 control identification — kickoff
- Done when: control set selected (Security + Confidentiality + Availability for Type I scope).
- Output: `docs/compliance/soc2/control-set-v0.md`.
- Verify: 120+ controls listed.
- Reviewer: Agent #36.
- Depends on: A36-W1-Mon.

**A38-W1-Tue (2026-05-26)** — ISO 27001 Annex A mapping — kickoff
- Done when: 93 Annex A controls reviewed; applicability marked.
- Output: `docs/compliance/iso27001/annex-a-applicability-v0.md`.
- Verify: each control marked applicable / not-applicable / partial.
- Reviewer: Agent #36.
- Depends on: A38-W1-Mon.

**A38-W1-Wed (2026-05-27)** — SOC 2 evidence collector inventory
- Done when: list of evidence types (commits, PRs, access reviews, vendor reviews, incident logs, training records).
- Output: `docs/compliance/soc2/evidence-types.md`.
- Verify: 15+ evidence types.
- Reviewer: Agent #36.
- Depends on: A38-W1-Tue.

**A38-W1-Thu (2026-05-28)** — SOC 2 auditor shortlist contribution
- Done when: contribution to `docs/compliance/soc2/auditor-shortlist.md` with cost + timeline.
- Output: PR contribution.
- Verify: each shortlisted firm has cost + India presence.
- Reviewer: Agent #36.
- Depends on: A38-W1-Wed.

**A38-W1-Fri (2026-05-29)** — Status post + ISO 27001 lead auditor shortlist contribution
- Done when: contribution to `docs/compliance/iso27001/lead-auditor-shortlist.md`.
- Output: PR.
- Verify: 3+ auditors listed.
- Reviewer: Agent #36.
- Depends on: A38-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A38-W2-Mon (2026-06-01)** — SOC 2 Type I scope draft
- Done when: → contribution to `docs/compliance/soc2/scope-memo-v0.md`.
- Output: PR.
- Verify: criteria sets named.
- Reviewer: Agent #36.
- Depends on: A38-W1-Fri.

**A38-W2-Tue (2026-06-02)** — ISO 27001 ISMS scope draft
- Done when: → contribution to `docs/compliance/iso27001/isms-scope-memo-v0.md`.
- Output: PR.
- Verify: boundary covers prod + corp IT.
- Reviewer: Agent #36.
- Depends on: A38-W2-Mon.

**A38-W2-Wed (2026-06-03)** — Evidence collector inventory v1
- Done when: each evidence type has a planned source (e.g., GitHub Actions logs, Audit log dumps).
- Output: PR.
- Verify: 15+ types with sources.
- Reviewer: Agent #36.
- Depends on: A38-W2-Tue.

**A38-W2-Thu (2026-06-04)** — Begin control narrative writing — first 30 controls
- Done when: 30 control narratives drafted.
- Output: `docs/compliance/soc2/control-narratives/<id>.md` × 30.
- Verify: each narrative ≥ 200 words.
- Reviewer: Agent #35.
- Depends on: A38-W2-Wed.

**A38-W2-Fri (2026-06-05)** — Phase 0 SOC 2/ISO sign-off + status post
- Done when: control set + ISO Annex A v0 + 30 narratives current.
- Output: row in Phase 0 exit doc.
- Verify: docs published.
- Reviewer: Agent #36.
- Depends on: A38-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A38-W3-Mon (2026-06-08)** — SOC 2 control narratives — next 30
- Done when: 30 more narratives drafted (cumulative 60).
- Output: `docs/compliance/soc2/control-narratives/<id>.md` × 30.
- Verify: 60 narratives.
- Reviewer: Agent #35.
- Depends on: A38-W2-Fri.

**A38-W3-Tue (2026-06-09)** — RFP responses review
- Done when: 3 RFP responses reviewed by line.
- Output: comparison memo.
- Verify: scoring grid completed.
- Reviewer: Agent #36.
- Depends on: A36-W3-Mon.

**A38-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + evidence collector decision contribution
- Done when: → contribution to `docs/compliance/evidence-collector-decision.md`.
- Output: PR.
- Verify: decision captured.
- Reviewer: Agent #36.
- Depends on: A38-W3-Tue.

**A38-W3-Thu (2026-06-11)** — Audit findings → SOC 2/ISO control mapping (with Agent #36)
- Done when: contribution to `docs/compliance/audit-findings-control-mapping.md`.
- Output: PR.
- Verify: each finding mapped to control(s).
- Reviewer: Agents #26, #36.
- Depends on: A38-W3-Wed.

**A38-W3-Fri (2026-06-12)** — Status post + ISO 27001 Annex A scope contribution to Agent #35
- Done when: scope content provided.
- Output: contribution to `docs/compliance/iso27001/annex-a-scope.md`.
- Verify: 90+ controls captured.
- Reviewer: Agent #35.
- Depends on: A38-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A38-W4-Mon (2026-06-15)** — SOC 2 control narratives — next 30
- Done when: 30 more narratives drafted (cumulative 90).
- Output: control narratives.
- Verify: 90 narratives.
- Reviewer: Agent #35.
- Depends on: A38-W3-Mon.

**A38-W4-Tue (2026-06-16)** — SOC 2 auditor engagement letter signed (with Agent #36)
- Done when: SoW + engagement letter signed off.
- Output: contribution to engagement letter.
- Verify: signed off.
- Reviewer: Agent #36.
- Depends on: A36-W4-Tue.

**A38-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + ISO 27001 lead auditor preferred candidate
- Done when: preferred candidate selected; engagement scoped.
- Output: `docs/compliance/iso27001/lead-auditor-selection-memo.md`.
- Verify: rationale captured.
- Reviewer: Agent #36.
- Depends on: A38-W4-Tue.

**A38-W4-Thu (2026-06-18)** — Sprint 1 SOC 2/ISO sign-off
- Done when: SOC 2/ISO section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: SOC 2 auditor engaged + 90 control narratives + ISO scope final.
- Reviewer: Agent #36.
- Depends on: A36-W4-Thu.

**A38-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (remaining narratives, evidence collector setup).
- Output: `docs/compliance/soc2/a38-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #36.
- Depends on: A38-W4-Thu.
