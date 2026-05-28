# Security audit findings — Phase 0 status

Snapshot of the 21 findings from the Phase 0 readiness audit, with current status. Closed findings carry the commit hash that closed them. Open findings carry an owner and a target sprint.

Severity scale:

- **P0** — production-blocking. Must close before any pilot.
- **P1** — pilot-blocking. Must close before Phase 2 pilot kickoff.
- **P2** — phase 2-blocking. Must close before pilot exit.
- **P3** — phase 3-blocking. Must close before SOC 2 Type II evidence period.

LAST_UPDATED: 2026-05-25

## Phase 0 P0 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-1** | Demo bypass in `submitProof` accepts any `did:zeroauth:demo:*` without crypto verification | **CLOSED** | `02e1734` | Bypass branch removed from `src/services/proof-pairing.ts`. `pairing_demo_mode` field on `TenantSecurityPolicy` marked `@deprecated`. Tests: `tests/proof-pairing.test.ts::"P0 audit finding C-1 closure"`. Threat model row A-27. |
| **C-2** | Mobile app ships with `FakeKeystoreManager`, `FakeMobileProver`, `FakeBiometricGate` — no real biometric, no real proof generation | **TRACKED-TO-PHASE-1-SPRINT-3** | — | Real Android prover with rapidsnark JNI + StrongBox-backed keystore lands C-104 (Phase 1 Sprint 3). Real biometric capture (CameraX face + R307 USB-OTG) lands C-143/C-167. Grep test `tests/no-fake-prover.test.ts` will close this finding at C-149. |
| **C-3** | `?access_token=<jwt>` query fallback in console SSE auth lands JWT in Caddy access logs | **CLOSED** | `ee6aad4` | Replaced with HttpOnly `zeroauth_console_jwt` cookie scoped to `/api/console`. Tests: `tests/console-auth.test.ts::"P0 audit finding C-3"`. Threat model row A-28. |
| **C-7** | Verifier loads `verification_key.json` from disk without checking it matches the circuit version compiled in code | **CLOSED** | `e98d158` | Boot-time SHA-256 check on `verification_key.json` against `EXPECTED_VKEY_SHA256` env var. Production refuses to boot if missing or mismatched; non-prod warns. ADR 0015 (commit `27ed93c`) + tests `tests/zkp-version.test.ts`. |
| **C-9** | In-memory session store loses state on process restart; no horizontal scale-out | **OPEN — sprint 2** | — | Postgres-backed session store tracked as C-025 per `docs/plan/bfsi-v1/04-commits.md`. |
| **C-10** | No rate-limit on `/v1/zkp/verify` or `/api/console/login`; trivially DoS-able | **OPEN — sprint 2** | — | Postgres-backed rate-limit middleware tracked as C-026 per `04-commits.md`. |
| **C-11** | JWT signed with HS256 (symmetric); no JWKS surface; key rotation requires every verifier-side service to learn the new secret simultaneously | **OPEN — sprint 2** | — | RS256 migration + JWKS endpoint tracked as C-028. Rollover playbook lands `docs/operations/jwt-key-rotation-playbook.md`. |

## Phase 0 P1 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-4** | `audit_events` is tamper-evident in spirit only — no hash chain, no integrity verification | **CLOSED** | `5e3b79d` + ADR commits + `c09c081` | Hash chain (ADR 0013) lands as part of the C-011/C-012/C-013 batch. Daily on-chain anchor (ADR 0014) tracked as C-015 + C-016 (sprint 2). |
| **C-5** | `users` schema (called `tenant_users` in code) carries PII columns (`full_name`, `email`, `phone`, `employee_code`) instead of just `did` + `commitment` | **OPEN — phase 1 PII strip** | — | Schema-purity test (`tests/schema-purity.test.ts`, commit `5425032`) locks down the current state — no NEW PII columns can sneak in. The PII strip itself is a Phase 1 migration; an ADR proposing the migration is to be drafted before sprint 2. |
| **C-6** | Every direct `INSERT INTO audit_events` is a bypass of the chain; no compile-time guard | **CLOSED** | `c09c081` | Grep guard in `tests/audit-chain.test.ts::"every audit-writing surface uses appendAuditEvent"`. Direct INSERTs anywhere except `src/services/audit.ts` fail the test. |
| **C-8** | No structured guard against accepting raw biometric data over the wire | **CLOSED** | `c09c081` | Source-grep test `tests/biometric-rejection.test.ts` blocks 9 forbidden payload-key patterns across `req.body / req.query / req.params` reads. Validator-layer rejection lands with zod (C-022). |
| **C-12** | No cross-tenant rejection test matrix; tenant isolation relies on each developer remembering to add the right `WHERE` clause | **CLOSED** | `a1bbc47` | Source-level guard `tests/tenant-isolation.test.ts` walks every route file and asserts every `router.<verb>` declaration carries an `authenticateTenantApiKey` middleware. The 14 intentionally-public exceptions live in `PUBLIC_ROUTE_EXCEPTIONS` with a >= 20-char reason each. |

## Phase 0 P2 findings

| ID | Title | Status | Closing commit | Notes |
|---|---|---|---|---|
| **C-13** | CORS is wildcard-allowed | **OPEN — sprint 2** | — | Per-tenant `allowed_origins` rolled out by C-027. |
| **C-14** | No CVE monitoring; supply-chain attacks invisible until they bite | **OPEN — sprint 2** | — | Nightly CVE monitor workflow tracked as C-032. |
| **C-15** | No automated dependency-ADR audit; new deps can land without an ADR | **OPEN — phase 1 sprint 1** | — | Pre-commit hook + CI mirror tracked as C-001 + sprint-1 CI work. |
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
