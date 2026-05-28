# Agent #1 — Chief Engineering Officer

**Reports to:** Founder.
**Mandate:** Owns engineering org. Final arbiter on architectural decisions captured in `/adr/`. Sign-off on every release.
**KPIs:** see role 1 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A01-W1-Mon (2026-05-25)** — Send Phase 0 kickoff brief to all 50 agents
- Done when: brief sent before 10:00 IST, names the 6 P0 audit findings to close in weeks 1–2, names each agent's first ticket id.
- Output: `docs/team/announcements/2026-05-25-phase-0-kickoff.md` and Slack #all-hands post.
- Verify: file committed; Slack post linked from doc.
- Reviewer: Agent #28 (CPO co-signs), Agent #42 (CRO co-signs).
- Depends on: none.

**A01-W1-Tue (2026-05-26)** — Author ADR 0008 (branching workflow)
- Done when: → C-002 PR opened with ADR captured per `04-commits.md` C-002 DoD.
- Output: `adr/0008-branching-workflow.md`, PR link.
- Verify: markdownlint passes; ADR references CLAUDE.md.
- Reviewer: Agent #5, Agent #21.
- Depends on: A01-W1-Mon.

**A01-W1-Wed (2026-05-27)** — Review pre-commit hook PR (C-001)
- Done when: PR review submitted (APPROVE or REQUEST_CHANGES) with explicit comment on commit-msg gate behaviour.
- Output: PR comment thread on C-001.
- Verify: PR review event recorded.
- Reviewer: self-sign-off; Agent #22 implements.
- Depends on: C-001 opened.

**A01-W1-Thu (2026-05-28)** — Review demo-bypass-removal PR (C-004)
- Done when: PR review submitted; explicit comment that no `did:zeroauth:demo:*` short-circuit remains in `submitProof`.
- Output: PR comment on C-004.
- Verify: grep `did:zeroauth:demo:` in merged code returns zero hits in `src/services/proof-pairing.ts`.
- Reviewer: Agent #26 + Agent #27 sub-agent reviews already posted.
- Depends on: C-004 opened.

**A01-W1-Fri (2026-05-29)** — Review C-005 + Friday status sweep
- Done when: C-005 reviewed (access_token query fallback removed); all 50 Friday status posts read; blockers triaged into Monday standup.
- Output: PR comment on C-005; `docs/team/blockers/2026-05-29.md`.
- Verify: blocker doc lists every blocker raised; assignments recorded.
- Reviewer: line VPs (Agents #2, #3, #4, #5).
- Depends on: A01-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A01-W2-Mon (2026-06-01)** — Week 2 sprint check + ADR arbitration session
- Done when: 30-min sync with crypto lead (Agent #11) + backend lead (Agent #2) closes any open architectural debate from week 1.
- Output: `docs/team/decisions/2026-06-01-arbitration-log.md`.
- Verify: decisions logged; each decision tagged ADR-pending or no-ADR-needed.
- Reviewer: Agents #2, #11.
- Depends on: A01-W1-Fri.

**A01-W2-Tue (2026-06-02)** — Review C-012 (audit chain implementation)
- Done when: PR review submitted; cryptographer-reviewer sub-agent has signed off.
- Output: PR comment on C-012.
- Verify: sub-agent APPROVE row present.
- Reviewer: Agent #11, Agent #27.
- Depends on: cryptographer-reviewer sub-agent invocation.

**A01-W2-Wed (2026-06-03)** — Review C-016 (AuditAnchor contract) + C-020 (Groth16Verifier redeploy)
- Done when: both PRs reviewed; Basescan-verified addresses confirmed.
- Output: PR comments + `contracts/deployed-addresses.json` reviewed.
- Verify: addresses match Basescan-verified contracts.
- Reviewer: Agent #25, Agent #11.
- Depends on: C-016, C-020 opened.

**A01-W2-Thu (2026-06-04)** — Review C-028 (JWT RS256) + C-025 (Postgres session store)
- Done when: both PRs reviewed; key-management ADR (0017 if needed) green-lit.
- Output: PR comments.
- Verify: JWKS endpoint live in test env.
- Reviewer: Agent #12.
- Depends on: C-028, C-025 opened.

**A01-W2-Fri (2026-06-05)** — Phase 0 exit-gate review meeting
- Done when: all P0 audit findings (C-1, C-3, C-7, C-9, C-10, C-11) confirmed closed by referenced commits; C-2 marked tracked-to-phase-1-sprint-3; CLAUDE.md updated by C-033.
- Output: `docs/team/phase-exits/phase-0-exit-2026-06-05.md` with sign-off rows.
- Verify: 6 P0 findings closed in `docs/security/audit-findings.md`; CI green on `dev`.
- Reviewer: Agents #26, #27 (security + crypto), #36 (compliance), #28 (product), #42 (revenue).
- Depends on: A01-W2-Mon..Thu, C-033 merged.

## Week 3 (2026-06-08 → 2026-06-12)

**A01-W3-Mon (2026-06-08)** — Phase 1 Sprint 1 kickoff brief
- Done when: brief sent; lists C-101..C-108 anchor commits with owners; reaffirms the "no demo bypass anywhere" rule.
- Output: `docs/team/announcements/2026-06-08-phase-1-s1-kickoff.md`.
- Verify: file committed; Slack post linked.
- Reviewer: Agents #2, #3, #4, #5, #28, #36, #42.
- Depends on: Phase 0 exit gate passed.

**A01-W3-Tue (2026-06-09)** — Review C-101 (mobile subtree bootstrap) + C-102 (ADR 0014 android-only)
- Done when: both PRs reviewed; android-only decision documented.
- Output: PR comments; ADR merged.
- Verify: `mobile/` subtree exists in `dev`; ADR 0014 referenced from CLAUDE.md.
- Reviewer: Agent #4.
- Depends on: C-101, C-102 opened.

**A01-W3-Wed (2026-06-10)** — Review C-103 (ADR 0015 rapidsnark) + Cross-line architecture sync
- Done when: ADR reviewed; mid-week architecture sync held with VPs.
- Output: PR comment; `docs/team/syncs/2026-06-10-arch-sync.md`.
- Verify: ADR merged; sync notes published.
- Reviewer: Agents #2, #3, #4, #5, #11.
- Depends on: A01-W3-Tue.

**A01-W3-Thu (2026-06-11)** — Review C-104 (rapidsnark JNI POC) — sub-agent gates
- Done when: PR reviewed; cryptographer-reviewer + security-reviewer sub-agent posts read.
- Output: PR comment.
- Verify: smoke test on Pixel emulator passes in CI.
- Reviewer: Agents #11, #17, #27.
- Depends on: C-104 opened.

**A01-W3-Fri (2026-06-12)** — Friday status sweep + sprint 1 mid-point health check
- Done when: all 50 status posts read; on-track / at-risk per-agent grid published.
- Output: `docs/team/sprint-health/s1-mid.md`.
- Verify: grid covers all 50; flagged risks have owners.
- Reviewer: line VPs.
- Depends on: A01-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A01-W4-Mon (2026-06-15)** — Review C-105 (redesigned identity register)
- Done when: PR reviewed; Play Integrity acceptance ADR (0016) co-reviewed.
- Output: PR comment on C-105.
- Verify: tests `tests/identity-register.test.ts` pass on CI; sub-agent APPROVE present.
- Reviewer: Agents #6, #26, #27.
- Depends on: C-105 opened.

**A01-W4-Tue (2026-06-16)** — Review C-106 (ADR 0016 Play Integrity acceptance)
- Done when: ADR reviewed; `live`-env stricter rule confirmed.
- Output: PR comment; ADR merged.
- Verify: ADR linked from `docs/threat_model.md` row for device-attestation attack.
- Reviewer: Agent #27.
- Depends on: A01-W4-Mon.

**A01-W4-Wed (2026-06-17)** — Review C-107 (dashboard users view)
- Done when: PR reviewed; PII-blacklist Playwright assertion confirmed.
- Output: PR comment.
- Verify: `dashboard/src/routes/tenant/__tests__/users.test.tsx` green.
- Reviewer: Agents #14, #39 (privacy engineer).
- Depends on: C-107 opened.

**A01-W4-Thu (2026-06-18)** — Sprint 1 exit-gate review
- Done when: all S1 anchor commits (C-101..C-108) merged; sprint 1 exit-gate checklist green.
- Output: `docs/team/sprint-exits/s1-2026-06-18.md`.
- Verify: each of 8 anchor commits referenced + merged; sub-agent sign-offs present.
- Reviewer: Agents #2, #3, #4, #28.
- Depends on: A01-W4-Mon..Wed.

**A01-W4-Fri (2026-06-19)** — Sprint 2 ticket list confirmation + Friday status sweep
- Done when: sprint 2 anchor commits (C-121..C-128) reviewed with VPs; per-agent week-5 tickets confirmed.
- Output: `docs/team/sprint-plans/s2-2026-06-22.md`; Friday status posts read.
- Verify: each of 8 sprint-2 anchor commits has an owner; week-5 daily tickets created for all 50 agents (separate work, tracked separately).
- Reviewer: Agents #2, #3, #4, #5, #28.
- Depends on: A01-W4-Thu.
