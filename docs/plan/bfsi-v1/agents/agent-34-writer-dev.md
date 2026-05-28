# Agent #34 — Technical Writer (developer docs)

**Reports to:** Agent #31.
**Mandate:** Owns `docs/api_contract.md`, `docs/error_codes.md`, integration guides, SDK READMEs.
**KPIs:** see role 34 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A34-W1-Mon (2026-05-25)** — API contract audit
- Done when: every `/v1/*` endpoint reviewed against actual implementation.
- Output: `docs/team/writers/api-contract-audit-w1.md`.
- Verify: discrepancies between doc + code listed.
- Reviewer: Agent #31.
- Depends on: A31-W1-Mon.

**A34-W1-Tue (2026-05-26)** — Error-codes audit
- Done when: every machine-readable error code in code reviewed against `docs/error_codes.md`.
- Output: `docs/team/writers/error-codes-audit-w1.md`.
- Verify: every error has cause + remediation.
- Reviewer: Agent #31.
- Depends on: A34-W1-Mon.

**A34-W1-Wed (2026-05-27)** — API contract PR — fix discrepancies
- Done when: PR updating `docs/api_contract.md` for known discrepancies.
- Output: PR.
- Verify: doc now matches code.
- Reviewer: Agents #2, #31.
- Depends on: A34-W1-Tue.

**A34-W1-Thu (2026-05-28)** — Error codes PR — fix discrepancies
- Done when: PR updating `docs/error_codes.md`.
- Output: PR.
- Verify: 100 % of codes documented.
- Reviewer: Agents #2, #31.
- Depends on: A34-W1-Wed.

**A34-W1-Fri (2026-05-29)** — Status post + integration guide skeleton
- Done when: integration guide skeleton for a target bank's net-banking team drafted.
- Output: `docs/integrations/bank-netbanking-integration-guide.md` v0.
- Verify: covers 6 sections (overview, scope, prerequisites, flow, troubleshooting, support).
- Reviewer: Agent #10.
- Depends on: A34-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A34-W2-Mon (2026-06-01)** — API contract update for zod validators (post-C-022)
- Done when: documented payload schemas updated.
- Output: PR.
- Verify: schemas reflect zod definitions.
- Reviewer: Agent #6.
- Depends on: A34-W1-Fri.

**A34-W2-Tue (2026-06-02)** — Integration guide v1 — net-banking section
- Done when: net-banking integration steps detailed.
- Output: PR.
- Verify: steps reviewable by an engineer.
- Reviewer: Agent #10.
- Depends on: A34-W2-Mon.

**A34-W2-Wed (2026-06-03)** — RBI Master Direction compliance section in integration guide
- Done when: section added explaining ZeroAuth's coverage of MD IT Governance §6.4.
- Output: PR.
- Verify: section references threat model.
- Reviewer: Agent #37.
- Depends on: A34-W2-Tue.

**A34-W2-Thu (2026-06-04)** — Console panel docstrings + tooltips
- Done when: console panel strings refreshed.
- Output: PR.
- Verify: panels render with new strings.
- Reviewer: Agent #15.
- Depends on: A34-W2-Wed.

**A34-W2-Fri (2026-06-05)** — Phase 0 writer sign-off + status post
- Done when: API contract + error codes current.
- Output: row in Phase 0 exit doc.
- Verify: docs site reflects state.
- Reviewer: Agent #31.
- Depends on: A34-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A34-W3-Mon (2026-06-08)** — Integration guide v1 — branch-teller section
- Done when: branch-teller (workforce) integration drafted.
- Output: PR.
- Verify: reviewed by Agent #10.
- Reviewer: Agent #10.
- Depends on: A34-W2-Fri.

**A34-W3-Tue (2026-06-09)** — Integration guide v1 — transaction step-up section
- Done when: transaction step-up integration drafted.
- Output: PR.
- Verify: reviewed.
- Reviewer: Agent #10.
- Depends on: A34-W3-Mon.

**A34-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + kiosk integration docs page
- Done when: kiosk web app integration page drafted.
- Output: PR.
- Verify: covers SSE + QR formats.
- Reviewer: Agent #15.
- Depends on: A34-W3-Tue.

**A34-W3-Thu (2026-06-11)** — Node SDK README skeleton
- Done when: skeleton aligned with `docs/product/dx/node-sdk-api-spec.md`.
- Output: `sdk/node/README.md` v0 (in future sdk dir).
- Verify: skeleton matches spec.
- Reviewer: Agents #31, #47.
- Depends on: A34-W3-Wed.

**A34-W3-Fri (2026-06-12)** — Status post + Anchor Bank integration guide branch
- Done when: Anchor-Bank-specific overlay drafted (placeholder until pilot agreed).
- Output: `docs/integrations/anchor-bank-overlay.md`.
- Verify: branded overlay covers Anchor-Bank-specific webhooks + topics.
- Reviewer: Agent #29.
- Depends on: A34-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A34-W4-Mon (2026-06-15)** — API contract update for C-105 (identity register)
- Done when: documentation reflects attestation payload changes.
- Output: PR.
- Verify: schemas match.
- Reviewer: Agent #6.
- Depends on: A06-W4-Tue.

**A34-W4-Tue (2026-06-16)** — Error codes update for C-105 (attestation-related errors)
- Done when: new error codes (`attestation_invalid`, `play_integrity_failed`, etc.) documented.
- Output: PR.
- Verify: 100 % of new codes covered.
- Reviewer: Agent #6.
- Depends on: A34-W4-Mon.

**A34-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + threat-model writer pass
- Done when: threat model reviewed for consistency.
- Output: PR (or comments to Agent #35).
- Verify: language consistent.
- Reviewer: Agent #35.
- Depends on: A34-W4-Tue.

**A34-W4-Thu (2026-06-18)** — Sprint 1 writer sign-off
- Done when: developer-docs section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: API contract + error codes + integration guide current.
- Reviewer: Agent #31.
- Depends on: A28-W4-Thu.

**A34-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (more SDK docs, integration guide bank-specific overlays).
- Output: `docs/team/writers/a34-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #31.
- Depends on: A34-W4-Thu.
