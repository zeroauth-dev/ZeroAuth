# Enterprise risk register — v1

**Status:** v1 — first issue, baseline of 10 enterprise risks.
**Owner:** Agent #40 (Risk & Audit Lead).
**Reviewer:** Agent #36 (Chief Compliance Officer).
**Sign-off authority for residual >= 13:** Agent #1 (founder / CTO) plus
Agent #28 (founder / product, in his Pulkit-Amit founder role on the
roadmap). At the time of v1 issue no risk exceeds the auto-accept band
after mitigation.

**Companion documents:**

- [docs/threat_model.md](../../threat_model.md) — the technical attack
  catalogue (A-NN entries). Each enterprise risk below references the
  attack rows that materialise it at the protocol layer.
- [docs/compliance/compliance-roadmap-v1.md](../compliance-roadmap-v1.md)
  — the 12-month regulator-defensibility roadmap. This register is the
  authoritative copy of every commercial / operational / regulatory /
  strategic risk; the roadmap's §7 is a thinner cut focused on
  compliance-bearing risks only.
- [docs/cryptography/trusted-setup-ceremony.md](../../cryptography/trusted-setup-ceremony.md)
  — operational runbook for the Phase 2 ceremony that R-ENT-04 and
  R-ENT-07 attach to.
- [docs/compliance/privacy/data-inventory-v1.md](../privacy/data-inventory-v1.md)
  — the canonical catalogue of every data element ZeroAuth processes.
  R-ENT-03 (DPDP §8 breach) reasons over this inventory.
- [docs/plan/bfsi-v1/03-team.md](../../plan/bfsi-v1/03-team.md) — the
  50-person roster. Risk owners below cite the agent number from this
  document.
- [docs/plan/bfsi-v1/agents/agent-40-risk-audit.md](../../plan/bfsi-v1/agents/agent-40-risk-audit.md)
  — Agent #40's week 1–4 ticket list. A40-W1-Mon is this document.

---

## 1. Purpose

This register is the **enterprise-level** view of the risks ZeroAuth
faces as a going concern: commercial, operational, regulatory, strategic
and high-blast-radius security risks that would degrade the company's
ability to deliver the BFSI v1 roadmap or to sustain a customer base
once delivered. It is **distinct** from
[docs/threat_model.md](../../threat_model.md), which is the technical
attack catalogue (`A-NN` rows) tracking spoofing, replay, tampering,
elevation-of-privilege and similar attack vectors at the protocol layer.

The two documents are linked: technical attacks **ladder up** to
enterprise risks. A successful replay of a captured proof (A-02) does
not in itself sink the company, but a pattern of unmitigated A-02
incidents materialises R-ENT-02 (supply-chain) and R-ENT-03 (DPDP §8
breach) depending on root cause. Each enterprise risk row therefore
references the threat-model `A-NN` entries that contribute to it.

**What changed since the threat model:** the threat model is exhaustive
at the attack-vector level — every endpoint, every payload field, every
write surface. This register is exhaustive at the **enterprise** level —
the risks that the founder, the CCO, the CRO and the board carry on
their dashboard. Threat model has many rows; the register has ten.

**Audience:** Agent #1 (founder/CTO), Agent #28 (founder/product), Agent
#36 (CCO), Agent #42 (CRO), Agent #40 (Risk & Audit), and the regulator
or auditor reading our governance evidence pack.

**Cadence:** see §4. Re-assessment is event-driven (see §6 operating
principles) on top of the calendar cadence.

---

## 2. Risk classification

The classification grid is the same across enterprise risks and the
technical threat-model rows that ladder up to them, so a single language
holds end to end.

### 2.1 Likelihood (L)

| Score | Label | Plain-English meaning |
|---|---|---|
| 1 | rare | Expected once in 10 years or longer. No precedent in the team's experience. |
| 2 | unlikely | Expected once in 3–10 years. Has happened to peer companies but not to us. |
| 3 | possible | Expected once in 1–3 years. Has happened in adjacent industries or in early demos. |
| 4 | likely | Expected at least once in the next 12 months. Active controls keep it from being routine. |
| 5 | almost-certain | Expected multiple times in 12 months unless a hard mitigation lands. |

### 2.2 Impact (I)

| Score | Label | Plain-English meaning |
|---|---|---|
| 1 | insignificant | Local inconvenience; absorbed by existing on-call rotation in under a day. |
| 2 | minor | A sprint of remediation work; no customer-visible degradation beyond a hours-scale outage. |
| 3 | moderate | A pilot bank pauses; one quarterly milestone slips by up to 4 weeks. No regulator notification. |
| 4 | major | A signed pilot terminates, or a Phase exit gate slips by 8+ weeks, or a regulator opens correspondence. |
| 5 | catastrophic | Existential — the company is unable to operate as a BFSI vendor; or DPDP §8 breach with > 10 000 data principals affected; or RBI notice; or founder dismissal. |

### 2.3 Inherent risk (L × I)

The product `L × I` is the **inherent** risk score, computed before any
mitigation is applied. Range 1..25.

### 2.4 Residual risk (L_residual × I_residual)

After mitigations land, both likelihood and impact may drop. The
**residual** risk is computed against the after-mitigation values. The
target for v1 is that every residual sits in the low-amber band (<= 6)
or has explicit sign-off from Agent #1 + Agent #28.

### 2.5 Risk appetite

| Residual band | Verdict | Action |
|---|---|---|
| 1–6 | low-amber | Auto-accept. Recorded in this register. Reviewed quarterly. |
| 7–12 | mid-amber | Review required by Agent #36 (CCO) and Agent #1 (CTO). Mitigation roadmap mandatory. Reviewed monthly. |
| 13–25 | red | Hard-stop. No new pilot signed, no new release shipped, until either residual drops below 13 or the founders explicitly sign off (Agent #1 + Agent #28) with a documented mitigation timeline. |

The threshold lines are deliberately tight: a 4×4=16 inherent that drops
to 3×2=6 residual is acceptable; a 4×4=16 that drops only to 3×4=12 is
mid-amber and gets monthly attention.

---

## 3. The 10 enterprise risks

Each row carries: identifier, title, class, description, inherent L×I,
mitigations (numbered, testable), residual L×I, owner agent #, review
cadence, last-reviewed date, threat-model row references, residual
sign-off.

### R-ENT-01 — Concentration risk: single BFSI vertical, single market (India)

| Field | Value |
|---|---|
| **Class** | Commercial |
| **Description** | The BFSI v1 plan stakes 12 months on Indian banks as the only revenue-bearing vertical. A single regulatory shift (RBI tightening third-party-vendor governance), a single market-wide downturn (CRR change starving bank IT budgets), or a single competitive entrant (a domestic incumbent bundles identity verification into a core banking suite) materially degrades the company's commercial trajectory. Healthcare and Web3 are deferred to Phase 2+, so for ~26 weeks ZeroAuth has no diversification cushion. |
| **Inherent L × I** | 4 × 4 = **16** |
| **Mitigations** | (1) Horizontal expansion to healthcare in Phase 2 (compliance-roadmap-v1 §3.3 Q3 milestones name the second-vertical demo). (2) GCC pilot scoping in Phase 4 — see compliance-roadmap-v1 §3.4 Q4 placeholder. (3) Target recurring-revenue mix > 80 % so loss of any single bank does not terminate the company (KPI tracked by Agent #42). (4) Identify two cohorts in flight at the RBI sandbox (R-COMP-05 mitigation in compliance roadmap) so we keep an open regulator door. (5) Maintain a quarterly "vertical-readiness" memo by Agent #28 + Agent #42 logging the second- and third-vertical option value. |
| **Residual L × I** | 3 × 2 = **6** |
| **Owner** | Agent #42 (CRO). Co-owner: Agent #28 (founder/product). |
| **Review cadence** | Quarterly with Agent #36 + Agent #1, plus on any of the §6 event triggers. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | None directly — this is a commercial risk, not a protocol attack. Indirectly, A-09 (console JWT theft) and A-13 (session fixation in pairing) magnify the impact if they coincide with a single-bank concentration event. |
| **Residual sign-off** | Agent #42 (auto-accept at residual 6). |

### R-ENT-02 — Supply-chain attack via npm / Gradle / cargo dependency

| Field | Value |
|---|---|
| **Class** | Security |
| **Description** | A direct or transitive dependency in `package.json`, `mobile/build.gradle`, the IoT firmware Cargo crates, the Hardhat contract deps, or the snarkjs/circomlib chain is compromised. The compromise injects code that exfiltrates the `BLOCKCHAIN_PRIVATE_KEY`, the `JWT_SECRET`, the API-key plaintext seen at issuance, or the `biometricSecret` in the prover. Same class as `event-stream`, `ua-parser-js`, `xz-utils` 2024 backdoor. |
| **Inherent L × I** | 3 × 4 = **12** |
| **Mitigations** | (1) Nightly CVE monitor running in CI (commit `f8a756c` on `.github/workflows/cve-monitor.yml`) with high-severity alerts routed to the on-call channel — verifiable by inspecting the workflow run history. (2) dep-add ADR-first policy (CLAUDE.md §6 + ADR `/adr/0000-grandfather-initial-deps.md` baseline) plus `scripts/check-dep-trail.sh` blocking merge when a dep lacks an ADR — verifiable by triggering a no-ADR PR and asserting CI fails. (3) Signed-only releases on Phase 3 SBOM (compliance-roadmap-v1 §3.3 Q3 milestones) — verifiable by checking `provenance: true` on the GitHub Actions release attestation when Phase 3 work completes. (4) Lockfile review gate in CI — `package-lock.json` diffs > 100 lines are routed for human review; verifiable by a dependent PR that exceeds the threshold. (5) WebView snarkjs bundling with SHA-256 pinning per [ADR 0010](../../../adr/0010-android-webview-snarkjs-bundling.md) closes the runtime-CDN class of supply-chain attack on the prover (A-17). |
| **Residual L × I** | 2 × 3 = **6** |
| **Owner** | Agent #26 (Application Security Engineer). Co-owners: Agent #21 (DevOps/SRE) for the CI gates and Agent #40 (Risk & Audit) for the policy. |
| **Review cadence** | Monthly. Friday SBOM dump reviewed weekly during release windows. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | A-17 (WebView snarkjs supply-chain), A-24 (side-channel during proof generation — partially material to a hardened-prover dep). New A-NN required if a non-prover supply-chain attack vector materialises. |
| **Residual sign-off** | Agent #26 (auto-accept at residual 6). |

### R-ENT-03 — DPDP §8 reportable breach incident

| Field | Value |
|---|---|
| **Class** | Regulatory |
| **Description** | A personal-data breach that meets the DPDP Act 2023 §8 reporting threshold — i.e., processing failure that materially affects the rights of data principals — must be notified to the Data Protection Board of India and to affected principals within 72 hours of discovery. A breach of bank-onboarded user records, a misrouted audit-event export, or a leaked Postgres backup falls in this class. Penalties under §33 can reach INR 250 crore per incident. |
| **Inherent L × I** | 3 × 5 = **15** |
| **Mitigations** | (1) DPO breach-notification SOP in [docs/compliance/dpdp/breach-notification-sop-v0.md](../dpdp/breach-notification-sop-v0.md) (planned A37-W?? deliverable per agent-37 plan; v0 lives by Phase 0 exit). Verifiable by quarterly tabletop (first tabletop Q3 wk 33 per compliance-roadmap-v1 §3.3). (2) Hash-chained audit log (commit `a475ed8` on `src/services/audit.ts`, per [ADR 0013](../../../adr/0013-audit-log-hash-chain.md)) gives a cryptographic record of every write surface, supporting forensics within the 72-hour window. Verifiable by replay via `/api/admin/audit-integrity`. (3) Per-tenant on-chain anchors per [ADR 0014](../../../adr/0014-on-chain-anchor-cadence.md) make the audit chain externally verifiable, so a regulator can confirm scope without trusting any ZeroAuth process. (4) [DPDP §2(t) commitments memo v0](../dpdp-2t-commitments-memo-v0.md) argues that the Poseidon commitment and DID are not personal data, limiting the *reportable surface area* to the genuine PII (email, tenant company name, lead form fields per data-inventory-v1 §3.1, §3.2). (5) Data inventory v1 explicitly classifies every data element so the breach scoping in the 72-hour window is a lookup, not a derivation. |
| **Residual L × I** | 2 × 3 = **6** |
| **Owner** | Agent #37 (Compliance / DPDP & RBI Lead). Co-owners: Agent #36 (CCO) for the regulator interface and Agent #41 (DPO) for the principal-side notifications. |
| **Review cadence** | Monthly. After any incident classified as severity-2 or worse the review goes interim. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | A-22 (PII in pairing logs), A-28 (JWT-in-URL log leak, CLOSED), A-09 (console JWT theft via XSS), A-10 (dashboard requests leaking another tenant's data), A-21 (audit-log tampering for pairing events). |
| **Residual sign-off** | Agent #37 (auto-accept at residual 6). |

### R-ENT-04 — Key compromise: trusted-setup ceremony bad actor

| Field | Value |
|---|---|
| **Class** | Security / Cryptographic |
| **Description** | The Phase 2 trusted-setup ceremony for `identity_proof` v1.2 (and successor versions) produces the proving/verification keys. If every contributor colludes — or the coordinator runs a solo setup and the team accepts the artefact uninspected — the toxic waste is recoverable and the holder can forge accepted proofs against any tenant's commitments indefinitely. Until detected this destroys the verification guarantee at the heart of the product. |
| **Inherent L × I** | 2 × 5 = **10** |
| **Mitigations** | (1) Six (>= 6) contributors with the at-least-one-honest assumption (trusted-setup-ceremony.md §1.4 + §2.2). Verifiable by inspecting the contributor list in `docs/team/crypto/trusted-setup-contributors.md` and the chained transcripts in `circuits/ceremony-transcripts/v1.2/`. (2) External attestor: an external cryptographer (not on ZeroAuth payroll and not from any contributor's employer) re-verifies offline post-ceremony and publishes a PGP-signed `attestation.pdf`. Verifiable by checking the PGP signature in the published transcript bundle. (3) Public transcripts: every contribution hash and the final beacon round are published with sources; any third party can replay-verify. (4) The on-chain `Groth16Verifier` is the verifiable artefact — its bytecode is on Base Sepolia (Phase 0–3) and Base mainnet (Phase 4) and is checked against the local artefact via bytecode-equivalence verification on deploy (R-ENT-08 mitigation #4). (5) Selection rules (>= 2 external, no shared employer, no shared laptop+OS combo) reduce the realistic collusion surface. |
| **Residual L × I** | 1 × 4 = **4** |
| **Owner** | Agent #11 (Senior Cryptography Engineer — circuit + prover, coordinator). Co-owners: Agent #27 (Cryptographer-Reviewer subagent owner) for the external-attestor relationship and Agent #40 (Risk & Audit) for ceremony-day governance. |
| **Review cadence** | Per ceremony (v1.2 in Phase 1 wk 10; successor versions per ADR 0015). Quarterly between ceremonies. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | None directly today — the threat model treats proof verification (A-02), not key-genesis. A new `A-NN` entry "forged proof via setup compromise" is queued for the threat-model bump that lands with the v1.2 circuit. |
| **Residual sign-off** | Agent #11 (auto-accept at residual 4). |

### R-ENT-05 — Vendor lock-in / lapse

| Field | Value |
|---|---|
| **Class** | Operational |
| **Description** | ZeroAuth depends on a small set of external SaaS vendors: GitHub Enterprise Cloud (code + CI), Sentry (error reporting, scrubbed), Cloudflare (TLS termination on marketing site), 1Password (secrets), Google Workspace (SSO + corporate IT), the eventual evidence collector (Drata / Vanta / Sprinto), the eventual bug bounty platform (HackerOne / BugCrowd), and the eventual HSM vendor (Phase 4). A unilateral price hike, an account suspension, an export-control change, or a vendor going dark each interrupts compliance evidence collection, deploy ability, or breach-response readiness. |
| **Inherent L × I** | 3 × 3 = **9** |
| **Mitigations** | (1) Annual vendor review owned by Agent #50 (Operations) per the agent-50 plan; recorded in `docs/compliance/vendors/<vendor>/annual-review-<year>.md`. Verifiable by inspecting the directory. (2) DPA on file per vendor — see compliance-roadmap-v1 §1.3 ("each covered by a DPA on file"). Verifiable by checking the off-repo evidence pack hash reference in `docs/compliance/evidence-pack/<year>-<q>/`. (3) RBI Phase-3 outsourcing-policy alignment — RBI MD on IT Governance §10 (third-party risk) requires the bank to inspect our vendor management; the inspection-readiness checklist (compliance-roadmap-v1 §2.2) captures the cross-reference. (4) Reserve fund earmarked by Agent #50 covers replacement procurement up to 90 days of operating costs. Verifiable in the budget tracker. (5) Pre-evaluated in-country alternatives for each cross-border processor (compliance-roadmap-v1 §7.8 R-COMP-08 mitigation: `docs/compliance/dpdp/cross-border-fallbacks.md`) so a DPDP §13 tightening or a vendor lapse triggers a documented swap-out rather than improvisation. |
| **Residual L × I** | 2 × 2 = **4** |
| **Owner** | Agent #50 (Operations / Office Manager). Co-owners: Agent #36 (CCO) for DPA compliance and Agent #21 (DevOps/SRE) for CI/CD-bearing vendors. |
| **Review cadence** | Quarterly vendor review (Q2 wk 26, Q3 wk 39, Q4 wk 52 per compliance-roadmap-v1 §4). |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | None directly. Adjacent: A-17 (WebView snarkjs supply-chain) treats the vendor risk for a specific runtime artefact. |
| **Residual sign-off** | Agent #50 (auto-accept at residual 4). |

### R-ENT-06 — Key person dependency

| Field | Value |
|---|---|
| **Class** | Strategic |
| **Description** | A small team (50 agents per docs/plan/bfsi-v1/03-team.md, with several "of-one" roles) means several functions have a single named owner. If Agent #1 (founder/CTO), Agent #11 (lead cryptography), Agent #12 (key management), Agent #25 (lead smart-contract engineer) or Agent #36 (CCO) leaves, falls ill, or otherwise becomes unavailable for > 2 weeks, the corresponding work stream stalls. The cryptographic and on-chain functions are especially exposed because the knowledge density is high and the load-bearing decisions live in their heads. |
| **Inherent L × I** | 3 × 4 = **12** |
| **Mitigations** | (1) Every load-bearing role has a documented secondary owner per `docs/plan/bfsi-v1/03-team.md` — secondaries listed explicitly in the role rows. Verifiable by grepping `Secondary:` in `03-team.md`. (2) ADR-driven architecture: every load-bearing decision is captured in `/adr/` so reconstructing the rationale does not require the original author (see ADRs 0009..0016 for the Phase 0 + 1 hot path). Verifiable by reading any ADR cold. (3) Key-management practices that do not depend on a single human — Phase 3 HSM-backed signer (compliance-roadmap-v1 §3.4 Q4 wk 48 D-Q4-06) replaces the BLOCKCHAIN_PRIVATE_KEY-in-`.env` posture so contract ownership rotation is procedural, not heroic. Verifiable by inspecting the HSM cutover runbook and the on-chain owner change. (4) Cross-training: every agent's secondary attends the primary's standup once per sprint; recorded in `docs/team/cross-training-log.md`. (5) Founders carry duplicate signing authority on contracts and on regulator filings, so neither founder is a single point of failure on the legal surface. |
| **Residual L × I** | 2 × 3 = **6** |
| **Owner** | Agent #1 (founder / CTO). Co-owners: Agent #36 (CCO) for governance and Agent #50 (Operations) for HR continuity. |
| **Review cadence** | Quarterly. Re-assessed within 7 days of any agent moving role or leaving. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | None directly. Adjacent: A-07 (leaked deployer wallet private key) becomes harder to mitigate when the named key holder is unavailable. |
| **Residual sign-off** | Agent #1 (auto-accept at residual 6). |

### R-ENT-07 — Ceremony / circuit-version slip

| Field | Value |
|---|---|
| **Class** | Operational |
| **Description** | The Phase 2 trusted-setup ceremony is on the critical path for the Anchor Bank demo (Phase 1 exit, wk 12) and for ISO 27001 Annex A.5.31 evidence (ISO Stage 2, wk 36). A ceremony slip — coordinator unavailable, contributor pool incomplete, ptau file integrity check failure — propagates downstream. A v1.2 → v1.3 circuit bump mid-pilot would compound the slip with a re-issuance of every tenant's pinned verification key. |
| **Inherent L × I** | 3 × 3 = **9** |
| **Mitigations** | (1) Trusted-setup runbook ([docs/cryptography/trusted-setup-ceremony.md](../../cryptography/trusted-setup-ceremony.md)) is the operational playbook; verifiable by walking section §1..§8 and asserting each artefact exists when the ceremony day arrives. (2) Phase 1 sprint-4 buffer for the ceremony: ceremony target is wk 10, ISO Stage 2 is wk 36, so 26 weeks of contingency (compliance-roadmap-v1 §7.3 R-COMP-03). (3) `cryptographer-reviewer` subagent gate per [ADR 0015](../../../adr/0015-circuit-version-pinning.md) ensures every circuit-version bump goes through plan mode + ADR + subagent review. Verifiable by inspecting the ADR-trail script's coverage of `circuits/` changes. (4) Rollback path retained: the prior verification key + pinned ptau hash kept in `circuits/legacy/<prev-version>/`; verifier service can be pinned to a prior version per ADR 0015 §3 "Rollback procedure." (5) Pre-coordinated calendar slot with the lead ISO auditor so the ceremony is on her calendar (compliance-roadmap-v1 §7.3). |
| **Residual L × I** | 2 × 2 = **4** |
| **Owner** | Agent #11 (Cryptography). Co-owners: Agent #36 (CCO) for the regulator-facing knock-on and Agent #40 (Risk & Audit) for the schedule-buffer enforcement. |
| **Review cadence** | Monthly through Phase 1 (sprints 1–4); per ceremony thereafter. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | Indirect: a slip that pushes the ceremony past ISO Stage 2 reduces the assurance level for A-21 (audit-log tampering) and A-02 (proof replay) where the audit defence depends on the post-ceremony verifier going live. |
| **Residual sign-off** | Agent #11 (auto-accept at residual 4). |

### R-ENT-08 — Contract / smart-contract bug post-deployment

| Field | Value |
|---|---|
| **Class** | Security / Financial |
| **Description** | The `DIDRegistry`, `Groth16Verifier`, and `AuditAnchor` Solidity contracts are deployed to Base Sepolia (Phase 0–3) and Base mainnet (Phase 4). A logic bug in `registerIdentity`, `revokeIdentity`, or the audit-anchor `commit` path could (a) allow forged identity rows, (b) lock out a tenant from its own anchors, or (c) silently drift the anchored hash from the off-chain truth. Once mainnet is reached, contract upgrade paths are constrained (no proxy by deliberate choice per ADR 0014), so remediation requires a new deployment + migration. |
| **Inherent L × I** | 2 × 5 = **10** |
| **Mitigations** | (1) Hardhat test suite per contract — `tests/` under `contracts/test/` covers every public function with unit + scenario tests; verifiable by `npx hardhat test` returning green. (2) Trail of Bits (or equivalent firm) external audit before mainnet — compliance-roadmap-v1 §3.3 Q3 wk 16–24 with final report by wk 24, remediation by wk 30. Verifiable by checking the published audit report under `docs/security/contract-audits/`. (3) Write-once + role-gated state changes: contract storage variables for identity registry rows are `private` + write-only-by-owner; reads are `view`; no contract method permits mass deletion. Verifiable by running slither / mythril on the bytecode. (4) Bytecode-equivalence verification post-deploy: deploy script computes the local hash of the compiled bytecode and compares against `eth_getCode(contractAddress)`; deploy fails on mismatch. Verifiable by inspecting the deploy log. (5) The cryptographer-reviewer subagent is mandatory for any change under `contracts/` (CLAUDE.md §5). |
| **Residual L × I** | 2 × 3 = **6** |
| **Owner** | Agent #25 (Senior Smart-Contract Engineer). Co-owners: Agent #26 (Application Security Engineer) for the third-party audit relationship and Agent #36 (CCO) for the change-in-scope memo to the SOC 2 + ISO auditors when mainnet lands (compliance-roadmap-v1 §3.4 Q4 wk 46 D-Q4-04). |
| **Review cadence** | Monthly during Phase 2 (audit period); on every deploy thereafter. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | A-07 (leaked deployer wallet key) is the operational sibling. A new `A-NN` entry "contract-storage corruption via owner-only function bug" is queued for the threat-model update that lands with the mainnet deployment. |
| **Residual sign-off** | Agent #25 (auto-accept at residual 6). |

### R-ENT-09 — On-chain anchor disruption (Base L2 outage / gas spike)

| Field | Value |
|---|---|
| **Class** | Operational |
| **Description** | The daily on-chain anchor of the audit-chain head ([ADR 0014](../../../adr/0014-on-chain-anchor-cadence.md)) requires a working Base L2 RPC endpoint and reasonably low gas. A Base outage (sequencer downtime, RPC provider DDoS), a gas-price spike above the configured ceiling, or a wallet-balance shortage interrupts anchor delivery. While the off-chain hash chain remains intact, the bank's auditor sees an "anchor-lagged" tenant state in the dashboard and may flag it during inspection. |
| **Inherent L × I** | 3 × 3 = **9** |
| **Mitigations** | (1) Three redundant Base RPC providers per [ADR 0014](../../../adr/0014-on-chain-anchor-cadence.md) — Alchemy, Infura, Coinbase (or current equivalents). Failover order is configured; verifiable by inducing a 503 on the primary and asserting the secondary fires. (2) Retry-with-backoff in the anchor cron (`src/services/blockchain.ts`) — up to 6 retries over 4 hours; verifiable by integration test. (3) The off-chain hash chain remains intact regardless of anchor delivery — every audit row carries `previous_hash` + `event_hash`; the chain is replay-verifiable via `/api/admin/audit-integrity` even when the on-chain anchor is days stale. (4) An "anchor-degraded" tenant state in the dashboard, surfaced via `IntegrityCheckCard` and `/api/admin/audit-integrity` ([ADR 0013](../../../adr/0013-audit-log-hash-chain.md), commits `a475ed8` and follow-ups). The state is transparent to the bank's auditor — a degraded badge with a "stale since" timestamp, not a hidden failure. (5) Gas-ceiling alerting: if the next anchor would exceed the configured ceiling (default 5 gwei), the cron emits a `pricing_breach` audit event and pages on-call rather than firing the transaction blindly. |
| **Residual L × I** | 2 × 2 = **4** |
| **Owner** | Agent #25 (Smart-Contract Engineer) for the on-chain path. Co-owners: Agent #21 (DevOps/SRE) for the RPC redundancy and Agent #40 (Risk & Audit) for the SLA. |
| **Review cadence** | Monthly. Per-incident review on any 24-hour-or-longer anchor lag. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | A-21 (audit-log tampering) — the on-chain anchor is one of the five mitigations on A-21, so anchor disruption raises the residual on A-21 until the anchor catches up. |
| **Residual sign-off** | Agent #25 (auto-accept at residual 4). |

### R-ENT-10 — Anti-money-laundering / sanctions-listed enrolment

| Field | Value |
|---|---|
| **Class** | Regulatory |
| **Description** | A bank tenant enrols an end user who is on a sanctions list (OFAC, UN, MEA) or a money-laundering watch list, and the verification event flows through ZeroAuth's pipeline. The regulator's inspection treats ZeroAuth's role as either (a) a passive infrastructure provider — the bank's responsibility — or (b) a participant in the chain — ZeroAuth's responsibility. Misclassification of role under DPDP §6 or RBI MD on KYC §44 carries direct penalties and reputational damage with all other bank prospects. |
| **Inherent L × I** | 2 × 5 = **10** |
| **Mitigations** | (1) KYC anchor at enrolment per the bank's existing screening: ZeroAuth's enrolment record references the bank's CKYC / V-CIP record ID (RBI MD on KYC §16, §44 per compliance-roadmap-v1 §2.5). Verifiable by the per-tenant attestation clause in the pilot SOW. (2) **ZeroAuth does NOT do AML** — the AML responsibility stays with the bank. ZeroAuth provides the verification artefact (proof + Poseidon commitment + audit row) and the integrity guarantee, not the watchlist check. The role boundary is documented in [docs/compliance/aml-statement.md](../aml-statement.md) (planned Agent #37 deliverable in Q1; placeholder file referenced here and slot-cited in agent-37's ticket list). Verifiable by checking the existence of the document and the per-tenant DPA clause that incorporates it by reference. (3) The aml-statement.md explicitly disclaims ZeroAuth's involvement and binds the bank to perform its own AML screening before invoking ZeroAuth's verification flow. (4) Sanctioned-jurisdiction tenant config blocks origin countries: `tenants.security_policy.jurisdiction_allowlist` enforces a per-tenant allowlist evaluated on the `clientMeta.requesterCountry` header at `/v1/proof-pairing/sessions` and `/v1/zkp/verify`. Verifiable by integration test against a known-blocked country code. (5) Audit row on every enrolment captures the bank's CKYC reference ID (when supplied), so the inspection trail traces every ZeroAuth verification back to a bank-owned KYC record. |
| **Residual L × I** | 1 × 4 = **4** |
| **Owner** | Agent #37 (DPDP & RBI Lead). Co-owners: Agent #36 (CCO) for regulator interface and Agent #41 (DPO) for principal-side communications. |
| **Review cadence** | Per pilot SOW signing and per RBI MD on KYC revision. Monthly otherwise. |
| **Last reviewed** | 2026-05-28 (v1 issue). |
| **Threat-model rows** | A-22 (PII in pairing logs) — leakage of an enrolment with a watchlist reference materialises the regulatory class-of-harm at the protocol layer. |
| **Residual sign-off** | Agent #37 (auto-accept at residual 4). |

---

## 4. Risk-management cadence

The cadence below is the floor; event triggers in §6 force interim
reviews above and beyond the calendar.

### 4.1 Weekly — Agent #40 risk-walk

Every Monday Agent #40 (Risk & Audit Lead) walks the register row by
row, looking for:

- Mitigations that have become testable since last walk — i.e., a commit
  has landed that closes a previously-aspirational mitigation. Update
  the "Mitigations" column with the commit hash.
- Mitigations that have **regressed** — i.e., a revert or a config flip
  has weakened a previously-tested mitigation. Re-score residual and
  flag for Agent #36.
- New threat-model `A-NN` rows since last walk — assign them to the
  enterprise risks they ladder up to.

The walk is documented in `docs/compliance/risk/walks/<yyyy-mm-dd>.md`
on Monday afternoon. The Friday status post by Agent #40 cites the most
recent walk.

### 4.2 Monthly — risk register review (15th of every month)

Held on the 15th of every month, attendees:

- Agent #1 (founder / CTO) — chair.
- Agent #36 (Chief Compliance Officer).
- Agent #42 (Chief Revenue Officer).
- Agent #40 (Risk & Audit Lead) — secretary.

Agenda:

1. Walk every mid-amber risk (residual 7–12) row by row.
2. Spot-check two low-amber risks (residual <= 6) by rotating through
   the list.
3. Review any new risks proposed since last review.
4. Confirm risk-acceptance protocol decisions from the prior month
   (see §5).

Output: minutes committed to
`docs/compliance/risk/minutes/<yyyy-mm-15>.md` within 48 hours.

### 4.3 Quarterly — board-level review

Held in the last week of Q1, Q2, Q3, Q4 (target dates wk 13, 26, 39,
52 — aligned with the retrospective cadence in
compliance-roadmap-v1 §3 and §8.1). Attendees:

- Founders (Agent #1 + Agent #28).
- Agent #36 (CCO).
- Agent #42 (CRO).
- Agent #40 (Risk & Audit) — secretary.
- The board observer (when one is seated).

Agenda:

1. Quarterly retrospective of risks materialised vs. forecast.
2. Re-score every risk against the past quarter's facts.
3. Approve any residual >= 13 sign-off requests.
4. Decide any escalations to v2 of the register (new risks, new
   classes).

Output: board-pack row published as part of the compliance retro
(compliance-roadmap-v1 §8.1).

### 4.4 Release-time — "risk-delta" check

Every release-shepherd-led release runs a "risk-delta" check:

- Any new risk surfaced by the release? Documented in the release
  notes under a "Risk delta" heading.
- Any mitigation that has regressed (test removed, config flipped) on
  any row of the register? Block the release until either restored or
  Agent #40 + Agent #36 sign off.

Verifiable by inspecting the release notes — the "Risk delta" heading
must be present even if its body is "none."

### 4.5 Regulator inspection — interim review

Every regulator inspection (DPB §17 update, RBI sandbox progress
report, a bank's internal audit walk-through, a SOC 2 auditor
fieldwork day) triggers an interim review of the relevant slice of
the register the day before the inspection. The review confirms the
"Last reviewed" column is current and that no residual has drifted
since the last weekly walk.

---

## 5. Risk-acceptance protocol

The acceptance bands from §2.5 map to acceptance procedure:

### 5.1 Residual <= 6 (low-amber): auto-accept

Recorded in this register with the named sign-off in the row.
Reviewed at the cadence in §4.

### 5.2 Residual 7–12 (mid-amber): formal review

Review required by Agent #36 (CCO) plus Agent #1 (CTO). The review
record is committed to
`docs/compliance/risk/acceptances/<R-ENT-NN>-<yyyy-mm-dd>.md` with
the following fields:

- Risk ID + title.
- Date of review.
- Reviewers (Agent #36, Agent #1, and any subject-matter expert
  pulled in).
- Mitigation roadmap (commits to land, target weeks).
- Re-review date (default 30 days; sooner if mitigations are landing
  fast).
- Sign-off signatures (in the form `Agent #36: accept`).

Mid-amber risks are reviewed monthly per §4.2 until they drop to
low-amber or graduate to red.

### 5.3 Residual >= 13 (red): hard-stop

No new pilot signed, no new release shipped, until either:

- the residual drops below 13 via additional mitigations, **or**
- the founders (Agent #1 + Agent #28) explicitly sign off in writing
  with a documented mitigation roadmap and a target re-review date
  not later than 30 days out.

The founder sign-off record is committed to
`docs/compliance/risk/acceptances/<R-ENT-NN>-founder-<yyyy-mm-dd>.md`
and is referenced by ID from this register's row "Residual sign-off"
column.

At v1 issue **no risk is in the red band** after mitigation. Every
row sits at residual <= 6.

---

## 6. Operating principles

These are the rules the register lives by — they are not
risk-specific, they apply across the document.

### 6.1 Owners are named individuals

Risk owners must be named individuals, identified by agent number,
not roles. No "TBD," no "the security team." If a row's owner is
ambiguous, Agent #40 escalates to Agent #36 within 24 hours of
discovery. The escalation must resolve into a single named agent
number — not into a working group.

### 6.2 Mitigations must be testable

Every mitigation listed under a risk must be verifiable by a test, an
audit, a code review, or an inspectable artefact (commit, ADR, doc).
"We will be careful" is not a mitigation. "ADR 0010 SHA-256 pins the
snarkjs bundle and CI fails on mismatch" is. If a mitigation cannot
be verified, the owner must propose how to verify it within 7 days,
or the mitigation is removed and the residual re-scored.

### 6.3 Risks must be re-assessed on event triggers

Beyond the calendar cadence in §4, risks must be re-assessed when
**any** of the following occurs:

- A regulator notification (DPB, RBI, SEBI, a bank's internal
  auditor) changes — i.e., a new rule, a new circular, a new
  interpretation memo.
- The customer base composition shifts > 20 % — e.g., the largest
  customer's share crosses the 20-point threshold up or down.
- A competitor enters the market (a new ZK identity vendor opens
  India operations) or exits (a domestic incumbent shutters its
  identity product).
- A major dependency reaches end-of-life (snarkjs deprecation,
  circomlib break, Node.js LTS expiration, Base L2 deprecation, Hardhat major bump).
- A security incident at any severity is declared (links into the
  incident-response runbook drafted A40-W1-Tue).

The re-assessment fires within 5 business days of the triggering
event and updates the affected rows' "Last reviewed" column.

### 6.4 Register-quality discipline

Agent #40 owns register-quality. A row that has gone > 60 days
without a "Last reviewed" date update is a discipline failure, not a
risk: it is fixed in the next weekly walk and a note is added to
`docs/compliance/risk/walks/<date>.md` recording the lapse.

### 6.5 Cross-references are bidirectional

When a threat-model `A-NN` row references this register (e.g., "this
attack materialises R-ENT-03"), the corresponding R-ENT row must
reference back. CI runs a cross-reference linter weekly
(compliance-roadmap-v1 §8.5).

---

## 7. Risk-residual-acceptance sign-offs (v1)

Each row's residual-acceptance signature is listed for v1 issue. At
v1 every residual sits in the low-amber band so the sign-off is the
auto-accept by the row's owner; no founder sign-off is required.

| Risk ID | Title | Inherent | Residual | Owner | Sign-off | Date |
|---|---|---|---|---|---|---|
| R-ENT-01 | Concentration risk (BFSI / India) | 16 | 6 | Agent #42 | Agent #42: accept | 2026-05-28 |
| R-ENT-02 | Supply-chain attack via deps | 12 | 6 | Agent #26 | Agent #26: accept | 2026-05-28 |
| R-ENT-03 | DPDP §8 reportable breach | 15 | 6 | Agent #37 | Agent #37: accept | 2026-05-28 |
| R-ENT-04 | Trusted-setup bad-actor compromise | 10 | 4 | Agent #11 | Agent #11: accept | 2026-05-28 |
| R-ENT-05 | Vendor lock-in / lapse | 9 | 4 | Agent #50 | Agent #50: accept | 2026-05-28 |
| R-ENT-06 | Key person dependency | 12 | 6 | Agent #1 | Agent #1: accept | 2026-05-28 |
| R-ENT-07 | Ceremony / circuit-version slip | 9 | 4 | Agent #11 | Agent #11: accept | 2026-05-28 |
| R-ENT-08 | Contract bug post-deployment | 10 | 6 | Agent #25 | Agent #25: accept | 2026-05-28 |
| R-ENT-09 | On-chain anchor disruption | 9 | 4 | Agent #25 | Agent #25: accept | 2026-05-28 |
| R-ENT-10 | AML / sanctions-listed enrolment | 10 | 4 | Agent #37 | Agent #37: accept | 2026-05-28 |

Counter-signature by Agent #36 (CCO) confirming all v1 residuals are
within auto-accept band: Agent #36: accept (2026-05-28).

Counter-signature by Agent #1 (founder / CTO) confirming the
classification framework and the cadence in §4: Agent #1: accept
(2026-05-28).

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #40 (Risk & Audit Lead)
NEXT REVIEW: 2026-06-01
