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
| `https://api.zeroauth.dev/v1/*` | Public, tenant-API-key authenticated | Scoped to `(tenant_id, environment)`. Rate-limit + monthly quota per tenant. |
| `https://api.zeroauth.dev/api/console/*` | Public, JWT-authenticated for everything except signup + login | Per-IP rate limit on signup/login. Password policy enforced. |
| `https://api.zeroauth.dev/api/admin/*` | Public, `x-api-key` (single shared admin key in `.env`) | Read-only. |
| `https://api.zeroauth.dev/api/health` | Public, unauthenticated | Health + subsystem status only. |
| `https://api.zeroauth.dev/api/leads/*` | Public, unauthenticated | Marketing forms; writes to `leads` table. |
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
| **Surface** | `POST /v1/identity/verify` (production); the deprecated `/v1/auth/zkp/verify` (Sunset 2026-12-31). The legacy `/api/auth/zkp/verify` was gated off in prod (K-1) and then **removed entirely** in the June 2026 dead-API sweep. |
| **Description** | An attacker replays a captured `(proof, publicSignals)` after the original verification, to authenticate as the victim. |
| **Mitigation** | **CLOSED for the production surface.** `/v1/identity/verify` now converges onto the hardened proof-pairing verifier (`verifyIdentityProof`): the client first calls `/v1/identity/challenge` for a server-minted single-use nonce, the proof binds it as `publicSignals[1] = Poseidon(didHash, nonce)` (re-derived + constant-time compared server-side, A-11), and the challenge is consumed atomically (`UPDATE … WHERE state='issued' RETURNING`, A-14). A captured proof carries a spent/foreign nonce and fails. The 5-minute timestamp window remains the (weaker) defence only on the deprecated `/v1/auth/zkp/verify`. |
| **Test status** | `tests/identity-verify-face.test.ts`: challenge issuance; verify requires `challengeId` (400 without); nonce-mismatch → 401; replayed/consumed challenge → 409 `challenge_already_used`; expired → 410. Inherits the proof-pairing nonce-binding + single-use consume tests (`tests/proof-pairing.test.ts`). |
| **Audit signal** | `pairing.replay_blocked` on a `publicSignals[1]` mismatch; `identity.verify` (success/failure) per attempt. |

### A-03 — Forged SAML assertion via demo callback — CLOSED (surface removed)

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | ~~`POST /api/auth/saml/callback`, `POST /v1/auth/saml/callback`~~ — **removed June 2026** (dead-API sweep). |
| **Description** | The mock route minted a session JWT from `nameID` and `email` in the request body without validating any SAML signature. Demonstrated live in the May 2026 review; previously mitigated by the `ENABLE_DEMO_AUTH` 503 gate. |
| **Mitigation** | **CLOSED.** The routes, the demo-auth gate, and the `saml` config block no longer exist. Any future SSO surface must be a real `@node-saml/node-saml` implementation behind a new ADR. |
| **Test status** | N/A — surface deleted; `tests/saml.test.ts` removed with it. |

### A-04 — Forged OIDC callback via demo route — CLOSED (surface removed)

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | ~~`POST /api/auth/oidc/callback`, `POST /v1/auth/oidc/callback`~~ — **removed June 2026** (dead-API sweep). |
| **Description** | The mock route took the user identity from `req.body.email` without exchanging the code at the IdP token endpoint or validating the `id_token`. |
| **Mitigation** | **CLOSED.** Routes and `oidc` config block deleted, same as A-03. Any future implementation uses `openid-client` behind a new ADR. |
| **Test status** | N/A — surface deleted; `tests/oidc.test.ts` removed with it. |

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

### A-09 — Console JWT theft via XSS in the dashboard

| | |
|---|---|
| **Class** | Information disclosure / EoP (STRIDE: I + E) |
| **Surface** | Anything rendered inside the dashboard SPA at `/dashboard/*` |
| **Description** | The console JWT is **persisted to `localStorage`** under the key `zeroauth.console_token` by `dashboard/src/lib/api.ts` so the session survives page reloads. If an XSS payload executes in the SPA, the attacker reads the token from `localStorage` and uses it for the remaining lifetime of the token (≤ 24h). This is a deliberate trade-off vs. in-memory storage (better UX, worse blast radius) — captured here so the threat model is honest about the choice. See [`zeroauth-dev/ZeroAuth-Governance: docs/threat-model/dashboard.md` §A-09](https://github.com/zeroauth-dev/ZeroAuth-Governance/blob/main/docs/threat-model/dashboard.md) for the authoritative component-level write-up. |
| **Mitigation** | (a) Strict CSP from Helmet — no `unsafe-eval`, no inline scripts beyond the existing landing-page allowance. (b) React's default escape protects against most reflected XSS. (c) **Never** introduce `dangerouslySetInnerHTML` without an ADR — enforced by reviewer rule. (d) The console JWT is short-lived (24h) and now carries `jti` + `aud='zeroauth-console'` (issue #26 F-5, commit landed Day 3 Week 1) — `jti` is the seam for a future Redis-backed allow-list that makes "logout everywhere" possible. (e) Console JWT is rejected on any `/v1` endpoint because `aud` is verified explicitly. |
| **Test status** | CSP header presence is asserted in `tests/health.test.ts` (indirectly via helmet output). **Missing:** an integration test that asserts no inline `<script>` blocks land in the dashboard build output, an integration test for `dangerouslySetInnerHTML` absence, and a test that confirms `jti` revocation 401s subsequent requests (pending the Redis allow-list). |
| **Audit signal** | None today. Open: log an `auth.token_reuse` event when the same `jti` is replayed from a new IP within a short window. |
| **Open ADR** | `0006-console-jwt-cookie-vs-localstorage.md` — decide whether to migrate from `localStorage` to an HttpOnly + SameSite=Strict + Secure cookie. The cookie path eliminates the read-via-XSS class entirely at the cost of a CSRF mitigation requirement (SameSite=Strict handles most of it; add a custom header check for safety). Trigger to file: before first pilot SOW signing. |

### A-10 — Dashboard requests leaking another tenant's data

| | |
|---|---|
| **Class** | Elevation of privilege (STRIDE: E) |
| **Surface** | Every `/api/console/*` route that returns tenant-owned rows |
| **Description** | The dashboard fetches from `/api/console/overview`, `/api/console/audit`, `/api/console/usage`, `/api/console/keys`. If any of those handlers infers tenant from the request body or query rather than the JWT subject, an attacker with one valid console JWT can read another tenant's data by passing a target `tenantId`. |
| **Mitigation** | Every console route reads `tenantId` from `(req as any).console.tenantId` (set by `verifyConsoleToken`), never from the body or query. Reviewers must check this on every PR that touches `src/routes/console.ts` or adds a new console endpoint. |
| **Test status** | **Missing:** integration test that constructs a JWT for tenant A and probes every console route with a body / query that names tenant B's ID. |
| **Audit signal** | All console writes log to `audit_events` already; reads don't. Open: emit `console.read` audit events for high-value reads (audit log export, usage breakdown). |

### A-08 — Inline event handler bypasses strict CSP

| | |
|---|---|
| **Class** | Information disclosure / XSS (STRIDE: I) |
| **Surface** | `public/index.html` marketing page |
| **Description** | Helmet sets `script-src-attr 'none'` so inline `onclick=` / `onsubmit=` handlers are blocked. The May 2026 review found two `onsubmit=` attributes which were quietly failing in browsers. |
| **Mitigation** | All inline handlers were removed; forms now use `addEventListener` from a single `<script>` block. CSP is enforced. |
| **Test status** | Live `curl … | grep onsubmit=` returns 0 in CI. Could be promoted to a real test. |

### A-11 — Pairing-nonce replay across two desktop sessions

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /v1/proof-pairing/sessions/:id/submit` |
| **Description** | A passively-recorded `{proof, publicSignals, did}` from session S1 is replayed against a freshly-issued session S2 whose nonce the attacker observes (shoulder-surf of the desktop QR). Without an explicit nonce ↔ proof binding the same proof verifies for any session because `identityBinding = Poseidon(2)([biometricSecret, didHash])` is per-user, not per-session. |
| **Mitigation** | [ADR-0009](https://github.com/zeroauth-dev/ZeroAuth/blob/main/adr/0009-qr-proof-pairing-protocol.md) Option B′: phone computes `didHashSession = Poseidon(2)([didHash, sessionNonce])` and uses it as the circuit's `didHash` input. Server re-derives `Poseidon(2)([user.didHash, session.nonce])` from its own records and `crypto.timingSafeEqual`-compares to `publicSignals[1]`. Mismatch → 400 `pairing_nonce_mismatch`. |
| **Test status** | **Required before merge.** `tests/proof-pairing.test.ts` cases: (i) valid first submit succeeds; (ii) replay against same session returns 409; (iii) replay against fresh session with different nonce returns 400 with `pairing_nonce_mismatch`. |
| **Audit signal** | `audit_events.action = 'pairing.replay_blocked'` with `metadata.session_id`. |

### A-12 — Cross-tenant claim in pairing submit

| | |
|---|---|
| **Class** | Elevation of privilege (STRIDE: E) |
| **Surface** | `POST /v1/proof-pairing/sessions/:id/submit` |
| **Description** | The phone's QR payload carries `did` + `tenant_id`. If the `/submit` handler trusts `tenant_id` from the body or from the proof's public signals instead of from `getTenantContext(req).tenant.id` (set by `src/middleware/tenant-auth.ts:118`), a holder of tenant A's API key can submit a proof generated against tenant B's commitment. |
| **Mitigation** | The handler MUST derive `tenantId` exclusively from `getTenantContext(req)`. The pairing session row stores `(tenant_id, environment)` at issuance time; `/submit` rejects with 403 `tenant_mismatch` if the authed tenant differs from the row's tenant. The `did` → user lookup filters `WHERE did = $1 AND tenant_id = $2 AND environment = $3`. |
| **Test status** | **Required before merge.** Test name: `submit rejects when proof carries another tenant's commitment`. |
| **Audit signal** | `audit_events.action = 'pairing.cross_tenant_blocked'`, status `failure`. |

### A-13 — Session fixation via attacker-issued pairing session

| | |
|---|---|
| **Class** | Elevation of privilege (STRIDE: E) |
| **Surface** | `POST /v1/proof-pairing/sessions` + `POST .../submit` |
| **Description** | The attacker opens `/demo/qr-proof-login`, calls `POST /v1/proof-pairing/sessions`, copies the QR, sends it to a victim ("scan to verify your KYC"). The victim's phone produces a valid proof, the proof is submitted, and the **attacker's** browser receives the minted desktop JWT via the SSE stream. The attacker is logged in as the victim. |
| **Mitigation** | The initial `POST /sessions` sets a `Secure; HttpOnly; SameSite=Strict; Path=/v1/proof-pairing/` cookie carrying a 32-byte random `session_bind` token. The cookie value is sha256-hashed and stored in `proof_pairing_sessions.session_bind_token_hash`. `GET /stream` and `GET /:id` both require the cookie to match. The phone never sees the cookie; a phished QR carries only `session_id` + `nonce` and produces a successful proof, but the minted JWT is only deliverable to the browser that holds the cookie. |
| **Test status** | **Required before merge.** Test names: `stream returns 403 when session_bind cookie is missing`, `stream returns 403 when session_bind cookie differs from row`. |
| **Audit signal** | `audit_events.action = 'pairing.session_bind_mismatch'`, severity high. |

> **Demo-portal phone-push scope note (2026-06-04).** The mitigation above applies to the **production `/v1/proof-pairing` surface**. The `/api/demo-portal/*` sandbox bridge uses a *phone-push* variant: the phone POSTs its proof to `POST /api/demo-portal/submit-proof` (the demo SPA holds no `session_bind` cookie by design), and the desktop then mints its session cookie via `POST /api/demo-portal/sessions/:id/claim`. To preserve an A-13-equivalent binding on that surface, `/init-login` sets a `Secure; HttpOnly; SameSite=Strict; Path=/api/demo-portal` **`demo_portal_claim`** cookie (32-byte random); `/claim` requires it (constant-time compare against the sha256 stored server-side), is **single-use**, and returns a uniform `409 pairing_not_ready` for every not-ready/missing-cookie/wrong-cookie case so a known session id alone cannot mint a session. The Groth16 + Poseidon-nonce verification in `submitProof` is unchanged, so a proof still only completes the session whose challenge QR the phone scanned. Residual vs production: the demo relaxes the ADR-0009 "phone never POSTs to the backend" property (sandbox only); a `pairing.desktop_claimed` audit row is written on each desktop claim. Promoting phone-push to a real customer tenant requires a superseding ADR + cryptographer-reviewer sign-off (the co-presence assumption changes). Tests: `tests/demo-portal.test.ts` → the `POST /api/demo-portal/sessions/:id/claim` suite.

### A-14 — Race: two phones scan the same desktop QR

| | |
|---|---|
| **Class** | Tampering / EoP (STRIDE: T + E) |
| **Surface** | `POST .../submit` |
| **Description** | A single desktop QR is briefly visible to two cameras. Both phones scan, both submit valid proofs (for different users) targeting the same `session_id` within milliseconds. Without atomic single-use enforcement, both submits race and the session is either bound twice or bound to the wrong user. |
| **Mitigation** | Atomic `UPDATE proof_pairing_sessions SET state='consumed', consumed_user_id=$2, consumed_at=NOW() WHERE id=$1 AND state='issued' RETURNING *`. The row-level lock + `RETURNING` semantics make this race-safe. Second arrival gets 0 rows → 409 `pairing_session_already_bound`. |
| **Test status** | **Required before merge.** Test name: `concurrent submits — only one wins, the other 409s`. |
| **Audit signal** | `audit_events.action = 'pairing.race_lost'` on the losing submit. |

### A-15 — Camera spoofing: desktop sees a recorded proof QR

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | Desktop client at `console.zeroauth.dev/demo/qr-proof-login` |
| **Description** | A pre-recorded video of a previous proof QR is presented to the desktop's webcam in place of a live phone. |
| **Mitigation** | A-11's nonce binding closes the cryptographic side: a recorded QR from session S1 fails the nonce check on any other session. Desktop UX gates: the QR scanner requires the QR to be present for ≥ 500 ms across ≥ 5 frames with motion (defeats a static photo); pairing session TTL is 5 min. |
| **Test status** | Manual QA gate (Playwright + a camera shim is heavy). Document in the runbook. |
| **Audit signal** | The `pairing.replay_blocked` from A-11 covers the audit trail when the nonce mismatch fires. |

### A-16 — Network MITM on the proof-submit POST

| | |
|---|---|
| **Class** | Tampering / Information disclosure (STRIDE: T + I) |
| **Surface** | `POST .../submit` over TLS to `api.zeroauth.dev` |
| **Description** | A network attacker (corporate proxy, hostile Wi-Fi, compromised TLS CA) intercepts the submit; in the worst case substitutes a proof, in the lesser case reads `did` + `user_external_id`. |
| **Mitigation** | HSTS preload via Helmet (already set, `src/app.ts`). Pin the API origin in the desktop SPA build (hardcoded `https://api.zeroauth.dev`, not env-configurable). Treat `did` as PII at the log boundary — never include in `logApiCall` body, never echo back in error messages. CT-log monitor in the runbook for `*.zeroauth.dev`. |
| **Test status** | HSTS header asserted via helmet. **Missing:** integration test that error bodies on `/v1/proof-pairing/*` don't echo `did`. |
| **Audit signal** | None at submit; CT monitoring is out-of-band. |

### A-17 — WebView supply-chain attack on the snarkjs build

| | |
|---|---|
| **Class** | Tampering (STRIDE: T) |
| **Surface** | The Android app's WebView running snarkjs |
| **Description** | If snarkjs is loaded over HTTPS at runtime, a CDN/network compromise swaps it for a build that exfiltrates `biometricSecret` (the only private witness) or produces proofs against attacker-chosen commitments. Same class as `event-stream` / `ua-parser-js`. |
| **Mitigation** | [ADR-0010](https://github.com/zeroauth-dev/ZeroAuth/blob/main/adr/0010-android-webview-snarkjs-bundling.md): snarkjs is bundled in the APK at `android/app/src/main/assets/prover/`, SHA-256 pinned in the ADR, build fails on mismatch. WebView CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`. **WebView runs inside a bound Service in `android:process=":prover"` with `android:isolatedProcess="true"`** (`ProverService.kt`, `IsolatedMobileProver.kt`, `ProverIpc.kt`): the WebView's UID has no filesystem access to the app data dir, no Keystore, no SharedPreferences; renderer compromise reaches at most the in-flight witness for the current proof, not past proofs or the long-lived Keystore-wrapped credential. No `file://`, no `content://`, no DOM storage. Play Integrity verdict travels in `clientMeta.playIntegrityVerdict` for W4 server-side enforcement. |
| **Test status** | **Required before Android app merge.** CI step diffs `assets/prover/*.sha256` against the ADR-pinned table; build fails on mismatch. |
| **Audit signal** | If `clientMeta.snarkjsHash` ever travels in the submit, log mismatches as `audit_events.action = 'pairing.unexpected_prover_hash'`. |

### A-18 — Rooted/jailbroken phone with extracted Keystore secret

| | |
|---|---|
| **Class** | Spoofing / EoP (STRIDE: S + E) |
| **Surface** | Android app, BiometricPrompt + Keystore-wrapped secret |
| **Description** | On a rooted device, an attacker with root can dump the wrapped `biometricSecret`, bypass BiometricPrompt, and produce valid proofs at will — defeats A-11's protection because they're generated fresh against the live nonce with the legitimate key. |
| **Mitigation** | Key gen params: `setUserAuthenticationRequired(true)` + `setInvalidatedByBiometricEnrollment(true)` + `setUserAuthenticationParameters(0, BIOMETRIC_STRONG)` + `setIsStrongBoxBacked(true)` where available + `setUnlockedDeviceRequired(true)`. Play Integrity verdict captured at proof time and **enforced server-side** via `src/services/play-integrity.ts` against `tenants.security_policy.require_{strong,device,basic}_integrity`. Default policy is permissive (demo tenants); BFSI tenants flip `require_strong_integrity: true` + `allow_play_integrity_absent: false`. Rejection writes `audit_events.action = 'pairing.integrity_rejected'` with the presented verdict + the policy snapshot. |
| **Test status** | `tests/play-integrity.test.ts` covers the policy evaluator (permissive accept, require_strong + STRONG accept, require_strong + DEVICE reject, require_strong + absent reject, allow_absent override, rank comparisons, whitespace-as-absent). `tests/proof-pairing.test.ts` covers the route-layer 400/401 mapping. |
| **Test status** | Server-side: test that submits with `playIntegrityVerdict = MEETS_BASIC_INTEGRITY` are rejected for tenants demanding STRONG. Device-side: Firebase Test Lab matrix. |
| **Audit signal** | `audit_events.action = 'pairing.integrity_rejected'` with `metadata.verdict` + `metadata.attestation_state`. |
| **Residual risk** | A determined attacker with lab equipment can still mount key-extraction against StrongBox; accepted for v1 demo, documented in pilot SOW. |

### A-19 — Stolen phone, biometric coerced

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) — physical adversary |
| **Surface** | The phone in the hands of someone other than the enrolled user |
| **Description** | A hostile actor presents the sleeping user's finger to the sensor or coerces the user. The phone produces a valid proof; the verifier has no way to know. |
| **Mitigation** | Out of scope for the verifier — user-side / regulatory. Tenant policy: for high-value `action_class`, require a typed confirmation on the phone after the biometric (captures a "willingness" signal). Duress-PIN pattern: a special PIN produces a proof shaped to fail at the verifier with `duress_observed`, logging the silent alert without tipping off the coercer. BFSI customers must layer transaction limits + cooling-off periods. |
| **Test status** | `duress_observed` reason code never appears in a success response and never produces an `accepted` attendance event; logs to audit only. |
| **Audit signal** | `audit_events.action = 'pairing.duress_observed'`, `status='failure'`, `metadata.tenant_silent_alert=true`. |

### A-20 — QR-bombing / DoS by spraying bogus proofs at `/submit`

| | |
|---|---|
| **Class** | Denial of service (STRIDE: D) |
| **Surface** | `POST .../submit` |
| **Description** | Each `/submit` invokes Groth16 verification (~10–50 ms). An attacker fires thousands of bogus proofs and pegs the verifier's CPU. |
| **Mitigation** | (a) Reject before crypto: session-row state machine drops `/submit` for rows not in `issued` (cheap DB lookup). (b) Reject before crypto, part 2: tenant context check is O(1). (c) Per-session failure cap: after 3 failed submits for the same `session_id`, mark `state='failed'`. (d) Per-tenant rate cap on `/submit`: 30/min + 5/min/session (tightening of the existing tenant limiter). (e) Verifier circuit-breaker: when verifier p95 > 500 ms, API returns 503 to `/submit` and pages on-call. |
| **Test status** | **Missing.** Load test: 1000 invalid submits to one session; assert the 4th onwards return 423 `session_failed` without invoking the verifier. |
| **Audit signal** | `audit_events.action = 'pairing.failed'` per failed submit; `pairing.session_locked` when the 3-failure threshold trips. |

### A-21 — Audit-log tampering for the new pairing event types

| | |
|---|---|
| **Class** | Tampering / Repudiation (STRIDE: T + R) |
| **Surface** | `audit_events` writes for new actions `pairing.created`, `pairing.claimed`, `pairing.expired`, `pairing.failed`, `pairing.replay_blocked`, `pairing.cross_tenant_blocked`, `pairing.session_bind_mismatch`, `pairing.integrity_rejected`, `pairing.race_lost`, `pairing.session_locked`, `pairing.duress_observed` |
| **Description** | (1) Today's `recordAuditEvent` calls are fire-and-forget (`void recordAuditEvent(...).catch(...)`). DB failure produces only a Winston warn that no one reads. (2) `audit_events` has no INSERT-only constraint at DB level (existing open item). |
| **Mitigation** | (a) Pairing handlers must `await recordAuditEvent(...)` on the critical-path events (`pairing.claimed`, `pairing.cross_tenant_blocked`, `pairing.replay_blocked`, `pairing.session_bind_mismatch`). Audit-write failure on these paths returns 500 — better to fail the login than to mint a session with no audit trail. (b) High-volume nuisance events (`pairing.failed`, `pairing.race_lost`) stay fire-and-forget but increment a Prometheus counter on `.catch()`. (c) **MITIGATED PHASE 0 C-012**: hash chain over `audit_events` (ADR 0013, `src/services/audit.ts`). Every row carries `previous_hash` + `event_hash`; replay via `/api/admin/audit-integrity` detects any mutation. (d) DB-level: add a `BEFORE UPDATE OR DELETE` trigger on `audit_events` raising an exception — deferred to phase 2 once the backfill is complete. (e) **MITIGATED PHASE 1 C-015**: daily on-chain anchor on Base L2 (ADR 0014) so the bank's auditor can independently verify history without trusting any ZeroAuth process. |
| **Test status** | **Required before merge.** Per action verb: `pairing.X writes an audit row with the expected actor + metadata`. Hash chain replay covered by `tests/audit-chain.test.ts` + integration suite. |
| **Audit signal** | Recursive: `audit.write_failure` metric + page-the-on-call when audit writes fail at > 0.1 % rate. Plus `audit.integrity_check` rows from every invocation of the admin endpoint. |

### A-27 — Demo-DID prover bypass (P0 audit finding C-1, CLOSED)

| | |
|---|---|
| **Class** | Tampering / Authentication bypass (STRIDE: T + S) |
| **Surface** | `POST /v1/proof-pairing/sessions/:id/submit` |
| **Description** | The prior `pairing_demo_mode` branch in `src/services/proof-pairing.ts` accepted any DID starting with `did:zeroauth:demo:` and short-circuited checks 4..8 (user lookup, commitment compare, nonce binding, Groth16 verification). Default behaviour was `pairing_demo_mode === undefined ⇒ accept demo`, making the entire crypto pipeline a soft opt-in. Any tenant that forgot to flip the flag to `false` before pilot would silently accept canned-signal proofs. |
| **Mitigation** | **MITIGATED PHASE 0 C-004 (commit 02e1734).** The bypass branch is removed. All DIDs go through the standard lookup; a DID with a demo prefix gets the same uniform `pairing_did_unknown` response as any other unknown DID. The `pairing_demo_mode` field on the `TenantSecurityPolicy` type is marked `@deprecated` and ignored by the verifier. |
| **Test status** | **Pinned.** `tests/proof-pairing.test.ts::"P0 audit finding C-1 closure"` — (a) demo-prefixed DID returns 400 / `pairing_did_unknown`, (b) source-grep guard rejects re-introduction of `DEMO_DID_PREFIX`, `did:zeroauth:demo:`, `pairing_demo_mode`, or `demoBypassAllowed` symbols in `src/services/proof-pairing.ts`. |
| **Audit signal** | No special signal. Demo-prefixed unknown DIDs land in the standard `pairing_did_unknown` audit row. |

### A-28 — JWT-in-URL log leak via SSE auth fallback (P0 audit finding C-3, CLOSED)

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) — DPDP §8 risk |
| **Surface** | `?access_token=<jwt>` query string on `/api/console/*` endpoints, esp. `/api/console/proof-pairing/sessions/:id/stream` (SSE) |
| **Description** | The console-auth middleware previously accepted the JWT either in `Authorization: Bearer …` or as a `?access_token=` query parameter so EventSource clients (which cannot set custom headers) could authenticate. Query strings land in Caddy access logs even when the `Authorization` header is redacted, so a leaked log line was a session-replay primitive for the JWT's TTL. |
| **Mitigation** | **MITIGATED PHASE 0 C-005 (commit ee6aad4).** The query-string fallback is removed. The replacement is an HttpOnly, SameSite=Strict cookie `zeroauth_console_jwt` set at login + verify-signup, scoped to `/api/console`. EventSource reaches authenticated routes via `withCredentials: true` so the cookie auto-flows without code change. |
| **Test status** | **Pinned.** `tests/console-auth.test.ts::"P0 audit finding C-3"` — (a) `?access_token=` returns 401 on protected and SSE routes, (b) HttpOnly cookie path works, (c) login response carries Set-Cookie with HttpOnly + SameSite=Strict + Path=/api/console, (d) source-grep guard rejects re-introduction of `req.query.access_token` reads. |
| **Audit signal** | None directly. Any 401 with no Bearer header is a candidate signal for an unauthenticated SSE attempt. |

### A-22 — PII in pairing logs and responses

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) — DPDP §8 purpose limitation |
| **Surface** | Winston logs, `audit_events.metadata`, `/stream` and `/:id` response bodies, error responses |
| **Description** | The phone's submit body carries `did` (and historically `user_external_id` if a tenant maps employee IDs / phone numbers / Aadhaar fragments to user records). If any of those surfaces echo it back: log retention, browser history, on-call scrollback all become a PII trail. |
| **Mitigation** | (a) `logApiCall` in `src/services/usage.ts` records `req.originalUrl` only — confirm request bodies don't leak via debug logs. (b) `audit_events.metadata` stores `did_sha256` only, never the raw `did`. (c) `/stream` and `/:id` responses return the minted JWT and the tenant's internal `user_id` (UUID); never echo `did`. (d) Error bodies in production follow `src/middleware/error-handler.ts:4` — generic `{error: 'pairing_failed'}`, no detail. (e) Add `did` + `user_external_id` to the rejection list in the input validator when zod lands. |
| **Test status** | **Required before merge.** `submit logs do not contain did raw value` (mock logger, fire submit, grep capture). |
| **Audit signal** | None directly; privacy-by-design control. Map to DPDP §8 in `docs/compliance/dpdp-mapping.md`. |

### A-23 — Shoulder-surf of the desktop pairing QR

| | |
|---|---|
| **Class** | Information disclosure → spoofing (STRIDE: I → S) |
| **Surface** | The desktop screen rendering the pairing QR |
| **Description** | A bystander photographs the desktop's pairing QR. The QR carries `(session_id, nonce)`. Without A-13's session-bind cookie, the attacker can complete the flow on their own phone and steal the desktop session. (Distinct from A-13: there the attacker owned the desktop; here the attacker owns the phone.) |
| **Mitigation** | (a) A-13's session-bind cookie makes the minted JWT undeliverable to the attacker. (b) 5-min TTL with a visible countdown. (c) Desktop modal renders the QR inside an opt-in "Hide screen from others" affordance. (d) After consumption, the desktop's `/stream` carries the user identity in a confirmation dialog the user must click "Yes, this is me" on. (e) **Demo-portal phone-push:** the `demo_portal_claim` desktop-bind cookie (see A-13 scope note) is the equivalent of (a) on the sandbox surface — a shoulder-surfed `session_id` alone cannot mint a session because the attacker does not hold the `SameSite=Strict` claim cookie, and `/claim` is single-use. |
| **Test status** | Visual / UX gate, not automatable; add to manual QA. |
| **Audit signal** | `audit_events.action = 'pairing.expected_user_mismatch'` when the desktop sets `expected_user_did` and the proof's `did` differs. |

### A-24 — Side-channel leakage on the phone during proof generation

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) |
| **Surface** | The Android device while snarkjs runs in the WebView |
| **Description** | Groth16 proof generation in JS is not constant-time. Co-resident malicious apps with `BATTERY_STATS` permission, hostile USB chargers, or accessibility-service apps can correlate power/timing with proof generation and over many sessions recover bits of `biometricSecret`. |
| **Mitigation** | (a) Wipe the secret from memory immediately after proof generation. (b) Rate-limit proof generation: one per 2 s, ≤ 30/hour/device. (c) StrongBox-backed key wrapping so `biometricSecret` doesn't enter the WebView in plaintext when StrongBox is available (W5+ work). (d) **Process isolation per ADR-0010**: the WebView runs in `android:process=":prover"` with `android:isolatedProcess="true"`, so a co-resident side-channel observer that ATTAINS code execution still cannot read the long-lived Keystore-wrapped credential — only the in-flight witness for one proof; the `:prover` process is torn down on unbind and its heap pages are unmapped, defeating cross-session aggregation that the attack model relies on. (e) **Accepted residual risk for v1 demo** — documented in pilot SOW: ZeroAuth's side-channel posture is "best-effort with hardware-backed key derivation; not certified against EAL5+ side-channel attacks." |
| **Test status** | Out of scope for unit tests. Manual + lab review before BFSI tier-1 deployment. |
| **Audit signal** | None server-side. |

### A-25 — Pairing-session enumeration via guessable IDs

| | |
|---|---|
| **Class** | Information disclosure / EoP (STRIDE: I + E) |
| **Surface** | `GET /v1/proof-pairing/sessions/:id` and `/stream`, `POST .../submit` |
| **Description** | If session ids are guessable, an attacker probes them to (a) learn that session `abc-123` was claimed at 14:02 by user `u_4f8c…` or (b) submit a proof against any unconsumed session they find. |
| **Mitigation** | (a) Session id is UUIDv4 (122 bits effective entropy), generated by `crypto.randomUUID()`. (b) `/stream` and `/:id` require the `session_bind` cookie (A-13); without it they return 404 indistinguishably from "session doesn't exist." (c) `/submit` returns 404 (not 403, not 200) for any session id not owned by the requesting tenant — uniform error responses across "doesn't exist" and "exists but not yours." (d) Per-tenant rate limit on `/stream` polling: 1 req/s. |
| **Test status** | **Required before merge.** `status returns 404 for unknown id`, `status returns 404 for known-id-other-tenant`, `responses are indistinguishable in body, status, and timing within ±25 ms`. |
| **Audit signal** | `audit_events.action = 'pairing.session_probe'` when a tenant's `/stream` calls exceed 30 distinct session ids in 60 s. |

### A-26 — Timing side-channel between submit-failure paths

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) |
| **Surface** | `POST .../submit` |
| **Description** | The submit handler has multiple rejection paths with different latency profiles: invalid session id (DB lookup, fast), wrong tenant (DB lookup, fast), nonce mismatch (string compare, fast), Groth16 verify failure (off-chain verifier, ~30 ms). Latency differentials let an attacker distinguish "session exists for my tenant but proof is wrong" from "session doesn't exist" — combined with A-25 this defeats UUID's enumeration guarantee. |
| **Mitigation** | (a) Pad response time: all failure paths return after a target latency of 200 ms (`await sleep(200 - elapsed)` if `elapsed < 200`). One middleware, future handlers inherit. (b) `crypto.timingSafeEqual` on nonce/binding compares (not `===`). (c) Document the SLO: `p95 submit latency ≥ 200 ms` for both failed and successful proofs. |
| **Test status** | **Required before merge.** `failure paths return within ±25 ms of each other` — hit `/submit` with 100 of each failure mode, assert stddev < 25 ms across mode means. |
| **Audit signal** | None (mitigation, not detection). |

## Phase 1 Sprint 4 surfaces

> Added Sprint 4 (weeks 9–10). Sprint 4 introduces five new attack surfaces
> outside the proof-pairing core: **outbound webhooks** to tenant receivers
> (`user.enrolled`, `verification.completed`, `txn.step_up.completed`,
> `audit.anchor.published`), **metered billing** (`/v1/billing/*` +
> `/api/console/billing/*`), **RS256 JWT signing with a public JWKS**
> (`/.well-known/jwks.json` per C-028), **Redis-backed session store**
> for multi-instance scale-out (replacing the in-memory `src/services/session-store.ts`),
> and **live operator logs over SSE** (`/api/console/logs/stream`). Each
> introduces a fresh class of risk; mitigations below are required gates
> before the surface ships to a pilot tenant.
>
> A-33 (Stripe webhook replay) withdrawn — see ADR 0022.

### A-29 — Webhook receiver SSRF / internal-network pivot

| | |
|---|---|
| **Class** | Information disclosure / EoP (STRIDE: I + E) |
| **Surface** | `POST /api/console/webhooks` (tenant configures a receiver URL), worker that dispatches `user.enrolled` / `verification.completed` / `txn.step_up.completed` / `audit.anchor.published` events |
| **Description** | A tenant (or attacker controlling a tenant account) sets the webhook receiver URL to `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (cloud metadata), `http://localhost:5432/`, `http://127.0.0.1:6379/`, `http://10.0.0.1/admin`, or `file:///etc/passwd`. The dispatcher fires HTTP requests to that URL from inside the ZeroAuth VPS, pivoting to the metadata service, Postgres, Redis, or internal admin surfaces. |
| **Mitigation** | (a) URL validator rejects any scheme other than `https://`. (b) DNS resolution of the host is performed up-front; the resolved IP is checked against the deny-list: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local + IMDS), `::1/128`, `fc00::/7`, `fe80::/10`. (c) Redirects are followed only when the redirect target passes the same checks (re-resolve + re-check). (d) HTTP client uses a fresh socket per attempt with `lookup` hook that re-verifies the resolved IP against the deny-list at connection time (defeats DNS rebinding). (e) Per-tenant rate limit on dispatch retries (≤ 5/min/receiver). |
| **Test status** | **Required before merge.** `tests/webhook-ssrf.test.ts` cases: (i) `http://` URL rejected at config time, (ii) `https://169.254.169.254/…` rejected after DNS resolve, (iii) `https://attacker.com` → 302 → `http://127.0.0.1:5432` rejected at redirect-time, (iv) DNS-rebind attack where first lookup returns public IP and second returns 127.0.0.1 — rejected at connection-time lookup hook. |
| **Audit signal** | `audit_events.action = 'webhook.ssrf_blocked'`, severity high, with `metadata.target_ip_redacted` (only the /24, never the full IP). |
| **Open ADR** | `0019-webhook-egress-allowlist.md` — decide whether to default-deny outbound webhook hosts to a tenant-curated allow-list (additional safety vs. friction). Trigger to file: before first BFSI pilot SOW signing. |

### A-30 — Webhook signature forgery / replay against tenant receivers

| | |
|---|---|
| **Class** | Spoofing / Tampering (STRIDE: S + T) |
| **Surface** | The HTTP request `POST <receiver_url>` with header `X-ZeroAuth-Signature: t=<unix>,v1=<hex>` and JSON body, observed by any party with TLS-MITM capability or a passively-collected log |
| **Description** | A network attacker replays a captured `user.enrolled` webhook to the tenant's receiver after the original event has been processed, causing duplicate enrolments on the tenant side. Alternatively, a tenant with a leaked signing secret on one channel reuses the same secret on another, conflating event sources. Or: the receiver does not verify the signature at all (validation is the tenant's job) and accepts forged bodies from any sender. |
| **Mitigation** | (a) Signing: `v1 = HMAC-SHA256(secret, "<unix>.<raw_body>")` per Stripe-style convention, documented in `docs/api_contract.md` so tenant integrations get a copy-paste verifier. (b) `t` timestamp is rejected by the tenant's verifier if `|now - t| > 300 s` (5-min window, documented in the SDK helper). (c) Each event carries an `id` UUID; the tenant's receiver must persist seen IDs for ≥ 24h (documented; cannot be enforced server-side). (d) ZeroAuth holds the secret in `webhook_endpoints.secret_hash` (SHA-256), with the raw secret only shown once at create time + on rotate. (e) Per-endpoint rotate endpoint `POST /api/console/webhooks/:id/rotate-secret` — old secret accepted for a 24h grace window. (f) Outbound dispatcher uses one fresh HMAC per delivery; never reuses a payload across endpoints. |
| **Test status** | **Required before merge.** `tests/webhook-signing.test.ts`: (i) sign + verify round-trip, (ii) timestamp drift > 300 s rejected, (iii) modified body fails signature, (iv) old secret rejected after grace window. |
| **Audit signal** | `audit_events.action = 'webhook.delivered'` with `metadata.signature_version='v1'`, `webhook.delivery_failed` on non-2xx, `webhook.secret_rotated` on rotate. |
| **SDK obligation** | The published `@zeroauth/node-sdk`, `@zeroauth/python-sdk`, and the documentation snippet for "verify webhook" must all default-on the timestamp check; samples that omit the check are a footgun and are not shipped. |

### A-31 — Webhook receiver as oracle for tenant-internal state

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) — DPDP §8 purpose-limitation risk |
| **Surface** | The webhook payload body delivered to the tenant's URL |
| **Description** | The dispatcher includes fields helpful for the tenant (timestamp, `user.external_id`, `verification.id`, `txn.amount_minor`, `txn.payee_masked`). If a tenant misconfigures their endpoint or shares the URL with a third party, the payload leaks PII (external_id is often an employee number or phone-number-derived value; txn amount + masked payee reveal customer behaviour). |
| **Mitigation** | (a) Per-event-type field allow-list in `src/services/webhooks/payloads.ts`; never spread the full row into the body. (b) `did` is never in the payload; replaced with `did_sha256` for correlation. (c) `txn.amount_minor` is included only when the tenant's `webhook_endpoints.include_amounts = true` (opt-in, default false). (d) Document the payload schema in `docs/api_contract.md` so tenants can decide what to consume. (e) Sensitive payloads (`audit.anchor.published`) include only the anchor hash + block number, never the underlying audit row contents. |
| **Test status** | **Required before merge.** `tests/webhook-payload-purity.test.ts`: assert each event-type payload contains only the documented fields, fails on extra keys. Reuses the schema-purity pattern. |
| **Audit signal** | None directly; mapped to DPDP §8 in `docs/compliance/dpdp-mapping.md`. |

### A-32 — Billing API tampering for free-tier abuse / over-quota access

| | |
|---|---|
| **Class** | EoP / Tampering (STRIDE: E + T) |
| **Surface** | `GET /v1/billing/usage`, `POST /api/console/billing/plan`, `POST /api/console/billing/portal-session`, the Stripe webhook receiver at `POST /api/billing/stripe-webhook` |
| **Description** | (1) An attacker with one tenant's console JWT submits `POST /api/console/billing/plan {tenantId: 'other-tenant', plan: 'enterprise'}`, upgrading another tenant. (2) The Stripe webhook is forged (no signature check) and the dispatcher writes `tenants.plan = 'enterprise'` for any tenant the attacker names. (3) `GET /v1/billing/usage` from tenant A returns tenant B's counters because the query forgets a tenant filter. (4) A tenant on the free tier exceeds quota by racing thousands of `/v1/zkp/verify` requests before the metered counter increments — the increment is not transactional with the verify. |
| **Mitigation** | (a) `tenantId` for every billing endpoint comes from `getTenantContext(req)` or `req.console.tenantId`, never from body / query (same rule as A-10, A-12). (b) Stripe webhook handler verifies `Stripe-Signature` per the official SDK; rejects on mismatch. (c) Quota enforcement is atomic: `UPDATE tenants SET monthly_usage_count = monthly_usage_count + 1 WHERE id = $1 AND monthly_usage_count < plan_limit RETURNING monthly_usage_count` — when zero rows returned, the verify itself returns 402 before invoking the verifier. (d) Plan changes write `audit_events.action = 'billing.plan_changed'` with the actor (Stripe webhook event ID, or console JWT subject). |
| **Test status** | **Required before merge.** `tests/billing-cross-tenant.test.ts` (tenant A cannot change tenant B's plan); `tests/billing-stripe-signature.test.ts` (forged webhook → 400); `tests/billing-quota-race.test.ts` (1000 concurrent verifies under a 100-verify quota → exactly 100 succeed + 900 return 402). |
| **Audit signal** | `audit_events.action ∈ {'billing.plan_changed', 'billing.quota_exceeded', 'billing.stripe_event_received', 'billing.stripe_signature_failed'}`. |

### A-34 — RS256 private-key compromise on the API host

| | |
|---|---|
| **Class** | EoP / Spoofing (STRIDE: E + S) |
| **Surface** | `JWT_SIGNING_KEY_PRIVATE` (RS256 PEM) on the VPS filesystem at `/opt/zeroauth/keys/jwt-current.pem`; the corresponding public key is published at `https://api.zeroauth.dev/.well-known/jwks.json` |
| **Description** | An attacker with read access to the VPS filesystem (compromised dependency with native code, container escape, ssh-key reuse, backup-tarball leak) extracts the private RSA key. They can now mint console JWTs and `/v1/identity/*` session JWTs for any tenant for the lifetime of the key. Rotating the key requires a JWKS update + a tolerance window during which both keys must verify, otherwise live sessions break. |
| **Mitigation** | (a) Key file mode `0400` owned by `zeroauth-deploy`; not in any git history, not in any backup that leaves the VPS host. (b) JWKS endpoint serves **two** keys during rotation: `kid=current` + `kid=next`. New tokens are signed under `current`; verifiers accept either. After a 24h overlap, `next` becomes `current` and the old key is wiped from disk. The boot-time loader fails closed if `JWT_SIGNING_KEY_PRIVATE` is missing or unparseable. (c) Rotation script `scripts/rotate-jwt-keys.sh` documented in `docs/operations/jwt-rotation.md`; the script is the only path that touches the key files (auditable). (d) JWKS `kid` is stable across the rotation; clients (`jose`, `jsonwebtoken --jwksUri`) cache by `kid` and pick up the new key on the next fetch with no code change. (e) Emergency revocation: a separate `jwt_revoked_keys` table lists kids that must never verify — boot-time guard rejects any token signed under a revoked kid even if the public key is still in the JWKS. (f) Tokens carry `iss = "https://api.zeroauth.dev"` + `aud ∈ {'zeroauth-console','zeroauth-v1'}`; both checked on every verify. |
| **Test status** | **Required before merge.** `tests/jwt-rs256.test.ts`: (i) token signed under `current` verifies, (ii) token signed under `next` verifies (rotation overlap), (iii) token signed under a kid not in JWKS rejected, (iv) token signed under a revoked kid rejected, (v) JWKS endpoint returns only public-key material — no `d`, `p`, `q`, `dp`, `dq`, `qi`. |
| **Audit signal** | `audit_events.action ∈ {'jwt.key_rotated', 'jwt.key_revoked', 'jwt.verify_failed_unknown_kid'}`. |
| **Residual risk** | A successful one-shot extraction is undetectable from the network — there is no per-token attestation that proves the signer is the real VPS. Compensating control is the kid-revocation list + a 24h rotation window during incident response. Long-term: hardware-backed signing (KMS / HSM) — tracked in `adr/0020-jwt-signing-kms-evaluation.md`. |

### A-35 — JWKS endpoint poisoning / DoS

| | |
|---|---|
| **Class** | DoS / Spoofing (STRIDE: D + S) |
| **Surface** | `GET https://api.zeroauth.dev/.well-known/jwks.json` |
| **Description** | (1) A cache-poisoning attack on a CDN or DNS layer serves a forged JWKS, letting the attacker mint tokens that downstream services (other ZeroAuth instances, partner SDKs that cache the JWKS) accept. (2) An attacker hammers the endpoint to force JWKS rebuilds and force the API to spend CPU on PEM parsing per request. |
| **Mitigation** | (a) JWKS endpoint is served from a static in-memory snapshot built at boot from `/opt/zeroauth/keys/*.pem`; no per-request PEM parsing. (b) HTTP `Cache-Control: public, max-age=300` + `ETag` for client-side caching. (c) The JWKS response is signed by an offline-rotated long-lived root key — published as `signed_jwks` alongside the JWKS itself; client SDKs verify the signature against the pinned root public key before trusting the JWKS. (Defers cache-poisoning concerns to the offline root, which is rotated under a four-eyes process documented in the rotation runbook.) (d) HSTS preload (already set) + CT-log monitoring for `*.zeroauth.dev` certs catches MITM at the TLS layer. (e) Per-IP rate limit on the JWKS endpoint (≥ 60/min/IP, generous for legitimate caches). |
| **Test status** | **Required before merge.** `tests/jwks-endpoint.test.ts`: (i) JWKS body is byte-identical to a snapshot fixture (regression guard for accidental key leakage), (ii) `Cache-Control` header set, (iii) `ETag` set + 304 returned on `If-None-Match`. The signed-JWKS pattern lands in a follow-up PR before public SDK release. |
| **Audit signal** | None at the JWKS layer. Downstream `jwt.verify_failed_unknown_kid` (A-34) covers the consumed-bad-key signal. |

### A-36 — Algorithm-confusion attack (RS256 → HS256) during migration

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | All `jwt.verify` paths in `src/services/jwt.ts` during the HS256→RS256 cutover |
| **Description** | The classic `alg=none` and `alg=HS256` confusion against an RS256 verifier: an attacker submits a token with `alg: 'HS256'` and signs it with the **public** RSA key (which they fetched from JWKS), and a permissive `verify(token, key)` call where `key` is the RSA public key string would accept it because `jsonwebtoken` treats the key as an HMAC secret when `alg=HS256`. |
| **Mitigation** | (a) Every `jwt.verify` call passes `{ algorithms: ['RS256'] }` explicitly; never an empty / wildcard list. (b) `jwt.sign` is wrapped in `signRs256(payload)` helper that hardcodes `{ algorithm: 'RS256' }` — no callsite picks the algorithm. (c) ESLint rule (`no-restricted-syntax`) forbids direct `jsonwebtoken.verify(` and `jsonwebtoken.sign(` calls outside `src/services/jwt.ts`. (d) Boot-time self-test: sign a fixture payload, tamper its `alg` to `HS256` + `none`, assert verify fails — fails closed if not. |
| **Test status** | **Required before merge.** `tests/jwt-alg-confusion.test.ts`: (i) `alg=HS256` signed with RSA public key → reject, (ii) `alg=none` → reject, (iii) `alg=RS512` (different RSA variant) → reject. |
| **Audit signal** | `audit_events.action = 'jwt.alg_confusion_attempt'`, severity high (rare in legitimate traffic; high-signal). |

### A-37 — Redis session-store hijack via network exposure

| | |
|---|---|
| **Class** | EoP / Information disclosure (STRIDE: E + I) |
| **Surface** | The Redis instance backing `src/services/session-store.ts` after the multi-instance migration |
| **Description** | (1) Redis on `127.0.0.1:6379` with no auth on a multi-tenant VPS — any process on the host can `KEYS session:*` and dump every active session. (2) Redis exposed to the public internet during a misconfigured firewall change. (3) Redis without TLS over the internal Docker network — a compromised sidecar container reads sessions off the wire. |
| **Mitigation** | (a) Redis listens only on the internal Docker network (`zeroauth_internal`), no public port mapping in `docker-compose.yml`. (b) `requirepass` set from `REDIS_PASSWORD` env (32-byte random; rotated alongside the app's deploy secrets). (c) TLS-encrypted client (`rediss://`) when the broker isn't co-located. (d) Session values are AEAD-encrypted at the application layer with a key in `SESSION_ENCRYPTION_KEY` — Redis sees ciphertext only, so a `KEYS *` dump returns opaque blobs. (e) Per-session keys are namespaced `session:{tenant_id}:{session_id}` and the session-store API rejects cross-tenant key access at the SDK layer (defense in depth in case of a code path that takes session_id from input). (f) Redis `CONFIG GET *` + `CLIENT LIST` accessible only via `redis-cli` over a local Unix socket on the host, never over TCP. |
| **Test status** | **Required before merge.** `tests/session-store-redis.test.ts`: (i) write + read round-trip, (ii) value at the Redis level is ciphertext (mock Redis, assert stored bytes don't contain the plaintext user ID), (iii) cross-tenant key access throws. Infra: `scripts/check-redis-binding.sh` asserts Redis is not reachable from the public Docker bridge. |
| **Audit signal** | `audit_events.action = 'session.store_read_failure'` on decryption failure (signal of tampered-with Redis state). |
| **Open ADR** | `0022-redis-vs-postgres-sessions.md` — captures the decision to use Redis (latency + LRU) vs. Postgres (one less moving piece) and the migration plan from the existing in-memory store. |

### A-38 — Session fixation / race during multi-instance scale-out

| | |
|---|---|
| **Class** | Spoofing / EoP (STRIDE: S + E) |
| **Surface** | Redis-backed session store under concurrent reads/writes from N API instances behind a load balancer |
| **Description** | (1) Instance A writes `session:S` then crashes before the LB notices; instance B's request finds the session in Redis and proceeds — but A's crash dropped a pending audit write. (2) Race: two concurrent `POST /v1/identity/verify` calls with the same session ID hit instances A and B; both read state `pending`, both flip to `consumed`, two JWTs are minted. (3) After a `POST /api/console/logout`, a request to instance C that hasn't seen the invalidation continues to accept the revoked token. |
| **Mitigation** | (a) Session-store writes use Redis `SET … NX EX` for create and `WATCH … MULTI … EXEC` for state transitions — single-writer wins, others get `OperationAborted` → retry. (b) Audit writes are committed to Postgres **before** the session-store transition; on a crash mid-write, the next read-side observer sees the audit row + the prior session state and refuses to proceed (fail closed). (c) Logout writes a `jti` to the `revoked_jtis` set with TTL = remaining-token-lifetime; every JWT verify call (every instance) checks `revoked_jtis` (one Redis SISMEMBER per request, sub-ms). (d) Sticky-session affinity at the LB layer is **not** relied on for correctness — every instance must work for every request. (e) Health-check endpoint returns the instance's Redis-connection state; LB removes instances with stale Redis from rotation. |
| **Test status** | **Required before merge.** `tests/session-store-concurrency.test.ts`: (i) two concurrent state transitions → one succeeds + one retries, (ii) revoked `jti` rejected on any instance, (iii) logout on instance A → fetch on instance B returns 401 within 100 ms. |
| **Audit signal** | `audit_events.action ∈ {'session.race_lost', 'session.revoked_jti_replay'}`. |

### A-39 — Live-logs SSE leaking other tenants' events

| | |
|---|---|
| **Class** | Information disclosure / EoP (STRIDE: I + E) |
| **Surface** | `GET /api/console/logs/stream` (SSE) — streams real-time `audit_events` + `api_calls` rows for the authenticated tenant |
| **Description** | (1) The handler filters by `tenant_id` only at the initial query and forgets to filter the subsequent stream — a tenant subscribes to a Postgres `LISTEN` channel that delivers every row. (2) An attacker with one console JWT passes `?tenantId=...` in the URL hoping the handler honours it. (3) An admin debugging an issue connects via the console and the stream includes other tenants' events because admin scope inherits all tenants by default. (4) The SSE long-lived connection survives a tenant-context refresh (e.g., the console JWT is updated mid-stream); the stream keeps emitting under the old tenant scope. |
| **Mitigation** | (a) `tenantId` for the stream is derived only from `req.console.tenantId`; query/body ignored. (b) The Postgres notification handler (`db.on('notification', …)`) filters payloads by `tenantId` before pushing to the SSE response — never trust the channel to be tenant-scoped. (c) Admin scope cannot use this endpoint; admins use `/api/admin/logs/stream` which is separately authenticated and requires `X-Admin-Scope: cross-tenant` to be explicitly passed (and audit-logged as `admin.cross_tenant_logs_opened`). (d) On any JWT-refresh / scope-change event, the SSE handler closes the connection and forces the client to re-open with the new credential. (e) Output sanitisation: same purity rules as A-31 — never echo `did`, `biometric_template`, raw request bodies, or any field with PII-class metadata. |
| **Test status** | **Required before merge.** `tests/console-logs-sse.test.ts`: (i) tenant A's stream never receives tenant B's row even when both are published in the same Postgres `NOTIFY`, (ii) `?tenantId=otherTenant` is ignored, (iii) connection closes within 1 s of a `POST /api/console/logout`, (iv) emitted records never contain `did`, `biometric_template`, or the request body. |
| **Audit signal** | `audit_events.action ∈ {'console.logs_stream_opened', 'console.logs_stream_cross_tenant_attempt'}`. The "opened" row records `tenant_id`, `actor_user_id`, `client_ip_hash` so the audit trail shows who watched what when. |
| **Open ADR** | `0021-sse-vs-websocket-for-live-streams.md` — SSE is one-way; the dashboard wants typed acks for "log row read". Decide WS upgrade before SDK v1. |

### A-40 — SSE keep-alive abuse / slow-client connection exhaustion

| | |
|---|---|
| **Class** | DoS (STRIDE: D) |
| **Surface** | `GET /api/console/logs/stream`, `GET /v1/proof-pairing/sessions/:id/stream` |
| **Description** | An attacker opens hundreds of SSE connections and keeps each alive at minimum keep-alive cost (reads bytes very slowly). Each connection consumes a Node.js event-loop slot + a Postgres LISTEN handle + Redis pub/sub slot. The pool exhausts; legitimate console users see "stream unavailable". |
| **Mitigation** | (a) Per-tenant cap of 5 concurrent SSE connections on `/api/console/logs/stream`; the 6th is rejected with 429 + `Retry-After`. (b) Per-IP cap of 20 concurrent SSE across all SSE endpoints. (c) Idle-timeout: any SSE connection that hasn't acknowledged a heartbeat in 30 s is closed (heartbeat is a `: ping` comment line every 15 s; client-side EventSource handles it transparently). (d) Slow-client write-buffer cap: if the write buffer to the client exceeds 64 KB the connection is closed (Node's `writable.writableLength > 65536`). (e) Connection-count metric exported to Prometheus; alert at 80% of cap per instance. |
| **Test status** | **Required before merge.** `tests/console-logs-sse-limits.test.ts`: (i) 6th concurrent connection per tenant → 429, (ii) slow client where reads are throttled → connection closed after buffer threshold, (iii) idle-timeout fires after 30 s of no heartbeat ack. |
| **Audit signal** | `audit_events.action = 'console.logs_stream_capacity_rejected'` for 429s; Prometheus alert for capacity-exhaustion. |

### A-41 — Attendance buddy-punch / off-site check-in

| | |
|---|---|
| **Class** | Spoofing / repudiation (STRIDE: S + R) |
| **Surface** | `POST /api/attendance/record` — the employee's own phone marks attendance |
| **Description** | An employee who is not physically at the office wants to be marked present. In the own-phone model the face proof is genuinely theirs, so identity is not the gap — *presence* is. (1) The employee opens the app at home and tries to check in. (2) A colleague at the office tries to mark an absent employee present from the colleague's phone — but that fails the face proof (it is bound to the absent employee's secret on the absent employee's device). |
| **Mitigation** | (a) Presence is gated by a WiFi anchor: the phone reports the connected BSSID + signal %, and the server **re-checks** both against the company's configured anchor (`verifyWifiAgainstAnchor`) before accepting — a home check-in fails `outside_anchor` because the office router is out of radio range. (b) The face proof binds the event to one enrolled identity on one device, so a colleague cannot punch for an absent employee. (c) An off-network attempt with a valid face is still verified and written as a `result:'rejected'` row (+ audit), so HR sees the attempt rather than a silent drop. (d) **Residual risk:** WiFi-range only — a relay/wormhole (someone physically at the door tethering the absent employee onto the office network) is out of scope for slice 1; NFC-tap / BLE-beacon relay-proof presence is the documented hardening follow-up. |
| **Test status** | `tests/attendance-bridge.test.ts`: BSSID mismatch → `403 outside_anchor` + `rejected` row; weak signal → `403`; happy path on-anchor → `201 accepted`. |
| **Audit signal** | `audit_events.action = 'attendance.recorded'`, `status='failure'` for the `rejected` (off-anchor) rows; `metadata.wifi_reason ∈ {bssid_mismatch, weak_signal, missing_reading, no_anchor_configured}`. |

### A-42 — Spoofed WiFi presence attestation (mock BSSID)

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /api/attendance/record` — the `wifi: { bssid, signal }` attestation is computed on-device |
| **Description** | The phone self-reports the network it is on. A rooted device or a patched APK could report the office BSSID + a strong signal while physically elsewhere, defeating the presence gate. |
| **Mitigation** | (a) The server holds the authoritative anchor config and only ever trusts a BSSID that matches it — an attacker must know the exact office BSSID, not merely any value. (b) The same proof-pairing Play-Integrity policy that gates sign-in (`allow_play_integrity_absent`, `require_*_integrity`) applies to attendance verification, so a tenant can require a hardware-attested, non-rooted device before any check-in is accepted. (c) **Residual risk:** on a permissive (demo) tenant a determined attacker with a modified client can still forge the BSSID; closing this fully requires either device-attested location (Play Integrity + a trusted location provider) or a co-presence channel (NFC/BLE). Documented, not yet mitigated for permissive tenants. |
| **Test status** | `tests/attendance-bridge.test.ts` pins the server-side re-check (`verifyWifiAgainstAnchor`); Play-Integrity enforcement is covered by `tests/proof-pairing.test.ts` (shared verifier). |
| **Audit signal** | `audit_events.metadata` carries only the WiFi **verdict** — `wifi_ok` + `wifi_reason` + `wifi_signal` — never the raw office BSSID, so no location identifier is persisted to the immutable audit trail (data-minimisation). |

### A-43 — Attendance proof replay / session reuse

| | |
|---|---|
| **Class** | Spoofing / EoP (STRIDE: S + E) |
| **Surface** | `POST /api/attendance/init` → `POST /api/attendance/record` |
| **Description** | An attacker captures a valid `(did, proof, publicSignals)` for one check-in and replays it — either to the same session twice or to a new session — to forge additional attendance events. |
| **Mitigation** | (a) Each `record` is bound to a single proof-pairing session whose nonce the proof commits to via `publicSignals[1] = Poseidon(didHash, nonce)`; a proof minted for one nonce fails the binding on any other session (A-11, inherited). (b) The session bind token is stashed server-side at `init` and **consumed single-use** at `record`, so a second `record` for the same session id returns `410 attendance_session_expired` before any crypto runs. (c) The underlying `submitProof` atomic `UPDATE … WHERE state='issued'` makes the consume race-safe (A-14, inherited). |
| **Test status** | `tests/attendance-bridge.test.ts`: a second `record` on the same session id → `410 attendance_session_expired`, `submitProof` invoked exactly once. Inherited nonce-binding + atomic-consume coverage in `tests/proof-pairing.test.ts`. |
| **Audit signal** | Inherited `pairing.replay_blocked` / `pairing.race_lost` from the proof-pairing verifier. |

### A-44 — HR admin portal session / surface isolation

| | |
|---|---|
| **Class** | Spoofing / EoP (STRIDE: S + E) |
| **Surface** | `/api/hr/*` — the standalone attendance admin portal |
| **Description** | (1) An HR-admin JWT is replayed on `/v1/*` or `/api/console/*` to escalate into the platform or developer console; or a console/`/v1` token is replayed on `/api/hr/*`. (2) An HR admin reads/writes another tenant's roster or attendance by tampering with a request. |
| **Mitigation** | (a) The HR JWT carries issuer **and** audience `zeroauth-hr-admin` (distinct from `zeroauth-console` and the `/v1` `zeroauth` issuer); `verifyHrAdminToken` rejects any other audience, and `requireConsoleAuth`/`/v1` verifiers reject the HR audience. (b) Every `/api/hr/*` query is scoped to `req.hrAdmin.tenantId` (from the verified token) — never a client-supplied tenant/company. (c) The cookie is HttpOnly, `SameSite=Strict`, path `/api/hr`. (d) Scrypt password hashing (reused from `tenants.ts`); write routes are rate-limited per admin id. |
| **Test status** | `tests/hr-admin.test.ts`: an HR token → 401 on `/api/console/keys`; a console-audience token → 401 on `/api/hr/account`; auth required; signup/login/provision happy paths. |
| **Audit signal** | `audit_events.actor_type='hr_admin'` for company/member writes. |

### A-45 — Provision-then-claim invite abuse

| | |
|---|---|
| **Class** | Spoofing (STRIDE: S) |
| **Surface** | `POST /api/hr/employees` (provision) → `POST /api/attendance/claim` |
| **Description** | (1) A captured `(did, commitment, proof)` tuple (observable on every prior sign-in) is replayed into an open invite to drive the binding / deny onboarding. (2) A stolen invite code lets a third party complete the ceremony. (3) An invite is reused for multiple identities. |
| **Mitigation** | (a) **Server-nonce freshness (primary).** The claim is bound to a fresh `/init` session: `proof-pairing.verifyAndConsumeForClaim` enforces `publicSignals[1] = Poseidon(Poseidon(commitment), nonce)` (the SAME A-11 binding as check-in), runs the Groth16 verifier loopback rejecting `structuralFallback`, and consumes the session single-use. A captured proof carries the prior session's nonce fold and fails → `400 pairing_nonce_mismatch`. (b) **Single-use invite** — SHA-256-hashed at rest, consumed atomically (`FOR UPDATE` + `invite_code_hash=NULL`) inside the claim transaction, **48-hour** TTL; a replayed claim finds no live invite → `410`. (c) `commitmentsEqual(publicSignals[0], commitment)` is gated before the proof verify, so `did_hash = Poseidon(commitment)` binds the value the proof committed to. (d) `UNIQUE(company_id, did)` prevents two memberships sharing a DID. See ADR 0025. **Residual:** the invite is a bearer secret delivered out-of-band, so the proof binds *freshness + control of the committed secret*, not *that the claimer is the named employee* — that trust flows through invite delivery. Documented; future hardening = deliver the code to the employee's verified channel + bake the nonce into the circuit's public inputs. |
| **Test status** | `tests/attendance-membership.test.ts`: claim requires `sessionId` (400 without); valid claim → 200; expired/used invite → 410; bad proof → 401. `tests/attendance-membership-service.test.ts`: real `did_hash = Poseidon(commitment)` derivation; `commitment_mismatch` before proof; rollback (invite unconsumed) on nonce/proof failure. |
| **Audit signal** | `attendance.member_provisioned` / `attendance.membership_claimed`. |

### A-46 — Cross-company attendance leakage

| | |
|---|---|
| **Class** | Information disclosure / EoP (STRIDE: I + E) |
| **Surface** | `POST /api/attendance/record` with a `companyId` |
| **Description** | A verified employee of company A submits a check-in against company B's `companyId` to forge presence there, or to probe B's WiFi anchor. |
| **Mitigation** | (a) `record` resolves the company's own tenant and gates on `findClaimedMembership(companyId, did)` → `403 not_a_member` unless the DID is a **claimed** member of *that* company. (b) The WiFi anchor returned by `/company` is non-sensitive config (the BSSID is required to be matched, not secret); the real gate is the server-side re-check + membership. (c) The demo (`companyId` absent) keeps the slice-1 any-registered-user behaviour and is isolated to the demo tenant. |
| **Test status** | `tests/attendance-membership.test.ts`: company-scoped record for a claimed member → 201 (scoped to the company's tenant); non-member → `403 not_a_member`, no event written. |
| **Audit signal** | `attendance.recorded` under the company's own tenant; non-member attempts return 403 without a row. |

### A-47 — Bank 2FA: approval-inbox poll + pinned-session integrity

| | |
|---|---|
| **Class** | Spoofing / Information disclosure (STRIDE: S + I) |
| **Surface** | `POST /api/demo-portal/bank/login` (opens a pinned session), `POST /api/demo-portal/device/pending` (the app's inbox poll), `POST /api/demo-portal/submit-proof` (the approval). |
| **Description** | Two risks. (1) *Approval hijack:* a different enrolled user (or an attacker with a captured proof) tries to approve someone else's password-initiated login. (2) *Inbox enumeration:* the pending poll is authenticated only by DID knowledge, so anyone holding a victim's public DID can observe that a login is pending (+ coarse browser hint) — a privacy/notification-spam vector, not an auth bypass. |
| **Mitigation** | (1) **CLOSED by DID pinning, enforced at the shared session layer.** The login-opened session carries `expected_did`. `proof_pairing_sessions` has THREE consumers, and the pin holds on all of them (a Critical the security review caught — enforcing it only in `submitProof` left `verifyIdentityProof`/`/v1/identity/verify` and `verifyAndConsumeForClaim` as bypass paths): `submitProof` + `verifyIdentityProof` reject a foreign DID with the uniform `pairing_did_unknown` *before* the user lookup; `verifyAndConsumeForClaim` (the claim flow, which never pins) refuses any pinned session outright as uniform not-found; and — belt-and-braces — every atomic consume UPDATE carries `AND (expected_did IS NULL OR expected_did = $did)`, so the DB is the single enforcement point no future consumer can miss. The pinned identity's proof still passes the full chain (commitment CT-compare, `Poseidon(didHash, nonce)` binding, Groth16 verify, single-use consume). Password (first factor: scrypt, uniform 401, lockout at 10, timing-uniform across unknown/wrong/locked) and face proof (second factor) are owned by different parties — the bank and the phone. (2) *Accepted for the demo:* `/device/pending` leaks only "a login is pending" + a **coarse** browser/OS family (full UA version string is not surfaced) for a known DID, and is per-IP rate-limited; approval is impossible without the enrolled face. Production path: FCM push + a bind-time device token authenticating the poll — the endpoint's contract note marks it. |
| **Test status** | `tests/pinned-pairing.test.ts` — pin enforced pre-lookup + never-consumed on ALL THREE consumers (`submitProof`, `verifyIdentityProof`, `verifyAndConsumeForClaim`), unpinned back-compat; `tests/bank-2fa.test.ts` (uniform 401, lockout, pinning arg threaded, coarse inbox hint); `tests/demo-bank.test.ts` (scrypt at rest, timing-uniform unknown-customer path, counter reset). |
| **Audit signal** | `pairing.pinned_did_mismatch` on a wrong-identity approval attempt (both `submitProof` and `verifyIdentityProof`); `bank.account_opened`, `bank.login_password_ok`, `bank.transfer_stepup_requested`, `bank.transfer_settled` on the bank flow. |
| **Payment step-up** | The same pin protects high-value payments: a transfer ≥ ₹10,000 opens a pinned, `context_label`-tagged session, and money moves (`commitTransferIfApproved`) ONLY when that session reaches `consumed` — i.e. the account holder's own face approved it. The debit is a single-winner status-flip + a funds-guarded `UPDATE`, so it is idempotent and cannot double-spend or overdraw. A wrong face → pin reject → session stays `issued` → the transfer is never committed and expires to `declined`. `tests/demo-bank-ledger.test.ts` pins the money-gate (consumed→debit, issued→no-debit, expired/failed→declined, idempotent). |

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
LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek
