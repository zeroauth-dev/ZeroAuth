# Agent #36 — Chief Compliance Officer

**Reports to:** Founder.
**Mandate:** Owns compliance roadmap — DPDP, RBI MDs, SOC 2, ISO 27001, regulator engagement.
**KPIs:** see role 36 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A36-W1-Mon (2026-05-25)** — Compliance roadmap calendar v1
- Done when: 12-month calendar covers SOC 2 + ISO 27001 + DPDP + RBI sandbox milestones.
- Output: `docs/compliance/compliance-roadmap-v1.md`.
- Verify: every phase has a milestone.
- Reviewer: Agent #1.
- Depends on: A01-W1-Mon.

**A36-W1-Tue (2026-05-26)** — SOC 2 auditor shortlist
- Done when: 3+ firms shortlisted (Sequence, Strike Graph, A-LIGN, others).
- Output: `docs/compliance/soc2/auditor-shortlist.md`.
- Verify: cost + timeline + India presence captured.
- Reviewer: Agent #38.
- Depends on: A36-W1-Mon.

**A36-W1-Wed (2026-05-27)** — ISO 27001 lead auditor shortlist
- Done when: 3+ India-accredited lead auditors shortlisted.
- Output: `docs/compliance/iso27001/lead-auditor-shortlist.md`.
- Verify: accreditation body listed (NABCB or equivalent).
- Reviewer: Agent #38.
- Depends on: A36-W1-Tue.

**A36-W1-Thu (2026-05-28)** — RBI engagement strategy v0
- Done when: RBI engagement plan (FinTech Department, RBIH Sandbox, IBA) drafted.
- Output: `docs/compliance/rbi/engagement-strategy-v0.md`.
- Verify: 3 specific contact paths.
- Reviewer: Agents #1, #42.
- Depends on: A36-W1-Wed.

**A36-W1-Fri (2026-05-29)** — Status post + OWASP top-10 review (with Agent #26)
- Done when: OWASP evidence reviewed.
- Output: contribution to `docs/team/security/owasp-top-10-evidence.md`.
- Verify: gaps prioritised.
- Reviewer: Agent #26.
- Depends on: A36-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A36-W2-Mon (2026-06-01)** — SOC 2 scope memo draft
- Done when: SOC 2 Type I scope finalised (security + availability + confidentiality criteria).
- Output: `docs/compliance/soc2/scope-memo-v0.md`.
- Verify: criteria sets named.
- Reviewer: Agent #38.
- Depends on: A36-W1-Fri.

**A36-W2-Tue (2026-06-02)** — ISO 27001 ISMS scope memo draft
- Done when: ISMS scope (boundary, exclusions, interested parties) drafted.
- Output: `docs/compliance/iso27001/isms-scope-memo-v0.md`.
- Verify: boundary covers prod stack + corporate IT.
- Reviewer: Agent #38.
- Depends on: A36-W2-Mon.

**A36-W2-Wed (2026-06-03)** — DPDP compliance engagement with external counsel
- Done when: external counsel engaged for DPDP advisory.
- Output: engagement letter ref (off-repo).
- Verify: SoW + dates captured.
- Reviewer: Agents #37, #41.
- Depends on: A36-W2-Tue.

**A36-W2-Thu (2026-06-04)** — HSM evaluation review (with Agent #12)
- Done when: HSM trade-off paper reviewed; preferred path documented.
- Output: contribution to `docs/team/crypto/hsm-evaluation.md`.
- Verify: RBI acceptance factor weighted.
- Reviewer: Agent #12.
- Depends on: A36-W2-Wed.

**A36-W2-Fri (2026-06-05)** — Phase 0 compliance sign-off + status post
- Done when: roadmap + auditor shortlists + scope memos current.
- Output: row in Phase 0 exit doc.
- Verify: roadmap published.
- Reviewer: Agent #1.
- Depends on: A36-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A36-W3-Mon (2026-06-08)** — SOC 2 auditor RFP issued
- Done when: RFP sent to 3 shortlisted firms.
- Output: RFP doc + send log.
- Verify: 3 firms received.
- Reviewer: Agent #38.
- Depends on: A36-W2-Fri.

**A36-W3-Tue (2026-06-09)** — ISO 27001 lead auditor outreach
- Done when: outreach to 3 lead auditors begun.
- Output: outreach log.
- Verify: 3 responses being tracked.
- Reviewer: Agent #38.
- Depends on: A36-W3-Mon.

**A36-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + audit-evidence collector approach
- Done when: approach (in-house vs Drata / Vanta / Sprinto) selected.
- Output: `docs/compliance/evidence-collector-decision.md`.
- Verify: decision rationale captured.
- Reviewer: Agent #38.
- Depends on: A36-W3-Tue.

**A36-W3-Thu (2026-06-11)** — Audit findings vs compliance mapping
- Done when: each closed P0 finding mapped to SOC 2 + ISO control.
- Output: `docs/compliance/audit-findings-control-mapping.md`.
- Verify: 6 P0 findings mapped.
- Reviewer: Agents #26, #38.
- Depends on: A36-W3-Wed.

**A36-W3-Fri (2026-06-12)** — Status post + privacy review with Agent #39
- Done when: PIA template + privacy programme reviewed.
- Output: comments.
- Verify: programme aligned with DPDP.
- Reviewer: Agent #39.
- Depends on: A36-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A36-W4-Mon (2026-06-15)** — SOC 2 auditor RFP responses review
- Done when: 3 responses reviewed; preferred firm selected.
- Output: `docs/compliance/soc2/auditor-selection-memo.md`.
- Verify: rationale captured.
- Reviewer: Agent #1.
- Depends on: A36-W3-Mon.

**A36-W4-Tue (2026-06-16)** — SOC 2 auditor engagement letter signed
- Done when: SoW + engagement letter signed.
- Output: engagement letter ref.
- Verify: signed off.
- Reviewer: Agent #1.
- Depends on: A36-W4-Mon.

**A36-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + RBI sandbox application pre-work
- Done when: sandbox application requirements catalogued.
- Output: `docs/compliance/rbi/sandbox-application-prework.md`.
- Verify: every requirement has an owner.
- Reviewer: Agent #37.
- Depends on: A36-W4-Tue.

**A36-W4-Thu (2026-06-18)** — Sprint 1 compliance sign-off
- Done when: compliance section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: SOC 2 auditor engaged; ISMS scope drafted; RBI prep started.
- Reviewer: Agent #1.
- Depends on: A28-W4-Thu.

**A36-W4-Fri (2026-06-19)** — Sprint 2 dispatch + Friday status read
- Done when: sprint-2 daily tickets generated for compliance team.
- Output: `docs/compliance/sprint-2-daily-dispatch.md`.
- Verify: 6 compliance agents have 5 daily tickets each.
- Reviewer: Agent #1.
- Depends on: A36-W4-Thu.
