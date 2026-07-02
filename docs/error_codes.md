# Error codes

> v0 — May 12, 2026. Every error response from the API uses the shape
> `{ "error": "<machine_code>", "message": "<human readable>" }` plus an
> appropriate HTTP status. The machine code is stable across releases;
> the human message can change for clarity.
>
> When a new error is added, append it here in the matching section.

## Shape

```json
{
  "error": "invalid_api_key",
  "message": "API key is invalid, expired, or revoked."
}
```

Some responses carry extra fields (`docs`, `retryAfterSeconds`, `currentScopes`, `upgradeUrl`, `plan`). Those are documented per code below.

## Auth (`401 Unauthorized`)

| Code | When |
|---|---|
| `missing_api_key` | No `Authorization: Bearer za_…` or `X-API-Key:` header. |
| `invalid_api_key_format` | Header present but not `za_(live\|test)_<48 hex>`. |
| `invalid_api_key` | Key hashed and matched against `api_keys.key_hash`, but row is missing, revoked, or expired. |
| `unauthorized` | Console endpoint hit without a JWT. |
| `session_expired` | Console JWT failed verification. |
| `invalid_credentials` | `/api/console/login` — email + password don't match an active tenant. |
| `invalid_session_token` | `/v1/identity/me` — session JWT failed verification. |

## Authorization (`403 Forbidden`)

| Code | When |
|---|---|
| `insufficient_scopes` | API key valid but doesn't carry all required scopes. Response includes `currentScopes: string[]`. |
| `tenant_inactive` | API key valid, but tenant `status != 'active'`. |
| `Invalid admin API key` | Admin endpoints hit with wrong `X-API-Key`. (Legacy string; will move to a machine code in v1.) |

## Validation (`400 Bad Request`)

| Code | When |
|---|---|
| `invalid_request` | Generic catch — body / params shape is wrong. `message` describes the field. |
| `invalid_password` | `/api/console/signup` — password too short, missing letter/digit, or in the common-password denylist. |
| `invalid_status_filter` / `invalid_status` | Query param or body field outside the allowed enum (devices, users, attendance, audit). |
| `invalid_method` / `invalid_method_filter` | `/v1/verifications` — `method` outside `zkp,fingerprint,face,depth,saml,oidc,manual`. |
| `invalid_result` / `invalid_result_filter` | `/v1/verifications` / `/v1/attendance` — `result` outside the allowed enum. |
| `invalid_type` / `invalid_type_filter` | `/v1/attendance` — `type` outside `check_in,check_out`. |
| `invalid_battery_level` | `/v1/devices` — `batteryLevel` not an integer in [0, 100]. |

## Conflict (`409 Conflict`)

| Code | When |
|---|---|
| `email_taken` | `/api/console/signup` — email already exists. |
| `user_external_id_taken` | `/v1/users` POST — `externalId` already used for this tenant+environment. |
| `device_external_id_taken` | `/v1/devices` POST — `externalId` already used. |

## Not found (`404 Not Found`)

| Code | When |
|---|---|
| `device_not_found` | `/v1/devices/:id` PATCH, or referenced from a verification/attendance. |
| `user_not_found` | `/v1/users/:id` PATCH, or referenced from an attendance. |
| `dependency_not_found` | `/v1/verifications` or `/v1/attendance` POST — a referenced user/device/verification doesn't exist for this tenant. |

## Rate / quota (`429 Too Many Requests`)

| Code | When |
|---|---|
| `rate_limit_exceeded` | Tenant exceeded its sliding-window rate. Response includes `plan`, `retryAfterSeconds`, `upgradeUrl`. |
| `monthly_quota_exceeded` | Tenant exceeded its monthly quota. Response includes `plan`, `used`, `limit`, `upgradeUrl`. |
| `too_many_attempts` | `/api/console/signup` or `/login` — per-IP limit (10 / 15 min) tripped. |
| `key_limit_reached` | `/api/console/keys` POST — max 10 active keys per tenant. |

## Server error (`500 Internal Server Error`)

| Code | When |
|---|---|
| `signup_failed` | Database insert failed. Detailed error logged via Winston; generic message returned to the client. |
| `login_failed` | Tenant lookup or password verification threw. |
| `registration_failed` | `/v1/auth/zkp/register` — identity pipeline failed. |
| `verification_failed` | `/v1/auth/zkp/verify` — proof verification threw. Also `/v1/identity/verify` (401): the uniform enumeration-defended failure for did_unknown / commitment_mismatch / nonce_mismatch / proof_invalid. |
| `challenge_not_found` (404), `challenge_expired` (410), `challenge_already_used` (409), `challenge_locked` (423) | `/v1/identity/verify` — the `challengeId` is unknown, expired, already consumed (replay), or locked after repeated failures. Request a fresh `/v1/identity/challenge`. |
| `too_many_pending_challenges` (429), `challenge_failed` (500) | `/v1/identity/challenge` — open-challenge cap exceeded / internal error. |
| `device_create_failed`, `device_list_failed`, `device_update_failed` | Devices route exceptions. |
| `user_create_failed`, `user_list_failed`, `user_update_failed` | Users route exceptions. |
| `verification_create_failed`, `verification_list_failed` | Verifications route exceptions. |
| `attendance_create_failed`, `attendance_list_failed` | Attendance route exceptions. |
| `outside_anchor` | `/api/attendance/record` — the attested WiFi BSSID/signal does not match the company's configured anchor. The face proof still verified; the event is recorded as `rejected` and `403` is returned. |
| `attendance_session_expired` | `/api/attendance/record` — the attendance session was already used (single-use) or expired. Start again from `/api/attendance/init`. |
| `attendance_not_provisioned` | `/api/attendance/*` — the attendance company tenant is not seeded on this deployment. |
| `attendance_init_failed`, `attendance_record_failed` | Attendance bridge route exceptions. |
| `too_many_requests` | `/api/attendance/*` + `/api/hr/*` — rate limit exceeded. |
| `not_a_member` | `/api/attendance/record` — the verified DID is not a claimed member of the given company. |
| `invite_not_found_or_expired` | `/api/attendance/claim` — the invite code is unknown, already used, or expired (single-use). |
| `commitment_mismatch` | `/api/attendance/claim` — `publicSignals[0]` does not equal the submitted commitment. |
| `proof_verification_failed` | `/api/attendance/claim` — the Groth16 face proof failed. |
| `attendance_claim_failed`, `company_not_found` | Claim/company route exceptions. |
| `customer_id_taken` | `/api/demo-portal/bank/signup` (409) — a bank account already exists for that email. |
| `weak_password` | `/api/demo-portal/bank/signup` (400) — password under 8 chars or missing letter/digit. |
| `invalid_credentials` | `/api/demo-portal/bank/login` (401) — uniform for unknown customer AND wrong password. |
| `enrollment_pending` | `/api/demo-portal/bank/login` (409) — password OK but the ZeroAuth enrollment bind never completed. |
| `account_locked` | `/api/demo-portal/bank/login` (423) — 10+ failed password attempts. |
| `bank_signup_failed`, `bank_login_failed`, `pending_poll_failed` | `/api/demo-portal/bank/*` + `/device/pending` route exceptions. |
| `no_account` | `/api/demo-portal/bank/overview` + `/bank/transfer` (404) — the demo session has no active bank account. |
| `insufficient_funds` | `/api/demo-portal/bank/transfer` (400) — the debit would overdraw the savings balance. |
| `transfer_not_found` | `/api/demo-portal/bank/transfer/:id` (404) — no such transfer for this account. |
| `overview_failed`, `transfer_failed`, `transfer_poll_failed` | NeoBank dashboard route exceptions. |
| `email_taken` | `/api/hr/signup` — an HR admin already exists for that email. |
| `invalid_credentials` | `/api/hr/login` — wrong email or password. |
| `weak_password`, `invalid_email`, `employee_exists`, `no_company`, `invalid_status` | `/api/hr/*` validation / provisioning errors. |
| `audit_list_failed` | Audit route exceptions. |

## Proof pairing (`/v1/proof-pairing/*` — W3)

| Code | Status | When |
|---|---|---|
| `pairing_session_not_found` | `404` | `:id` doesn't match a session row for this tenant. Also returned (indistinguishably) for "exists in a different tenant" to defeat enumeration. |
| `pairing_session_expired` | `410` | Session passed its 5-min TTL. |
| `pairing_session_already_bound` | `409` | Single-use — another submit already succeeded. |
| `pairing_session_locked` | `423` | Per-session failure cap reached (3 failed submits). Get a fresh session. |
| `pairing_session_bind_mismatch` | `403` | `session_bind` cookie missing or doesn't match the row. |
| `pairing_nonce_mismatch` | `400` | `publicSignals[1]` ≠ server-recomputed `Poseidon(storedDidHash, sessionNonce)`. |
| `pairing_did_unknown` | `400` | The `did` in submit doesn't resolve to a stored commitment in this tenant. |
| `pairing_proof_invalid` | `401` | Verifier returned `verified: false`. Distinct from `pairing_nonce_mismatch` for dashboard attribution. |
| `pairing_tenant_mismatch` | `403` | Session row's `tenant_id` differs from the authed tenant (defense-in-depth on top of normal scope check). |
| `pairing_unavailable` | `503` | Verifier unreachable at session creation; pairing temporarily disabled. |
| `verifier_unavailable` | `503` | Verifier loopback call timed out on this submit. Retryable. |
| `too_many_pending_sessions` | `429` | Tenant has more than 50 open `issued` sessions. |
| `play_integrity_required` | `400` | The tenant's `security_policy` requires a Play Integrity verdict on the submit body and the field is absent. |
| `play_integrity_insufficient` | `401` | The presented `clientMeta.playIntegrityVerdict` is weaker than the tenant's required rank (strong > device > basic). |

---
LAST_UPDATED: 2026-05-22
OWNER: Pulkit Pareek
