# ADR 0014 — On-chain anchor cadence for the audit hash chain

- **Status:** Accepted
- **Date:** 2026-05-25
- **Phase:** Phase 0, week 1 (per `docs/plan/bfsi-v1/04-commits.md` C-010)
- **Related:** ADR 0013 (audit log hash chain), `contracts/AuditAnchor.sol` (lands with C-016), `docs/plan/bfsi-v1/02-bank-demo.md` Scene 5.

## Context

ADR 0013 introduces a per-tenant hash chain over `audit_events`. The chain by itself is a defence against in-DB tampering provided **the drift detector is live and trusted**. An attacker who compromises both the chain writer and the drift detector can rewrite history.

The bank-facing pitch requires a defence the bank's own auditor can verify **without trusting any ZeroAuth process at all**. The standard answer is to anchor the chain's terminal hash on a public blockchain at a regular cadence, so the bank can independently prove "this chain existed at this point in time and has not been re-written since."

## Decision

Each tenant's chain terminal hash is anchored once per day on **Base L2** via the `AuditAnchor` contract.

### Schedule

- Anchor job runs at **00:30 IST** (19:00 UTC the previous day).
- For each active tenant in `live` environment with at least one audit event in the prior 24 h, compute the terminal `event_hash` and submit it to the contract.
- Test-env anchoring is optional (default off) to save gas.

### Anchor payload

```solidity
struct AnchorRecord {
  bytes32 tenantIdHash;     // keccak256(tenant_id || environment)
  uint64  dayUtc;           // YYYYMMDD as uint64 in UTC
  bytes32 terminalHash;     // SHA-256 of last audit_events row in window
  uint64  rowCountAtAnchor; // number of rows the hash is taken across
}
```

The `(tenantIdHash, dayUtc)` is a unique key — write-once enforced by the contract.

### `audit_anchors` table

The DB records every successful anchor with the on-chain tx hash:

```sql
CREATE TABLE audit_anchors (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  environment     TEXT NOT NULL,
  day_utc         DATE NOT NULL,
  terminal_hash   TEXT NOT NULL,
  row_count       BIGINT NOT NULL,
  tx_hash         TEXT NOT NULL,
  block_number    BIGINT NOT NULL,
  anchored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, environment, day_utc)
);
```

### Failure recovery

- If anchor fails on day D, retry every 60 min for the next 6 hours. After 6 h, page on-call.
- If the chain hits 2 consecutive missed-anchor days, the tenant goes into "anchor-degraded" state and the dashboard shows a banner.
- Anchor failure does NOT block audit writes. The chain remains intact; the off-chain defence (ADR 0013) is still active.

### Verification by the bank

Each tenant gets a `verify-audit-chain.sh` helper that takes a DB dump and:

1. Replays the chain row-by-row.
2. For each `audit_anchors` row, queries Basescan / a Base RPC for the `AnchorRecord` and asserts the terminal hash matches.
3. Outputs a verification report.

The script has zero ZeroAuth dependencies — runs against Postgres + the public RPC.

### Why Base L2 and not Base mainnet?

- Phase 0 + Phase 1: Base Sepolia (testnet). Gas-free; acceptable for pilots that understand the path to mainnet.
- Phase 4: Base mainnet. Gas budget computed: ~$5/day per tenant at current Base gas; offset by anchor-batching if cost becomes material.
- Not Ethereum L1: gas would be ~$50/day per tenant.
- Not a private chain: would not give the bank the third-party trust property we need.

## Consequences

**Positive**

- Tamper evidence the bank's auditor can verify without trusting us.
- Public-record narrative for the regulator ("your audit log is on-chain anchored").
- Failure mode is observable (`audit_anchors` row missing), recoverable, and bounded.

**Negative**

- Daily anchor → ~365 transactions/year per tenant. At 50 tenants × $5/tx that's ~$90 k/year on mainnet. Material but defensible in the SaaS pricing.
- Adds a runtime dependency on Base RPC availability. Mitigation: anchor cron uses 3 redundant RPC providers + retries.
- Adds a contract surface that needs auditing (Trail of Bits engagement planned phase 3).

## Open questions

- Should we publish each tenant's daily anchor via an SNS-like feed so the bank can monitor in real time? → likely yes, deferred to phase 2.
- Should the contract emit an event so block-explorers index it? → yes, included in the contract design (C-016).
- Should we batch anchors across tenants into a single Merkle root per day? → tempting but deferred; one anchor per tenant per day keeps the verification UX trivial.
