# Data inventory — v1

**Status:** v1 — first issue.
**Scope:** every data element processed by the ZeroAuth platform (`docs/compliance/compliance-roadmap-v1.md` §1.1 in-scope union).
**Companion documents:**

- [docs/compliance/privacy/pia-template-v0.md](./pia-template-v0.md) — every change consults this inventory as input.
- [docs/compliance/privacy/data-retention-policy-v0.md](./data-retention-policy-v0.md) — retention rules per classification + per table.
- [docs/compliance/dpdp-2t-commitments-memo-v0.md](../dpdp-2t-commitments-memo-v0.md) — basis for the OPAQUE-CRYPTOGRAPHIC classification of commitments and DIDs.
- [docs/compliance/compliance-roadmap-v1.md](../compliance-roadmap-v1.md) — frameworks tracked + quarterly milestones.
- [docs/threat_model.md](../../threat_model.md) — attack catalogue; rows A-15, A-22, A-27, A-28 reference this inventory.
- [src/services/db.ts](../../../src/services/db.ts) — source of truth for the DB schema this inventory enumerates.
- [tests/schema-purity.test.ts](../../../tests/schema-purity.test.ts) — column allowlist locked against this inventory.

---

## 1. Purpose

This inventory establishes the **canonical catalogue of every data element ZeroAuth processes**, classified by sensitivity under DPDP §17, with the lawful basis (DPDP §6), the retention period, and the cross-border transfer status named per element. It is used as the **input to every Privacy Impact Assessment** (PIA-template-v0) and as the source of truth for the `tests/schema-purity.test.ts` column allowlist.

When an engineering change introduces a new field, log line, or API surface, the PIA author looks up the element in this inventory. If the element is missing, a row must be added in the same PR that introduces the field, signed off by Agent #39 (Privacy) and Agent #41 (DPO). New rows that propose a new classification value (beyond the five enumerated below) require an ADR.

The five classification values used throughout are:

- **NON-PII** — opaque IDs (UUIDs), system-generated counters, configuration values, timestamps not bound to a single natural person.
- **PII** — data that identifies, or is reasonably likely to identify, a natural person under DPDP §2(t). Examples: name, email, phone, employee code, IP address paired with a session.
- **SENSITIVE-PII** — the DPDP §17 category for elevated-obligation personal data. Biometric data is the canonical example. ZeroAuth never holds raw biometric data centrally; SENSITIVE-PII rows in this inventory describe the on-device-only artefacts within ZeroAuth code paths (see Q6 in dpdp-2t-commitments-memo-v0.md §7).
- **SECRET** — credentials and key material whose disclosure to an unintended party degrades the system's authentication or integrity guarantees. Examples: password hashes, API-key SHA-256 hashes, JWT signing secret, session-bind cookie value, contract owner private key.
- **OPAQUE-CRYPTOGRAPHIC** — artefacts that have been constructed under a hiding-and-binding commitment scheme or a one-way function such that they do not identify a natural person under §2(t) by the argument in `dpdp-2t-commitments-memo-v0.md` §5. Examples: Poseidon commitment, DID, did_sha256 in audit metadata.
- **TRANSIENT-SECRET** — secret material that exists only in RAM on the customer's own device for the duration of a single proof-generation operation and is then garbage-collected. The SHA-256 of the biometric template is the canonical example. ZeroAuth ships the code path that produces this material; the bank's tenant database never holds it.

Cross-border status is named per element: **Indian-only** (lives on the Mumbai VPS + Hyderabad DR replica only) or **shipped-out** (replicated to a non-Indian region or processed by a non-Indian processor, with destination named).

---

## 2. Methodology

This inventory was produced by walking every surface that handles data:

1. **Every table in `src/services/db.ts`** — twelve table definitions enumerated below. Every column captured.
2. **Every audit-event metadata field** — by inspecting `src/services/audit.ts` and the call sites that build the `metadata` JSONB. The canonical fields are `did_sha256`, `actor_email`, `ip_address`, `user_agent`, `requested_scope`, `failure_reason`, `verification_id`, `device_id`, `session_id` and free-form per-event extensions.
3. **Every API payload field** — by inspecting the request and response interfaces in `src/types/` and the route handlers under `src/routes/`. The inventory captures the fields that cross the network boundary.
4. **Every Winston log field** — by inspecting `src/services/usage.ts` (request logger), `src/middleware/error-handler.ts` (error logger), and the structured-logging conventions across services. Winston records `requestId`, `path`, `tenantId`, `apiKeyId`, status code, response time. Body content is **not** logged (A-22 mitigation).
5. **Every Caddy access-log field** — by inspecting `Caddyfile`. Caddy records source IP, method, path (no query string under the C-005 closure for `/api/console/*`), user agent, response status, bytes, duration.
6. **On-device, transient elements** — the SHA-256 of the biometric template that lives in RAM on the customer's phone during proof generation. Captured here because ZeroAuth ships the code that computes it, even though it never leaves the device (Q6 in `dpdp-2t-commitments-memo-v0.md` §7).
7. **The OPAQUE-CRYPTOGRAPHIC artefacts** — the Poseidon commitment and the DID, classified per the §2(t) memo argument.

The walk is committed to source so the audit trail is reviewable. Every PR that touches `src/services/db.ts`, audit metadata fields, log fields, or API surfaces must update this inventory in the same commit; CI lints for column drift against the allowlist locked into `tests/schema-purity.test.ts`.

---

## 3. Inventory table

The columns:

- **Element name** — `<surface>.<column>` for DB columns; `<service>.<field>` for log fields; `<endpoint>.<field>` for API payloads.
- **Source surface** — DB table / log type / API endpoint / cache.
- **Classification** — one of the five values defined in §1.
- **Lawful basis** — DPDP §6 ground: `consent` / `legitimate-interest` / `legal-obligation` / `not-personal-data` (where the §2(t) memo argument applies) / `other` (specify).
- **Retention (days)** — number of days; `0` = transient (must be GC'd within request lifetime); `-1` = bound to a sliding window from last contact (resolved per the retention policy).
- **Cross-border** — `Indian-only` or `shipped-out:<destination>`.
- **Notes** — observations, mitigations, special handling.

### 3.1 `leads` table (marketing capture)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| leads.id | DB | NON-PII | not-personal-data | 1095 | Indian-only | Surrogate PK; SERIAL counter. |
| leads.type | DB | NON-PII | not-personal-data | 1095 | Indian-only | Enum: `pilot` / `whitepaper`. |
| leads.name | DB | PII | consent | -1 | Indian-only | Captured via marketing form; consent text shown at point of capture. |
| leads.company | DB | PII | consent | -1 | Indian-only | Company name; may identify a natural person at small firms. |
| leads.email | DB | PII | consent | -1 | Indian-only | Primary identifier for follow-up; subject to DPDP §13 erasure on request. |
| leads.size | DB | NON-PII | consent | 1095 | Indian-only | Company-size bucket (1-10, 11-50, …). |
| leads.created_at | DB | NON-PII | legitimate-interest | 1095 | Indian-only | Timestamp; not bound to an identified individual on its own. |

### 3.2 `tenants` table (developer accounts)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| tenants.id | DB | NON-PII | not-personal-data | -1 | Indian-only | UUID; surrogate PK. |
| tenants.email | DB | PII | consent | -1 | Indian-only | Account owner email; consent captured at signup. Subject to §11 erasure (cascades to api_keys via FK). |
| tenants.password_hash | DB | SECRET | legitimate-interest | -1 | Indian-only | bcrypt hash; never displayed; rotated on password reset. |
| tenants.company_name | DB | PII | consent | -1 | Indian-only | May identify a natural person at single-founder firms. |
| tenants.plan | DB | NON-PII | not-personal-data | -1 | Indian-only | Enum: `free`/`starter`/`growth`/`enterprise`. |
| tenants.status | DB | NON-PII | not-personal-data | -1 | Indian-only | Enum: `active`/`suspended`/`deactivated`. |
| tenants.rate_limit | DB | NON-PII | not-personal-data | -1 | Indian-only | Per-tenant requests / 15 min. |
| tenants.monthly_quota | DB | NON-PII | not-personal-data | -1 | Indian-only | -1 = unlimited. |
| tenants.metadata | DB | PII | consent | -1 | Indian-only | JSONB; may contain free-form bank-side identifiers. |
| tenants.security_policy | DB | NON-PII | not-personal-data | -1 | Indian-only | JSONB; per-tenant security knobs (Play Integrity gate, etc.). |
| tenants.created_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |
| tenants.updated_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |

### 3.3 `pending_signups` table (24-hour signup verification)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| pending_signups.id | DB | NON-PII | not-personal-data | 1 | Indian-only | UUID. |
| pending_signups.email | DB | PII | consent | 1 | Indian-only | 24h TTL; deleted on consume or expiry. |
| pending_signups.password_hash | DB | SECRET | consent | 1 | Indian-only | bcrypt; 24h TTL. |
| pending_signups.company_name | DB | PII | consent | 1 | Indian-only | 24h TTL. |
| pending_signups.token_hash | DB | SECRET | consent | 1 | Indian-only | SHA-256 of the single-use verify token. |
| pending_signups.expires_at | DB | NON-PII | not-personal-data | 1 | Indian-only | Timestamp. |
| pending_signups.created_at | DB | NON-PII | not-personal-data | 1 | Indian-only | Timestamp. |
| pending_signups.consumed_at | DB | NON-PII | not-personal-data | 1 | Indian-only | Timestamp. |

### 3.4 `api_keys` table (tenant API credentials)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| api_keys.id | DB | NON-PII | not-personal-data | -1 | Indian-only | UUID. |
| api_keys.tenant_id | DB | NON-PII | not-personal-data | -1 | Indian-only | FK → tenants. |
| api_keys.name | DB | NON-PII | not-personal-data | -1 | Indian-only | Free-form label. |
| api_keys.key_prefix | DB | NON-PII | not-personal-data | -1 | Indian-only | First 13 chars (e.g. `za_live_a1b2c3`); identification only. |
| api_keys.key_hash | DB | SECRET | legitimate-interest | -1 | Indian-only | SHA-256 of full key; raw key shown once at creation. |
| api_keys.scopes | DB | NON-PII | not-personal-data | -1 | Indian-only | TEXT[] of scope strings. |
| api_keys.environment | DB | NON-PII | not-personal-data | -1 | Indian-only | `live`/`test`. |
| api_keys.status | DB | NON-PII | not-personal-data | -1 | Indian-only | `active`/`revoked`. |
| api_keys.last_used_at | DB | NON-PII | legitimate-interest | -1 | Indian-only | Timestamp. |
| api_keys.expires_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Optional expiry timestamp. |
| api_keys.created_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |
| api_keys.revoked_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |

### 3.5 `devices` table (registered devices)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| devices.id | DB | NON-PII | not-personal-data | -1 | Indian-only | UUID. |
| devices.tenant_id | DB | NON-PII | not-personal-data | -1 | Indian-only | FK. |
| devices.environment | DB | NON-PII | not-personal-data | -1 | Indian-only | `live`/`test`. |
| devices.external_id | DB | PII | legitimate-interest | -1 | Indian-only | Tenant-supplied device identifier; may be derived from MAC / serial. |
| devices.name | DB | NON-PII | not-personal-data | -1 | Indian-only | Human-readable name (e.g. `Branch-12-Counter-3`). |
| devices.location_id | DB | NON-PII | not-personal-data | -1 | Indian-only | Tenant-side location code. |
| devices.status | DB | NON-PII | not-personal-data | -1 | Indian-only | `active`/`inactive`/`retired`. |
| devices.battery_level | DB | NON-PII | not-personal-data | -1 | Indian-only | 0-100. |
| devices.metadata | DB | PII | legitimate-interest | -1 | Indian-only | JSONB; may carry Play Integrity verdict, cert-chain hash. |
| devices.last_seen_at | DB | NON-PII | legitimate-interest | -1 | Indian-only | Timestamp. |
| devices.created_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |
| devices.updated_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |

### 3.6 `tenant_users` table (enrolled identities — PII columns scheduled for Phase 1 PII-strip)

The columns marked **PII (scheduled-for-removal)** are removed in the Phase 1 PII-strip migration (the follow-on to C-121). Until that migration lands, `tests/schema-purity.test.ts` allowlists them for the **current** state.

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| tenant_users.id | DB | NON-PII | not-personal-data | -1 | Indian-only | UUID. |
| tenant_users.tenant_id | DB | NON-PII | not-personal-data | -1 | Indian-only | FK. |
| tenant_users.environment | DB | NON-PII | not-personal-data | -1 | Indian-only | `live`/`test`. |
| tenant_users.external_id | DB | PII | consent | -1 | Indian-only | Tenant-supplied user identifier; may be Aadhaar fragment, employee code, phone. |
| tenant_users.full_name | DB | PII (scheduled-for-removal) | consent | -1 | Indian-only | Direct identifier. Removed in Phase 1 PII-strip. |
| tenant_users.email | DB | PII (scheduled-for-removal) | consent | -1 | Indian-only | Direct identifier. Removed in Phase 1 PII-strip. |
| tenant_users.phone | DB | PII (scheduled-for-removal) | consent | -1 | Indian-only | Direct identifier. Removed in Phase 1 PII-strip. |
| tenant_users.employee_code | DB | PII (scheduled-for-removal) | consent | -1 | Indian-only | May be re-identifying when joined with HR system. Removed in Phase 1 PII-strip. |
| tenant_users.status | DB | NON-PII | not-personal-data | -1 | Indian-only | `active`/`inactive`. |
| tenant_users.primary_device_id | DB | NON-PII | not-personal-data | -1 | Indian-only | FK → devices. |
| tenant_users.metadata | DB | PII | consent | -1 | Indian-only | JSONB; tenant-side metadata may include identifying data. |
| tenant_users.last_verified_at | DB | NON-PII | legitimate-interest | -1 | Indian-only | Timestamp. |
| tenant_users.created_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |
| tenant_users.updated_at | DB | NON-PII | not-personal-data | -1 | Indian-only | Timestamp. |

### 3.7 `verification_events` table

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| verification_events.id | DB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. Retention 7 years (audit baseline). |
| verification_events.tenant_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| verification_events.environment | DB | NON-PII | not-personal-data | 2555 | Indian-only | `live`/`test`. |
| verification_events.user_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK → tenant_users; UUID. |
| verification_events.device_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK → devices; UUID. |
| verification_events.api_key_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK → api_keys. |
| verification_events.method | DB | NON-PII | not-personal-data | 2555 | Indian-only | Enum: `zkp`/`fingerprint`/`face`/`depth`/`saml`/`oidc`/`manual`. |
| verification_events.result | DB | NON-PII | not-personal-data | 2555 | Indian-only | `pass`/`fail`/`challenge`. |
| verification_events.reason | DB | NON-PII | not-personal-data | 2555 | Indian-only | Free-form short string; must not contain PII. |
| verification_events.confidence_score | DB | NON-PII | not-personal-data | 2555 | Indian-only | Numeric. |
| verification_events.reference_id | DB | PII | legitimate-interest | 2555 | Indian-only | Tenant-supplied transaction reference; may be re-identifying. |
| verification_events.metadata | DB | PII | legitimate-interest | 2555 | Indian-only | JSONB; reviewed at PR time. |
| verification_events.occurred_at | DB | NON-PII | not-personal-data | 2555 | Indian-only | Timestamp. |
| verification_events.created_at | DB | NON-PII | not-personal-data | 2555 | Indian-only | Timestamp. |

### 3.8 `attendance_events` table

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| attendance_events.id | DB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. |
| attendance_events.tenant_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| attendance_events.environment | DB | NON-PII | not-personal-data | 2555 | Indian-only | `live`/`test`. |
| attendance_events.user_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK; UUID. |
| attendance_events.device_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| attendance_events.verification_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| attendance_events.event_type | DB | NON-PII | not-personal-data | 2555 | Indian-only | `check_in`/`check_out`. |
| attendance_events.result | DB | NON-PII | not-personal-data | 2555 | Indian-only | `accepted`/`rejected`. |
| attendance_events.metadata | DB | PII | legitimate-interest | 2555 | Indian-only | JSONB. |
| attendance_events.occurred_at | DB | NON-PII | not-personal-data | 2555 | Indian-only | Timestamp. |
| attendance_events.created_at | DB | NON-PII | not-personal-data | 2555 | Indian-only | Timestamp. |

### 3.9 `proof_pairing_sessions` table (W3, 5-minute TTL)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| proof_pairing_sessions.id | DB | NON-PII | not-personal-data | 30 | Indian-only | UUID; rows TTL-deleted by cleanup job. |
| proof_pairing_sessions.tenant_id | DB | NON-PII | not-personal-data | 30 | Indian-only | FK. |
| proof_pairing_sessions.environment | DB | NON-PII | not-personal-data | 30 | Indian-only | `live`/`test`. |
| proof_pairing_sessions.api_key_id | DB | NON-PII | not-personal-data | 30 | Indian-only | FK. |
| proof_pairing_sessions.nonce_hex | DB | NON-PII | not-personal-data | 30 | Indian-only | 31-byte random nonce. |
| proof_pairing_sessions.session_bind_token_hash | DB | SECRET | legitimate-interest | 30 | Indian-only | SHA-256 of session-bind cookie (A-13). |
| proof_pairing_sessions.state | DB | NON-PII | not-personal-data | 30 | Indian-only | Enum. |
| proof_pairing_sessions.consumed_user_id | DB | NON-PII | not-personal-data | 30 | Indian-only | FK; UUID. |
| proof_pairing_sessions.consumed_verification_id | DB | NON-PII | not-personal-data | 30 | Indian-only | FK. |
| proof_pairing_sessions.proof_hash | DB | NON-PII | not-personal-data | 30 | Indian-only | SHA-256 of submitted Groth16 proof bytes; for replay defence. |
| proof_pairing_sessions.last_error_code | DB | NON-PII | not-personal-data | 30 | Indian-only | Machine code. |
| proof_pairing_sessions.desktop_ip | DB | PII | legitimate-interest | 30 | Indian-only | IPv4/IPv6 of desktop client; abuse-defence signal. |
| proof_pairing_sessions.desktop_user_agent | DB | PII | legitimate-interest | 30 | Indian-only | UA string. |
| proof_pairing_sessions.failure_count | DB | NON-PII | not-personal-data | 30 | Indian-only | SMALLINT. |
| proof_pairing_sessions.expires_at | DB | NON-PII | not-personal-data | 30 | Indian-only | 5-min TTL. |
| proof_pairing_sessions.consumed_at | DB | NON-PII | not-personal-data | 30 | Indian-only | Timestamp. |
| proof_pairing_sessions.created_at | DB | NON-PII | not-personal-data | 30 | Indian-only | Timestamp. |

### 3.10 `audit_events` table (append-only, hash-chained per ADR 0013)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| audit_events.id | DB | NON-PII | not-personal-data | 2555 | Indian-only | BIGSERIAL. 7-year retention. |
| audit_events.tenant_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| audit_events.environment | DB | NON-PII | not-personal-data | 2555 | Indian-only | `live`/`test`. |
| audit_events.actor_type | DB | NON-PII | not-personal-data | 2555 | Indian-only | `api_key`/`console`/`device`/`system`. |
| audit_events.actor_id | DB | PII | legal-obligation | 2555 | Indian-only | UUID of api_key, console user, or device. |
| audit_events.action | DB | NON-PII | not-personal-data | 2555 | Indian-only | Verb (e.g. `verify`, `revoke_key`). |
| audit_events.entity_type | DB | NON-PII | not-personal-data | 2555 | Indian-only | Noun (e.g. `tenant_user`). |
| audit_events.entity_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. |
| audit_events.status | DB | NON-PII | not-personal-data | 2555 | Indian-only | `success`/`failure`. |
| audit_events.summary | DB | NON-PII | not-personal-data | 2555 | Indian-only | Short human string. Must not contain PII. |
| audit_events.metadata | DB | PII | legal-obligation | 2555 | Indian-only | JSONB; field-by-field rows below. |
| audit_events.metadata.did_sha256 | DB JSONB | OPAQUE-CRYPTOGRAPHIC | not-personal-data | 2555 | Indian-only | SHA-256 of DID; per §2(t) memo argument. |
| audit_events.metadata.actor_email | DB JSONB | PII | legal-obligation | 2555 | Indian-only | Console-user email when actor_type=console. |
| audit_events.metadata.ip_address | DB JSONB | PII | legal-obligation | 2555 | Indian-only | Source IPv4/IPv6. |
| audit_events.metadata.user_agent | DB JSONB | PII | legal-obligation | 2555 | Indian-only | UA string. |
| audit_events.metadata.requested_scope | DB JSONB | NON-PII | not-personal-data | 2555 | Indian-only | Free-form scope name. |
| audit_events.metadata.failure_reason | DB JSONB | NON-PII | not-personal-data | 2555 | Indian-only | Short machine code. |
| audit_events.metadata.verification_id | DB JSONB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. |
| audit_events.metadata.device_id | DB JSONB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. |
| audit_events.metadata.session_id | DB JSONB | NON-PII | not-personal-data | 2555 | Indian-only | UUID. |
| audit_events.previous_hash | DB | NON-PII | not-personal-data | 2555 | Indian-only | SHA-256 hash chain link (ADR 0013). |
| audit_events.event_hash | DB | NON-PII | not-personal-data | 2555 | Indian-only | SHA-256 of canonical event payload (ADR 0013). |
| audit_events.created_at | DB | NON-PII | not-personal-data | 2555 | Indian-only | Timestamp. |

### 3.11 `audit_anchors` table (Phase 1 C-016 backfill — anchored daily to Base Sepolia)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| audit_anchors.id | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | BIGSERIAL. |
| audit_anchors.tenant_id | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | FK. |
| audit_anchors.day | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | DATE of anchored window. |
| audit_anchors.terminal_hash | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | Final event_hash for the day. |
| audit_anchors.tx_hash | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | On-chain anchor transaction; Ethereum-format. |
| audit_anchors.block_number | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | L2 block. |
| audit_anchors.created_at | DB | NON-PII | not-personal-data | 2555 | shipped-out:Base Sepolia | Timestamp. |

**Cross-border note.** The anchor payload contains only `tenant_id` + `day` + `terminal_hash`. None of these identify a natural person; the §13 transfer-impact assessment in `dpdp-2t-commitments-memo-v0.md` §7 Q3 treats the on-chain anchor as a not-personal-data export under Argument-A.

### 3.12 `usage_logs` table (per-API-call billing log)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| usage_logs.id | DB | NON-PII | not-personal-data | 540 | Indian-only | BIGSERIAL. 18 months for billing. |
| usage_logs.tenant_id | DB | NON-PII | not-personal-data | 540 | Indian-only | FK. |
| usage_logs.api_key_id | DB | NON-PII | not-personal-data | 540 | Indian-only | FK. |
| usage_logs.endpoint | DB | NON-PII | not-personal-data | 540 | Indian-only | URL path only (no query string). |
| usage_logs.method | DB | NON-PII | not-personal-data | 540 | Indian-only | HTTP verb. |
| usage_logs.status_code | DB | NON-PII | not-personal-data | 540 | Indian-only | HTTP status. |
| usage_logs.response_time_ms | DB | NON-PII | not-personal-data | 540 | Indian-only | INT. |
| usage_logs.ip_address | DB | PII | legitimate-interest | 540 | Indian-only | Source IP. |
| usage_logs.user_agent | DB | PII | legitimate-interest | 540 | Indian-only | UA string. |
| usage_logs.created_at | DB | NON-PII | not-personal-data | 540 | Indian-only | Timestamp. |

### 3.13 `usage_monthly` table (billing roll-up)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| usage_monthly.id | DB | NON-PII | not-personal-data | 2555 | Indian-only | BIGSERIAL. |
| usage_monthly.tenant_id | DB | NON-PII | not-personal-data | 2555 | Indian-only | FK. |
| usage_monthly.month | DB | NON-PII | not-personal-data | 2555 | Indian-only | DATE. |
| usage_monthly.total_requests | DB | NON-PII | not-personal-data | 2555 | Indian-only | Counter. |
| usage_monthly.zkp_verifications | DB | NON-PII | not-personal-data | 2555 | Indian-only | Counter. |
| usage_monthly.zkp_registrations | DB | NON-PII | not-personal-data | 2555 | Indian-only | Counter. |
| usage_monthly.saml_auths | DB | NON-PII | not-personal-data | 2555 | Indian-only | Counter. |
| usage_monthly.oidc_auths | DB | NON-PII | not-personal-data | 2555 | Indian-only | Counter. |

### 3.14 On-device transient secrets

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| device.sha256_biometric_template | Customer-device RAM | TRANSIENT-SECRET | consent | 0 | Indian-only (never transmitted) | Computed on customer device during proof generation; consumed by fuzzy extractor; input buffer GC'd. Q6 in §2(t) memo asks counsel to confirm standard of care. |
| device.fuzzy_extractor_secret | Customer-device RAM | TRANSIENT-SECRET | consent | 0 | Indian-only (never transmitted) | Derived from biometric capture; never leaves the device. |
| device.poseidon_salt | Customer StrongBox-wrapped | SECRET | consent | -1 | Indian-only (never transmitted) | Per-user salt bound to hardware key; survives across sessions on the customer's device only. |

### 3.15 OPAQUE-CRYPTOGRAPHIC artefacts (commitments + DIDs)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| user.poseidon_commitment | Bank-tenant DB (per §2(t) memo) | OPAQUE-CRYPTOGRAPHIC | not-personal-data | -1 | Indian-only (Phase 0); may ship out per Q3 of §2(t) memo | Single Fr field element; hiding+binding under DL on BN128. |
| user.did | Bank-tenant DB | OPAQUE-CRYPTOGRAPHIC | not-personal-data | -1 | Indian-only (Phase 0); may ship out per Q3 of §2(t) memo | `did:zeroauth:<40 hex>`. Leading 20 bytes of keccak256(commitment). |
| user.did_sha256 | audit_events.metadata.did_sha256 | OPAQUE-CRYPTOGRAPHIC | not-personal-data | 2555 | Indian-only | Used in audit metadata (A-22 mitigation) to avoid raw DID in audit rows. |
| onchain.tx_hash | Base Sepolia / Base mainnet | NON-PII | not-personal-data | -1 | shipped-out:Base L2 | Public Ethereum-format transaction hash. |
| onchain.commitment_anchor | Base Sepolia DIDRegistry | OPAQUE-CRYPTOGRAPHIC | not-personal-data | -1 | shipped-out:Base L2 | Commitment value emitted as on-chain event (no PII). |

### 3.16 Winston log fields (structured-JSON application logs)

The Winston logger lives in `src/services/logger.ts`; the request logger in `src/services/usage.ts` and error logger in `src/middleware/error-handler.ts`. Body content is **not** logged. The fields below could carry PII if a future change is not reviewed; the inventory captures the risk per field.

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| winston.timestamp | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry (scrubbed) on error path only | ISO-8601. |
| winston.level | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | `info`/`warn`/`error`. |
| winston.message | Winston log | NON-PII (could carry PII if developer is careless) | legitimate-interest | 90 | shipped-out:Sentry | Reviewed at PR time. |
| winston.requestId | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | UUID per request. |
| winston.path | Winston log | NON-PII (could carry PII if a path embeds an identifier) | legitimate-interest | 90 | shipped-out:Sentry | URL path; query string omitted. |
| winston.tenantId | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | UUID. |
| winston.apiKeyId | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | UUID. |
| winston.statusCode | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | HTTP status. |
| winston.responseTimeMs | Winston log | NON-PII | not-personal-data | 90 | shipped-out:Sentry | Numeric. |
| winston.error.stack | Winston log | NON-PII (could carry PII in error context) | legitimate-interest | 90 | shipped-out:Sentry | Reviewed at PR time; Sentry beforeSend scrubber strips known PII keys. |

### 3.17 Caddy access-log fields (reverse-proxy edge log)

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| caddy.ts | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | Timestamp. |
| caddy.remote_ip | Caddy access log | PII | legitimate-interest | 90 | Indian-only | Source IP; retained for abuse defence. |
| caddy.method | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | HTTP verb. |
| caddy.url | Caddy access log | PII | legitimate-interest | 90 | Indian-only | Path; query string stripped on `/api/console/*` per C-005 closure (A-28). |
| caddy.user_agent | Caddy access log | PII | legitimate-interest | 90 | Indian-only | UA string. |
| caddy.status | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | HTTP status. |
| caddy.size | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | Bytes returned. |
| caddy.duration | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | Numeric. |
| caddy.request_id | Caddy access log | NON-PII | not-personal-data | 90 | Indian-only | UUID. |

### 3.18 Caches and ephemeral surfaces

| Element name | Source surface | Classification | Lawful basis | Retention (days) | Cross-border | Notes |
|---|---|---|---|---|---|---|
| session-store.tenantContext | In-memory cache | NON-PII | not-personal-data | 0 | Indian-only | Per-request; never persisted. |
| rate-limiter.bucket | In-memory cache | NON-PII | not-personal-data | 0 | Indian-only | Per IP + tenant; 15-min sliding window. |
| jwt.signing_secret | env var → process memory | SECRET | legitimate-interest | -1 | Indian-only | HS256 secret; rotated quarterly. |
| cookie.zeroauth_console_jwt | Browser cookie (HttpOnly, SameSite=Strict) | SECRET | legitimate-interest | -1 | Indian-only | Console session JWT; A-28 closure. |

---

## 4. Cross-references to threat-model rows

The following threat-model rows in `docs/threat_model.md` reference this inventory:

- **A-15** (Camera spoofing) — references session_bind_token_hash + nonce_hex in `proof_pairing_sessions`.
- **A-22** (PII in pairing logs and responses) — references audit_events.metadata.did_sha256 (in lieu of raw did) and the `desktop_ip` / `desktop_user_agent` columns.
- **A-27** (Demo-DID prover bypass, CLOSED) — references the `did` field on the prover submit body, which is no longer privileged by prefix.
- **A-28** (JWT-in-URL log leak, CLOSED) — references `caddy.url` (the closure removed the query-string fallback that put JWTs into this field).

---

## 5. Open inventory questions

The following questions are referred forward to PIA-current-state (Agent #39's A39-W2-Tue deliverable) and to counsel via the §2(t) memo's §7:

- **Q-INV-01.** Does `tenant_users.metadata` need a structural schema (JSON Schema, `migrations/`) to keep tenant-supplied PII out of free-form text? Owner: Agent #6 + Agent #39. Target: Phase 1 sprint 2.
- **Q-INV-02.** Is the 90-day Winston-log retention defensible for Sentry shipping, given Sentry's US-region tenancy? Counsel referred via §13 cross-border opinion (D-Q1-05 dependency).
- **Q-INV-03.** Does the `pending_signups` table need column-level encryption at rest, or is the 24-hour TTL sufficient mitigation? Owner: Agent #39 + Agent #6. Decision Phase 1 sprint 3.
- **Q-INV-04.** Should the `audit_events.metadata.actor_email` field be moved to a `did_sha256`-style hash to align with the rest of the metadata? Defers to Agent #41 (DPO) — the actor_email is operationally useful for incident response; the trade-off is captured in PIA-current-state.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #39 (Privacy) + Agent #41 (DPO)
