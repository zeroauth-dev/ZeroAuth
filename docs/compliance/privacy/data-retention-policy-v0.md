# Data retention policy — v0

**Status:** v0 — first issue. Establishes the per-table retention rules used by the nightly cleanup job (implementation lands Phase 1 sprint 4; this is the policy spec).
**Companion documents:**

- [docs/compliance/privacy/data-inventory-v1.md](./data-inventory-v1.md) — element classifications drive the retention rule selection.
- [docs/compliance/privacy/pia-template-v0.md](./pia-template-v0.md) — every PIA cites the retention policy section that applies.
- [docs/compliance/dpdp-2t-commitments-memo-v0.md](../dpdp-2t-commitments-memo-v0.md) — basis for the conservative treatment of OPAQUE-CRYPTOGRAPHIC elements (commitments + DIDs) at the PII retention bar until counsel signs off.
- [docs/compliance/compliance-roadmap-v1.md](../compliance-roadmap-v1.md) §2.5 — RBI Master Direction on KYC §38 (record retention) — drives the 5-year baseline on KYC-touching surfaces; §6.4 of the IT MD drives the 7-year audit-log retention.
- [docs/threat_model.md](../../threat_model.md) — A-22 (PII in pairing logs) and the §13 cross-border discussion in `dpdp-2t-commitments-memo-v0.md` Q3.

---

## 1. Purpose

This policy establishes the **canonical retention rules** for every data element ZeroAuth holds. The rules are organised in two layers:

- **Default retention by classification** — applies when no table- or bank-specific override is in force.
- **Per-table retention** — explicit retention for every table in `src/services/db.ts`.
- **Bank-specific overrides** — per-tenant `security_policy.retention_overrides` JSON (already wired through the `tenants.security_policy` column; the schema-purity test allowlists it as a permissive JSONB).

The policy is enforced by a nightly cleanup job (Phase 1 sprint 4 implementation; this document is the spec). Bank-tenants that require longer retention pass it through their per-tenant policy JSON; bank-tenants that require shorter retention than the default pass it the same way, subject to a sanity floor (no retention shorter than the regulator-mandated minimum on any audit-touching surface).

The right-to-erasure flow (DPDP §13) operates orthogonally: a data-principal request triggers an operator erasure action that cascades a `DELETE` and writes an audit row, regardless of whether the retention timer has elapsed. (The admin-portal that once automated this was retired in July 2026; erasure is currently an operator DB action, with a console-side erasure endpoint as the planned replacement.)

---

## 2. Default retention by classification

The classification values are the same five used in `data-inventory-v1.md` §1. The defaults below apply unless a per-table rule (§3) or a bank-specific override (§4) is more specific.

| Classification | Default retention | Basis |
|---|---|---|
| **NON-PII** | **7 years (2555 days)** | Aligned with the audit-log baseline. NON-PII data is statutorily safe to keep for the longer of the audit horizon and the operational horizon; the audit horizon is the binding constraint on tenant-scoped tables (RBI IT MD §6.4). |
| **PII** | **3 years from last contact** | DPDP §6 (storage limitation principle) + RBI KYC MD §38 (5-year storage of KYC records counts only against KYC artefacts at the bank — ZeroAuth holds none — so the lower 3-year bar applies to ZeroAuth's PII). Erasable on data-principal request per DPDP §11 / §13. |
| **SENSITIVE-PII (DPDP §17)** | **2 years from last contact** | DPDP §17 imposes elevated obligations; the conservative reading is shorter retention. Erasable on request. ZeroAuth holds zero SENSITIVE-PII centrally; this default applies to on-device SENSITIVE-PII covered by Q6 in the §2(t) memo. |
| **SECRET** | **Rotated quarterly; never persisted beyond rotation** | JWT signing secret, session-bind cookie material, admin x-api-key. Rotation cadence captured in `docs/security/secret-rotation-runbook.md` (to be written, Phase 1 sprint 3 deliverable). |
| **OPAQUE-CRYPTOGRAPHIC (commitments, DIDs)** | **Same as PII (3 years from last contact)**, conservatively, until counsel signs off on the §2(t) memo | The §2(t) memo argues these artefacts are not personal data and can be retained without DPDP §6 limitation. The conservative posture treats them as PII until counsel confirms Argument-A. On counsel sign-off (memo v2), the retention promotes to NON-PII (7 years). |
| **TRANSIENT-SECRET** | **0 days** | Must be GC'd within the request lifetime. Verified by the biometric-payload-key blocklist (C-022) and the `device.sha256_biometric_template` field in `data-inventory-v1.md` §3.14. |

The "from last contact" idiom means: the retention timer resets on every legitimate-purpose touch (a successful verification, an admin action initiated by the same principal). When the timer elapses with no touch, the cleanup job deletes the row and writes an audit-event with action `retention_expired_deletion`.

---

## 3. Per-table retention table

The table below resolves the default-by-classification rules against the specific tables. Where the table holds mixed classifications, the row carries the binding rule (typically the longest, since column-level deletion is operationally hard inside a single row).

| Table | Retention (days) | Rule source | Notes |
|---|---|---|---|
| `leads` | 1095 (3 years) | PII default | Marketing lead capture; deleted on data-principal request via an operator erasure action. |
| `tenants` | -1 (lifetime of business relationship) | Service-relationship retention | Deleted on tenant offboarding; cascades to `api_keys`, `usage_logs`, `usage_monthly`, `devices`, `tenant_users`, `verification_events`, `attendance_events`, `audit_events`. |
| `pending_signups` | 1 (24 hours TTL) | Operational TTL | Hard TTL; rows older than 24h that have not been consumed are deleted by the cleanup job. |
| `api_keys` | -1 (lifetime of tenant) | Service-relationship retention | Revoked keys are retained for audit purposes; `revoked_at` is the operational timer for any policy that prunes revoked keys after 1 year (not yet enabled). |
| `usage_logs` | 540 (18 months) | Billing horizon | Billing dispute window plus a 6-month buffer. |
| `usage_monthly` | 2555 (7 years) | Audit horizon | Aggregated counters; retained for the audit horizon for financial reporting. |
| `devices` | -1 (lifetime of tenant) | Service-relationship retention | Retired devices retained for audit traceability; pruned on tenant offboarding. |
| `tenant_users` | -1 (lifetime of relationship; PII columns scheduled for removal in Phase 1 PII-strip) | Conservative until Phase 1 PII-strip lands | After Phase 1 PII-strip, this row reads `7 years (2555 days)` because the remaining columns are NON-PII + OPAQUE-CRYPTOGRAPHIC. Tracked as a roadmap deliverable. |
| `verification_events` | 2555 (7 years) | RBI IT MD §6.4 (audit logs) | Aligned with the audit-event retention; required for bank-side §6.4 evidence. |
| `attendance_events` | 2555 (7 years) | Audit horizon | Aligned with verification_events. |
| `proof_pairing_sessions` | 30 (30 days) | Operational + abuse-defence | 5-min TTL on `state=issued` (cleanup job); 30 days on `state IN (consumed,failed,expired)` for fraud-investigation tail. |
| `audit_events` | 2555 (7 years) | RBI IT MD §6.4 + DPDP §8 baseline | Append-only; the hash chain (ADR 0013) ensures any deletion is detectable. The cleanup job that prunes rows older than 7 years must also extend the chain forward (covered by ADR 0013 §rolling-genesis). |
| `audit_anchors` | 2555 (7 years; on-chain anchor is permanent) | Audit horizon | The DB row is purged at 7 years; the on-chain anchor lives forever on Base mainnet (Phase 4 deployment). |

---

## 4. Bank-specific retention overrides

Each bank-tenant can pass a `retention_overrides` map through `tenants.security_policy` JSONB. The map keys are table names; the values are objects with `retention_days` and optional `last-contact-field` overrides. Example for Anchor Bank, which requires the legally maximal 7-year retention on every audit-touching surface and the regulator-mandated 5-year retention on transactional surfaces:

```json
{
  "retention_overrides": {
    "audit_events":      { "retention_days": 2555 },
    "verification_events": { "retention_days": 1825 },
    "attendance_events": { "retention_days": 1825 },
    "usage_logs":        { "retention_days": 1095 },
    "tenant_users":      { "retention_days": -1 }
  }
}
```

The cleanup job consults `tenants.security_policy.retention_overrides` first; if absent, it falls back to the §3 table. The override may only **lengthen** retention on audit-touching surfaces relative to the defaults; an override that proposes a shorter retention on any audit-touching surface is rejected at policy-load time with a `policy_violation` audit row.

The schema-purity test (`tests/schema-purity.test.ts`) does not yet inspect `security_policy` JSONB schemas; an ADR will be raised to lock that JSONB schema down once the override surface is in use across more than one tenant.

---

## 5. Nightly cleanup job (proposed spec — implementation Phase 1 sprint 4)

A nightly cron at 02:00 IST runs the cleanup job. The job:

1. Loads the per-tenant `retention_overrides` map for every active tenant.
2. For each table in §3 with a finite retention period:
   - Computes the effective `retention_days` (override or default).
   - Executes a parameterised SQL `DELETE` of rows older than `now() - retention_days * INTERVAL '1 day'`.
   - Counts deleted rows; logs the count to `audit_events` with action `retention_cleanup`, summary "rows deleted by retention policy".
3. For `audit_events` specifically:
   - The delete extends the hash chain forward by writing a `chain_rolling_genesis` event whose `previous_hash` is the last hash before the deletion window. This preserves the chain across the prune.
4. Hard failure modes:
   - If the `DELETE` query exceeds 30 seconds, the job aborts and pages the on-call engineer.
   - If the count of deleted rows exceeds 5% of the table size in a single run, the job aborts and pages.
5. Soft failure modes:
   - Job runtime > 10 minutes total → warning logged.
   - Override JSONB that fails the policy guard (§4) → row dropped from this run + policy-violation audit row.

The implementation lands in Phase 1 sprint 4; the C-IDs are reserved as `C-141..C-146` (allocated in `docs/plan/bfsi-v1/04-commits.md` placeholder).

---

## 6. Right-to-erasure flow (DPDP §13)

Per DPDP §13, a data principal may request erasure of their personal data. The flow:

1. **Request capture.** The data principal writes to the bank-tenant's grievance officer (per the bank's DPDP §6 notice). The grievance officer files an erasure request keyed by `did` or by `external_id` (depending on which the bank operates with).
2. **Lookup.** An operator locates the `tenant_users` row by `tenant_id + environment + external_id` (or by `tenant_id + environment + did` once the Phase 1 PII-strip lands).
3. **Cascade.** The system performs a transactional delete:
   - Delete the `tenant_users` row.
   - Cascade-null the `verification_events.user_id` and `attendance_events.user_id` FKs (set to NULL by the existing `ON DELETE SET NULL`).
   - Delete the on-device-issued `cookie.zeroauth_console_jwt` if the data principal also held a console account (rare case).
   - Cascade-delete by FK any other rows referencing the user.
4. **Audit.** Write an `audit_events` row with `action = 'erasure_dpdp_13'`, `entity_type = 'tenant_user'`, `entity_id = <former-uuid>`, `actor_type = 'console'`, `actor_id = <grievance-officer-uuid>`, `metadata = { reason: 'data_principal_request', request_id: <uuid> }`.
5. **Confirmation.** The grievance officer receives a confirmation that the cascade ran successfully, including the audit-event ID.
6. **Tombstone.** The bank-tenant retains a tombstone record outside ZeroAuth that says "user X was erased on YYYY-MM-DD"; this tombstone is the bank's evidence of compliance and is not stored in ZeroAuth's database.

**Exception classes (§7) override the cascade where they apply.**

The right-to-erasure flow is exercised quarterly as part of the DPDP §13 tabletop (Q3 week 33 first exercise per `compliance-roadmap-v1.md` §3.3). The first tabletop is the operational proof that the cascade is intact; subsequent exercises verify drift.

---

## 7. Exception classes

The following classes **block** the cleanup job and the right-to-erasure cascade for the affected rows. Each class requires an audit-events row of class `retention_hold` at the time the hold is applied, with the legal/operational basis cited.

### 7.1 Court-ordered data hold

A court order (Indian or, where Indian law gives effect, a foreign court) compels retention of specific rows beyond their retention timer or against a data-principal erasure request. The hold is applied by:

- Writing a `retention_holds` row (table to be added in Phase 1 sprint 4) keyed by `(tenant_id, target_table, target_pk)` with `hold_type = 'court_order'`, `case_reference`, `hold_until`.
- Marking the affected row(s) with a JSONB flag `metadata.retention_hold = true`.

The cleanup job and the erasure cascade both honour the flag and skip the affected rows. When the hold lapses (court order vacated, hold_until reached), the flag is cleared and the rows return to the normal retention regime.

### 7.2 Regulator inspection

An RBI inspection, a DPB inquiry, or any other regulator action that requires the preservation of specific records beyond their retention timer. The hold mechanism is the same as §7.1 with `hold_type = 'regulator_inspection'` and the inspection reference.

The hold is applied by the CCO (Agent #36) on advice of counsel; the hold cannot be applied by an engineering action alone.

### 7.3 Ongoing security investigation

A live security incident under investigation by Agent #26 (Security red-team), Agent #21 (SRE), or an external incident-response vendor. Hold type `security_investigation` with the incident reference.

Holds in this class default to 90 days and are extended only on written advice of the incident commander. They are reviewed at every quarterly access review (`compliance-roadmap-v1.md` §4.2 D-Q2-12) for stale entries.

### 7.4 Pending bank-side audit

A bank-tenant's internal audit team has requested preservation of specific records for an audit cycle. Hold type `bank_audit` with the audit reference. Defaults to 180 days; extended by mutual agreement.

### 7.5 Litigation hold

A litigation hold notice from any party with standing (a customer, a regulator, a co-defendant). Hold type `litigation_hold` with the matter reference. Defaults to the duration of the matter as advised by counsel.

---

## 8. Audit + observability

Every action that touches retention writes an audit row. The actions are:

- `retention_cleanup` — nightly cleanup ran successfully.
- `retention_expired_deletion` — individual row deleted by retention timer (folded into the daily cleanup audit row to avoid log explosion; sampled at 1 in 100 for individual rows).
- `retention_hold_applied` — a hold under §7 was applied.
- `retention_hold_lifted` — a hold was lifted.
- `erasure_dpdp_13` — a right-to-erasure cascade was executed.
- `retention_policy_violation` — a bank-tenant `retention_overrides` was rejected at policy-load time.

The `/api/admin/privacy-audit` endpoint (already shipped) surfaces these rows for inspection. The retention-cleanup-summary view (to be added in Phase 1 sprint 4) aggregates the rows by tenant + table for quarterly review by the DPO.

---

## 9. Open questions referred forward

- **Q-RET-01.** Should the OPAQUE-CRYPTOGRAPHIC default be promoted to NON-PII (7-year retention) on counsel sign-off of the §2(t) memo, or do we hold at PII-equivalent retention pending a regulator interaction? Referred to Agent #41 + counsel via memo v2.
- **Q-RET-02.** Does the `pending_signups` 24-hour TTL satisfy DPDP §6 storage-limitation, or should we shorten to 1 hour after the verify link is consumed? Operational impact is minor; security upside is small. Decision deferred to Phase 1 sprint 3.
- **Q-RET-03.** Should `usage_logs.ip_address` be hashed after 90 days (preserving abuse-defence histograms but losing the raw IP for re-identification)? Referred to Agent #6 + Agent #39; ADR target Phase 1 sprint 4.
- **Q-RET-04.** The right-to-erasure cascade currently leaves orphan rows in `verification_events` (FK `SET NULL`). Is this consistent with DPDP §13 erasure, or must we delete the `verification_events` row outright? Referred to counsel via memo v1.
- **Q-RET-05.** The `audit_events.metadata.actor_email` field — captured during console actions — is a PII surface on what is otherwise a NON-PII / OPAQUE row. Should the email be replaced with a `console_user_id` UUID lookup on a separate table, with the email queryable only via a restricted operator lookup? Referred to Agent #14 + Agent #39 for Phase 1 sprint 2 design.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #39 (Privacy) + Agent #41 (DPO)
