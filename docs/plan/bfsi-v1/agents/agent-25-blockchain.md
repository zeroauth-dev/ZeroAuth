# Agent #25 — Senior Blockchain Engineer (contracts + Base L2)

**Reports to:** Agent #1.
**Mandate:** Owns `DIDRegistry`, `Groth16Verifier`, contract deployment on Base Sepolia + mainnet, audit anchor contract, upgradability.
**KPIs:** see role 25 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A25-W1-Mon (2026-05-25)** — Contract inventory
- Done when: existing contracts (`DIDRegistry`, `Groth16Verifier`) reviewed; on-chain state captured.
- Output: `docs/team/blockchain/contract-inventory.md`.
- Verify: every deployed contract has a row.
- Reviewer: Agent #11.
- Depends on: A01-W1-Mon.

**A25-W1-Tue (2026-05-26)** — ADR 0011 draft (on-chain anchor cadence)
- Done when: → C-010 PR opened.
- Output: `adr/0011-on-chain-anchor-cadence.md`.
- Verify: defines `audit_anchors` table, cron schedule, anchor payload, failure recovery.
- Reviewer: Agents #1, #11, #27.
- Depends on: A25-W1-Mon.

**A25-W1-Wed (2026-05-27)** — `AuditAnchor` contract design
- Done when: contract API surface designed (write-once anchors per `(tenant, day)`).
- Output: `docs/team/blockchain/audit-anchor-contract-design.md`.
- Verify: design captures gas budget + role authorisation.
- Reviewer: Agent #27.
- Depends on: A25-W1-Tue.

**A25-W1-Thu (2026-05-28)** — `AuditAnchor` contract first cut
- Done when: `contracts/AuditAnchor.sol` written; Hardhat test passes.
- Output: contract source + test.
- Verify: `contracts/test/AuditAnchor.test.ts` green.
- Reviewer: Agent #11.
- Depends on: A25-W1-Wed.

**A25-W1-Fri (2026-05-29)** — Status post + Groth16Verifier redeploy plan (C-020)
- Done when: redeploy plan captured for v1.1 verifier.
- Output: `docs/team/blockchain/groth16-v1-1-redeploy-plan.md`.
- Verify: includes rollback path.
- Reviewer: Agent #11.
- Depends on: A25-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A25-W2-Mon (2026-06-01)** — Deploy `AuditAnchor` to Base Sepolia (C-016)
- Done when: → C-016 PR opened; contract deployed + verified on Basescan.
- Output: `contracts/deployed-addresses.json` updated.
- Verify: contract verified on Basescan; ABI exported.
- Reviewer: Agents #1, #11.
- Depends on: A25-W1-Thu.

**A25-W2-Tue (2026-06-02)** — Pair with Agent #21 on C-015 (anchor cron) — contract-side
- Done when: contract integration in anchor-job.ts confirmed.
- Output: PR contribution.
- Verify: `tests/anchor-job.test.ts` green against Hardhat fork.
- Reviewer: Agent #21.
- Depends on: A25-W2-Mon.

**A25-W2-Wed (2026-06-03)** — Redeploy `Groth16Verifier` to Base Sepolia (C-020)
- Done when: → C-020 PR opened; new verifier deployed + verified.
- Output: `contracts/deployed-addresses.json` updated.
- Verify: verifier accepts known-good v1.1 proof, rejects known-bad.
- Reviewer: Agent #11.
- Depends on: A25-W2-Tue.

**A25-W2-Thu (2026-06-04)** — Contract-test harness expansion
- Done when: tests added for `AuditAnchor` edge cases (re-anchor attempt, wrong role, gas exhaustion).
- Output: PR.
- Verify: edge-case tests green.
- Reviewer: Agent #27.
- Depends on: A25-W2-Wed.

**A25-W2-Fri (2026-06-05)** — Phase 0 blockchain sign-off + status post
- Done when: AuditAnchor + Groth16Verifier v1.1 deployed + verified.
- Output: row in `docs/team/phase-exits/phase-0-crypto-signoff.md`.
- Verify: addresses committed.
- Reviewer: Agents #1, #11.
- Depends on: A25-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A25-W3-Mon (2026-06-08)** — Deploy-script idempotence
- Done when: `scripts/deploy-contracts.ts` returns existing address on rerun.
- Output: PR.
- Verify: rerun on Base Sepolia produces zero new transactions.
- Reviewer: Agent #21.
- Depends on: A25-W2-Fri.

**A25-W3-Tue (2026-06-09)** — Mainnet-readiness checklist drafted
- Done when: checklist captures pre-deploy review, dry-run on Base testnet, audit-firm engagement, monitoring, rollback.
- Output: `docs/team/blockchain/mainnet-readiness-checklist.md`.
- Verify: 20+ checklist items.
- Reviewer: Agent #36.
- Depends on: A25-W3-Mon.

**A25-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + bytecode-equivalence verification
- Done when: bytecode-equivalence procedure documented.
- Output: `docs/team/blockchain/bytecode-equivalence-procedure.md`.
- Verify: procedure replicable.
- Reviewer: Agent #27.
- Depends on: A25-W3-Tue.

**A25-W3-Thu (2026-06-11)** — Contract risk register
- Done when: risk register lists upgrade risk, key compromise, gas-spike risk, chain-rollback risk.
- Output: `docs/team/blockchain/contract-risk-register.md`.
- Verify: each risk has a mitigation.
- Reviewer: Agent #40.
- Depends on: A25-W3-Wed.

**A25-W3-Fri (2026-06-12)** — Status post + Trail of Bits (or equivalent) audit firm scoping
- Done when: audit firm shortlist documented; pre-engagement scoped.
- Output: `docs/team/blockchain/contract-audit-firm-shortlist.md`.
- Verify: 3 firms compared.
- Reviewer: Agent #36.
- Depends on: A25-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A25-W4-Mon (2026-06-15)** — Anchor-job production-ish monitoring
- Done when: alert wired for "anchor failed 2 days running" + "anchor gas spike".
- Output: PR + Grafana alert.
- Verify: alert path tested with synthetic failure.
- Reviewer: Agent #21.
- Depends on: A25-W3-Fri.

**A25-W4-Tue (2026-06-16)** — Deploy-script secrets audit
- Done when: deploy script audited for secret-handling; no plaintext keys in CI.
- Output: PR / report.
- Verify: secrets sourced from CI secrets, never logged.
- Reviewer: Agent #26.
- Depends on: A25-W4-Mon.

**A25-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + ABI artefact publishing
- Done when: ABI files published as part of CI artefacts; SDKs can consume.
- Output: PR.
- Verify: SDK packages can pin ABI version.
- Reviewer: Agents #31, #34.
- Depends on: A25-W4-Tue.

**A25-W4-Thu (2026-06-18)** — Sprint 1 blockchain sign-off
- Done when: blockchain section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-crypto.md`.
- Verify: contracts deployed + verified + monitored.
- Reviewer: Agent #1.
- Depends on: A25-W4-Wed.

**A25-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (v1.2 verifier redeploy after trusted-setup).
- Output: `docs/team/blockchain/a25-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #1.
- Depends on: A25-W4-Thu.
