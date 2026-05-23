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
| `https://api.zeroauth.dev/api/auth/saml/*`, `…/oidc/*` | Public, gated by `ENABLE_DEMO_AUTH` flag | Demo stubs; **do not** validate real SAML signatures or OIDC tokens. Off in production. |
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
| **Mitigation** | [ADR-0010](https://github.com/zeroauth-dev/ZeroAuth/blob/main/adr/0010-android-webview-snarkjs-bundling.md): snarkjs is bundled in the APK at `android/app/src/main/assets/prover/`, SHA-256 pinned in the ADR, build fails on mismatch. WebView CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`. WebView in a separate renderer process. No `file://`, no `content://`, no DOM storage. Play Integrity verdict travels in `clientMeta.playIntegrityVerdict` for W4 server-side enforcement. |
| **Test status** | **Required before Android app merge.** CI step diffs `assets/prover/*.sha256` against the ADR-pinned table; build fails on mismatch. |
| **Audit signal** | If `clientMeta.snarkjsHash` ever travels in the submit, log mismatches as `audit_events.action = 'pairing.unexpected_prover_hash'`. |

### A-18 — Rooted/jailbroken phone with extracted Keystore secret

| | |
|---|---|
| **Class** | Spoofing / EoP (STRIDE: S + E) |
| **Surface** | Android app, BiometricPrompt + Keystore-wrapped secret |
| **Description** | On a rooted device, an attacker with root can dump the wrapped `biometricSecret`, bypass BiometricPrompt, and produce valid proofs at will — defeats A-11's protection because they're generated fresh against the live nonce with the legitimate key. |
| **Mitigation** | Key gen params: `setUserAuthenticationRequired(true)` + `setInvalidatedByBiometricEnrollment(true)` + `setUserAuthenticationParameters(0, BIOMETRIC_STRONG)` + `setIsStrongBoxBacked(true)` where available + `setUnlockedDeviceRequired(true)`. Play Integrity verdict captured at proof time. Tenant policy knob `tenant.security_policy.require_strong_integrity` defaults true for `live` (W4 enforcement). |
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
| **Mitigation** | (a) Pairing handlers must `await recordAuditEvent(...)` on the critical-path events (`pairing.claimed`, `pairing.cross_tenant_blocked`, `pairing.replay_blocked`, `pairing.session_bind_mismatch`). Audit-write failure on these paths returns 500 — better to fail the login than to mint a session with no audit trail. (b) High-volume nuisance events (`pairing.failed`, `pairing.race_lost`) stay fire-and-forget but increment a Prometheus counter on `.catch()`. (c) DB-level: add a `BEFORE UPDATE OR DELETE` trigger on `audit_events` raising an exception (filed as ADR-0011, pilot blocker). |
| **Test status** | **Required before merge.** Per action verb: `pairing.X writes an audit row with the expected actor + metadata`. |
| **Audit signal** | Recursive: `audit.write_failure` metric + page-the-on-call when audit writes fail at > 0.1 % rate. |

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
| **Mitigation** | (a) A-13's session-bind cookie makes the minted JWT undeliverable to the attacker. (b) 5-min TTL with a visible countdown. (c) Desktop modal renders the QR inside an opt-in "Hide screen from others" affordance. (d) After consumption, the desktop's `/stream` carries the user identity in a confirmation dialog the user must click "Yes, this is me" on. |
| **Test status** | Visual / UX gate, not automatable; add to manual QA. |
| **Audit signal** | `audit_events.action = 'pairing.expected_user_mismatch'` when the desktop sets `expected_user_did` and the proof's `did` differs. |

### A-24 — Side-channel leakage on the phone during proof generation

| | |
|---|---|
| **Class** | Information disclosure (STRIDE: I) |
| **Surface** | The Android device while snarkjs runs in the WebView |
| **Description** | Groth16 proof generation in JS is not constant-time. Co-resident malicious apps with `BATTERY_STATS` permission, hostile USB chargers, or accessibility-service apps can correlate power/timing with proof generation and over many sessions recover bits of `biometricSecret`. |
| **Mitigation** | (a) Wipe the secret from memory immediately after proof generation. (b) Rate-limit proof generation: one per 2 s, ≤ 30/hour/device. (c) StrongBox-backed key wrapping so `biometricSecret` doesn't enter the WebView in plaintext when StrongBox is available (W5+ work). (d) **Accepted residual risk for v1 demo** — documented in pilot SOW: ZeroAuth's side-channel posture is "best-effort with hardware-backed key derivation; not certified against EAL5+ side-channel attacks." |
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
LAST_UPDATED: 2026-05-22
OWNER: Pulkit Pareek
