# Agent #26 — Senior Security Engineer (red team + AppSec)

**Reports to:** Agent #1 (dotted: Agent #36).
**Mandate:** Owns OWASP posture, internal + external pentest, bug bounty, security-reviewer sub-agent operation.
**KPIs:** see role 26 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A26-W1-Mon (2026-05-25)** — Audit-findings tracking doc (C-031)
- Done when: → C-031 PR opened with table of all 21 findings.
- Output: `docs/security/audit-findings.md`.
- Verify: each row has status + remediation owner.
- Reviewer: Agent #1.
- Depends on: A01-W1-Mon.

**A26-W1-Tue (2026-05-26)** — Security-reviewer subagent rules review (C-029 precursor)
- Done when: rules updated to reflect Phase 0 paths.
- Output: contribution to `.claude/agents/security-reviewer.md`.
- Verify: ruleset captured.
- Reviewer: Agent #1.
- Depends on: A26-W1-Mon.

**A26-W1-Wed (2026-05-27)** — Sub-agent reviews on C-004 + C-005
- Done when: APPROVE or REQUEST_CHANGES rows posted on both PRs.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #1.
- Depends on: A26-W1-Tue.

**A26-W1-Thu (2026-05-28)** — OWASP top-10 evidence audit (current state)
- Done when: OWASP top-10 + current state catalogued; gaps listed.
- Output: `docs/team/security/owasp-top-10-evidence.md`.
- Verify: each item has evidence or gap-ticket.
- Reviewer: Agent #36.
- Depends on: A26-W1-Wed.

**A26-W1-Fri (2026-05-29)** — Status post + sub-agent reviews on C-007 + C-021
- Done when: review rows posted.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #1.
- Depends on: A26-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A26-W2-Mon (2026-06-01)** — Implement C-029 (security-reviewer subagent hooks)
- Done when: hooks invoke subagent on every PR touching sensitive paths.
- Output: PR.
- Verify: `scripts/test-sec-reviewer-hook.sh` green.
- Reviewer: Agent #22.
- Depends on: A26-W1-Fri.

**A26-W2-Tue (2026-06-02)** — Sub-agent reviews on C-012 + C-013 + C-014 (audit chain)
- Done when: review rows posted; concerns logged.
- Output: PR review threads.
- Verify: APPROVE secured before merge.
- Reviewer: Agent #1.
- Depends on: A26-W2-Mon.

**A26-W2-Wed (2026-06-03)** — Sub-agent reviews on C-022 + C-025 + C-026 + C-027
- Done when: review rows posted across 4 PRs.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #1.
- Depends on: A26-W2-Tue.

**A26-W2-Thu (2026-06-04)** — Sub-agent reviews on C-028 + C-032
- Done when: review rows posted.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #1.
- Depends on: A26-W2-Wed.

**A26-W2-Fri (2026-06-05)** — Phase 0 security sign-off + status post
- Done when: all 6 P0 findings confirmed closed; audit-findings doc green.
- Output: contribution to Phase 0 exit doc.
- Verify: findings doc has closing commit hashes.
- Reviewer: Agent #1.
- Depends on: A26-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A26-W3-Mon (2026-06-08)** — Internal red-team exercise plan v1
- Done when: plan covers cred-store breach, replay, cross-tenant, SSRF, IDOR, JWT-forgery, audit-tamper.
- Output: `docs/team/security/internal-red-team-plan-v1.md`.
- Verify: 7 attack scenarios.
- Reviewer: Agent #36.
- Depends on: A26-W2-Fri.

**A26-W3-Tue (2026-06-09)** — Sub-agent review on C-101 (mobile subtree)
- Done when: review row posted.
- Output: PR review thread.
- Verify: row visible.
- Reviewer: Agent #1.
- Depends on: A26-W3-Mon.

**A26-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A26-W3-Tue.

**A26-W3-Thu (2026-06-11)** — Sub-agent review on C-104 (rapidsnark JNI POC)
- Done when: review row posted with focus on memory-safety + RNG seeding.
- Output: PR review thread.
- Verify: row visible.
- Reviewer: Agent #27.
- Depends on: A26-W3-Wed.

**A26-W3-Fri (2026-06-12)** — Status post + bug-bounty platform vendor evaluation
- Done when: 3 vendors evaluated (HackerOne, Bugcrowd, Intigriti).
- Output: `docs/team/security/bug-bounty-vendor-evaluation.md`.
- Verify: comparison table covers cost, payout floor, India SLA.
- Reviewer: Agent #36.
- Depends on: A26-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A26-W4-Mon (2026-06-15)** — Sub-agent review on C-105 (identity register attestation)
- Done when: review row posted.
- Output: PR review thread.
- Verify: row visible.
- Reviewer: Agent #1.
- Depends on: A26-W3-Thu.

**A26-W4-Tue (2026-06-16)** — Sub-agent review on C-106 (ADR 0016 Play Integrity)
- Done when: review row posted.
- Output: PR review thread.
- Verify: row visible.
- Reviewer: Agent #1.
- Depends on: A26-W4-Mon.

**A26-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + IoT bridge security audit (with Agent #20)
- Done when: bridge attack surface mapped; mitigations reviewed.
- Output: contribution to `docs/team/iot/bridge-security-audit.md`.
- Verify: each surface has mitigation.
- Reviewer: Agent #20.
- Depends on: A26-W4-Tue.

**A26-W4-Thu (2026-06-18)** — Sprint 1 security sign-off
- Done when: security section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: every S1 PR with subagent gates has APPROVE.
- Reviewer: Agent #1.
- Depends on: A26-W4-Wed.

**A26-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (red-team exercise execution, more sub-agent reviews).
- Output: `docs/team/security/a26-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A26-W4-Thu.
