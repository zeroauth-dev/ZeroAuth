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
| `POST` | `/v1/devices` | `devices:write` | Register a new device. Body: `{ name, externalId?, locationId?, batteryLevel?, metadata? }`. |
| `GET` | `/v1/devices` | `devices:read` | List devices for the tenant's environment. `?status=active\|inactive\|retired`, `?limit=…` (≤100). |
| `PATCH` | `/v1/devices/:deviceId` | `devices:write` | Mutate name, locationId, batteryLevel, status, metadata, lastSeenAt. |

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

### Central API — audit (`/v1/audit`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `GET` | `/v1/audit` | `audit:read` | Read-only business audit log. `?action=…`, `?status=success\|failure`, `?limit=…`. |

### Identity + ZKP (`/v1/auth/zkp/*`, `/v1/identity/*`)

| Method | Path | Scope | Description |
|---|---|---|---|
| `POST` | `/v1/auth/zkp/register` | `zkp:register` | Hash biometric → DID, anchor on Base Sepolia, return secrets to the client once. |
| `POST` | `/v1/auth/zkp/verify` | `zkp:verify` | Verify Groth16 proof, issue session JWT on success. |
| `GET` | `/v1/auth/zkp/nonce` | `nonce:create` | Fresh nonce, 5-minute lifetime. |
| `GET` | `/v1/auth/zkp/circuit-info` | `zkp:verify` | Circuit metadata for client SDKs. |
| `GET` | `/v1/identity/me` | `identity:read` | User profile from a session JWT (passed via `X-Session-Token`). |
| `POST` | `/v1/identity/logout` | `identity:read` | Invalidate a session. |
| `POST` | `/v1/identity/refresh` | `identity:read` | Refresh-token → new access token. |

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
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
