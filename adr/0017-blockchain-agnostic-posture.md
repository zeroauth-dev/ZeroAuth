# ADR 0017 — Blockchain-agnostic posture

- **Status:** Accepted
- **Date:** 2026-05-28
- **Phase:** Phase 1, pivot week 3
- **Supersedes / amends:** ADR 0014 (on-chain anchor cadence) — anchoring becomes opt-in, not mandatory. Existing on-chain artefacts (Base Sepolia `DIDRegistry`, `Groth16Verifier`, `AuditAnchor`) continue to exist as **providers**, not as load-bearing platform pieces.

## Context

Field reality from BFSI customer conversations: Indian banks, NBFCs, insurers, and most regulated buyers do not currently consume blockchain-anchored audit logs or on-chain identity registries. The category of trust they need is **independent verifiability of the audit chain** — they will pay for tamper-evidence they can verify with their own auditor — but the verification surface they prefer is a signed transcript or a third-party-witnessed Merkle tree, not "send your auditor to Basescan".

Two consequences:

1. Mandating blockchain rails (Base L2 anchor, `DIDRegistry`-as-truth, contract-side `Groth16Verifier`) as a hard dependency raises the integration cost without buying us a single Indian bank pilot.
2. The cryptographic substance of the platform — the Groth16 ZK identity verification protocol over biometric commitments — does not require any blockchain. The blockchain pieces were defence-in-depth bolt-ons, not the load-bearing primitive.

The substance — Pramaan ZK identity verification, biometric-commitments, hash-chained audit log — stands on its own. Blockchain is a pluggable provider for one specific value-add (independently verifiable anchor), not the core.

## Decision

ZeroAuth is **blockchain-agnostic**. The platform ships with three independent provider slots, each opt-in per tenant:

### 1. Identity provider — where DIDs live

Defaults to **off-chain**. The DID + commitment tuple is the system-of-record in the `users` table (`tenant_users` today; PII-stripped variant in Phase 1) in the tenant's database. The DID is a stable identifier the tenant assigns, scoped to `(tenant_id, environment)`.

Optional providers (selected via `tenant.security_policy.did_provider`):

- `"off-chain"` — DEFAULT. DID lives in DB. No external dependency.
- `"base-sepolia"` — register every DID on `DIDRegistry` on Base Sepolia (existing). Adds ~3 s to enrollment latency.
- `"base-mainnet"` — same, on Base mainnet (production future).
- `"custom-chain"` — pluggable; the tenant supplies an RPC + a `DIDRegistry`-compatible contract address.

### 2. Verifier provider — where Groth16 proofs are verified

Defaults to **off-chain snarkjs**. The verifier runs in-process, loading `verification_key.json` per ADR 0015. This is what the dashboard demo, every customer pilot, and the production verifier service uses.

Optional providers (selected via `tenant.security_policy.verifier_provider`):

- `"off-chain"` — DEFAULT. `snarkjs.groth16.verify` in `src/services/zkp.ts`.
- `"on-chain"` — additionally re-verify on Base via `Groth16Verifier`. Adds ~10 s wall-clock per verification. Useful only for tenants who insist on the on-chain re-verification as defence-in-depth.

### 3. Audit anchor provider — how the audit chain is independently verifiable

Defaults to **none**. The hash chain (ADR 0013) is the tamper-evidence primitive; it is fully off-chain and verifiable from a database dump. The anchor is an additional layer that lets a third party verify history without needing the DB dump.

Optional providers (selected via `tenant.security_policy.audit_anchor_provider`):

- `"none"` — DEFAULT. Hash chain only. Tenant's auditor verifies via DB dump.
- `"signed-transcript"` — ZeroAuth produces a daily signed transcript (ed25519 over the chain's terminal hash + day). The signing key is published; the bank's auditor checks the signature. NEW PROVIDER — implementation lands in a sprint-2 commit.
- `"base-sepolia"` — daily anchor on Base Sepolia `AuditAnchor` (existing infrastructure, commit `d6c6a4e`). Gas-free.
- `"base-mainnet"` — same on Base mainnet.
- `"witness-cosign"` — daily transcript co-signed by a named third party (e.g. the bank's own internal auditor, or a notary service). NEW PROVIDER — Phase 3.

### How a tenant configures providers

`tenants.security_policy` JSONB carries:

```json
{
  "did_provider": "off-chain",
  "verifier_provider": "off-chain",
  "audit_anchor_provider": "none",
  "audit_anchor_signing_key_id": null,
  "base_rpc_url": null,
  "did_registry_address": null,
  "groth16_verifier_address": null,
  "audit_anchor_contract_address": null
}
```

A tenant with all defaults runs the platform without any blockchain RPC, key, or contract — a clean off-chain deployment.

A tenant that opts into `signed-transcript` anchoring gets the value of "independently-verifiable history" without the operational + commercial overhead of running anything on a blockchain.

A tenant that opts into `base-sepolia` or `base-mainnet` adds the blockchain-anchored layer on top; the platform still works if the chain RPC is unavailable (the chain is best-effort).

### Defaults rationale

Defaults are **off-chain**, **off-chain**, **none** because:

- Most customers will never opt into a blockchain provider.
- A new customer setting up a tenant should not need to know what Base is, what a Groth16 contract is, or what a daily anchor cron is.
- Operational risk: an RPC outage on a chain provider should never block enrollment or verification.
- Commercial risk: per-anchor gas spend at scale (50 tenants × 365 anchors/year × ~$5 = $90 k/year on mainnet) needs explicit opt-in with a CFO-approved budget line, not silent default-on.

## What this changes

| Surface | Before | After |
|---|---|---|
| `src/services/blockchain.ts` | Hard-loaded at boot; `BLOCKCHAIN_PRIVATE_KEY` required for `live` | Optional. Boot loads only if at least one tenant has a non-default provider. Missing env vars → service marked unavailable, but boot succeeds. |
| `src/services/anchor-job.ts` (commit `8494ffc`) | Runs daily for every tenant | Runs daily only for tenants with `audit_anchor_provider != "none"`. Default tenants skipped at the top of the loop. |
| `src/services/identity.ts` register flow | Calls `registerDID()` on Base after DB insert | Calls `registerDID()` only when `did_provider != "off-chain"`. Default tenants get a pure DB enrollment. |
| `src/services/zkp.ts` verify flow | Calls `snarkjs.groth16.verify` + optional on-chain reverify | Same. On-chain reverify is gated by `verifier_provider == "on-chain"` (already was, this is just renamed). |
| `contracts/AuditAnchor.sol` | Implicit dependency | Now a **provider implementation**; the AuditAnchor provider is one of three audit-anchor providers. Source stays. |
| `contracts/DIDRegistry.sol` | Implicit dependency | Now a **provider implementation**; not loaded unless a tenant opts in. Source stays. |
| `contracts/Groth16Verifier.sol` | Tracked in `contracts/deployed-addresses.json` and verified on-chain by ADR 0015 | Same; still tracked; still used when a tenant opts into on-chain verification. |
| Dashboard "Audit Integrity" view (commit `0848640`) | Shows on-chain anchor link unconditionally | Shows the link only when the tenant has an anchor provider; otherwise shows "Off-chain hash chain only (signed transcript not enabled)". |
| Demo runbook Scene 5 | Shows on-chain anchor + Basescan | Shows hash-chain + the signed-transcript path; on-chain anchor is presented as an optional add-on, not the default. |
| `docs/plan/bfsi-v1/01-pain-points.md` P4 mitigation language | "hash-chained DB + on-chain anchor on Base" | "hash-chained DB + signed daily transcript (default) or on-chain anchor (opt-in)". |

## What this does NOT change

- The Pramaan ZK identity verification protocol itself.
- `identity_proof.circom` circuit.
- The `EXPECTED_VKEY_SHA256` boot check (ADR 0015).
- The hash-chained audit log (ADR 0013).
- The on-device biometric → commitment pipeline.
- The Groth16 proof-of-knowledge of secret opening the commitment.
- Any test in the existing test suite (403 backend tests stay green; the chain-related tests just gain a "skip when provider is off" branch).

## How we sell this vs Auth0 / Okta — the language stays the same

The Auth0 differentiation pitch we have been making does not depend on blockchain at all:

- "Credential storage: Auth0 stores hashes + MFA seeds; we store Poseidon commitments only."
- "Breach blast radius: their DB exfil yields PII; ours yields field elements with no PII linkage."
- "SIM-swap defence: StrongBox-bound DID + biometric local gate, no SMS in the loop."
- "Transaction binding: Poseidon over (amount, payee, ts) inside the proof — cryptographic, not OTP."
- "Per-auth marginal cost: zero SMS in the loop."
- "Audit log: hash-chained, independently verifiable from a DB dump."

Notice: none of these arguments mention a blockchain. They all hold with the default off-chain platform. Blockchain is a defence-in-depth optional layer for tenants who want it; absence of it is not a weakness in the pitch.

## Migration path for existing deployments

Anyone running the platform today (the W3 demo on `zeroauth.dev`):

1. Existing tenants keep their current `security_policy`. The boot-time loader reads the JSON; if no `did_provider` key, defaults are applied.
2. No DB migration needed.
3. The existing Base Sepolia `DIDRegistry` + `Groth16Verifier` + `AuditAnchor` (`d6c6a4e`) addresses stay in `contracts/deployed-addresses.json`. They're consulted only when a tenant opts in.
4. The `BLOCKCHAIN_PRIVATE_KEY` env var becomes optional. If absent, the platform boots cleanly and `src/services/blockchain.ts` is in "unavailable" mode.

## Test impact

- `tests/blockchain.test.ts` adds skip branches for "blockchain service unavailable" path.
- `tests/anchor-job.test.ts` adds a "tenant with provider=none is skipped" test.
- `tests/admin-audit-integrity.test.ts` already returns `pass` or `fail` without depending on chain — no change.
- `tests/identity.test.ts` adds an off-chain happy path.
- A new `tests/blockchain-agnostic-posture.test.ts` asserts the source-level invariant: `blockchain.ts`, `anchor-job.ts`, and `identity.ts` all gate their on-chain calls behind a provider check.

## Open questions deferred

- **Signed-transcript provider format.** ed25519 over canonical JSON, key rotation cadence, key publication mechanism — lands in the implementation commit.
- **Witness-cosign UX.** How does the bank's internal auditor sign? Lands in Phase 3 if a customer asks.
- **Provider migration.** What happens when a tenant flips from `off-chain` → `base-sepolia` mid-flight? Existing rows are not retroactively anchored; only new ones from the flip-date forward. Documented in the provider switch runbook (lands when the first customer migrates).

## Related ADRs

- ADR 0011 — branching workflow
- ADR 0013 — audit log hash chain (still load-bearing, blockchain-agnostic)
- ADR 0014 — on-chain anchor cadence (now ONE provider option, not mandatory)
- ADR 0015 — circuit version pinning (off-chain, blockchain-agnostic)
- ADR 0016 — zod input validation

## Sign-off

This ADR is the platform's commercial spine: **we sell a working ZK identity platform that does not require a customer to think about blockchain**. Blockchain becomes a feature flag.

LAST_UPDATED: 2026-05-28
OWNER: Agent #1 (CTO) + Agent #42 (CRO) + Agent #28 (CPO)
