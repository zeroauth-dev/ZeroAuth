# ZeroAuth — BFSI v1 Production Plan

**Audience:** the 50-person delivery team (humans + AI agents), the founders, and the BFSI design partners we will name in the pilot phase.

**Horizon:** 12 months from week 1. Regulator-defensible v1 by month 12 (RBI Master Direction on IT Governance, DPDP Act §8, SOC 2 Type II, ISO/IEC 27001:2022).

**First milestone:** a banker-facing live demo built on the production platform — not a sandbox — within 12 weeks of week 1.

**Vertical priority:** BFSI primary → Healthcare secondary → Web3 tertiary. Every commit in Phase 0 and Phase 1 is justified by a bank use case, not by an abstract roadmap line.

**Mobile platform:** Android only (Android 11+). iOS is explicitly out of scope until v2.

---

## What this plan is

A single, opinionated source of truth for how we get from the current demo-grade codebase to a production identity-verification platform that an Indian scheduled commercial bank can put behind a regulated workload.

It contains:

| File | Purpose |
|---|---|
| [01-pain-points.md](01-pain-points.md) | The 10 BFSI pain points ZeroAuth uniquely solves, with cost-of-pain numbers and the protocol mechanism that addresses each. |
| [02-bank-demo.md](02-bank-demo.md) | The "Anchor Bank" demo specification — five scenes, the operator script, the artefacts each scene requires, and what the bank's CISO / CFO / CRO see. |
| [03-team.md](03-team.md) | The 50-person roster — title, mandate, reporting line, KPIs. Replaces the earlier 51-person plan after dropping the iOS engineer slot. |
| [04-commits.md](04-commits.md) | Commit format, pre-commit gates, and the commit-by-commit plan for Phase 0 (weeks 1–2) and Phase 1 (weeks 3–12). |
| [05-agents.md](05-agents.md) | Per-agent ticket list for weeks 1–4. Each of the 50 agents has explicit tickets with file paths, definition-of-done, and review gates. |
| [06-ways-of-working.md](06-ways-of-working.md) | Cadence, sub-agent rules, DoD templates, branch policy, release policy, escalation. |

The plan is meant to be **executed in sequence**. Don't reorder Phase 0 commits without an ADR.

---

## What changed since the previous plan

| Change | Reason |
|---|---|
| Dropped iOS engineer (former role #22). | User directive: "keep only android right now". The slot is repurposed to a second Senior Android engineer focused on R307 USB-OTG driver and BiometricPrompt fallback reliability. |
| BFSI re-confirmed as the only vertical that has demos commissioned in Phase 1. | User directive: "we'll first start with a demo for banks". Healthcare and Web3 demos are deferred to Phase 2. |
| Phase 1 reorganised around the bank demo, not around a generic "platform v1". | User directive: "build the zero authc platform that way that in what way it'll be utilized". |
| Per-agent week-by-week ticket lists added. | User directive: "create a proper work document for all the agents". |
| Commit-by-commit log added. | User directive: "create a proper document with commit by commit data, what will be every single commit, what changes will be made and what will be the progress". |

---

## Standing constraints (apply to every commit, every agent)

1. **No `Co-Authored-By: Claude` trailer.** Commits are authored by the human or agent doing the work. AI assistance is not credited in the commit trailer.
2. **Tests before commit.** Every commit either (a) ships a test that fails before the code change and passes after, or (b) is documentation/config only and is marked `[no-test]` in the body with a one-line justification.
3. **Clean commit subjects.** Plain English, ≤ 72 characters, imperative mood, no emoji, no `feat:` / `fix:` prefixes, no "WIP" or "checkpoint".
4. **No raw biometric data over the wire.** Reject any payload key matching `image|template|pixel|depth|frame|raw_face|raw_finger` at the input validator. Tests in `tests/biometric-rejection.test.ts` enforce this.
5. **Every admin and console action writes an `audit_events` row.** No silent reads on tenant-scoped data.
6. **Every query is gated by `(tenant_id, environment)` in the WHERE clause.** Tests in `tests/tenant-isolation.test.ts` enforce this.
7. **Every new dependency is an ADR.** Use the `dep-add` skill. The CI step `scripts/check-dep-trail.sh` blocks the merge otherwise.
8. **`security-reviewer` and `cryptographer-reviewer` sub-agents are invoked automatically on touched paths** (`src/services/zkp.ts`, `src/services/identity.ts`, `src/middleware/tenant-auth.ts`, `circuits/`, `contracts/`, hash-construction in `src/audit/`).
9. **Plan-mode is mandatory for any change touching ≥ 5 files OR any of the sensitive paths.** Skipping plan mode is grounds for revert.
10. **Secrets never enter git.** `.env`, `PRODUCTION_CREDENTIALS.md`, `GITHUB_SECRETS.md`, any `*.zkey` over 50 KB, and any `*.pem` are gitignored. Pre-commit hook scans for `BEGIN PRIVATE KEY`, `JWT_SECRET=`, `SESSION_SECRET=`, `ADMIN_API_KEY=`, `BLOCKCHAIN_PRIVATE_KEY=`, `za_live_`, `za_test_` patterns in staged content.

---

## Phase map (12 months)

| Phase | Weeks | Goal | Exit gate |
|---|---|---|---|
| **Phase 0 — Remediation** | 1–2 | Close the 21 audit findings (P0 first). Remove demo bypass, real biometric on Android, real Groth16 verification end-to-end. | All P0 findings closed; `tests/` suite green; the dashboard demo runs against real proofs. |
| **Phase 1 — Pramaan v1 + Bank Demo** | 3–12 | Production-quality Pramaan protocol; the Anchor Bank demo; trusted-setup ceremony; rapidsnark prover on Android; R307 driver; hash-chained audit log; mainnet-ready contracts. | Demo runs in front of three banks, full evidence pack delivered, BFSI design-partner LoIs signed. |
| **Phase 2 — Pilots** | 13–26 | Three named-bank pilots in `live` mode against limited userbase; SOC 2 Type I evidence; ISO 27001 Stage 1 audit. | Three signed pilot agreements; SOC 2 Type I report; ISO 27001 Stage 1 cleared. |
| **Phase 3 — Compliance hardening** | 27–39 | SOC 2 Type II evidence period; ISO 27001 Stage 2; DPDP §8 compliance audit; RBI sandbox application; healthcare second-vertical demo. | SOC 2 Type II report; ISO 27001 certificate; DPDP audit clean; RBI sandbox acceptance. |
| **Phase 4 — Regulator-defensible v1** | 40–52 | Mainnet contract deployment; HSM-backed signer; full disaster recovery exercise; first paid bank in production. | One paid bank in production; mainnet contract verified on Basescan; DR drill passed. |

---

## How to use this plan

- **Day 1, every agent**: read `00-README.md`, your row in `03-team.md`, and your week-1 entry in `05-agents.md`. Confirm understanding in the team standup.
- **Every commit**: subject + body matches `04-commits.md` format; pre-commit hook passes; CI green before pushing to `dev`.
- **Every PR**: from `dev` → `main`. No feature branches. The branch workflow is `dev` + `main` only (see user memory note).
- **Every Friday**: each agent posts a status update mapped to their week's tickets.
- **End of each phase**: the phase exit gate must be met by demo + evidence pack before the next phase begins.

---

LAST_UPDATED: 2026-05-27
OWNER: Pulkit Pareek (engineering) + Amit Dua (product)
