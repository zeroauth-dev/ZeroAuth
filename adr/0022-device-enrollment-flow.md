# ADR 0022 — Production device-enrollment flow

- **Status:** Accepted
- **Date:** 2026-05-28
- **Phase:** Phase 1 sprint 2 (enables the BFSI demo "fleet onboarding" scene)
- **Related:** ADR 0013 (audit chain — every state change writes a row), ADR 0017 (face-first identity), ADR 0021 (RS256 JWT)

## Context

Before this ADR, the dashboard's **Register device** flow asked the operator for a free-form *name* and inserted a row in `devices` with status `active`. The row had no hardware-bound identity — anybody with a console session could mint infinite "devices" that didn't physically exist; any device could claim to be any row at API time. The threat model row A-22 ("phantom device enrollment") was the original opener; the same gap powers a class of attendance-fraud scenarios in the BFSI demo runbook (Scene 5).

Three things were missing:

1. **A handshake.** Real production fleets bind a *physical* device to a *logical* row at some point in the lifecycle. The Tailscale, Slack, Cloudflare-Tunnel pattern is the prior art: admin issues a one-time code → device claims with the code + its hardware identity → server flips the row to *active* and remembers the binding. We had no equivalent.

2. **A per-device identity.** The `external_id` column was filled with a server-generated UUID (`device_<12hex>`); the device itself didn't supply anything. So even after registration, the row carried no information that could be used to *prove* the device on subsequent calls — credentials lived entirely in the tenant API key, which is shared across the fleet.

3. **A taxonomy.** All devices were treated as one shape: a row with a name. But the attestation story is wildly different for an Android phone (Play Integrity), an iOS phone (App Attest), a branch kiosk (none — it's behind a VPN), and an R307 fingerprint bridge over USB-OTG (signed firmware hash only). Without a type, every code-path either over-rotated or under-rotated on attestation expectations.

## Decision

Adopt a **two-step enrollment handshake** modeled on the prior art above. The dashboard creates a *pending slot* + mints a one-time enrollment code; the device claims the slot via a public endpoint, binding its hardware fingerprint. Three columns of state-machine work, four routes, and one new service module.

### State model

`devices.enrollment_state` (NEW, orthogonal to `devices.status`):

| State    | Meaning                                                                   |
|----------|---------------------------------------------------------------------------|
| pending  | Slot created by admin; enrollment code outstanding; no device bound yet.  |
| enrolled | Device has claimed the slot; `fingerprint_hash` is bound; row is usable.  |
| revoked  | Admin voided credentials. Row retained for audit-log entity_id stability. |

`devices.status` keeps its existing semantics (`active` / `inactive` / `retired`) — that's the *operational* state of an *already-enrolled* device. A device is `pending`+`active` between issue and claim (the slot exists), `enrolled`+`active` after claim, `enrolled`+`inactive` after a heartbeat-failure threshold, `revoked`+`retired` after admin termination.

### Enrollment code

The code is a human-typeable one-time secret. Format: `ZA-XXXX-XXXX`, 8 entropy chars from a 27-symbol Crockford-base32 alphabet (no `0`, `1`, `I`, `L`, `O`, `U`):

- Entropy: log2(27^8) ≈ **38 bits**.
- TTL: **15 minutes**.
- Per-IP rate-limit on `/v1/devices/enroll`: **10 req/min** (existing `pgRateLimit` middleware).
- Stored only as **SHA-256** (`enrollment_code_hash`). The plaintext is returned to the dashboard exactly once, never persisted.

Under those guards, an attacker has expected ~2^25 online attempts before landing a single collision in the 15-minute window — meaning the rate-limit halts them at ~2^25 / (10 × 15) ≈ ~225,000× the window length. The combination is conservatively secure for a code with this UX budget.

### Device fingerprint

The device-side `fingerprint` is opaque to the server — we SHA-256 it and store the hash. The plaintext format is device-type-specific:

| Device type        | Suggested fingerprint composition                                |
|--------------------|------------------------------------------------------------------|
| `mobile_android`   | `android_id` + Play Integrity package name + installation UUID  |
| `mobile_ios`       | `identifierForVendor` + App Attest `keyId`                       |
| `kiosk`            | kiosk serial number + primary MAC address                        |
| `iot_bridge`       | bridge UUID + USB serial of the R307 sensor                      |
| `desktop`          | WebAuthn credential `rawId` (Phase 2)                            |

Validator requires `fingerprint.length >= 16` so a misconfigured client can't bind by sending `"default"`.

### Attestation

V1 *records* the attestation kind (`play-integrity` | `app-attest` | `webauthn` | `none`) in `devices.attestation_kind`, and the raw attestation blob in `audit_events.metadata`. V1 does **not** verify the attestation. Verification routes through `src/services/play-integrity.ts` (already exists for proof-pairing) in Phase 1 sprint 4.

### Routes

| Method | Path                                                  | Auth                | Purpose                                  |
|--------|-------------------------------------------------------|---------------------|------------------------------------------|
| POST   | `/api/console/devices`                                | Console JWT         | Create pending slot, mint enrollment code |
| POST   | `/api/console/devices/:id/regenerate-code`            | Console JWT         | Re-issue code (voids prior)              |
| DELETE | `/api/console/devices/:id`                            | Console JWT         | Soft-revoke (state=revoked, status=retired) |
| POST   | `/v1/devices/enroll`                                  | None (code is bearer) | Device-side claim with code + fingerprint |
| POST   | `/v1/devices`                                         | Tenant API key      | Trusted-service direct create (legacy)   |

`/v1/devices/enroll` is in `tests/tenant-isolation.test.ts::PUBLIC_ROUTE_EXCEPTIONS` for the same reason `/v1/zkp/verify` and the pairing public endpoints are: the bearer credential rides the request body, not the headers.

### Audit-log surface

Five new actions, all routed through `appendAuditEvent` so they show up in the hash chain:

- `device.enrollment_code_issued` — slot created; metadata: device_type, location, expires_at (NOT the code or its hash).
- `device.enrollment_code_reissued` — operator pressed Re-issue; metadata: expires_at.
- `device.enrolled` — device claimed the slot; actor_type='device', metadata: attestation_kind, enroll_ip, user_agent.
- `device.revoked` — admin terminated; actor_type='console'.
- `device.created` — kept for the trusted-service `/v1/devices` path; metadata.via='trusted-service'.

### Backwards compatibility

- `POST /v1/devices` (tenant API key path) keeps direct-create semantics for the SDK/bulk-provisioning use case. It now also accepts an optional `device_type`; defaults to `kiosk`. The demo seed continues to work unchanged.
- Existing `devices` rows backfill `enrollment_state='enrolled'` and `device_type='kiosk'` at schema-bootstrap time (`ADD COLUMN IF NOT EXISTS … DEFAULT`).
- The dashboard's `PATCH /api/console/devices/:id` (mutates name, location, status, etc.) is unchanged.

## Alternatives considered

1. **Email/SMS enrollment links** — fine for individual users, wrong for kiosk/IoT-bridge fleets which often have no inbox. The code-on-screen ↔ code-entered-on-device pattern is the canonical IoT primitive.
2. **Pre-shared per-device API keys** — every device gets its own `za_live_*` at creation. Defers the rotation problem (you've moved the secret-management problem from "shared key" to "fleet of unique keys"). Also fails if the admin minted the key on the wrong device or the device got swapped.
3. **mTLS client certs** — better long-term posture (the cert IS the identity) but requires every device class to ship a PKCS#11 stack and own a private key in secure storage. Defers to Phase 2 after the WebAuthn desktop path is in.
4. **No state machine; just an `is_enrolled` boolean** — fails on the revoked case (we'd lose forensic traceability after delete). Two booleans are equivalent to the three-state machine but less self-documenting.

## Out of scope (deferred)

- **Per-device tokens.** After enrollment, the device should get a long-lived bearer credential (`device_token`) it presents on heartbeats and verifications. V1 returns the row only — the device infers its identity from `device.id`. The token + heartbeat protocol lands in Phase 1 sprint 4 alongside Play Integrity verification.
- **QR rendering in the dashboard.** V1 shows the plaintext code + a copyable `zeroauth://enroll?code=…` deeplink. QR rendering requires a new dependency (qrcode.js or similar); deferred to a follow-up commit with the dep-add ADR. The deeplink format is stable.
- **Bulk CSV pre-provisioning.** Admin uploads a CSV of names+types, server mints N pending slots, returns a CSV with codes. Deferred to Phase 2 when the first multi-branch BFSI tenant ships.
- **Geofence + IP allowlist on the enroll endpoint.** Some BFSI tenants will want enrollment locked to the bank's office IP range. Deferred — implementable as a per-tenant `enrollment_ip_allowlist` in `tenants.security_policy` JSON when the demand surfaces.

## Verification

- `tests/device-enrollment.test.ts` — 26 tests covering code generation, normalisation, fingerprint validation, the four service-layer functions, and the failure modes (invalid_fingerprint, code_not_found_or_expired, fingerprint_collision).
- `tests/console-proxy.test.ts` — request-level coverage of POST/PATCH/DELETE /api/console/devices and the device_type validation gate.
- `tests/tenant-isolation.test.ts` — `/v1/devices/enroll` listed in `PUBLIC_ROUTE_EXCEPTIONS` with a documented reason.
- The dashboard's `Devices.tsx` test surface is exercised via the integration build (no new component tests in V1; the visual flow is hard to unit-test for the QR/deeplink screen and the existing user/audit-integrity test patterns are the wrong shape for it).
