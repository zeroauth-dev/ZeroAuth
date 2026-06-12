# API contract — single source of truth

> v0 — May 12, 2026. Every endpoint in the running service is listed here.
> Before adding, changing, or removing an endpoint, **update this file
> first** (DP1 — spec before code). The reviewer expects the diff in this
> file to land in the same PR as the implementation diff.
>
> Error shape conventions and per-error codes live in
> [`docs/error_codes.md`](error_codes.md).

## Conventions

- All responses are `application/json` unless explicitly noted (`metadata.xml`, `application/pdf`).
- All write endpoints return `201 Created` with the new resource at the top level (e.g. `{ "device": {...} }`).
- All list endpoints return `200 OK` with the collection plus the resolved `environment` (e.g. `{ "devices": [...], "environment": "live" }`).
- All errors return `4xx` or `5xx` with `{ "error": "<machine_code>", "message": "<human>" }`.
- Rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are present on every authenticated `/v1/*` response.
- Tenant + environment headers (`X-ZeroAuth-Tenant`, `X-ZeroAuth-Plan`) are present on every authenticated `/v1/*` response.
- All `/v1/*` endpoints accept the API key via `Authorization: Bearer za_…` or `X-API-Key: za_…`. Format: `za_(live|test)_<48 hex chars>`.

## Authentication tiers

| Tier | Header | Used by |
|---|---|---|
| Tenant API key | `Authorization: Bearer za_…` | `/v1/*` |
| Console JWT (24h) | `Authorization: Bearer eyJ…` (issued by `/api/console/login`) | `/api/console/keys`, `/api/console/usage`, `/api/console/account`, `/api/console/overview`, `/api/console/audit` |
| Admin static key | `X-API-Key: <ADMIN_API_KEY>` | `/api/admin/*`, `GET /api/leads` |
| Unauthenticated | — | `/api/health`, `/`, `/docs/*`, `/dashboard/*`, `POST /api/leads/pilot`, `POST /api/leads/whitepaper`, `POST /api/console/signup`, `POST /api/console/login` |

## Endpoints

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service + blockchain + ZKP + Poseidon subsystem status. Public. |

### Developer console (`/api/console/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/console/signup` | none | Create a tenant + first live API key. Per-IP rate limit (10 / 15 min). Password policy: ≥12 chars, letter + digit, denylist. |
| `POST` | `/api/console/login` | none | Exchange email + password for a 24h console JWT. Per-IP rate limit. |
| `GET` | `/api/console/keys` | console JWT | List API keys for the authenticated tenant. |
| `POST` | `/api/console/keys` | console JWT | Create a new API key (max 10 active per tenant). Returns the raw key once. |
| `DELETE` | `/api/console/keys/:keyId` | console JWT | Revoke an API key. Irreversible. |
| `GET` | `/api/console/usage` | console JWT | Per-tenant rate limit, monthly quota, history, recent calls. |
| `GET` | `/api/console/account` | console JWT | Plan, status, limits, account metadata. |
| `GET` | `/api/console/overview` | console JWT | Counts + 10 most-recent rows per stream (devices, users, verifications, attendance, audit). `?environment=live|test`. |
| `GET` | `/api/console/audit` | console JWT | Filterable business audit events. `?environment=live|test`, `?action=…`, `?status=success\|failure`, `?limit=…`. |

### Central API — devices (`/v1/devices`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/devices` | `devices:write` | **Trusted-service path.** Register a device row in `enrolled` state directly (used by SDK-led bulk provisioning + demo seed scripts). Body: `{ name, deviceType?, externalId?, locationId?, batteryLevel?, metadata? }`. `deviceType` ∈ `mobile_android,mobile_ios,kiosk,iot_bridge,desktop` (defaults to `kiosk`). |
| `POST` | `/v1/devices/enroll` | **none (code is bearer)** | **Device-side claim.** Exchange a one-time enrollment code (minted by the dashboard) for an enrolled row. Body: `{ enrollment_code, fingerprint, attestation_kind? }`. Rate-limited to 10 req/min per IP. Returns `{ device }` on success, uniform 404 `enrollment_failed` on any failure mode (unknown code, expired code, invalid fingerprint, fingerprint collision). See [ADR 0022](../adr/0022-device-enrollment-flow.md). |
| `GET` | `/v1/devices` | `devices:read` | List devices for the tenant's environment. `?status=active\|inactive\|retired`, `?limit=…` (≤100). |
| `PATCH` | `/v1/devices/:deviceId` | `devices:write` | Mutate name, locationId, batteryLevel, status, metadata, lastSeenAt. |

Console-side device endpoints (require console JWT):

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/console/devices` | List devices. `?status=…`, `?enrollment_state=pending\|enrolled\|revoked`, `?limit=…`. |
| `POST` | `/api/console/devices` | **Mint a pending slot + enrollment code.** Body: `{ name, deviceType, locationId?, metadata? }`. Returns `{ device, enrollment: { code, expires_at, deeplink } }`. The plaintext code is returned exactly once — server keeps only its SHA-256. Code TTL is 15 minutes. |
| `POST` | `/api/console/devices/:id/regenerate-code` | Re-issue the enrollment code (voids the prior one). Same response shape as POST. |
| `PATCH` | `/api/console/devices/:id` | Mutate name/location/status/etc. |
| `DELETE` | `/api/console/devices/:id` | Soft-revoke (sets `enrollment_state='revoked'`, `status='retired'`). Row retained for audit. |

Enrollment code format: `ZA-XXXX-XXXX`, 8 entropy chars from a 27-symbol Crockford-base32 alphabet (no `0`, `1`, `I`, `L`, `O`, `U`). The deeplink format is `zeroauth://enroll?code=<code>` and is stable across V1.

### Central API — end-user registration ceremony (`/v1/registrations`)

The three-QR end-user signup flow. See [ADR 0023](../adr/0023-three-qr-signup-ceremony.md) for design + state machine + threat-model deltas. The biometric never touches the server side; only the Poseidon commitment (step 2) and the Groth16 proof (step 3) do.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/registrations` | `users:write` | Open a session. Body: `{ profile?: object }`. Returns `{ session, pair: { code, expires_at, deeplink } }`. Render `pair.deeplink` as QR1. |
| `GET` | `/v1/registrations/:id` | `users:read` | Poll state. Response redacts all code hashes + challenge nonce. |
| `DELETE` | `/v1/registrations/:id` | `users:write` | Abandon (idempotent). Voids outstanding codes; row retained for audit. |
| `POST` | `/v1/registrations/pair-device` | **none — `pair_code` is bearer** | Step 1. Body: `{ pair_code, fingerprint, attestation_kind? }`. Phone scans QR1. Server claims a device row (reuses ADR 0022 fingerprint binding), attaches to session, mints `enroll_code` for step 2. Returns `{ session_id, device_id, next: { step: 'enroll', code, expires_at, deeplink } }`. |
| `POST` | `/v1/registrations/submit-commitment` | **none — `enroll_code` is bearer** | Step 2. Body: `{ enroll_code, did, commitment, attestation_kind? }`. Phone scans QR2 after capturing biometric locally. Server stores (did, commitment), mints `verify_code` + `challenge_nonce` for step 3. Returns `{ session_id, next: { step: 'verify', code, expires_at, deeplink, challenge_nonce } }`. |
| `POST` | `/v1/registrations/complete` | **none — `verify_code` is bearer** | Step 3. Body: `{ verify_code, challenge_nonce, proof, public_signals }`. Phone scans QR3, re-captures biometric, produces Groth16 proof. Server asserts `challenge_nonce` matches, asserts `publicSignals[0]` equals stored commitment, verifies proof off-chain, creates `tenant_user`. Returns `{ session_id, tenant_user, device }`. |

State machine: `awaiting_device → awaiting_commitment → awaiting_verification → completed` (or `abandoned`). Whole-session TTL is 30 min; each code's TTL is 15 min. Phone-side endpoints are rate-limited at 20 req/min per IP via `pgRateLimit`.

Failure-mode surface (uniform envelopes to defeat enumeration):

| Code | When |
|---|---|
| `400 invalid_request` | Required field missing or malformed at the JSON layer. |
| `404 pair_failed` | Step 1: unknown / expired pair_code, invalid fingerprint, session expired. |
| `404 enroll_failed` | Step 2: unknown / expired enroll_code, wrong session state. |
| `404 verify_failed` | Step 3: unknown / expired verify_code, challenge mismatch, commitment mismatch, proof verification failed. |
| `404 session_not_found` | Tenant poll: id does not exist in this tenant/environment. |
| `429` | Phone-side rate-limit (20/min/IP) exceeded. |

The deeplink schema is `zeroauth://reg?step=<pair|enroll|verify>&session=<uuid>&code=<code>[&challenge=<hex>]` and is stable across V1.

### Central API — users (`/v1/users`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/users` | `users:write` | Enroll a tenant user. Body: `{ fullName, externalId?, email?, phone?, employeeCode?, primaryDeviceId?, metadata? }`. No biometric template ever accepted. |
| `GET` | `/v1/users` | `users:read` | List enrolled users. `?status=active\|inactive`, `?limit=…`. |
| `PATCH` | `/v1/users/:userId` | `users:write` | Mutate user metadata. |

### Central API — verifications (`/v1/verifications`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/verifications` | `verifications:write` | Record a verification event. Body: `{ method, result, userId?, deviceId?, reason?, confidenceScore?, referenceId?, metadata?, occurredAt? }`. `method` ∈ `zkp,fingerprint,face,depth,saml,oidc,manual`. `result` ∈ `pass,fail,challenge`. |
| `GET` | `/v1/verifications` | `verifications:read` | List events. `?method=…`, `?result=…`, `?limit=…`. |

### Central API — attendance (`/v1/attendance`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/attendance` | `attendance:write` | Record check-in/out. Body: `{ userId, type, deviceId?, verificationId?, result?, metadata?, occurredAt? }`. `type` ∈ `check_in,check_out`. `result` ∈ `accepted,rejected`. |
| `GET` | `/v1/attendance` | `attendance:read` | `?type=…`, `?result=…`, `?limit=…`. |

### Attendance bridge (`/api/attendance/*`)

Face-first office attendance from the employee's own phone (slice 1). The phone holds no tenant API key, so — like `/api/demo-portal/*` — this is a public same-process bridge that attaches the company tenant internally and reuses the production proof-pairing verifier. Slice 1 reuses the demo-portal tenant as the single seeded company ("Anchor Corp"); any registered user is treated as an employee. Per-company HR provisioning is a later slice.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/attendance/company` | none | WiFi-anchor config for the phone: `{ company: { name, location, wifi: { ssidLabel, bssids, minSignalPercent } } }`. |
| `POST` | `/api/attendance/init` | none | Opens a proof-pairing session. Returns `{ sessionId, nonce, expiresAt, company }`. The bind token is held server-side; the phone only sees the session id + nonce. |
| `POST` | `/api/attendance/record` | none (session-bound) | Body: `{ sessionId, type, did, proof, publicSignals, wifi: { bssid, signal }, clientMeta? }`. `type` ∈ `check_in,check_out`. Verifies the proof via the proof-pairing path, strictly re-checks the WiFi anchor server-side, then records an `attendance_events` row. `201 { ok, type, result, occurredAt }` on success; `403 outside_anchor` (plus a `rejected` row) when the BSSID/signal fails the anchor; proof failures surface the proof-pairing codes (`401 pairing_proof_invalid`, `400 pairing_did_unknown`, …); `410 attendance_session_expired` on a replayed or expired session. |
| `POST` | `/api/attendance/claim` | none (nonce + invite) | The employee's phone claims an HR-provisioned membership. It first calls `/init` (with `companyId`) for a session nonce, binds the face proof to it, then submits `{ companyId, sessionId, inviteCode, did, commitment, proof, publicSignals }`. The server enforces the **nonce binding** (`publicSignals[1] = Poseidon(Poseidon(commitment), nonce)`) + commitment match + Groth16 verify (same path as check-in), then binds the DID, creates/links a `tenant_user`, and consumes the single-use invite **and** session. `200 { ok, companyId, employee }`; `410 invite_not_found_or_expired` / `attendance_session_expired`; `401 proof_verification_failed` / `pairing_proof_invalid`; `400 commitment_mismatch` / `pairing_nonce_mismatch`; `404 company_not_found`. |

`company`, `init`, and `record` accept an optional **`companyId`**: a real `attendance_companies` row uses that company's tenant + DB-stored WiFi anchor and gates `record` on a **claimed membership** (`403 not_a_member` otherwise); with no `companyId` the bridge serves the seeded demo company (any registered user — slice-1 back-compat).

There is intentionally **no** did-keyed status read — a public endpoint mapping a (public) DID to a person's live in/out state would be a presence-enumeration oracle. The phone renders Home from its own locally-tracked last action; the server stays the auditable source of truth. An authenticated status read lands with the slice-2 per-employee session. The bridge is per-IP rate-limited (60/min).

No biometric, image, or location trail crosses the wire — only the Groth16 proof + a WiFi-presence boolean (BSSID + signal %). Identity verification is byte-identical to `/v1/proof-pairing` (Poseidon nonce binding, commitment match, Groth16 verify, single-use consume); attendance adds the server-side WiFi re-check + the event write (which carries its own audit hash-chain row).

### HR admin portal (`/api/hr/*`)

The standalone attendance admin portal (slice 3). Auth: the `zeroauth-hr-admin` JWT (Bearer or HttpOnly `zeroauth_hr_jwt` cookie, path-scoped `/api/hr`) — a distinct issuer/audience so it is **never** accepted on `/v1` or `/api/console`. Each HR admin is bound to one tenant (= one company); every query is tenant-scoped.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/hr/signup` | none | Create a company tenant + HR admin + default company. Body `{ email, password, companyName, location? }`. Sets the cookie. `409 email_taken`. |
| `POST` | `/api/hr/login` | none | `{ email, password }` → mint the HR session. `401 invalid_credentials`. |
| `POST` | `/api/hr/logout` | cookie | Clear the cookie. |
| `GET` | `/api/hr/account` | HR JWT | The admin + their company. |
| `GET`/`POST` | `/api/hr/company` | HR JWT | Read / update the WiFi presence anchor (`{ ssidLabel, bssids[], minSignalPercent, location? }`). |
| `GET` | `/api/hr/employees` | HR JWT | Roster (status ∈ `invited,claimed,revoked`). |
| `POST` | `/api/hr/employees` | HR JWT | Provision `{ employeeId, fullName, department?, email? }` → returns a single-use invite `{ code, deeplink: zeroauth://emp-claim?company=…&code=…, expiresAt }`. |
| `PATCH` | `/api/hr/employees/:id` | HR JWT | `{ status: revoked\|invited }`. |
| `GET` | `/api/hr/attendance` | HR JWT | Attendance board (events joined to employee names) + summary. |
| `GET` | `/api/hr/attendance/export` | HR JWT | CSV. |

### Central API — audit (`/v1/audit`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/v1/audit` | `audit:read` | Read-only business audit log. `?action=…`, `?status=success\|failure`, `?limit=…`. |

### Identity + ZKP (`/v1/auth/zkp/*`, `/v1/identity/*`)

ADR 0017 introduced the face-first identity surface at `/v1/identity/register` + `/v1/identity/verify`. These are the **production** integration points; the `/v1/auth/zkp/*` endpoints are retained for backward compat with the W3 demo client and are deprecated for new integrations.

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/identity/register` | `zkp:register` | **Face-first register.** Accepts the on-device-computed `(did, commitment)` tuple. No biometric template ever crosses the wire. Optional `externalId` + `attestation` fields. Returns `201 { userId, did, commitment, createdAt }`. Conflicts: `409 did_already_registered`. |
| `POST` | `/v1/identity/verify` | `zkp:verify` | **Face-first verify.** Accepts `{ did, proof, publicSignals, nonce, timestamp }`. Looks up user by DID, asserts `publicSignals[0]` matches the stored commitment, runs snarkjs.groth16.verify against the boot-pinned vkey. On success returns 200 with `accessToken / refreshToken / sessionId / did`. Uniform `401 verification_failed` for did_unknown, commitment_mismatch, proof_invalid (enumeration defence). |
| `GET` | `/v1/identity/me` | `identity:read` | User profile from a session JWT (passed via `X-Session-Token`). |
| `POST` | `/v1/identity/logout` | `identity:read` | Invalidate a session. |
| `POST` | `/v1/identity/refresh` | `identity:read` | Refresh-token → new access token. |
| `POST` | `/v1/auth/zkp/register` | `zkp:register` | **DEPRECATED.** Accepts a base64 `biometricTemplate`. Computes commitment server-side and registers. Retained for the W3 demo client + existing fixtures. New integrations MUST use `/v1/identity/register` per ADR 0017. |
| `POST` | `/v1/auth/zkp/verify` | `zkp:verify` | **DEPRECATED for new integrations.** Verifies a Groth16 proof without a DID lookup. Use `/v1/identity/verify` which adds the commitment-vs-DID match check before running snarkjs. |
| `GET` | `/v1/auth/zkp/nonce` | `nonce:create` | Fresh nonce, 5-minute lifetime. |
| `GET` | `/v1/auth/zkp/circuit-info` | `zkp:verify` | Circuit metadata for client SDKs. |

### SAML + OIDC (`/v1/auth/saml/*`, `/v1/auth/oidc/*`)

These endpoints are gated by `ENABLE_DEMO_AUTH` and currently simulate the assertion exchange — they are **not** production-quality SAML / OIDC. See A-03, A-04 in [`threat_model.md`](threat_model.md). Full implementations will land via `@node-saml/node-saml` and `openid-client` and the route signatures will not change.

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/v1/auth/saml/login` | `saml:login` | Returns the IdP redirect URL. |
| `POST` | `/v1/auth/saml/callback` | `saml:callback` | SAML assertion → session JWT. |
| `GET` | `/v1/auth/saml/metadata` | `saml:login` | SP metadata XML. |
| `GET` | `/v1/auth/oidc/authorize` | `oidc:authorize` | OIDC `/authorize` redirect URL with PKCE. |
| `POST` | `/v1/auth/oidc/callback` | `oidc:callback` | Code → session JWT. |

### Admin (`/api/admin/*`)

All require `X-API-Key: <ADMIN_API_KEY>`. Read-only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | In-process counters + blockchain identity count. |
| `GET` | `/api/admin/blockchain` | Live RPC info, contract addresses, deployer address. |
| `GET` | `/api/admin/privacy-audit` | Zero-storage attestation. |
| `GET` | `/api/leads` | All marketing leads. `?type=pilot\|whitepaper`. |

### Marketing (`/api/leads/*`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/leads/pilot` | none | Pilot-access form: `{ name, company, email, size }`. |
| `POST` | `/api/leads/whitepaper` | none | Whitepaper download form: `{ email }`. Response includes `downloadUrl`. |

### Proof pairing (`/v1/proof-pairing/*`)

Cross-device verification flow: a desktop opens a session, a phone scans the QR + generates a Groth16 proof, the desktop submits the proof, the backend mints a desktop JWT. Full protocol in [ADR-0009](https://github.com/zeroauth-dev/ZeroAuth/blob/main/adr/0009-qr-proof-pairing-protocol.md).

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/proof-pairing/sessions` | `proof_pairing:create` | Desktop opens a session. Server returns `{ id, nonce, expiresAt, qrPayload, streamUrl }` and sets a `session_bind` cookie on the response. |
| `POST` | `/v1/proof-pairing/sessions/:id/submit` | `proof_pairing:claim` | Desktop submits the proof + public signals it scanned from the phone. Body: `{ did, proof, publicSignals, clientMeta? }`. Returns `{ session, tokens }`. |
| `GET` | `/v1/proof-pairing/sessions/:id/stream` | `proof_pairing:create` + `session_bind` cookie | Server-Sent Events. Events: `session_created`, `session_bound`, `session_expired`, `session_error`. Connection closes after a terminal event. |
| `GET` | `/v1/proof-pairing/sessions/:id` | `proof_pairing:create` + `session_bind` cookie | Polling fallback for clients without `EventSource`. |
| `GET` | `/v1/proof-pairing/sessions/:id/public` | none (per-IP rate-limited 30/min) | Unauthenticated freshness read. Returns only `{ id, state, expiresAt }` so the Android app can short-circuit a ceremony after a stale QR was scanned. Uniform `404 pairing_session_not_found` for every rejection class (A-25). Cache-Control: no-store. |

`POST /sessions` response (also sets `Set-Cookie: zeroauth_pair_bind=…; HttpOnly; Secure; SameSite=Strict; Path=/v1/proof-pairing/; Max-Age=300`):
```json
{
  "session": {
    "id": "9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1",
    "nonce": "<62-hex-char 31-byte nonce>",
    "expiresAt": "2026-05-25T14:35:00.000Z",
    "qrPayload": "za:pair:1:9f8e2a4b…:9f7c1d4a…:zeroauth.dev:5b3e",
    "streamUrl": "/v1/proof-pairing/sessions/9f8e2a4b…/stream",
    "state": "issued"
  }
}
```

`POST .../submit` body:
```json
{
  "did": "did:zeroauth:demo:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b",
  "proof": { "pi_a":[…], "pi_b":[…], "pi_c":[…], "protocol":"groth16", "curve":"bn128" },
  "publicSignals": ["<commitment>", "<didHashSession>", "<identityBinding>"],
  "clientMeta": { "appVersion": "0.1.0", "platform": "android", "model": "Pixel 7a", "proofMs": 4820, "playIntegrityVerdict": "MEETS_STRONG_INTEGRITY", "rawScan": "za:proof:1:<base64url-of-gzip-cbor>" }
}
```

**`clientMeta.rawScan` short-key schema.** The Android app encodes the proof QR as `gzip(cbor({ s, p, ps, d, m }))` to fit under the 1500-byte QR-capacity ceiling (ADR-0009 §5). The desktop relays the raw scan string into `clientMeta.rawScan` unchanged; backend audit + analytics decoders need to know the field-shortening map:

| Short key | Long key in this contract | Type |
|---|---|---|
| `s` | `session.id` | string (UUIDv4) |
| `p` | `proof` | `{ a, b, c, protocol, curve }` (same shape, also short-keyed: `a` = `pi_a`, `b` = `pi_b`, `c` = `pi_c`) |
| `ps` | `publicSignals` | string[3] (`[commitment, didHashSession, identityBinding]`) |
| `d` | `did` | string |
| `m` | `clientMeta` | `{ av, pl, md, ms, pi }` where `av` = `appVersion`, `pl` = `platform`, `md` = `model`, `ms` = `proofMs`, `pi` = `playIntegrityVerdict` |

Decoded forms are byte-equal to the long-keyed JSON above; the desktop's submit handler reconstructs the long-keyed body before posting if it needs to call `/submit` itself, so server-side handlers can rely on the documented long-keyed shape and treat `clientMeta.rawScan` as an opaque audit token.

`POST .../submit` success — `200 OK`:
```json
{
  "session": { "id": "9f8e2a4b…", "state": "bound", "boundAt": "…", "userId": "…", "did": "…" },
  "tokens": { "accessToken": "eyJ…", "refreshToken": "eyJ…", "tokenType": "Bearer", "expiresIn": 3600 }
}
```

SSE event shapes on `/stream`:
```
event: session_created
data: {"id":"9f8e2a4b…","state":"issued","expiresAt":"…"}

event: session_bound
data: {"id":"…","state":"bound","userId":"…","did":"…","tokens":{…}}

event: session_expired
data: {"id":"…","state":"expired"}

event: session_error
data: {"id":"…","error":"pairing_nonce_mismatch","message":"…"}
```

Error variants on `/submit` (all return `{ "error": "<code>", "message": "<human>" }`): see [`docs/error_codes.md`](error_codes.md) under "Proof pairing".

#### Tenant policy

Per-tenant security knobs live in the `tenants.security_policy` JSONB column. The current consumer is the Play Integrity verdict gate on `/submit`. All fields are optional; absent = permissive default (any verdict accepted, including absent).

```json
{
  "require_strong_integrity": false,
  "require_device_integrity": false,
  "require_basic_integrity": false,
  "allow_play_integrity_absent": false
}
```

Rank order (highest wins when multiple flags set): `require_strong_integrity` (rank 4) > `require_device_integrity` (rank 3) > `require_basic_integrity` (rank 2). Demo tenants ship with `{}`. BFSI / regulated tenants flip `require_strong_integrity: true` and `allow_play_integrity_absent: false`.

Failure modes:
- Verdict absent + policy requires one + `allow_play_integrity_absent` false → `400 play_integrity_required`.
- Verdict rank < required rank → `401 play_integrity_insufficient`.
- Both write an `audit_events` row with action `pairing.integrity_rejected` carrying the presented verdict + the policy snapshot (no PII; never `did`).

### Legacy `/api/auth/*` surface

These exist for backwards compatibility with internal tooling that pre-dates the `/v1/*` rollout. The legacy SAML and OIDC callbacks are gated by `ENABLE_DEMO_AUTH` for the same reason as their `/v1/*` counterparts. Document but plan to deprecate.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/auth/me` | Current user from session JWT. |
| `POST` | `/api/auth/refresh` | Refresh tokens. |
| `POST` | `/api/auth/logout` | Invalidate a session. |
| `POST` | `/api/auth/zkp/register` | Register identity. Same shape as `/v1/auth/zkp/register` minus tenant scoping. |
| `POST` | `/api/auth/zkp/verify` | Verify proof. |
| `GET` | `/api/auth/zkp/nonce` | Fresh nonce. |
| `GET` | `/api/auth/zkp/circuit-info` | Circuit metadata. |
| `GET` | `/api/auth/saml/login` | SAML login, demo-gated. |
| `POST` | `/api/auth/saml/callback` | SAML callback, demo-gated. |
| `GET` | `/api/auth/saml/metadata` | SP metadata XML. |
| `GET` | `/api/auth/oidc/authorize` | OIDC authorize, demo-gated. |
| `POST` | `/api/auth/oidc/callback` | OIDC callback, demo-gated. |
| `GET` | `/api/auth/oidc/.well-known/openid-configuration` | OIDC discovery document. **Note:** `jwks_uri` is intentionally absent (HS256-only today). |

---
LAST_UPDATED: 2026-05-22
OWNER: Pulkit Pareek
