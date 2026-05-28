# Agent #6 — Senior Backend Engineer (verifier service)

**Reports to:** Agent #2.
**Mandate:** Owns `/v1/zkp/*` — verification key load, snarkjs.groth16.verify, verification audit row, session creation.
**KPIs:** see role 6 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A06-W1-Mon (2026-05-25)** — Spike: enumerate every demo-bypass code path
- Done when: grep + reading produces a list of every `did:zeroauth:demo:*` short-circuit in the codebase.
- Output: `docs/team/backend/demo-bypass-inventory.md`.
- Verify: list has at least the bypass in `submitProof` + any dashboard placeholder DID.
- Reviewer: Agent #2, Agent #26.
- Depends on: A02-W1-Mon.

**A06-W1-Tue (2026-05-26)** — Write failing test first for C-004 demo-bypass removal
- Done when: `tests/proof-pairing.test.ts::"rejects did:zeroauth:demo:* even with otherwise valid payload"` written, fails red on current code.
- Output: PR draft with failing test.
- Verify: test fails before fix; CI run linked.
- Reviewer: Agent #23.
- Depends on: A06-W1-Mon.

**A06-W1-Wed (2026-05-27)** — Implement C-004 — remove demo bypass from `submitProof`
- Done when: code removed; test from Tuesday now passes; sub-agent reviews requested.
- Output: PR opened, C-004 committed.
- Verify: `tests/proof-pairing.test.ts` green; security-reviewer + cryptographer-reviewer sub-agents posted reviews.
- Reviewer: Agents #2, #26, #27.
- Depends on: A06-W1-Tue.

**A06-W1-Thu (2026-05-28)** — Respond to sub-agent + Agent #2 comments on C-004; threat-model update PR
- Done when: comments addressed; `docs/threat_model.md` row A-12 updated.
- Output: PR comments + threat-model commit on same PR.
- Verify: A-12 references C-004 commit hash.
- Reviewer: Agent #35.
- Depends on: A06-W1-Wed.

**A06-W1-Fri (2026-05-29)** — Friday status post + zod adoption pre-work
- Done when: status posted; zod alternatives surveyed (joi, ajv, hand-rolled).
- Output: status post; `docs/team/backend/zod-alternatives-survey.md`.
- Verify: comparison table covers bundle size, perf, ergonomics.
- Reviewer: Agent #2.
- Depends on: A06-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A06-W2-Mon (2026-06-01)** — Author ADR 0013 (zod adoption)
- Done when: → C-023 ADR drafted.
- Output: `adr/0013-zod-input-validation.md`.
- Verify: ADR captures alternatives, supply-chain check from npm audit clean, pinned version.
- Reviewer: Agent #2.
- Depends on: A06-W1-Fri.

**A06-W2-Tue (2026-06-02)** — Implement C-022 (zod validators on identity + zkp routes)
- Done when: → C-022 PR opened; validators reject malformed payloads + biometric-key blocklist.
- Output: `src/validators/identity.ts`, `src/validators/zkp.ts`, tests.
- Verify: `tests/validator-identity.test.ts`, `tests/validator-zkp.test.ts` green.
- Reviewer: Agent #2.
- Depends on: A06-W2-Mon.

**A06-W2-Wed (2026-06-03)** — Review C-018 (circuit version pin) with Agent #11
- Done when: PR reviewed; version-hash boot check confirmed.
- Output: PR comment on C-018.
- Verify: vkey hash mismatch throws on boot in test.
- Reviewer: Agent #11.
- Depends on: A06-W2-Tue.

**A06-W2-Thu (2026-06-04)** — Verifier-path test coverage analysis
- Done when: coverage report on `src/services/zkp.ts` + `src/routes/v1/zkp.ts` ≥ 95 %.
- Output: `docs/team/backend/verifier-coverage-w2.md`.
- Verify: coverage tool output linked.
- Reviewer: Agent #23.
- Depends on: A06-W2-Wed.

**A06-W2-Fri (2026-06-05)** — Phase 0 backend sign-off contribution + status post
- Done when: verifier-related Phase 0 closures listed; status posted.
- Output: contribution to `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: C-004, C-022 referenced.
- Reviewer: Agent #2.
- Depends on: A06-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A06-W3-Mon (2026-06-08)** — Spike: Play Integrity verdict parsing library survey
- Done when: 3 candidate libraries evaluated for parsing/validating verdicts.
- Output: `docs/team/backend/play-integrity-libs.md`.
- Verify: comparison covers verdict parsing, nonce binding, JWS validation.
- Reviewer: Agent #2, Agent #12.
- Depends on: A06-W2-Fri.

**A06-W3-Tue (2026-06-09)** — Sync with Agent #2 on attestation library pick
- Done when: 1-hour sync done; library choice confirmed; new-dep ADR drafted if needed (0017 candidate).
- Output: PR draft for ADR 0017 (if new dep).
- Verify: dep-add skill steps followed.
- Reviewer: Agent #2.
- Depends on: A06-W3-Mon.

**A06-W3-Wed (2026-06-10)** — Implement C-105 (redesigned `/v1/identity/register` with attestation) — first half
- Done when: route + service refactored to accept new payload; validators ready.
- Output: PR draft for C-105.
- Verify: `tests/identity-register.test.ts` set of red tests written.
- Reviewer: Agent #2.
- Depends on: A06-W3-Tue.

**A06-W3-Thu (2026-06-11)** — Implement C-105 — second half (Play Integrity + key attestation validation)
- Done when: attestation validation library wired; tests green.
- Output: PR ready for sub-agent review.
- Verify: `tests/identity-register.test.ts::"rejects request without valid Play Integrity verdict"`, `"rejects request without valid StrongBox attestation chain"` green.
- Reviewer: Agent #2, Agent #26, Agent #27.
- Depends on: A06-W3-Wed.

**A06-W3-Fri (2026-06-12)** — Author ADR 0016 (Play Integrity acceptance) + status post
- Done when: → C-106 ADR drafted; status posted.
- Output: `adr/0016-play-integrity-acceptance.md`.
- Verify: ADR covers MEETS_DEVICE_INTEGRITY + MEETS_BASIC_INTEGRITY + StrongBox required for `live`; nonce binding rules.
- Reviewer: Agent #27.
- Depends on: A06-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A06-W4-Mon (2026-06-15)** — Respond to sub-agent feedback on C-105
- Done when: review comments addressed; ready for APPROVE.
- Output: PR updates on C-105.
- Verify: sub-agent APPROVE rows present.
- Reviewer: Agents #2, #26, #27.
- Depends on: A06-W3-Thu.

**A06-W4-Tue (2026-06-16)** — Merge C-105 + C-106
- Done when: both PRs merged to `dev`; CI green.
- Output: merge commits.
- Verify: `dev` CI green; `docs/threat_model.md` updated for device-attestation row.
- Reviewer: Agent #1.
- Depends on: A06-W4-Mon.

**A06-W4-Wed (2026-06-17)** — Design doc for sprint-2 verifier hardening (precursor C-148)
- Done when: design doc for `/v1/zkp/verify` hardening drafted (replay protection, session-nonce dedup table, audit-row enrichment).
- Output: `docs/team/backend/zkp-verify-hardening-design.md`.
- Verify: failure-mode matrix present.
- Reviewer: Agent #2.
- Depends on: A06-W4-Tue.

**A06-W4-Thu (2026-06-18)** — Sprint 1 backend sign-off + handover prep
- Done when: backend section of S1 exit gate green; sprint-2 verifier work scoped.
- Output: row in `docs/team/sprint-exits/s1-backend.md`.
- Verify: C-105 + C-106 merged.
- Reviewer: Agent #2.
- Depends on: A06-W4-Wed.

**A06-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 personal daily tickets drafted aligned with C-148.
- Output: `docs/team/backend/a06-sprint-2-plan.md`.
- Verify: 5 daily tickets for week 5.
- Reviewer: Agent #2.
- Depends on: A06-W4-Thu.
