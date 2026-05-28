# Agent #12 — Senior Cryptography Engineer (key management + HSM)

**Reports to:** Agent #1 (dotted: Agent #5).
**Mandate:** Owns platform key inventory, HSM path, StrongBox-rooted attestation chain for devices.
**KPIs:** see role 12 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A12-W1-Mon (2026-05-25)** — Production key inventory
- Done when: every production key (JWT, SESSION, ADMIN, BLOCKCHAIN, webhook signing) catalogued with current rotation date + storage location.
- Output: `docs/cryptography/key-inventory.md` v1.
- Verify: 5 categories present; sources of truth recorded.
- Reviewer: Agents #5, #21.
- Depends on: A01-W1-Mon.

**A12-W1-Tue (2026-05-26)** — JWT migration to RS256 — design
- Done when: design captures key generation, JWKS endpoint shape, dual-issuer rollover plan.
- Output: `docs/team/crypto/jwt-rs256-migration-design.md`.
- Verify: rollover preserves existing HS256 tokens during transition window.
- Reviewer: Agents #2, #6, #7.
- Depends on: A12-W1-Mon.

**A12-W1-Wed (2026-05-27)** — Secret-rotation calendar review (with Agent #5)
- Done when: calendar published with reminders to infra-on-call.
- Output: contribution to `docs/team/infra/secret-rotation-calendar.md`.
- Verify: quarterly entries for all 5 secret categories.
- Reviewer: Agent #5.
- Depends on: A12-W1-Tue.

**A12-W1-Thu (2026-05-28)** — Write red tests for C-028 (RS256 JWT)
- Done when: `tests/jwt-rs256.test.ts::"validates RS256 token against JWKS"` red.
- Output: PR draft.
- Verify: tests fail before implementation.
- Reviewer: Agent #23.
- Depends on: A12-W1-Wed.

**A12-W1-Fri (2026-05-29)** — Status post + StrongBox attestation chain spec
- Done when: status posted; spec for validating StrongBox attestation chains drafted.
- Output: `docs/team/crypto/strongbox-attestation-spec.md`.
- Verify: covers AAA root → device leaf chain; nonce binding.
- Reviewer: Agent #27.
- Depends on: A12-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A12-W2-Mon (2026-06-01)** — Implement C-028 (RS256 JWT) — first half
- Done when: key generation + JWT issuance refactored.
- Output: PR draft with keys generated + JWKS shape.
- Verify: HS256 tokens still accepted; RS256 issued during rollover.
- Reviewer: Agent #6.
- Depends on: A12-W1-Thu.

**A12-W2-Tue (2026-06-02)** — Implement C-028 — second half (JWKS endpoint + tests)
- Done when: `/.well-known/jwks.json` live; tests green.
- Output: PR ready for merge.
- Verify: `tests/jwt-rs256.test.ts` green.
- Reviewer: Agents #2, #6.
- Depends on: A12-W2-Mon.

**A12-W2-Wed (2026-06-03)** — Merge C-028 + key-rotation playbook documentation
- Done when: PR merged; rotation playbook v1 drafted.
- Output: merge commit + `docs/operations/jwt-key-rotation-playbook.md`.
- Verify: playbook covers rotation procedure + roll-back.
- Reviewer: Agents #5, #21.
- Depends on: A12-W2-Tue.

**A12-W2-Thu (2026-06-04)** — HSM evaluation: AWS CloudHSM vs YubiHSM2
- Done when: trade-off paper with cost, latency, regulatory acceptance, operational overhead.
- Output: `docs/team/crypto/hsm-evaluation.md`.
- Verify: covers FIPS 140-2 level, RBI acceptance, ops cost.
- Reviewer: Agents #36, #38.
- Depends on: A12-W2-Wed.

**A12-W2-Fri (2026-06-05)** — Phase 0 crypto key sign-off + status post
- Done when: C-028 merged; JWKS live in test env.
- Output: row in `docs/team/phase-exits/phase-0-crypto-signoff.md`.
- Verify: JWKS endpoint reachable.
- Reviewer: Agent #1.
- Depends on: A12-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A12-W3-Mon (2026-06-08)** — StrongBox attestation library implementation start
- Done when: skeleton library scaffolded; AAA root chain verification step landed.
- Output: PR draft.
- Verify: root chain validation works against Google sample attestation.
- Reviewer: Agent #27.
- Depends on: A12-W2-Fri.

**A12-W3-Tue (2026-06-09)** — Pair-program with Agent #6 on `src/services/attestation.ts`
- Done when: integration between key-attestation library + C-105 attestation validation working.
- Output: PR contribution.
- Verify: integration test green.
- Reviewer: Agents #2, #6.
- Depends on: A12-W3-Mon.

**A12-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A12-W3-Tue.

**A12-W3-Thu (2026-06-11)** — Test fixture: Play Integrity sample verdicts + key attestation cert chains
- Done when: fixture committed for use in `tests/identity-register.test.ts`.
- Output: `tests/fixtures/play-integrity-verdicts/`, `tests/fixtures/key-attestation-chains/`.
- Verify: fixtures cover MEETS_DEVICE_INTEGRITY + MEETS_BASIC_INTEGRITY + failures.
- Reviewer: Agent #6, Agent #27.
- Depends on: A12-W3-Wed.

**A12-W3-Fri (2026-06-12)** — Status post + HSM ADR draft (precursor)
- Done when: ADR for HSM decision drafted (target: merged later in phase 1).
- Output: `adr/0019-hsm-backed-signer-decision.md` draft.
- Verify: decision rationale + procurement timeline captured.
- Reviewer: Agents #5, #36.
- Depends on: A12-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A12-W4-Mon (2026-06-15)** — Review C-105 (identity register) attestation path
- Done when: PR reviewed; attestation validation cryptographically sound.
- Output: PR comment on C-105; cryptographer-reviewer APPROVE row.
- Verify: validation rejects malformed verdicts + tampered cert chains.
- Reviewer: Agent #27.
- Depends on: A12-W3-Thu.

**A12-W4-Tue (2026-06-16)** — Review C-106 (ADR 0016 Play Integrity acceptance)
- Done when: ADR reviewed; `live`-env stricter rule confirmed.
- Output: PR comment on C-106.
- Verify: ADR merged.
- Reviewer: Agent #6.
- Depends on: A12-W4-Mon.

**A12-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A12-W4-Tue.

**A12-W4-Thu (2026-06-18)** — Sprint 1 key-management sign-off
- Done when: key-management section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: RS256 JWT live + JWKS endpoint live; StrongBox attestation library functional in test.
- Reviewer: Agent #1.
- Depends on: A12-W4-Wed.

**A12-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted; HSM PoC scoped.
- Output: `docs/team/crypto/a12-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A12-W4-Thu.
