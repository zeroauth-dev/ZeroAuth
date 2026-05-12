# Threat model

> v0 — May 12, 2026. This is the seed list. Every new endpoint, every new
> dependency that handles secrets or PII, every new circuit change, every
> new audit-log write path must extend this document and add a matching
> `A-NN` entry. The `test-from-threat-model` skill (to be installed)
> generates the tests; the `security-reviewer` and `cryptographer-reviewer`
> subagents read this file at session start.

## Threat surface inventory

| Surface | Exposure | Notes |
|---|---|---|
| `https://zeroauth.dev/v1/*` | Public, tenant-API-key authenticated | Scoped to `(tenant_id, environment)`. Rate-limit + monthly quota per tenant. |
| `https://zeroauth.dev/api/console/*` | Public, JWT-authenticated for everything except signup + login | Per-IP rate limit on signup/login. Password policy enforced. |
| `https://zeroauth.dev/api/admin/*` | Public, `x-api-key` (single shared admin key in `.env`) | Read-only. |
| `https://zeroauth.dev/api/health` | Public, unauthenticated | Health + subsystem status only. |
| `https://zeroauth.dev/api/auth/saml/*`, `…/oidc/*` | Public, gated by `ENABLE_DEMO_AUTH` flag | Demo stubs; **do not** validate real SAML signatures or OIDC tokens. Off in production. |
| `https://zeroauth.dev/api/leads/*` | Public, unauthenticated | Marketing forms; writes to `leads` table. |
| Base Sepolia `DIDRegistry` | Public RPC, `onlyOwner` writes | Deployer wallet is the single owner. Rotate via `npm run wallet:rotate`. |
| VPS SSH (`104.207.143.14:22`) | Internet, key-only | `root` (laptop key) and `zeroauth-deploy` (CI key) authorized. UFW open only on 22/80/443. |

## Identified attacks (A-NN)

### A-01 — Cross-tenant data read

| | |
|---|---|
| **Class** | Elevation of privilege (STRIDE: E) |
| **Surface** | Any `/v1/*` endpoint that returns data |
| **Description** | A request authenticated as tenant A receives data belonging to tenant B because a `WHERE` clause omits the tenant filter. |
| **Mitigation** | Every SQL path in `src/services/platform.ts` (and similar) takes `(tenant_id, environment)` as parameters and embeds them in the WHERE. `tests/central-api.test.ts` exercises the scoping at the router layer. |
| **Test status** | Router-level test exists; **no direct SQL-path test yet**. Add when `platform.ts` gets its dedicated test file. |
| **Audit signal** | None today. Should add an `audit_events.action = 'cross_tenant_query_blocked'` row when the WHERE-clause guard fires defensively. |

### A-02 — Replayed proof verification

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /v1/auth/zkp/verify`, `POST /api/auth/zkp/verify` |
| **Description** | An attacker replays a captured Groth16 proof + public signals + nonce after the original session has ended. |
| **Mitigation** | `src/services/zkp.ts` enforces a 5-minute timestamp window on the request and validates the nonce format. **Note:** the nonce is not currently bound to an issued-nonce table — replay within the 5-minute window is not blocked. Open issue. |
| **Test status** | Timestamp window + nonce format tests in `tests/zkp.test.ts`. **Missing:** within-window replay test. |
| **Audit signal** | `audit_events.action = 'zkp.verify'` is recorded; no special replay signal yet. |

### A-03 — Forged SAML assertion via demo callback

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /api/auth/saml/callback`, `POST /v1/auth/saml/callback` |
| **Description** | The route mints a session JWT from `nameID` and `email` in the request body without validating any SAML signature. Demonstrated live in the May 2026 review. |
| **Mitigation** | `src/middleware/demo-auth-gate.ts` returns 503 unless `ENABLE_DEMO_AUTH=true`. The flag is off in production, on in dev. |
| **Test status** | Existing `tests/saml.test.ts` covers happy-path; **missing:** "returns 503 in prod env" test. |
| **Follow-up** | Real implementation with `@node-saml/node-saml` is required before re-enabling the route. Tracked separately. |

### A-04 — Forged OIDC callback via demo route

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /api/auth/oidc/callback`, `POST /v1/auth/oidc/callback` |
| **Description** | PKCE state lookup is real, but once a state is valid the user identity is taken from `req.body.email` without exchanging the code at the IdP token endpoint or validating the `id_token`. |
| **Mitigation** | Same `demo-auth-gate` middleware as A-03. |
| **Test status** | Same gap as A-03. |
| **Follow-up** | Real implementation with `openid-client`. |

### A-05 — Credential stuffing / email enumeration on console signup

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) + DoS (D) |
| **Surface** | `POST /api/console/signup`, `POST /api/console/login` |
| **Description** | Without a per-IP rate limit, an attacker can probe email addresses (signup) or test password lists (login) at the global limiter's rate (300 req / 15 min). The 409 vs 201 status code on signup reveals whether an email is taken. |
| **Mitigation** | `src/routes/console.ts:authLimiter` — 10 attempts per 15 minutes per IP. Stricter password policy (12 chars, letter+digit, denylist of common passwords). |
| **Test status** | **Missing:** test that 11th attempt in a window returns 429. The limiter is skipped under `NODE_ENV=test`, so the test would need to flip that. |

### A-06 — Replay of revoked API key after restart

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | Any `/v1/*` endpoint |
| **Description** | An API key is revoked. The `api_keys` table is updated, but in-memory rate-limit counters are still keyed by tenant ID. If the revoked key is replayed and another active key for the same tenant exists, the request is rate-limited as the live tenant. |
| **Mitigation** | `authenticateApiKey` re-reads the DB on every request and rejects `status != 'active'`. So the key itself is rejected. The rate-limit counter sharing is not a security issue (the request never authenticates). |
| **Test status** | Covered indirectly. |

### A-07 — Leaked deployer wallet private key compromises `DIDRegistry`

| | |
|---|---|
| **Class** | Elevation of privilege (STRIDE: E) |
| **Surface** | `BLOCKCHAIN_PRIVATE_KEY` on the VPS, or in `.env` on a developer's laptop |
| **Description** | The wallet that deployed `DIDRegistry` is the contract `owner`. If the key leaks, the attacker can call `registerIdentity` / `revokeIdentity` on the production registry. |
| **Mitigation** | Key is in `/opt/zeroauth/.env` only (not in git). Key was rotated once after the May 2026 review (covered in commit history). `npm run wallet:rotate` exists and is documented. Long-term: move to a multisig owner. |
| **Test status** | Not applicable (operational concern). |

### A-08 — Inline event handler bypasses strict CSP

| | |
|---|---|
| **Class** | Information disclosure / XSS (STRIDE: I) |
| **Surface** | `public/index.html` marketing page |
| **Description** | Helmet sets `script-src-attr 'none'` so inline `onclick=` / `onsubmit=` handlers are blocked. The May 2026 review found two `onsubmit=` attributes which were quietly failing in browsers. |
| **Mitigation** | All inline handlers were removed; forms now use `addEventListener` from a single `<script>` block. CSP is enforced. |
| **Test status** | Live `curl … | grep onsubmit=` returns 0 in CI. Could be promoted to a real test. |

## Open items (no `A-NN` yet)

- The session store is in-memory; restart wipes session continuity. Not exploitable today (JWTs are stateless), but consumers of `/v1/identity/me` will see false 401s on restart.
- Postgres has no off-host backup. A VPS-level disk failure loses tenant + audit data.
- Audit log is append-only at the table level (no triggers blocking UPDATE / DELETE). A root-level Postgres compromise could rewrite history. Long-term: hash chain + cross-chain anchoring per the patent.
- No CSP report-uri. Successful CSP blocks go silent.
- The Docusaurus build embeds the patent number in the public docs site. This is intentional (the patent is granted, IN202311041001) but verify nothing else from the prompt suite (pricing, buyer names) leaks into static assets.

## How to extend

1. New endpoint or change to an existing one → identify which existing `A-NN` entries are in scope. If none fit, add a new `A-NN` here.
2. New dependency that handles secrets, PII, or network ingress → add an `A-NN` for its threat surface as part of the dep's ADR.
3. New mitigation → describe it in the relevant `A-NN`'s Mitigation row.
4. The `test-from-threat-model` skill (to be installed) generates the test scaffolds; each test maps to one `A-NN`.

---
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
