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
| `missing_saml_response` | `/v1/auth/saml/callback` — body missing `SAMLResponse`. |

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

## Service unavailable (`503 Service Unavailable`)

| Code | When |
|---|---|
| `demo_auth_disabled` | Legacy `/api/auth/saml/*` and `/api/auth/oidc/*` routes when `ENABLE_DEMO_AUTH` is off (production default). |

## Server error (`500 Internal Server Error`)

| Code | When |
|---|---|
| `signup_failed` | Database insert failed. Detailed error logged via Winston; generic message returned to the client. |
| `login_failed` | Tenant lookup or password verification threw. |
| `registration_failed` | `/v1/auth/zkp/register` — identity pipeline failed. |
| `verification_failed` | `/v1/auth/zkp/verify` — proof verification threw. |
| `device_create_failed`, `device_list_failed`, `device_update_failed` | Devices route exceptions. |
| `user_create_failed`, `user_list_failed`, `user_update_failed` | Users route exceptions. |
| `verification_create_failed`, `verification_list_failed` | Verifications route exceptions. |
| `attendance_create_failed`, `attendance_list_failed` | Attendance route exceptions. |
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
