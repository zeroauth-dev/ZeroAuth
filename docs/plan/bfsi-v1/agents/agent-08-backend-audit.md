# Agent #8 — Senior Backend Engineer (audit + blockchain integration)

**Reports to:** Agent #2.
**Mandate:** Owns `audit_events` write path, hash chain, daily on-chain anchor cron, `DIDRegistry` interaction.
**KPIs:** see role 8 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A08-W1-Mon (2026-05-25)** — Co-design ADR 0010 (audit hash chain) with Agent #11
- Done when: hash function (SHA-256 over canonical JSON), chain entry shape, genesis row, drift cadence agreed.
- Output: `adr/0010-audit-log-hash-chain.md` draft.
- Verify: spec referenceable from C-009 PR.
- Reviewer: Agents #11, #27.
- Depends on: A02-W1-Mon.

**A08-W1-Tue (2026-05-26)** — Write failing test for C-011 (audit_events schema columns)
- Done when: `tests/audit-schema.test.ts::"audit_events has previous_hash and event_hash columns"` red.
- Output: PR draft.
- Verify: test fails on current schema.
- Reviewer: Agent #23.
- Depends on: A08-W1-Mon.

**A08-W1-Wed (2026-05-27)** — Implement C-011 (schema columns)
- Done when: idempotent schema bootstrap; existing rows backfilled with NULL `previous_hash`.
- Output: C-011 PR.
- Verify: Tuesday's test green.
- Reviewer: Agent #2.
- Depends on: A08-W1-Tue.

**A08-W1-Thu (2026-05-28)** — Begin C-012 (audit chain implementation) — write failing tests
- Done when: `tests/audit-chain.test.ts` set written (100-row append, tamper detection).
- Output: red tests in PR draft.
- Verify: tests fail before implementation.
- Reviewer: Agent #23.
- Depends on: A08-W1-Wed.

**A08-W1-Fri (2026-05-29)** — Implement C-012 first cut + status post
- Done when: `appendAuditEvent` function returns chained row; tests green.
- Output: C-012 PR draft.
- Verify: `tests/audit-chain.test.ts` green; cryptographer-reviewer review requested.
- Reviewer: Agents #11, #13.
- Depends on: A08-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A08-W2-Mon (2026-06-01)** — Address sub-agent feedback on C-012; merge C-009 + C-011 + C-012
- Done when: hash-chain ADR + schema + implementation all merged.
- Output: 3 merge commits.
- Verify: `dev` CI green.
- Reviewer: Agents #2, #11, #27.
- Depends on: A08-W1-Fri.

**A08-W2-Tue (2026-06-02)** — Implement C-013 (route all writes through `appendAuditEvent`)
- Done when: `src/services/platform.ts`, `src/routes/admin.ts`, `src/routes/console.ts`, `src/routes/v1/*.ts` audited; no direct INSERT remains.
- Output: C-013 PR.
- Verify: `tests/audit-chain.test.ts::"every audit-writing surface uses appendAuditEvent"` (grep-style) green.
- Reviewer: Agent #2.
- Depends on: A08-W2-Mon.

**A08-W2-Wed (2026-06-03)** — Implement C-014 (`/api/admin/audit-integrity` endpoint)
- Done when: endpoint returns `{status, broken_at?}`; logs own audit row.
- Output: C-014 PR.
- Verify: `tests/admin-audit-integrity.test.ts::"returns PASS for clean chain"`, `"returns FAIL with broken_at row id"` green.
- Reviewer: Agents #2, #9.
- Depends on: A08-W2-Tue.

**A08-W2-Thu (2026-06-04)** — Pair with Agent #21 on C-015 (anchor-job cron)
- Done when: anchor cron implementation lands; failure-alert path agreed.
- Output: C-015 PR contribution.
- Verify: `tests/anchor-job.test.ts::"computes terminal hash and submits to AuditAnchor contract"` against Hardhat fork green.
- Reviewer: Agents #21, #25.
- Depends on: A08-W2-Wed.

**A08-W2-Fri (2026-06-05)** — Phase 0 audit-chain sign-off + status post
- Done when: hash-chain milestones merged; integrity endpoint live in test.
- Output: row in `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: C-009..C-015 all merged.
- Reviewer: Agent #2.
- Depends on: A08-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A08-W3-Mon (2026-06-08)** — Hash-chain runbook drafted
- Done when: on-call runbook covers "integrity check failed" + "anchor failed 2 days running" + "row tampering detected" scenarios.
- Output: `docs/operations/audit-integrity-runbook.md` v0.
- Verify: each scenario has detection, triage, recovery steps.
- Reviewer: Agents #21, #40.
- Depends on: A08-W2-Fri.

**A08-W3-Tue (2026-06-09)** — Backfill migration design (precursor to C-121)
- Done when: backfill migration design captured; rollback path documented.
- Output: `docs/team/backend/audit-backfill-design.md`.
- Verify: covers 10k-row test scenario.
- Reviewer: Agent #2.
- Depends on: A08-W3-Mon.

**A08-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; audit-chain integration with new audit-row sources clarified.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A08-W3-Tue.

**A08-W3-Thu (2026-06-11)** — Observability for audit-write lag
- Done when: metric emitter wired in `appendAuditEvent`; Grafana panel added.
- Output: PR for metric emitter + dashboard panel.
- Verify: metric visible in test env.
- Reviewer: Agent #21.
- Depends on: A08-W3-Wed.

**A08-W3-Fri (2026-06-12)** — Status post + audit-integrity check nightly CI
- Done when: nightly CI workflow checks audit-integrity on test env database.
- Output: `.github/workflows/audit-integrity-nightly.yml`.
- Verify: dry-run green.
- Reviewer: Agent #22.
- Depends on: A08-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A08-W4-Mon (2026-06-15)** — Test-env hash-chain backfill dry run
- Done when: backfill executed on test env database snapshot; chain integrity verified.
- Output: `docs/team/backend/audit-backfill-dry-run.md`.
- Verify: 10k-row backfill completes in ≤ 30 s.
- Reviewer: Agent #2.
- Depends on: A08-W3-Tue.

**A08-W4-Tue (2026-06-16)** — Audit-coverage test scaffolding (precursor C-127)
- Done when: scaffold for `tests/audit-coverage.test.ts` written using Express introspection + grep.
- Output: PR draft.
- Verify: scaffold lists every mutating endpoint.
- Reviewer: Agent #23.
- Depends on: A08-W4-Mon.

**A08-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A08-W4-Tue.

**A08-W4-Thu (2026-06-18)** — Sprint 1 audit-chain sign-off
- Done when: audit-chain section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: nightly integrity workflow green for 5 consecutive nights.
- Reviewer: Agent #2.
- Depends on: A08-W3-Fri.

**A08-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets focused on C-121/C-122 enforcement.
- Output: `docs/team/backend/a08-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #2.
- Depends on: A08-W4-Thu.
