# Agent #27 — Senior Security Engineer (cryptanalysis + circuit review)

**Reports to:** Agent #1 (dotted: Agent #11).
**Mandate:** Owns cryptographer-reviewer subagent, external cryptographer engagement, circuit review, trusted-setup ceremony coordination.
**KPIs:** see role 27 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A27-W1-Mon (2026-05-25)** — Review C-008 (ADR 0009 QR proof pairing protocol)
- Done when: PR review submitted; Option B′ protocol correctness verified.
- Output: PR comment on C-008.
- Verify: APPROVE row.
- Reviewer: Agent #11.
- Depends on: A01-W1-Mon.

**A27-W1-Tue (2026-05-26)** — Review C-009 (ADR 0010 hash chain spec)
- Done when: PR review submitted; chain construction verified.
- Output: PR comment on C-009.
- Verify: APPROVE row.
- Reviewer: Agents #8, #11, #13.
- Depends on: A27-W1-Mon.

**A27-W1-Wed (2026-05-27)** — Cryptographer-reviewer subagent rules review (C-030 precursor)
- Done when: rules updated to reflect Phase 0 paths.
- Output: contribution to `.claude/agents/cryptographer-reviewer.md`.
- Verify: ruleset captured.
- Reviewer: Agent #1.
- Depends on: A27-W1-Tue.

**A27-W1-Thu (2026-05-28)** — External cryptographer shortlist + outreach
- Done when: 3 candidates contacted with scoping email.
- Output: `docs/team/security/external-cryptographer-shortlist.md`.
- Verify: 3 candidates listed; outreach logged.
- Reviewer: Agent #36.
- Depends on: A27-W1-Wed.

**A27-W1-Fri (2026-05-29)** — Status post + Trusted-setup ceremony coordination kickoff
- Done when: 6 candidate contributors identified.
- Output: contribution to `docs/team/crypto/trusted-setup-contributors.md`.
- Verify: 6 contributors with backgrounds.
- Reviewer: Agent #11.
- Depends on: A27-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A27-W2-Mon (2026-06-01)** — Implement C-030 (cryptographer-reviewer subagent hooks)
- Done when: hooks invoke subagent on every PR touching `circuits/`, `contracts/`, hash construction.
- Output: PR.
- Verify: `scripts/test-crypto-reviewer-hook.sh` green.
- Reviewer: Agent #22.
- Depends on: A27-W1-Fri.

**A27-W2-Tue (2026-06-02)** — Sub-agent review on C-012 + C-013 (audit chain)
- Done when: cryptographer reviews posted; concerns logged.
- Output: PR review threads.
- Verify: APPROVE secured before merge.
- Reviewer: Agents #8, #11, #13.
- Depends on: A27-W2-Mon.

**A27-W2-Wed (2026-06-03)** — Sub-agent review on C-016 (AuditAnchor contract)
- Done when: review row posted; gas + reentrancy + access-control checked.
- Output: PR review thread.
- Verify: APPROVE row.
- Reviewer: Agent #25.
- Depends on: A27-W2-Tue.

**A27-W2-Thu (2026-06-04)** — Sub-agent review on C-018 (circuit version pin) + C-020 (verifier redeploy)
- Done when: review rows posted on both PRs.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #11.
- Depends on: A27-W2-Wed.

**A27-W2-Fri (2026-06-05)** — Phase 0 cryptanalysis sign-off + status post
- Done when: all crypto-touched PRs have cryptographer-reviewer APPROVE; ceremony scheduled.
- Output: contribution to Phase 0 exit doc.
- Verify: rows visible across PRs.
- Reviewer: Agent #11.
- Depends on: A27-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A27-W3-Mon (2026-06-08)** — Sub-agent review on C-101 (mobile subtree) + C-102 (ADR 0014)
- Done when: review rows posted.
- Output: PR review threads.
- Verify: rows visible.
- Reviewer: Agent #4.
- Depends on: A27-W2-Fri.

**A27-W3-Tue (2026-06-09)** — Sub-agent review on C-103 (ADR 0015 rapidsnark)
- Done when: review row posted; rapidsnark toolchain trust assumptions verified.
- Output: PR review thread.
- Verify: APPROVE row.
- Reviewer: Agent #11.
- Depends on: A27-W3-Mon.

**A27-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A27-W3-Tue.

**A27-W3-Thu (2026-06-11)** — Sub-agent review on C-104 (rapidsnark JNI POC) — cryptanalysis focus
- Done when: review row posted; nonce binding + memory safety + JNI boundary verified.
- Output: PR review thread.
- Verify: APPROVE row after concerns resolved.
- Reviewer: Agents #11, #17.
- Depends on: A27-W3-Wed.

**A27-W3-Fri (2026-06-12)** — Status post + external cryptographer SoW signed (with Agent #11)
- Done when: SoW for v1.2 circuit review signed.
- Output: SoW reference logged.
- Verify: deliverables + dates captured.
- Reviewer: Agent #36.
- Depends on: A27-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A27-W4-Mon (2026-06-15)** — Sub-agent review on C-105 (identity register) — cryptanalysis
- Done when: review row posted; attestation cryptography validated.
- Output: PR review thread.
- Verify: APPROVE row.
- Reviewer: Agents #6, #11, #12.
- Depends on: A27-W3-Thu.

**A27-W4-Tue (2026-06-16)** — Sub-agent review on C-106 (ADR 0016 Play Integrity)
- Done when: review row posted.
- Output: PR review thread.
- Verify: APPROVE row.
- Reviewer: Agent #6.
- Depends on: A27-W4-Mon.

**A27-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + Trusted-setup ceremony date confirmed
- Done when: 6 contributors confirmed for week 10; ceremony date + venue locked.
- Output: contribution to `docs/team/crypto/trusted-setup-ceremony.md`.
- Verify: invitations sent.
- Reviewer: Agent #11.
- Depends on: A27-W4-Tue.

**A27-W4-Thu (2026-06-18)** — Sprint 1 cryptanalysis sign-off
- Done when: cryptanalysis section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: every sprint-1 crypto PR has APPROVE.
- Reviewer: Agent #1.
- Depends on: A27-W4-Wed.

**A27-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (ceremony rehearsal, external review prep).
- Output: `docs/team/security/a27-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A27-W4-Thu.
