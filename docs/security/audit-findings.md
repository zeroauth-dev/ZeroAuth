# Security audit findings — Phase 0 status

Snapshot of the 21 findings from the Phase 0 readiness audit, with current status. Closed findings carry the commit hash that closed them. Open findings carry an owner and a target sprint.

Severity scale:

- **P0** — production-blocking. Must close before any pilot.
- **P1** — pilot-blocking. Must close before Phase 2 pilot kickoff.
- **P2** — phase 2-blocking. Must close before pilot exit.
- **P3** — phase 3-blocking. Must close before SOC 2 Type II evidence period.

LAST_UPDATED: 2026-05-29

## Phase 1 follow-ons landed since the last snapshot

The Phase 1 work since LAST_UPDATED above isn't an *audit finding* per se — these ADRs add capabilities that didn't exist when the original 21 findings were enumerated. Tracked here because the same hash-chain + tenant-isolation + biometric-payload guards continue to apply.

| ADR | Title | Status | Closing commits | Notes |
|---|---|---|---|---|
| **ADR 0022** | Production device-enrollment flow | **LANDED** | `8d313a0`, `c4681a9` | Two-step handshake (admin mints pending slot + code → device claims with fingerprint). Server-side: `src/services/device-enrollment.ts`, extensions to `src/services/platform.ts`, `POST /v1/devices/enroll` in `src/routes/v1/devices.ts`. Dashboard: redesigned `dashboard/src/routes/Devices.tsx` with type-aware modal + enrollment-code screen + Re-issue/Revoke actions. Tests: `tests/device-enrollment.test.ts` (26 tests). |
| **ADR 0023** | Three-QR end-user signup ceremony | **LANDED** | `8ad10bd`, `8e39425` | The signup-side counterpart of ADR 0017. Backend: `src/services/registration.ts`, `src/routes/v1/registrations.ts` with six routes (3 tenant-side, 3 phone-side bearing single-use codes). Dashboard demo: `dashboard/src/routes/demo/QrRegistration.tsx` with QR codes + simulator panel + live polling. Android: `android/app/src/main/java/dev/zeroauth/android/ui/reg/*` (paste-deeplink only for V1; camera scan deferred to Phase 1 Sprint 4). Tests: `tests/registration-flow.test.ts` (19 tests), `android/app/src/test/.../RegQrPayloadTest.kt` (11 tests). |
| **ADR 0024** | qrcode.react dep for dashboard QR rendering | **LANDED** | `8c2f028` | ISC, zero runtime deps, peer-dep React ^16-19. `npm audit --omit=dev` clean. Lazy-loaded in `dashboard/src/App.tsx` so the QrRegistration chunk stays out of the main bundle. |

## Pilot-ready vs production-ready gap (Phase 1 Sprint 4+)

What still blocks a real BFSI tenant onboarding, separated from the 21 original findings:

| Gap | Status | Blocking what |
|---|---|---|
| **Real biometric capture wired to the registration flow** | Source vendored at `mobile/biometric/` (FaceEmbedder + Quantizer + Poseidon + Keccak), not yet plugged into `RegistrationViewModel.BiometricSecretSource`. The default `PerInstallStableSecret` returns a SharedPreferences-persisted 32-byte secret so steps 2 and 3 derive the same commitment for the demo. | Real biometric verification. Currently any phone with the app behaves as if it were the same user across runs. |
| **Real Groth16 proof for `/v1/registrations/complete`** | `WebViewMobileProver` is operational for the W3 proof-pairing flow but the witness shape it expects differs from what the registration verify step needs (the current circuit has 3 public signals; the registration challenge_nonce isn't bound circuit-side). `RegistrationViewModel.ProofGenerator` is injectable so swapping in a real prover is a one-screen change once the witness math is finalised. | Step 3 surfaces `verify_failed` because the demo posts a stub proof. The route plumbing is end-to-end correct; only the proof bytes are stubbed. |
| **Camera QR scanning in `RegistrationScreen`** | Paste-deeplink only for V1. The existing `ui/scan/ScanScreen.kt` has a working ML Kit + CameraX pipeline that needs extracting into a shared composable. | Field-usable phone flow. Operator can paste the deeplink during a demo, end users can't realistically do that. |
| **Circuit v1.3 with challenge_nonce public input** | Designed in ADR 0023 §"V1 limitation" + §"Phase 1 Sprint 4 follow-on". V1 binds the challenge to the request, not to the proof. | Replay-defence depth: V1 prevents cross-session replay via single-use verify_code + 15-min TTL + rate-limit; V2 closes the proof-replay surface entirely. |
| **Branch protection on main (audit finding C-16)** | Pipeline exists; protected-branch settings still a manual ops ticket. | Blast-radius reduction for accidental force-pushes. |
| **PII strip on tenant_users (audit finding C-5)** | Schema-purity test pins current state; new tenant_users rows from registration ceremony already populate did + commitment alongside the legacy PII columns. | DPDP §2(t) minimisation target; tenant SDK can choose to pass an empty profile starting now. |

## Phase 0 P0 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-1** | Demo bypass in `submitProof` accepts any `did:zeroauth:demo:*` without crypto verification | **CLOSED** | `02e1734` | Bypass branch removed from `src/services/proof-pairing.ts`. `pairing_demo_mode` field on `TenantSecurityPolicy` marked `@deprecated`. Tests: `tests/proof-pairing.test.ts::"P0 audit finding C-1 closure"`. Threat model row A-27. |
| **C-2** | Mobile app ships with `FakeKeystoreManager`, `FakeMobileProver`, `FakeBiometricGate` — no real biometric, no real proof generation | **TRACKED-TO-PHASE-1-SPRINT-3** | — | Real Android prover with rapidsnark JNI + StrongBox-backed keystore lands C-104 (Phase 1 Sprint 3). Real biometric capture (CameraX face + R307 USB-OTG) lands C-143/C-167. Grep test `tests/no-fake-prover.test.ts` will close this finding at C-149. |
| **C-3** | `?access_token=<jwt>` query fallback in console SSE auth lands JWT in Caddy access logs | **CLOSED** | `ee6aad4` | Replaced with HttpOnly `zeroauth_console_jwt` cookie scoped to `/api/console`. Tests: `tests/console-auth.test.ts::"P0 audit finding C-3"`. Threat model row A-28. |
| **C-7** | Verifier loads `verification_key.json` from disk without checking it matches the circuit version compiled in code | **CLOSED** | `e98d158` | Boot-time SHA-256 check on `verification_key.json` against `EXPECTED_VKEY_SHA256` env var. Production refuses to boot if missing or mismatched; non-prod warns. ADR 0015 (commit `27ed93c`) + tests `tests/zkp-version.test.ts`. |
| **C-9** | In-memory session store loses state on process restart; no horizontal scale-out | **CLOSED** | `5a12bb4` | Postgres-backed write-through cache. New `user_sessions` table hydrated on boot, write-through on create/delete, hourly cleanup of expired rows. ADR 0017 / `src/services/session-store.ts`. The horizontal-scale-out half (cross-pod real-time reads) is a deferred Phase 2 follow-on; v1 closes the "lose state on restart" half. Tests: `tests/session-store-postgres.test.ts` (6 tests). |
| **C-10** | No rate-limit on `/v1/zkp/verify` or `/api/console/login`; trivially DoS-able | **CLOSED** | `3337d7b` | Postgres-backed sliding-window rate-limit middleware lands in `src/middleware/rate-limit.ts` (C-026). Wired on `POST /v1/auth/zkp/verify` + `POST /v1/auth/zkp/register` per-API-key (30 req / 60 s) and on `POST /api/console/login` per-IP (10 req / 60 s) on top of the existing in-memory `authLimiter`. The `rate_limit_buckets` table shares counters across replicas via atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING count`. Expired rows GC'd by `cleanupRateLimitBuckets()` from a 60 s interval started in `initRateLimitCleanup()`. Tests: `tests/rate-limit.test.ts`. Schema locked by `tests/schema-purity.test.ts`. |
| **C-11** | JWT signed with HS256 (symmetric); no JWKS surface; key rotation requires every verifier-side service to learn the new secret simultaneously | **CLOSED** | `4ce0fec` | ADR 0021 RS256 migration. `config.jwt.algorithm = 'RS256'` opts in; dual-issuer verify path accepts both HS256 (legacy) + RS256 (new) during rollover. `/.well-known/jwks.json` serves the RS256 public key in JWK format with the configured `kid`. `scripts/jwt-rotate.ts` generates a fresh 2048-bit keypair. Default stays HS256 so existing deployments keep working. Tests: `tests/jwt-rs256.test.ts` (6 tests). |

## Phase 0 P1 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-4** | `audit_events` is tamper-evident in spirit only — no hash chain, no integrity verification | **CLOSED** | `5e3b79d` + ADR commits + `c09c081` | Hash chain (ADR 0013) lands as part of the C-011/C-012/C-013 batch. Daily on-chain anchor (ADR 0014) tracked as C-015 + C-016 (sprint 2). |
| **C-5** | `users` schema (called `tenant_users` in code) carries PII columns (`full_name`, `email`, `phone`, `employee_code`) instead of just `did` + `commitment` | **OPEN — phase 1 PII strip** | — | Schema-purity test (`tests/schema-purity.test.ts`, commit `5425032`) locks down the current state — no NEW PII columns can sneak in. The PII strip itself is a Phase 1 migration; an ADR proposing the migration is to be drafted before sprint 2. |
| **C-6** | Every direct `INSERT INTO audit_events` is a bypass of the chain; no compile-time guard | **CLOSED** | `c09c081` | Grep guard in `tests/audit-chain.test.ts::"every audit-writing surface uses appendAuditEvent"`. Direct INSERTs anywhere except `src/services/audit.ts` fail the test. |
| **C-8** | No structured guard against accepting raw biometric data over the wire | **CLOSED** | `c09c081` | Source-grep test `tests/biometric-rejection.test.ts` blocks 9 forbidden payload-key patterns across `req.body / req.query / req.params` reads. Runtime validator-layer rejection lands with zod (C-022) per ADR 0016 — strengthens C-8 at runtime without replacing the source-grep guard. |
| **C-12** | No cross-tenant rejection test matrix; tenant isolation relies on each developer remembering to add the right `WHERE` clause | **CLOSED** | `a1bbc47` | Source-level guard `tests/tenant-isolation.test.ts` walks every route file and asserts every `router.<verb>` declaration carries an `authenticateTenantApiKey` middleware. The 14 intentionally-public exceptions live in `PUBLIC_ROUTE_EXCEPTIONS` with a >= 20-char reason each. |

## Phase 0 P2 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-13** | CORS is wildcard-allowed | **CLOSED** | `src/config/index.ts` `parseCorsOrigins` + `src/middleware/tenant-cors.ts` | Two layers: global non-wildcard allowlist via `CORS_ORIGINS` env var; per-tenant allowlist via `tenant.security_policy.allowed_origins` + `tenantCorsCheck` middleware. The per-tenant layer fires after `authenticateTenantApiKey` and asserts the Origin header is in the tenant's allowlist (case-insensitive exact match, server-to-server requests pass through). Tests: `tests/tenant-cors.test.ts` (7 tests). |
| **C-14** | No CVE monitoring; supply-chain attacks invisible until they bite | **CLOSED** | `f8a756c` | Nightly CVE monitor at `.github/workflows/cve-monitor.yml` with high-severity alert routing. |
| **C-15** | No automated dependency-ADR audit; new deps can land without an ADR | **CLOSED** | husky commit + `scripts/pre-commit-checks.sh` | ADR 0020 husky 9.1.7 pre-commit hook + commit-msg hook. The pre-commit script's "ADR-trail check" gate refuses any commit that adds a new dependency to `package.json` without a matching ADR file in the same commit. The commit-msg hook blocks subjects > 72 chars, Conventional-Commits prefixes, AI-coauthor trailers, bracket/WIP/checkpoint prefixes, and leading emoji. CI mirror in `.github/workflows/ci.yml` runs the same gates for `--no-verify` bypasses. Tests for the commit-msg hook: 3 smoke scenarios verified at commit time. |
| **C-16** | No production deploy pipeline — production changes are SSH'd in by hand | **OPEN — phase 1** | — | The pipeline exists (`.github/workflows/deploy.yml`) but lacks branch protection on `main`. ADR 0011 (commit `51bc705`) captures the workflow; protected-branch settings tracked as a sprint-2 ops ticket. |

## Phase 0 P3 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-17** | No formal threat model for the IoT bridge | **OPEN — sprint 1 of phase 1** | — | Tracked under bridge-security-audit owned by Agent #20 in week 4. |
| **C-18** | No external cryptographer engagement for the circuit + protocol review | **TRACKED** | — | Engagement SoW signed by week 4 (Agent #27). External review of v1.2 circuit lands phase 1 week 10. |
| **C-19** | No DPO appointment filed with DPB | **TRACKED** | — | DPO appointment paperwork prep owned by Agent #41 in week 1. Filing target week 3 of phase 0. |
| **C-20** | No data-retention policy | **TRACKED** | — | Owned by Agent #39 in week 2 (privacy engineer). |
| **C-21** | No DPDP §2(t) legal opinion on commitments | **TRACKED** | — | External counsel engagement scoped week 1 by Agent #37. Memo v1 target week 3. |

## Closed-finding regression guard

Every closed P0 finding has at least one test that pins the closure. The `tests/security/regression.spec.ts` suite (lands C-023 / sprint 2) runs the union of these tests on every PR; any regression on a closed finding fails the build.
