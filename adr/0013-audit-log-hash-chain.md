# ADR 0013 — Audit log hash chain

- **Status:** Accepted
- **Date:** 2026-05-25
- **Phase:** Phase 0, week 1 (per `docs/plan/bfsi-v1/04-commits.md` C-009)
- **Related:** ADR 0014 (on-chain anchor cadence), `docs/threat_model.md` rows A-14, A-22, `docs/plan/bfsi-v1/02-bank-demo.md` Scene 5.

## Context

The `audit_events` table is the system-of-record for every state-changing action in ZeroAuth (logins, key issuance, admin reads, tenant config changes, proof submissions, breach-sim invocations). Today the table has no integrity construction: a database administrator with `UPDATE` privilege can rewrite a row and there is no off-table mechanism to detect it.

Two pain points in `docs/plan/bfsi-v1/01-pain-points.md` (P4 insider abuse, RBI MD on IT Governance §6.4 requirement for tamper-evident logs) are not solvable without a cryptographic chain over the table.

The bank demo (Scene 5) requires us to demonstrate the chain breakage to a CISO + RBI auditor on stage.

## Decision

Each row in `audit_events` carries two new fields:

- `event_hash` — `SHA-256(canonical_json(event_data) || previous_hash)`, computed at write time.
- `previous_hash` — the `event_hash` of the immediately prior row for the same `tenant_id` chain.

The chain is **per-tenant** (i.e. there is one chain per tenant_id, not one global chain) so that a single noisy tenant cannot delay another tenant's chain head.

### Canonical JSON

We adopt **RFC 8785 JSON Canonicalization Scheme (JCS)** for the serialisation that goes into the hash. Rationale: deterministic, language-agnostic, no whitespace ambiguity, no key-ordering ambiguity. A reference implementation is provided by `canonicalize` (npm) and matched against `jcs` (Rust crate) for cross-language verification.

### Genesis row

For each tenant, the first audit row's `previous_hash` is the string `"genesis"` (literal). This avoids null-handling at chain validation time.

### Append-only contract

All writes go through `appendAuditEvent(tenantId, event)` in `src/services/audit.ts`. Direct `INSERT INTO audit_events` is forbidden in application code and detected by:

- an eslint custom rule (`no-direct-audit-insert`, lands in C-022), and
- a grep-style test (`tests/audit-chain.test.ts::"every audit-writing surface uses appendAuditEvent"`).

### Schema

```sql
ALTER TABLE audit_events
  ADD COLUMN previous_hash TEXT,
  ADD COLUMN event_hash TEXT;

CREATE INDEX audit_events_chain_idx
  ON audit_events (tenant_id, environment, id);
```

Both columns are nullable for the backfill window (C-121 in sprint 2). After backfill, both are constrained NOT NULL.

### Drift detection

A lightweight hourly job (per ADR 0014's spec, but operationally separate) replays the last N rows per tenant and compares to the recorded `event_hash`. Any mismatch triggers a severity-1 alert.

### What the chain does NOT defend against

- A DBA who can delete rows wholesale and disable the drift job. → mitigated by ADR 0014 daily on-chain anchor.
- A compromised process that controls both writes AND can poison the canonical_json serialiser. → mitigated by external cryptographer review of `src/services/audit.ts` (per ADR 0014 ceremony).
- An attacker who can pause the entire ZeroAuth service while they tamper. → out of scope; this is a process-availability concern, not an integrity concern.

## Consequences

**Positive**

- The `audit_events` table is tamper-evident with respect to row content + ordering, conditional on the drift detector being live.
- Independent verification is replayable from a database dump using `scripts/verify-audit-chain.ts` (lands with C-014).
- Bank-facing pitch: "your audit log is hash-chained and on-chain anchored; you bring your own auditor and verify yourself."

**Negative**

- Every audit write does an extra SHA-256 + canonical JSON pass. Measured cost on a 200-byte event: ~80 µs on the production VPS, ~0.15 % of total request time. Acceptable.
- Backfilling 4 M existing rows takes ~3 minutes on the prod DB. Run during low-traffic window (per C-121 plan).
- Adds one new dependency (`canonicalize`) requiring its own ADR — landed as ADR 0016 (zod + canonicalize) in the same week.

## Open questions (deferred to phase 2)

- Should we add per-tenant Merkle tree roots to allow proof-of-inclusion without sending the whole chain? → likely yes for the SaaS export, but not needed for v1.
- Should the chain include the `database_uuid` (a process-level identifier) to defend against full-DB-swap attacks? → deferred; defence-in-depth via the on-chain anchor is sufficient for v1.
