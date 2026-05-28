# Agent #13 — Mid Cryptography Engineer (Poseidon + hash chain)

**Reports to:** Agent #11.
**Mandate:** Owns Poseidon implementation correctness, audit hash-chain construction, primitive-level test vectors.
**KPIs:** see role 13 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A13-W1-Mon (2026-05-25)** — Poseidon implementation audit
- Done when: existing Poseidon usage in `src/services/zkp.ts`, `proof-pairing.ts`, `identity.ts` catalogued; entry points enumerated.
- Output: `docs/team/crypto/poseidon-usage-audit.md`.
- Verify: list covers every call site with input cardinality.
- Reviewer: Agent #11.
- Depends on: A02-W1-Mon.

**A13-W1-Tue (2026-05-26)** — Pair with Agent #11 on test vectors against `circomlibjs` reference
- Done when: 100 vectors generated + matched.
- Output: `tests/poseidon-vectors.test.ts` v1.
- Verify: vectors byte-for-byte match.
- Reviewer: Agent #11.
- Depends on: A13-W1-Mon.

**A13-W1-Wed (2026-05-27)** — Hash-chain primitive helpers design (precursor to C-012)
- Done when: helper functions `computeRowHash(prevHash, eventData)`, `validateChain(rows)`, `genesisHash()` designed.
- Output: `docs/team/crypto/hash-chain-helpers-design.md`.
- Verify: design covers canonical JSON serialisation rules.
- Reviewer: Agent #11.
- Depends on: A13-W1-Tue.

**A13-W1-Thu (2026-05-28)** — Wrap `src/services/poseidon.ts` (new wrapper)
- Done when: typed wrapper exported; consumers call wrapper, not raw circomlibjs.
- Output: PR.
- Verify: existing tests still green; new typed signature documented.
- Reviewer: Agent #11.
- Depends on: A13-W1-Wed.

**A13-W1-Fri (2026-05-29)** — Status post + canonical JSON serialisation choice
- Done when: status posted; choice of canonical JSON library (e.g., RFC 8785 JCS) documented.
- Output: `docs/team/crypto/canonical-json-choice.md`.
- Verify: covers determinism, perf, dep impact.
- Reviewer: Agent #11.
- Depends on: A13-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A13-W2-Mon (2026-06-01)** — Implement hash-chain primitives in `src/services/audit.ts`
- Done when: helpers landed; companion to C-012.
- Output: PR contribution to C-012.
- Verify: helpers pass unit tests in `tests/audit-chain-primitives.test.ts`.
- Reviewer: Agents #8, #11.
- Depends on: A13-W1-Fri.

**A13-W2-Tue (2026-06-02)** — Cryptographer-reviewer feedback on C-012
- Done when: review row submitted on C-012 PR; concerns logged.
- Output: PR comment + APPROVE row when ready.
- Verify: APPROVE row only after concerns addressed.
- Reviewer: Agent #11.
- Depends on: C-012 opened.

**A13-W2-Wed (2026-06-03)** — Drift-detection job design
- Done when: hourly drift-detection (lightweight chain replay) designed for live env.
- Output: `docs/team/crypto/drift-detection-design.md`.
- Verify: covers sampling strategy + alert threshold.
- Reviewer: Agent #40.
- Depends on: A13-W2-Tue.

**A13-W2-Thu (2026-06-04)** — Implementation kickoff: drift-detection cron skeleton
- Done when: cron skeleton landed (not yet wired in prod).
- Output: PR draft for drift-detection cron.
- Verify: scaffold compiles + tests skeleton passes.
- Reviewer: Agent #21.
- Depends on: A13-W2-Wed.

**A13-W2-Fri (2026-06-05)** — Phase 0 hash-chain sign-off + status post
- Done when: hash-chain primitives merged; drift-detection design captured.
- Output: row in `docs/team/phase-exits/phase-0-crypto-signoff.md`.
- Verify: helpers in `src/services/audit.ts`.
- Reviewer: Agent #11.
- Depends on: A13-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A13-W3-Mon (2026-06-08)** — External cryptographer engagement coordination
- Done when: external review SoW for v1.2 circuit coordinated with Agent #27 + Agent #11.
- Output: engagement letter draft.
- Verify: scope covers Poseidon + chain construction.
- Reviewer: Agents #11, #27.
- Depends on: A13-W2-Fri.

**A13-W3-Tue (2026-06-09)** — Hash-chain breakage detection in CI
- Done when: CI step replays the chain on `test` env nightly DB dump + asserts integrity.
- Output: PR for CI step.
- Verify: dry run green.
- Reviewer: Agents #22, #8.
- Depends on: A13-W3-Mon.

**A13-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A13-W3-Tue.

**A13-W3-Thu (2026-06-11)** — Cryptographer-reviewer subagent rules expansion (companion C-030)
- Done when: subagent rules cover hash-chain primitives, Poseidon usage changes, new commitment schemes.
- Output: contribution to `.claude/agents/cryptographer-reviewer.md`.
- Verify: rule set covers added paths.
- Reviewer: Agent #27.
- Depends on: A13-W3-Wed.

**A13-W3-Fri (2026-06-12)** — Status post + cryptanalysis-readiness checklist
- Done when: checklist drafted for external cryptographer review (v1.2 circuit + hash chain).
- Output: `docs/team/crypto/cryptanalysis-readiness-checklist.md`.
- Verify: covers Poseidon parameters, circuit constraints, chain construction.
- Reviewer: Agent #27.
- Depends on: A13-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A13-W4-Mon (2026-06-15)** — Pair with Agent #11 on identity_proof v1.2 design freeze
- Done when: review v1.2 diff (tx_nonce + consent_hash bindings).
- Output: review comments.
- Verify: constraints reviewed.
- Reviewer: Agent #11.
- Depends on: A11-W4-Tue.

**A13-W4-Tue (2026-06-16)** — Drift-detection cron pilot run in test env
- Done when: cron live in test env; hourly run for 24 h with zero false positives.
- Output: `docs/team/crypto/drift-detection-pilot.md`.
- Verify: alert log empty (clean test data).
- Reviewer: Agent #21.
- Depends on: A13-W3-Tue.

**A13-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A13-W4-Tue.

**A13-W4-Thu (2026-06-18)** — Sprint 1 hash-chain sign-off
- Done when: hash-chain section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: drift-detection live in test; nightly CI integrity check passing.
- Reviewer: Agent #11.
- Depends on: A13-W4-Wed.

**A13-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted; external review prep work scoped.
- Output: `docs/team/crypto/a13-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #11.
- Depends on: A13-W4-Thu.
