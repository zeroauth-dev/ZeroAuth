# ADR 0020 — Migrate console JWT from HS256 to RS256 with published JWKS

- **Status:** Proposed
- **Date:** 2026-06-01
- **Phase:** Phase 0, sprint 2 (closes audit finding C-11 — JWT symmetric-key class)
- **Owner:** Agent #12 (Senior Cryptography — key management + HSM)
- **Related:** ADR 0011 (branching workflow), ADR 0013 (audit log hash chain — every JWT verify writes an audit row), ADR 0016 (zod input validation — JWKS response shape), `docs/security/audit-findings.md` C-11, `docs/threat_model.md` row A-08 (key-compromise blast radius), `docs/api_contract.md` § Console auth, `src/services/jwt.ts` (the implementation surface this ADR governs).

## Context

The developer console JWT — minted by `POST /api/console/login`, consumed by every `/api/console/*` handler via the JWT middleware — is signed today with **HS256** (HMAC-SHA-256) keyed on a single symmetric secret `JWT_SECRET`. The same secret signs and verifies. The verifier is the API process itself, but the architectural roadmap calls for **at least three more verification surfaces** in the next two phases:

1. The **out-of-process verifier service** (Phase 2 split — `services/verifier` will run separately from `services/api` so verification can scale independently from issuance).
2. A **bank IdP / customer gateway** that proxies our API behind their own identity layer and wants to verify the bearer token before forwarding it.
3. A **horizontally scaled API fleet** — multiple Node 20 pods behind the load balancer, all needing to verify tokens minted by any of their peers.

Under HS256, every additional verifier requires the same `JWT_SECRET`. That has three concrete consequences this ADR proposes to eliminate.

### Problem 1 — Tenants and partners cannot verify without becoming co-issuers

If we hand `JWT_SECRET` to a bank's IdP so it can verify our tokens on their gateway, that bank can **immediately mint tokens against our identity**. There is no cryptographic distinction between signing and verifying under HMAC. The integration story today is therefore "we verify all your tokens server-side" — fine for a single-pod deployment, untenable for a partner integration where the partner wants to do its own validation at the edge.

Asymmetric signing splits the role. The signer holds the private key. Anyone can hold the public key. A bank IdP that fetches our JWKS gets exactly the capability to **verify**, with zero capability to mint.

### Problem 2 — Rotation is destructive

`JWT_SECRET` rotation today means:

- Generate a new `JWT_SECRET`.
- Deploy it to every process that verifies (API today; +2 surfaces in Phase 2).
- Every token already in circulation is **instantly invalid** at the moment the new secret takes effect on the verifier.

Operationally that forces every console-logged-in operator to re-login on rotation day. We have not actually rotated `JWT_SECRET` in production since the value was committed to the secret store eight months ago. That is the C-11 audit-finding headline: **"production has never rotated the JWT signing key because rotation is a hostile UX event."**

Asymmetric rotation is non-destructive. The signer flips to a new private key; the JWKS endpoint publishes the new public key alongside the old one (matched by `kid`); existing tokens minted by the old private key continue to verify against the still-published old public key until they expire naturally. The old key drops out of the JWKS after the longest-lived token has expired (24 h by default for refresh tokens). No operator is logged out by the rotation itself.

### Problem 3 — No `kid` claim, no multi-key future

Today's HS256 tokens carry no `kid` (key ID) in their header. Even if we wanted to roll over to a second secret without dropping the first, the verifier has no way to pick which secret to try — it would have to brute-force both. The standard JOSE answer is `kid` in the header pointing at a key in the JWKS. RS256 with JWKS naturally carries `kid`; HS256 deployments rarely do.

### Compliance posture

The Phase 0 compliance survey (`docs/compliance/compliance-roadmap-v1.md`) maps two existing-customer asks to this ADR:

- **SOC 2 CC6.1** — "logical access security measures protect against threats from sources outside the system boundary." The auditor reading this control looks for *separation of signing authority from verification authority*. HS256 fails this on its face: every verifier is a signer. RS256 passes — the private key lives in one process and one secret store entry; every verifier holds only the public key.
- **ISO 27001 Annex A.10.1.1 (Cryptographic controls)** — the control objective is "ensure proper and effective use of cryptography to protect the confidentiality, authenticity and/or integrity of information." The Annex's commonly-cited implementation guidance prefers asymmetric signing for tokens that cross a trust boundary. Our console JWT crosses such a boundary the moment a partner gateway wants to verify it.

Neither standard *forbids* HS256 — both call out symmetric vs asymmetric as a risk-based choice. ZeroAuth's risk profile (multi-tenant, BFSI customers, partner-gateway integration on the Phase 2 roadmap) places us firmly in the asymmetric column.

## Decision

Adopt **RS256 with a JWKS endpoint** as the migration target for the console JWT. Ship the change as an **env-flag-gated rollover** so existing deployments keep working unchanged until the operator opts in. No code path changes for HS256-only operators on day one.

### Algorithm selection

The `src/services/jwt.ts` service (existing surface, do not rewrite — extend) selects the signing algorithm at boot from `config.jwt.algorithm` driven by env `JWT_ALGORITHM`:

- `JWT_ALGORITHM=HS256` (**default**) — legacy behaviour. Single shared `JWT_SECRET`. No JWKS surface published (the endpoint returns `{ "keys": [] }`).
- `JWT_ALGORITHM=RS256` — new. Signer holds `JWT_RS256_PRIVATE_KEY`; verifiers hold `JWT_RS256_PUBLIC_KEY` or fetch it from `/api/jwks.json`.

The signing context selector in `src/services/jwt.ts` is the natural extension point — it already routes the two algorithms (lines 51–67 of the current file) and the `getSigningContext()` helper already errors loudly if `JWT_ALGORITHM=RS256` is set without a private key. This ADR ratifies that choice ahead of the env-driven rollover.

### Dual-issuer verify path (rollover support)

The `verifyToken` function in `src/services/jwt.ts` accepts **both algorithms during the rollover window** so previously-issued HS256 tokens stay valid until their natural expiry. The matrix:

| `JWT_SECRET` | `JWT_RS256_PUBLIC_KEY` | Tokens accepted |
|---|---|---|
| set (or dev default) | unset | HS256 only |
| set | set | HS256 + RS256 (rollover) |
| unset / dev default | set | RS256 only |
| unset | unset | error — fatal at boot |

Issuance is always exactly one algorithm — `config.jwt.algorithm` selects. There is intentionally no "issue both forms" mode; the old form drains out as tokens expire over the 24 h refresh-token TTL.

### JWKS endpoint at `/api/jwks.json`

`GET /api/jwks.json` returns the canonical JWKS shape:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<JWT_RS256_KID>",
      "n": "<base64url RSA modulus>",
      "e": "AQAB"
    }
  ]
}
```

Notes on the surface:

- **Path is `/api/jwks.json`, not `/.well-known/jwks.json`.** ZeroAuth's `/.well-known/` prefix is currently reserved for ACME challenges (Caddy's automatic certificate issuance). The `/api/` prefix is consistent with the rest of the platform's namespacing (`/api/health`, `/api/admin/*`, `/api/console/*`). Partners get a single discoverable URL: `https://zeroauth.dev/api/jwks.json`.
- **Unauthenticated.** Public keys are public by definition. No tenant gating, no x-api-key, no cookies. A separate ADR would govern any change to that posture.
- **Cache-Control: `public, max-age=3600`.** Intermediaries cache for one hour; key rotations are out-of-band and use the JWKS multi-key roll-forward pattern (see "Key rotation procedure" below).
- **CORS: open.** `Access-Control-Allow-Origin: *` so a browser-side verifier (a customer's React app verifying our console token before calling a third-party API) can fetch the JWKS without a CORS proxy.
- **When RS256 is not configured, the endpoint returns `{ "keys": [] }`** — not a 404, not a 503. A future flip to RS256 is a single env-var change, no client-visible API surface flips. Existing partners polling the JWKS just see keys appear.

The shape generator already exists as `getRs256Jwk()` in `src/services/jwt.ts` (lines 165–183 in the current file). The route handler wraps it in `{ keys: getRs256Jwk() ? [getRs256Jwk()!] : [] }`. Implementation lands in the same commit as this ADR's acceptance.

### Key rotation procedure (non-destructive)

`scripts/jwt-rotate.ts` (lands alongside the implementation commit) generates a fresh 2048-bit RSA keypair and prints it in `.env`-paste-ready form when called with `--env`. The procedure:

1. Generate fresh keypair via the script; load private key into the secret store, public key into the JWKS-publishing process.
2. Update env so both the **old** and **new** public keys are present in the JWKS (multi-key publish is a Phase 2 stretch ticket; for v1 there is a brief acceptance gap at the cutover — see "Open questions" below).
3. Flip `JWT_RS256_PRIVATE_KEY` to the new private key. From this moment new tokens are signed with the new `kid`.
4. Wait one refresh-token TTL (default 24 h). Outstanding tokens minted with the old private key naturally expire.
5. Drop the old public key from the JWKS publish set. Rotation is complete.

The full procedure lives in `docs/operations/jwt-key-rotation-playbook.md` (lands with the implementation commit). The playbook covers the failure-mode matrix (private key compromised → step-3 with a 0-second wait acceptable; routine quarterly rotation → step-3 with the full 24 h wait).

### What this does NOT do

- **Does NOT migrate any tokens already in circulation.** Existing HS256 tokens keep working until they expire naturally over their 24 h refresh-token TTL. After the rollover window the legacy `JWT_SECRET` is unset and any still-extant HS256 tokens are rejected.
- **Does NOT introduce per-tenant signing keys.** The signing key is platform-wide. Per-tenant fan-out (each tenant getting its own JWKS, the platform acting as a multi-tenant identity provider in the OIDC sense) is a Phase 2 ticket if a customer demands it.
- **Does NOT add HSM-backed signer support.** AWS CloudHSM / YubiHSM2 integration is on the Phase 4 roadmap; for now the private key lives in the secret manager and is read from the env var. Threat-model row A-08 (key-compromise blast radius) is reduced by rotation cadence, not by HSM, in v1.
- **Does NOT touch tenant API keys.** `/v1/*` is authenticated by `za_{live,test}_*` API keys (SHA-256 hashed at rest) — a wholly separate auth surface. This ADR only governs the console JWT.
- **Does NOT touch refresh-token storage.** The refresh-token rotation and revocation story is governed by `src/services/session-store.ts`; that surface is untouched.

## Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **RS256 + JWKS (chosen)** | Industry-standard JOSE primitive; jsonwebtoken native support; partner verifiers integrate with off-the-shelf JWKS clients; SOC 2 / ISO 27001 auditor-friendly. | RSA verify is ~10× slower than HS256 (~80 µs vs ~8 µs on m6i.large); larger signatures (~256 B vs 32 B). | **Chosen** — perf delta negligible at our target throughput; signature size delta is 224 B per token, sub-1 % of the typical Authorization header round-trip. |
| ES256 (ECDSA P-256) + JWKS | Smaller keys (~32 B), smaller signatures (~64 B), faster verify (~40 µs). | jsonwebtoken support exists but RSA is the more battle-tested path in JOSE-consuming integrations; some legacy partner gateways still don't accept EC keys. | Deferred — revisit once RS256 is in production and if a partner asks. The verify path is symmetric (the same `verifyToken` can multi-algorithm) so an ES256 future is non-blocking. |
| EdDSA (Ed25519) + JWKS | Smallest signatures; fastest verify; modern primitive. | RFC 8037 JWK type `OKP` not yet universally supported in partner JWKS clients (notably some Java-based gateways). | Deferred — same logic as ES256, plus a stronger ecosystem-maturity caveat. |
| Asymmetric HSM-only (no env-var private key) | Strongest blast-radius posture; private key never in process memory. | Adds AWS CloudHSM / YubiHSM2 dependency; ~$1.6 k/month CloudHSM baseline cost; vendor coupling. | Phase 4 — revisited after we have one BFSI customer paying for it. |
| Per-tenant HS256 (one secret per tenant) | Keeps the symmetric model; tenant compromise contained to one tenant. | Doubles the secret-store surface; doesn't solve the partner-verify problem; doesn't solve rotation. | Rejected — fixes the wrong axis. |
| Stay HS256, rotate quarterly | No code change. | Doesn't fix any of the three problems. Audit finding C-11 stays open. SOC 2 CC6.1 stays a hand-wave. | Rejected — the status quo this ADR exists to leave. |

## Threat model impact

`docs/threat_model.md` row A-08 (key-compromise blast radius) gets a meaningful mitigation upgrade:

- **Before:** if `JWT_SECRET` leaks, any party can mint console JWTs as any tenant operator. Mitigation: rotate (which logs everyone out).
- **After (RS256, env-var key):** if `JWT_RS256_PRIVATE_KEY` leaks, same attacker capability — but rotation is non-destructive, so we rotate immediately on any leak signal. Mean time to recover drops from "hostile UX event scheduled for next maintenance window" to "minutes."
- **After (RS256, HSM-backed — Phase 4):** the private key cannot leak through a process-memory disclosure; mitigation becomes "compromise the HSM," which is a wholly different threat class.

A new row A-22 ("JWKS endpoint compromise — adversary publishes their own public key alongside ours") is added to the threat model in the same commit. Mitigation: the JWKS endpoint is served by the same TLS-terminated reverse proxy as the rest of the API and authenticated by the certificate chain; a JWKS poisoning attack reduces to a TLS impersonation attack, which is out of scope for this ADR.

## Test impact

Three new test files land with the implementation commit:

- `tests/jwt-rs256.test.ts` — sets `JWT_ALGORITHM=RS256` + a real keypair via env; asserts tokens are signed with RS256 (header `alg` check), tokens are verified against the public key, JWKS endpoint returns the expected key.
- `tests/jwt-dual-issuer.test.ts` — sets both `JWT_SECRET` and `JWT_RS256_*`; asserts the verifier accepts both algorithms; asserts that issuance picks exactly one (the configured one).
- `tests/jwks-endpoint.test.ts` — request-level test of `GET /api/jwks.json`; asserts the response shape, the `Cache-Control` header, the CORS header, and the `{ keys: [] }` fallback when RS256 is not configured.

Existing tests stay green:

- `tests/jwt.test.ts` (current HS256 issuance + verify path) — unchanged, the default behaviour is unchanged.
- `tests/console-login.test.ts` — unchanged, the route doesn't care which algorithm signs the token it returns.

## Audit + rollback

**Observability.** Two new Prometheus counters land with the implementation commit:

- `jwt_issue_total{algorithm}` — incremented on every `issueTokens` call. The label flips visibly when the operator turns on RS256.
- `jwt_verify_total{algorithm, outcome}` — incremented on every `verifyToken` call. `outcome` is `success` or `fail`; `algorithm` is `HS256` or `RS256`. During the rollover window the operator can see HS256 verifications draining toward zero as tokens expire.

The dashboard panel "JWT algorithm transition" lands with the implementation commit and is the operator's single-pane-of-glass for the rollover.

**Roll-forward.** A bad RS256 keypair (wrong format, e.g. PKCS#1 instead of PKCS#8) shows up at boot — `getSigningContext` already throws loud on a missing key, and the implementation extends the check to "key is parseable as PKCS#8 RSA." CI gate on the implementation commit asserts this.

**Rollback.** Unset `JWT_ALGORITHM` (back to HS256 default) and restart the process. The dual-issuer verify path means tokens minted under either algorithm during the window stay valid; new tokens go back to HS256. No DB schema impact, no migration, no on-chain dependency.

## Open questions deferred

- **Multi-key concurrent publish (JWKS returning N keys during rotation).** v1 publishes one key at a time; rotation has a brief acceptance gap at the cutover (the verifier accepts only the currently-configured public key). Phase 2 stretch — extend `getRs256Jwk()` to return an array driven by a list of `JWT_RS256_PUBLIC_KEY_<N>` env vars.
- **HSM-backed signing (no private key in the API process).** Phase 4.
- **Token-type-specific algorithm choice** (e.g. access tokens RS256, refresh tokens HS256 for size). Phase 2 if profiling shows JWT size matters.
- **`/api/jwks.json` versus `/.well-known/jwks.json` aliasing.** v1 ships only `/api/jwks.json`. A future ADR can add the `.well-known` alias once we've resolved the Caddy ACME path conflict (likely by serving the JWKS from a sub-path-mapped Caddy block).
- **OIDC discovery document** (`/.well-known/openid-configuration`). Out of scope — we are not an OIDC IdP today. If a customer asks for OIDC IdP capability, that is a wholly separate ADR (and a wholly separate product surface).
- **Per-tenant signing keys.** Phase 2 stretch — would turn the JWKS into a tenant-scoped `/api/console/tenants/:id/jwks.json` and the platform into a multi-tenant identity provider.

## Consequences

**Positive.**

- Closes audit finding C-11.
- External verifiers (bank IdPs, partner gateways, the Phase 2 out-of-process verifier service) can self-verify console JWTs with zero shared secret.
- Key rotation no longer requires fleet-wide redeploy or operator re-login — the JWKS multi-key publish pattern (Phase 2) makes rotation a zero-downtime, zero-UX-impact operation.
- Standard `kid` claim in every token (when RS256 is on) lets future multi-key rollovers be seamless.
- SOC 2 CC6.1 and ISO 27001 Annex A.10.1.1 cryptographic-controls evidence becomes a clean "we sign with RS256, our public keys are at https://zeroauth.dev/api/jwks.json" rather than a hand-wave.

**Negative.**

- RS256 verification is ~10× slower than HS256 (~80 µs vs ~8 µs per verify on a Pixel 7 / m6i.large baseline). At our verification volume (target 500 RPS in Phase 2) this is sub-ms total. Acceptable.
- Two key formats to manage (`JWT_SECRET` for HS256, `JWT_RS256_PRIVATE_KEY` + `_PUBLIC_KEY` for RS256). Mitigation: the rotation playbook script generates and prints them in one step.
- A brief acceptance gap at the rotation cutover (multi-key publish is Phase 2). Mitigation: rotations happen quarterly, not daily; the gap is operationally manageable; emergency rotations skip the gap by accepting the UX cost.
- New public surface (`/api/jwks.json`) — one more endpoint to monitor, one more route to keep in `docs/api_contract.md`, one more thing for the security team to review for header-injection risk on every change.

**Neutral.**

- Replaces no existing code path — extends `src/services/jwt.ts` along the already-staked-out RS256 branch in `getSigningContext()`.
- Coexists with all other Phase 0 ADRs: blockchain-agnostic posture (ADR 0017) is unrelated; zod validation (ADR 0016) governs the request bodies, this ADR governs the token signing.

## References

- Implementation surface — `src/services/jwt.ts` (current file extends; do not rewrite).
- Audit finding — `docs/security/audit-findings.md` C-11 (JWT symmetric-key class).
- Threat model — `docs/threat_model.md` row A-08 (key-compromise blast radius); new row A-22 (JWKS endpoint compromise) lands with implementation.
- API contract — `docs/api_contract.md` § Console auth (gains an `/api/jwks.json` subsection on acceptance).
- Operations playbook — `docs/operations/jwt-key-rotation-playbook.md` (lands with implementation).
- Compliance — `docs/compliance/compliance-roadmap-v1.md` § SOC 2 CC6.1 + ISO 27001 A.10.1.1.
- Library — jsonwebtoken `^9.x` (already in `package.json`; no new dependency).
- Spec — RFC 7517 (JWK), RFC 7518 § 3.3 (RS256), RFC 8725 (JWT BCP).

---

LAST_UPDATED: 2026-06-01
OWNER: Agent #12 (Senior Cryptography — key management + HSM)
