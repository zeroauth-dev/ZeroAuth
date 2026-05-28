# Agent #11 — Senior Cryptography Engineer (circuit + prover)

**Reports to:** Agent #1 (dotted: Agent #2).
**Mandate:** Owns `identity_proof.circom`, trusted-setup ceremony, `*.zkey` + `verification_key.json` artefacts, prover correctness.
**KPIs:** see role 11 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A11-W1-Mon (2026-05-25)** — ADR 0009 (QR proof pairing protocol) draft
- Done when: → C-008 PR opened; Option B′ protocol captured with `didHashSession = Poseidon(2)([storedDidHash, sessionNonce])`.
- Output: `adr/0009-qr-proof-pairing-protocol.md`.
- Verify: threat-model row A-23 (replay) referenced.
- Reviewer: Agents #1, #27.
- Depends on: A01-W1-Mon.

**A11-W1-Tue (2026-05-26)** — Co-design ADR 0010 (audit hash chain) with Agent #8
- Done when: → C-009 ADR drafted (continued in week 2).
- Output: `adr/0010-audit-log-hash-chain.md` v0.
- Verify: hash function (SHA-256 over canonical JSON), chain entry shape, genesis row.
- Reviewer: Agents #13, #27.
- Depends on: A11-W1-Mon.

**A11-W1-Wed (2026-05-27)** — Spike: Poseidon test vectors against `circomlibjs` reference
- Done when: 100 test vectors generated; matched against reference.
- Output: `tests/poseidon-vectors.test.ts` written with Agent #13.
- Verify: vectors match byte-for-byte.
- Reviewer: Agent #13.
- Depends on: A11-W1-Tue.

**A11-W1-Thu (2026-05-28)** — Circuit version-pin design (precursor C-018, C-019)
- Done when: vkey hash check on boot designed; mismatch behaviour documented.
- Output: `docs/team/crypto/circuit-version-pin-design.md`.
- Verify: design covers ADR 0012 contents.
- Reviewer: Agents #6, #27.
- Depends on: A11-W1-Wed.

**A11-W1-Fri (2026-05-29)** — Status post + trusted-setup ceremony invite drafting
- Done when: → ceremony invite emails drafted for 6 candidate contributors.
- Output: `docs/team/crypto/trusted-setup-invite-draft.md`.
- Verify: 6 named contributors with backgrounds.
- Reviewer: Agent #27.
- Depends on: A11-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A11-W2-Mon (2026-06-01)** — Author ADR 0012 (circuit version pinning + upgrade procedure)
- Done when: → C-019 PR opened.
- Output: `adr/0012-circuit-version-pinning.md`.
- Verify: defines version constant, vkey hash check, landing procedure.
- Reviewer: Agents #2, #27.
- Depends on: A11-W1-Thu.

**A11-W2-Tue (2026-06-02)** — Implement C-018 (`src/services/zkp.ts` version pin)
- Done when: → C-018 PR opened.
- Output: `src/services/zkp.ts`, `tests/zkp-version.test.ts`.
- Verify: `tests/zkp-version.test.ts::"loads identity_proof v1.1 verification_key"` green.
- Reviewer: Agent #6.
- Depends on: A11-W2-Mon.

**A11-W2-Wed (2026-06-03)** — Review C-012 (audit chain implementation) — cryptographer review
- Done when: PR reviewed; chain construction cryptographically sound.
- Output: PR comment on C-012; cryptographer-reviewer APPROVE row.
- Verify: review row present in PR thread.
- Reviewer: Agents #13, #27.
- Depends on: C-012 opened.

**A11-W2-Thu (2026-06-04)** — Trusted-setup ceremony runbook v1
- Done when: runbook captures pre-ceremony, in-ceremony, post-ceremony steps; transcript hashing recipe + publication procedure.
- Output: `docs/cryptography/trusted-setup-ceremony.md` v1.
- Verify: includes Phase 2 Powers of Tau, randomness mixing, transcript verification.
- Reviewer: Agent #27.
- Depends on: A11-W2-Wed.

**A11-W2-Fri (2026-06-05)** — Phase 0 crypto sign-off + status post
- Done when: ADRs 0009, 0010, 0012 merged; C-018 merged; Poseidon vector tests green.
- Output: row in `docs/team/phase-exits/phase-0-crypto-signoff.md`.
- Verify: each ADR + commit referenced + merged.
- Reviewer: Agent #1.
- Depends on: A11-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A11-W3-Mon (2026-06-08)** — ADR 0015 (rapidsnark vs WebView) draft
- Done when: → C-103 PR opened.
- Output: `adr/0015-rapidsnark-jni-prover.md`.
- Verify: dual-track plan captured.
- Reviewer: Agents #4, #17, #27.
- Depends on: A11-W2-Fri.

**A11-W3-Tue (2026-06-09)** — Review C-104 (rapidsnark JNI POC) — first-pass
- Done when: review submitted; cryptographer-reviewer feedback on memory-safety + RNG seeding.
- Output: PR comment on C-104.
- Verify: `mobile/prover/src/androidTest/.../ProverSmokeTest.kt::"generates a valid proof against fixed witness"` reviewed.
- Reviewer: Agent #17.
- Depends on: A11-W3-Mon.

**A11-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; circuit + prover topology shared with mobile + backend.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A11-W3-Tue.

**A11-W3-Thu (2026-06-11)** — Trusted-setup contributor recruitment
- Done when: 6 contributors confirmed; dates scheduled for week 10 ceremony.
- Output: `docs/team/crypto/trusted-setup-contributors.md`.
- Verify: 6 named contributors with confirmed schedules.
- Reviewer: Agent #27.
- Depends on: A11-W2-Thu.

**A11-W3-Fri (2026-06-12)** — Status post + ADR 0015 merge
- Done when: ADR 0015 APPROVE + merged; status posted.
- Output: ADR merged.
- Verify: ADR referenced from `CLAUDE.md`.
- Reviewer: Agent #1.
- Depends on: A11-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A11-W4-Mon (2026-06-15)** — External cryptographer engagement letter signed
- Done when: engagement SoW signed with external cryptographer for v1.2 circuit review (precursor to week 10 review).
- Output: SoW + signed letter (off-repo; reference logged).
- Verify: engagement reference number recorded.
- Reviewer: Agents #27, #36.
- Depends on: A11-W3-Thu.

**A11-W4-Tue (2026-06-16)** — Identity_proof.v1.2 design freeze
- Done when: circuit changes for v1.2 frozen; design doc captures the diff from v1.1.
- Output: `docs/cryptography/identity-proof-v1-2-diff.md`.
- Verify: covers tx_nonce binding and consent_hash binding.
- Reviewer: Agent #27.
- Depends on: A11-W4-Mon.

**A11-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A11-W4-Tue.

**A11-W4-Thu (2026-06-18)** — Sprint 1 crypto sign-off
- Done when: crypto section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-crypto.md`.
- Verify: ADRs 0014, 0015 merged; trusted-setup ceremony scheduled.
- Reviewer: Agent #1.
- Depends on: A11-W4-Wed.

**A11-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted; v1.2 ceremony pre-work scoped.
- Output: `docs/team/crypto/a11-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A11-W4-Thu.
