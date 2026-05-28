# Commit-by-commit plan — Phase 0 + Phase 1

This document is the **operating plan** for the first 12 weeks. Every commit that is intended to land in `dev` (and from there in `main` via PR) is listed here with: subject, owning agent (role number from `03-team.md`), files touched, the test that must pass, the DoD, and dependencies on prior commits.

Phase 0 (weeks 1–2) is exhaustively listed. Phase 1 (weeks 3–12) is listed sprint-by-sprint, with the anchor commits per sprint enumerated; smaller iterative commits are described as a class with a counter.

Phase 2–4 commits are sketched at milestone level only and will be expanded sprint-by-sprint at the start of each phase.

---

## Commit format (binding rules)

**Subject:** ≤ 72 characters. Imperative mood. No prefix (`feat:`, `fix:`, etc.). No emoji.

Examples that pass:
- `remove demo bypass from proof-pairing submitProof`
- `add hash chain to audit_events insert path`
- `ship Anchor Bank dashboard users view`

Examples that fail:
- `feat: remove demo bypass` ❌ (Conventional Commits prefix)
- `Remove demo bypass.` ❌ (full stop, not imperative)
- `WIP: chain` ❌ (WIP)
- `[fix] check tenant` ❌ (bracket prefix)
- ` Update audit chain` ❌ (emoji)

**Body:** one to three short paragraphs. Explain why, not what. Reference the audit-finding ID or pain-point ID where applicable. Reference the test file by path. No screenshots, no logs.

**Trailers:** none. No `Co-Authored-By: Claude`. No `Signed-off-by:` unless the user explicitly requests it. The author/committer is the human or agent doing the work.

**One commit ≈ one reviewable change.** A commit that changes 12 files in unrelated areas is rejected at review.

---

## Pre-commit hook (mandatory, week 1 deliverable)

Lives at `.husky/pre-commit`. Blocks the commit if any of:

1. `tsc --noEmit` errors.
2. `eslint` reports any error (warnings allowed).
3. `jest --findRelatedTests <staged files>` reports any failure.
4. Staged content contains any of: `BEGIN PRIVATE KEY`, `JWT_SECRET=`, `SESSION_SECRET=`, `ADMIN_API_KEY=`, `BLOCKCHAIN_PRIVATE_KEY=`, `za_live_[0-9a-f]{48}`, `za_test_[0-9a-f]{48}`, the literal `Co-Authored-By: Claude`.
5. Staged content contains any biometric-payload key: `image|template|pixel|depth|frame|raw_face|raw_finger` in an Express handler.
6. New circuit version detected (changed `*.zkey` file > 50 KB) without a matching ADR in `/adr/`.
7. New dependency detected in `package.json` without a matching ADR.

Override: `git commit --no-verify` is explicitly disallowed. Pre-commit hook is also re-run in CI to catch override attempts.

---

## Phase 0 — Remediation (weeks 1–2)

Phase 0 closes the 21 audit findings (P0 first), removes the demo bypass, lays the hash-chain foundation, and brings the codebase to a state where Phase 1 can build on a clean slate.

### Week 1

**C-001** `add pre-commit hook with secret + tsc + eslint + jest gates`
- Owner: Role 22.
- Files: `.husky/pre-commit`, `package.json`, `scripts/pre-commit-checks.sh`.
- Test: `scripts/test-pre-commit.sh` — exits 0 on clean staging; exits non-zero on each of the 7 violation patterns above.
- DoD: hook installed in dev environment; CI replicates the same checks in `.github/workflows/ci.yml` step `pre-commit-mirror`.
- Depends on: nothing.

**C-002** `add ADR 0008 for dev+main branching workflow`
- Owner: Role 1.
- Files: `adr/0008-branching-workflow.md`.
- Test: `[no-test]` — ADR is documentation; CI lints the file with `markdownlint`.
- DoD: ADR captures `dev` + `main` only, PR from `dev → main`, no feature branches; referenced from `CLAUDE.md`.
- Depends on: C-001.

**C-003** `add tests/schema-purity.test.ts asserting no-PII in users`
- Owner: Role 23.
- Files: `tests/schema-purity.test.ts`.
- Test: itself — fails on red (current schema if any PII columns), passes on green.
- DoD: enumerates the allowed `users` columns explicitly; fails fast if any column not in the allowlist exists in any environment.
- Depends on: C-001.

**C-004** `remove demo bypass from proof-pairing submitProof`
- Owner: Role 6.
- Files: `src/services/proof-pairing.ts`, `tests/proof-pairing.test.ts`.
- Test: `tests/proof-pairing.test.ts::"rejects did:zeroauth:demo:* even with otherwise valid payload"`.
- DoD: `submitProof` no longer accepts `did:zeroauth:demo:*` without a verified Groth16 proof against the deployed verification key; closes P0 audit finding C-1; threat-model row `A-12` updated.
- Depends on: C-001, C-003.

**C-005** `remove access_token query fallback from console SSE auth`
- Owner: Role 7.
- Files: `src/middleware/tenant-auth.ts`, `src/routes/console.ts`, `tests/console-auth.test.ts`.
- DoD: SSE auth now uses HttpOnly cookie + CSRF token; `?access_token=` query parameter rejected with `unauthorized`; closes P0 audit finding C-3; access logs no longer contain token-in-URL.
- Test: `tests/console-auth.test.ts::"SSE rejects access_token in query string"`.
- Depends on: C-001.

**C-006** `migrate dashboard EventSource to credentials include + CSRF`
- Owner: Role 14.
- Files: `dashboard/src/lib/api.ts`, `dashboard/src/routes/demo/QrProofLogin.tsx`, `dashboard/src/lib/sse.ts` (new).
- Test: `dashboard/src/lib/__tests__/sse.test.ts` — asserts EventSource opened with `withCredentials: true`, no `?access_token=` in URL.
- DoD: dashboard SSE works end-to-end against the new cookie-based auth; QR demo flow still authenticates.
- Depends on: C-005.

**C-007** `add tests/tenant-isolation.test.ts cross-tenant rejection matrix`
- Owner: Role 23.
- Files: `tests/tenant-isolation.test.ts`.
- Test: itself — every `/v1/*` endpoint exercised with a wrong-tenant API key returns 403 `tenant_mismatch`.
- DoD: the test enumerates all currently mounted `/v1/*` routes via Express router introspection; every route is tested; no manual list.
- Depends on: C-001.

**C-008** `add ADR 0009 for QR proof pairing protocol (Option B-prime)`
- Owner: Role 11.
- Files: `adr/0009-qr-proof-pairing-protocol.md`.
- Test: `[no-test]` — markdown-lint.
- DoD: ADR captures the Option B′ protocol: `didHashSession = Poseidon(2)([storedDidHash, sessionNonce])`; threat-model row `A-23` (replay) cross-referenced.
- Depends on: nothing.

**C-009** `add ADR 0010 for audit hash chain construction`
- Owner: Role 11.
- Files: `adr/0010-audit-log-hash-chain.md`.
- Test: `[no-test]` — markdown-lint.
- DoD: ADR defines hash function (SHA-256 over canonical JSON), chain entry shape (`previous_hash`, `event_hash`), genesis row, drift-detection cadence; threat-model row `A-14` updated.
- Depends on: nothing.

**C-010** `add ADR 0011 for daily on-chain anchor cadence on Base L2`
- Owner: Role 25.
- Files: `adr/0011-on-chain-anchor-cadence.md`.
- Test: `[no-test]` — markdown-lint.
- DoD: ADR defines `audit_anchors` table, the cron schedule (00:30 IST), the anchor payload (`{tenant_id, day, terminal_hash}`), the contract method, failure recovery.
- Depends on: C-009.

**C-011** `add audit_events.previous_hash and event_hash columns`
- Owner: Role 8.
- Files: `src/services/db.ts`, `tests/audit-schema.test.ts`.
- Test: `tests/audit-schema.test.ts::"audit_events has previous_hash and event_hash columns"`.
- DoD: schema bootstrap idempotent; existing rows backfilled with NULL `previous_hash`; new rows compute `event_hash`.
- Depends on: C-009.

**C-012** `implement append-only audit chain in src/services/audit.ts`
- Owner: Role 8 (with Role 13 review).
- Files: `src/services/audit.ts` (new), `src/services/platform.ts`, `tests/audit-chain.test.ts`.
- Test: `tests/audit-chain.test.ts` — appends 100 rows, computes chain, tampers row 50, integrity check fails at row 50.
- DoD: `appendAuditEvent` is the only function callers use; direct `INSERT INTO audit_events` blocked by lint rule; cryptographer-reviewer subagent signs off.
- Depends on: C-011.

**C-013** `route all platform.ts audit writes through audit.ts appendAuditEvent`
- Owner: Role 8.
- Files: `src/services/platform.ts`, `src/routes/admin.ts`, `src/routes/console.ts`, `src/routes/v1/*.ts`.
- Test: `tests/audit-chain.test.ts::"every audit-writing surface uses appendAuditEvent"` — grep-style test reading source.
- DoD: zero direct INSERT into `audit_events` in production code; every audit row written through `appendAuditEvent`.
- Depends on: C-012.

**C-014** `add /api/admin/audit-integrity endpoint`
- Owner: Role 9.
- Files: `src/routes/admin.ts`, `src/services/audit.ts`, `tests/admin-audit-integrity.test.ts`.
- Test: `tests/admin-audit-integrity.test.ts::"returns PASS for clean chain"`, `"returns FAIL with broken_at row id"`.
- DoD: endpoint returns `{status, broken_at?}`; gated by `x-api-key`; logs an audit row of its own.
- Depends on: C-013.

**C-015** `add CronCreate-managed daily on-chain anchor job`
- Owner: Role 21 (with Role 25).
- Files: `src/services/anchor-job.ts` (new), `src/services/blockchain.ts`, `tests/anchor-job.test.ts`.
- Test: `tests/anchor-job.test.ts::"computes terminal hash and submits to AuditAnchor contract"` against Hardhat fork.
- DoD: cron registered, runs at 00:30 IST, writes `audit_anchors` row on success, logs alert on failure.
- Depends on: C-014.

**C-016** `add AuditAnchor contract on Base Sepolia`
- Owner: Role 25.
- Files: `contracts/AuditAnchor.sol`, `scripts/deploy-contracts.ts`, `contracts/deployed-addresses.json`.
- Test: `contracts/test/AuditAnchor.test.ts` (Hardhat).
- DoD: deployed and verified on Basescan; addresses committed to `deployed-addresses.json`; ABI exported.
- Depends on: C-010.

**C-017** `update threat_model.md for hash chain and on-chain anchor`
- Owner: Role 35.
- Files: `docs/threat_model.md`.
- Test: `[no-test]` — markdownlint.
- DoD: A-14 (audit-log tampering) marked as mitigated; A-22 (compromised DBA) added; references C-012 + C-016.
- Depends on: C-016.

### Week 2

**C-018** `lock circuit version to identity_proof.v1.1 in src/services/zkp.ts`
- Owner: Role 11.
- Files: `src/services/zkp.ts`, `tests/zkp-version.test.ts`.
- Test: `tests/zkp-version.test.ts::"loads identity_proof v1.1 verification_key"`.
- DoD: version constant exported; mismatch between vkey hash and constant throws on boot; closes P0 audit finding C-7.
- Depends on: C-001.

**C-019** `add ADR 0012 for circuit version pinning + upgrade procedure`
- Owner: Role 11.
- Files: `adr/0012-circuit-version-pinning.md`.
- Test: `[no-test]` — markdownlint.
- DoD: defines the version constant, the vkey hash check, the new-version landing procedure (ADR + ceremony transcript + verifier deploy).
- Depends on: C-018.

**C-020** `redeploy Groth16Verifier to Base Sepolia at v1.1 vkey`
- Owner: Role 25.
- Files: `contracts/Groth16Verifier.sol`, `scripts/deploy-contracts.ts`, `contracts/deployed-addresses.json`.
- Test: `contracts/test/Groth16Verifier.test.ts` against deployed contract.
- DoD: deployed, verified on Basescan, addresses committed; verifier accepts one known-good proof, rejects one known-bad.
- Depends on: C-018.

**C-021** `add tests/biometric-rejection.test.ts blocking payload keys`
- Owner: Role 23.
- Files: `tests/biometric-rejection.test.ts`.
- Test: itself — every `/v1/*` POST endpoint rejects payloads containing `image|template|pixel|depth|frame|raw_face|raw_finger`.
- DoD: enumerated POST routes via Express introspection; test class for each forbidden key.
- Depends on: C-007.

**C-022** `add zod input validators on /v1/identity/register and /v1/zkp/verify`
- Owner: Role 6.
- Files: `src/validators/identity.ts` (new), `src/validators/zkp.ts` (new), `src/routes/v1/identity.ts`, `src/routes/v1/zkp.ts`, `tests/validator-identity.test.ts`, `tests/validator-zkp.test.ts`.
- Test: validators reject malformed payloads with `invalid_input`; biometric-key blocklist enforced.
- DoD: zod is a new dep — ADR 0013 lands in C-023.
- Depends on: C-021.

**C-023** `add ADR 0013 for zod adoption + dependency rationale`
- Owner: Role 6.
- Files: `adr/0013-zod-input-validation.md`, `package.json`, `package-lock.json`.
- Test: `scripts/check-dep-trail.sh` passes.
- DoD: zod pinned to a SemVer-fixed version; ADR captures alternatives (joi, ajv, hand-rolled); supply-chain check from npm audit clean.
- Depends on: C-022.

**C-024** `add /api/admin/dump-users for breach-sim demo (read-only, allowlisted)`
- Owner: Role 9.
- Files: `src/routes/admin.ts`, `tests/admin-dump-users.test.ts`.
- Test: `tests/admin-dump-users.test.ts::"only returns DID + commitment + tenant_id + created_at"`.
- DoD: endpoint serves the demo scene 4; output strictly the four allowed columns; gated by `x-api-key` + tenant `demo_breach_view_allowed` flag.
- Depends on: C-003.

**C-025** `migrate session-store from in-memory to Postgres-backed`
- Owner: Role 7.
- Files: `src/services/session-store.ts`, `src/services/db.ts`, `tests/session-store-pg.test.ts`.
- Test: `tests/session-store-pg.test.ts::"sessions persist across process restart"`.
- DoD: Postgres-backed by default; in-memory still available behind `SESSION_STORE_BACKEND=memory` env for dev; closes P0 audit finding C-9.
- Depends on: C-001.

**C-026** `add rate-limit table + middleware backed by Postgres`
- Owner: Role 7.
- Files: `src/middleware/rate-limit.ts`, `src/services/db.ts`, `tests/rate-limit.test.ts`.
- Test: `tests/rate-limit.test.ts::"second 11th request within window returns 429"`.
- DoD: rate-limit per `(api_key_hash, route)` and per `(ip, route)` with configurable buckets; closes P0 audit finding C-10.
- Depends on: C-025.

**C-027** `harden CORS to explicit origin allowlist per tenant`
- Owner: Role 7.
- Files: `src/middleware/cors.ts` (new), `src/app.ts`, `tests/cors.test.ts`.
- Test: `tests/cors.test.ts::"rejects un-allowlisted Origin"`.
- DoD: each tenant has `allowed_origins`; wildcard explicitly disallowed in `live` env.
- Depends on: C-001.

**C-028** `JWT migrate to RS256 with key rotation; publish JWKS`
- Owner: Role 12.
- Files: `src/services/jwt.ts`, `src/routes/.well-known/jwks.ts` (new), `tests/jwt-rs256.test.ts`.
- Test: `tests/jwt-rs256.test.ts::"validates RS256 token against JWKS"`.
- DoD: keys generated, JWKS endpoint live, rotation playbook documented; closes P0 audit finding C-11.
- Depends on: C-023.

**C-029** `expand security-reviewer subagent invocation hooks`
- Owner: Role 26.
- Files: `.claude/agents/security-reviewer.md`, `.husky/post-commit`, `scripts/invoke-sec-reviewer.sh`.
- Test: `scripts/test-sec-reviewer-hook.sh` — touches a sensitive path, verifies subagent is invoked.
- DoD: every PR touching auth/crypto/tenant paths gets a subagent review row in the PR thread.
- Depends on: C-001.

**C-030** `expand cryptographer-reviewer subagent invocation hooks`
- Owner: Role 27.
- Files: `.claude/agents/cryptographer-reviewer.md`, `scripts/invoke-crypto-reviewer.sh`.
- Test: `scripts/test-crypto-reviewer-hook.sh`.
- DoD: every PR touching `circuits/`, `contracts/`, `src/services/zkp.ts`, `src/services/identity.ts`, or any new hash construction gets a subagent review.
- Depends on: C-001.

**C-031** `add docs/security/audit-findings.md tracking all 21 findings`
- Owner: Role 26.
- Files: `docs/security/audit-findings.md`.
- Test: `[no-test]` — markdownlint.
- DoD: table of all 21 findings with status (`open`, `closed-by-<commit-hash>`, `accepted-risk`); CI step asserts `closed-by-` rows have a real commit hash.
- Depends on: C-029.

**C-032** `add nightly CVE monitor with email alerts`
- Owner: Role 22.
- Files: `.github/workflows/cve-monitor.yml`, `scripts/cve-monitor.sh`.
- Test: workflow dry-run on a known-vulnerable lockfile asserts alert is fired.
- DoD: workflow runs nightly; alerts go to security-engineer email + Slack.
- Depends on: C-001.

**C-033** `update CLAUDE.md with phase-0 final state references`
- Owner: Role 1.
- Files: `CLAUDE.md`.
- Test: `[no-test]` — markdownlint.
- DoD: references `docs/plan/bfsi-v1/00-README.md`; lists the closed P0 findings; updates `LAST_UPDATED`.
- Depends on: all of week 1 + week 2.

**Phase 0 exit gate (end of week 2):**
- All P0 findings closed (C-1 via C-004, C-3 via C-005/C-006, C-7 via C-018, C-9 via C-025, C-10 via C-026, C-11 via C-028, plus C-2 below).
- `tests/` suite green.
- Pre-commit hook live in dev + mirrored in CI.
- All ADRs landed: 0008–0013.
- Threat model updated.
- Audit findings document live with status per row.

Note: **C-2 finding** (fake biometric / fake prover) is not closeable in Phase 0; it requires the mobile work in Phase 1. We mark C-2 as `tracked-to-phase-1-sprint-3` in `docs/security/audit-findings.md`.

---

## Phase 1 — Pramaan v1 + Bank Demo (weeks 3–12)

Each sprint is 2 weeks. Five sprints total.

### Sprint 1 (weeks 3–4) — Real identity register + mobile skeleton

**Theme:** Replace the demo identity-register path with a production-quality endpoint that validates Play Integrity verdicts and StrongBox key attestation. Bootstrap the Android repo and the rapidsnark JNI bridge proof-of-concept.

**Anchor commits:**

**C-101** `bootstrap mobile/ subtree with Android Studio project`
- Owner: Role 17.
- Files: `mobile/` (new tree), `mobile/.gitignore`, `mobile/README.md`, `mobile/build.gradle.kts`, `mobile/app/build.gradle.kts`, `mobile/app/src/main/AndroidManifest.xml`.
- Test: `mobile/gradlew assembleDebug` produces an APK; CI runs the build.
- DoD: minSdk 30, targetSdk 34, Kotlin 1.9, Jetpack Compose, Gradle 8.x; structured per Android best practices.
- Depends on: C-033.

**C-102** `add ADR 0014 for android-only mobile platform decision`
- Owner: Role 4.
- Files: `adr/0014-android-only-mobile-platform.md`.
- Test: `[no-test]` — markdownlint.
- DoD: captures the iOS deferral, the rationale (BFSI Android share ≥ 95 %, StrongBox availability, USB-OTG availability for R307), the v2 re-evaluation criteria.
- Depends on: C-101.

**C-103** `add ADR 0015 for rapidsnark JNI vs WebView prover`
- Owner: Role 11.
- Files: `adr/0015-rapidsnark-jni-prover.md`.
- Test: `[no-test]` — markdownlint.
- DoD: WebView prover OK for phase 1 spike; rapidsnark JNI is the production target; toolchain pinned.
- Depends on: C-102.

**C-104** `add rapidsnark JNI bridge proof-of-concept`
- Owner: Role 17.
- Files: `mobile/prover/`, `mobile/prover/src/main/cpp/`, `mobile/prover/src/main/kotlin/`.
- Test: `mobile/prover/src/androidTest/java/.../ProverSmokeTest.kt::"generates a valid proof against fixed witness"`.
- DoD: rapidsnark integrated as a static library via CMake; JNI wrapper exposes `generateProof(witnessJson) -> proofJson`; smoke test passes on a Pixel emulator.
- Depends on: C-103.

**C-105** `redesign /v1/identity/register for Play Integrity + StrongBox attestation`
- Owner: Role 6.
- Files: `src/routes/v1/identity.ts`, `src/services/identity.ts`, `src/services/attestation.ts` (new), `src/validators/identity.ts`, `tests/identity-register.test.ts`.
- Test: `tests/identity-register.test.ts::"rejects request without valid Play Integrity verdict"`, `"rejects request without valid StrongBox attestation chain"`.
- DoD: endpoint accepts `{did, commitment, play_integrity_verdict, key_attestation_chain, attestation_signature}`; validates both attestations; closes P0 finding C-2 partially (server-side; mobile in C-201–C-205); writes audit row.
- Depends on: C-022, C-104.

**C-106** `add ADR 0016 for Play Integrity verdict acceptance criteria`
- Owner: Role 27 (with Role 6).
- Files: `adr/0016-play-integrity-acceptance.md`.
- Test: `[no-test]` — markdownlint.
- DoD: defines `MEETS_DEVICE_INTEGRITY` + `MEETS_BASIC_INTEGRITY` + StrongBox required for `live` env; `MEETS_STRONG_INTEGRITY` strict for high-value flows; nonce binding rules.
- Depends on: C-105.

**C-107** `dashboard users view shows only allowed columns`
- Owner: Role 14.
- Files: `dashboard/src/routes/tenant/users.tsx`, `dashboard/src/lib/api.ts`, `dashboard/src/components/UsersTable.tsx`.
- Test: `dashboard/src/routes/tenant/__tests__/users.test.tsx::"never renders an email or name field"`.
- DoD: column allowlist enforced in component; Playwright check in CI.
- Depends on: C-024.

**C-108** `add demo bank tenant anchor_bank in test environment`
- Owner: Role 7.
- Files: `scripts/seed-demo-tenants.ts`, `tests/seed-demo-tenants.test.ts`.
- Test: `tests/seed-demo-tenants.test.ts::"anchor_bank tenant provisioned with right scopes"`.
- DoD: script idempotent; tenant has `live` + `test` envs; webhooks configured; API keys generated and printed to operator (not committed).
- Depends on: C-105.

Plus ~12 smaller commits (`C-109 .. C-120`) covering: cleanup of legacy demo paths in dashboard, smaller test fixes, schema migrations, docs updates, two minor frontend polish PRs.

**Sprint 1 exit gate:**
- `/v1/identity/register` running with attestation validation in `test` env.
- Android repo scaffolded with prover smoke test green.
- Dashboard users view PII-free.
- Anchor Bank tenant seeded in `test`.

### Sprint 2 (weeks 5–6) — Hash chain shipped + audit dashboard + tenant hardening

**Theme:** Operationalise the hash chain in production (`test` env first, `live` second), ship the audit-integrity view in the dashboard, harden tenant boundary tests, finalise schema migrations.

**Anchor commits:**

**C-121** `ship hash chain backfill migration for existing audit_events`
- Owner: Role 8.
- Files: `scripts/migrations/0001-audit-hash-chain-backfill.ts`, `tests/migrations/audit-backfill.test.ts`.
- Test: backfill 10 k rows; verify chain holds; idempotent.
- DoD: migration runnable on `test` and `live`; rollback path documented; verified on staging dump.
- Depends on: C-012.

**C-122** `enable audit hash chain enforcement in test env`
- Owner: Role 8.
- Files: `src/config/feature-flags.ts`, `src/services/audit.ts`.
- Test: `tests/audit-chain-prod.test.ts::"appends with non-null previous_hash in test env"`.
- DoD: feature flag `AUDIT_HASH_CHAIN_ENFORCED=true` in `test`; alerts wired.
- Depends on: C-121.

**C-123** `add audit-integrity dashboard view with on-chain anchor link`
- Owner: Role 14.
- Files: `dashboard/src/routes/tenant/audit-integrity.tsx`, `dashboard/src/components/IntegrityCheckCard.tsx`.
- Test: `dashboard/src/routes/tenant/__tests__/audit-integrity.test.tsx::"renders PASS state and FAIL state"`.
- DoD: view shows last integrity check result, last anchor tx hash with Basescan link, integrity-check-now button.
- Depends on: C-014, C-016.

**C-124** `add audit-anchors dashboard sub-view`
- Owner: Role 14.
- Files: `dashboard/src/routes/tenant/audit-anchors.tsx`.
- Test: `dashboard/src/routes/tenant/__tests__/audit-anchors.test.tsx`.
- DoD: table of recent anchors, with day, terminal hash, Basescan tx hash, status.
- Depends on: C-015, C-123.

**C-125** `add Anchor Bank webhook receiver smoke test`
- Owner: Role 23 (with Role 10).
- Files: `tests/webhook-anchor-bank.test.ts`, `scripts/mock-webhook-receiver.ts`.
- Test: mock receiver receives `user.enrolled` event, verifies HMAC signature, returns 200.
- DoD: webhook signing key rotation tested; replay protection (nonce + 5-min window) verified.
- Depends on: C-108.

**C-126** `expand cross-tenant rejection test to /api/console/* + /api/admin/*`
- Owner: Role 23.
- Files: `tests/tenant-isolation.test.ts`.
- Test: extended matrix; every console + admin endpoint exercised cross-tenant.
- DoD: 100 % route coverage by Express introspection; no manual list.
- Depends on: C-007.

**C-127** `add tests/audit-coverage.test.ts asserting every write surface logs`
- Owner: Role 23.
- Files: `tests/audit-coverage.test.ts`.
- Test: enumerates every mutating endpoint via Express + grep; asserts each writes an audit row.
- DoD: any new mutating endpoint without an audit row breaks the build.
- Depends on: C-013.

**C-128** `add docs/operations/audit-integrity-runbook.md`
- Owner: Role 35.
- Files: `docs/operations/audit-integrity-runbook.md`.
- Test: `[no-test]` — markdownlint.
- DoD: on-call runbook for "audit integrity check failed" + "on-chain anchor failed two days running".
- Depends on: C-123, C-124.

Plus ~14 smaller commits (`C-129 .. C-142`) covering: more cross-tenant test coverage, dashboard polish, observability dashboards (verifier latency, audit-write lag, anchor lag), CVE-monitor alert tuning, eslint rule additions, ADR-0017 (Postgres-backed rate-limit alternatives evaluated and discarded).

**Sprint 2 exit gate:**
- Hash chain enforced in `test`; nightly CI verifies integrity.
- On-chain anchors landing daily on Base Sepolia.
- Dashboard audit-integrity view live.
- Cross-tenant test coverage expanded.

### Sprint 3 (weeks 7–8) — Mobile prover end-to-end + Scene 2

**Theme:** Bring the Android prover to feature-completeness for Scene 2 (login). End-to-end: app scans QR, fires BiometricPrompt, generates real Groth16 proof, server verifies. This is where C-2 (fake-prover) audit finding closes.

**Anchor commits:**

**C-143** `mobile enrollment flow with CameraX face capture`
- Owner: Role 17 + Role 19.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/enrollment/`, `mobile/app/src/main/res/`, `mobile/app/src/androidTest/.../EnrollmentInstrumentedTest.kt`.
- Test: instrumented test on emulator simulates face capture, asserts SHA-256 of descriptor computed on-device, asserts buffer GC'd within 1 s.
- DoD: face capture flow runs on Pixel 7 + emulator; capture cancel + retry tested.
- Depends on: C-101.

**C-144** `mobile BiometricPrompt integration + StrongBox key wrap`
- Owner: Role 17.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/keystore/`, instrumented tests.
- Test: instrumented test asserts: key created with `setIsStrongBoxBacked(true)`; key inaccessible without fresh BiometricPrompt assertion.
- DoD: tested on Pixel 7 (StrongBox-capable); fallback path for non-StrongBox devices documented.
- Depends on: C-143.

**C-145** `mobile QR scanner + session_nonce + tenant_id binding`
- Owner: Role 19.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/scanner/`.
- Test: instrumented test scans a generated QR, asserts session_nonce extracted, tenant_id verified against in-app config.
- DoD: ML Kit Barcode Scanning integration; QR formats v1 documented in `docs/protocols/qr-pairing.md`.
- Depends on: C-143.

**C-146** `mobile end-to-end login flow against test env`
- Owner: Role 17 + Role 19.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/login/`, instrumented + on-device test.
- Test: on-device test on the team's CI device farm — scan QR, biometric, generate proof, post to test env, receive session.
- DoD: end-to-end login on test env works on Pixel 7 + Samsung S22 + Redmi Note 13.
- Depends on: C-104, C-144, C-145.

**C-147** `kiosk web app for Scene 2 with SSE consumer + QR generator`
- Owner: Role 15.
- Files: `dashboard/src/routes/kiosk/`, `dashboard/src/lib/kiosk-sse.ts`.
- Test: Playwright test simulating kiosk: opens QR, posts a verify request server-side, asserts SSE event received and redirect happens.
- DoD: kiosk URL is `https://zeroauth.dev/kiosk/<tenant>?session=<nonce>`; latency ≤ 1 s from server verify to kiosk redirect.
- Depends on: C-006.

**C-148** `harden /v1/zkp/verify with full proof verification path`
- Owner: Role 6.
- Files: `src/routes/v1/zkp.ts`, `src/services/zkp.ts`, `tests/zkp-verify-prod.test.ts`.
- Test: `tests/zkp-verify-prod.test.ts::"accepts known-good proof"`, `"rejects known-bad proof"`, `"rejects replayed session_nonce"`.
- DoD: full snarkjs.groth16.verify against `verification_key.json`; replay protection via session-nonce dedup table; writes audit row.
- Depends on: C-020.

**C-149** `close P0 audit finding C-2 (real prover on mobile)`
- Owner: Role 17 (signed off by Role 26 + Role 27).
- Files: `docs/security/audit-findings.md`, `tests/no-fake-prover.test.ts`.
- Test: `tests/no-fake-prover.test.ts::"grep for FakeMobileProver returns zero hits"`.
- DoD: `FakeKeystoreManager`, `FakeMobileProver`, `FakeBiometricGate` removed from codebase; instrumented Pixel test passes.
- Depends on: C-146.

**C-150** `mobile crash + ANR telemetry pipeline (no PII)`
- Owner: Role 19.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/telemetry/`.
- Test: instrumented test simulates crash; verifies telemetry payload contains no PII, no biometric data; verifies pipeline ships.
- DoD: telemetry endpoint receives + persists; allowlist of fields; no DID, no commitment in payload.
- Depends on: C-101.

Plus ~12 smaller commits (`C-151 .. C-162`) covering: server-side proof-verification audit row enrichment, kiosk UX polish, SSE reconnect logic, demo session expiry handling, dashboard "sessions live now" view, mobile UI strings + i18n stub (English + Hindi base), more device-fleet coverage tests.

**Sprint 3 exit gate:**
- Scene 1 (enrollment) and Scene 2 (login) work end-to-end with real biometrics, real prover, real verifier on test env.
- C-2 audit finding closed.
- Kiosk web app shippable.

### Sprint 4 (weeks 9–10) — Transactions + Trusted Setup + R307 driver

**Theme:** Scene 3 (transaction step-up) works end-to-end. Trusted-setup ceremony executed. R307 USB-OTG driver in production.

**Anchor commits:**

**C-163** `add /v1/zkp/challenge endpoint with tx_nonce computation`
- Owner: Role 6.
- Files: `src/routes/v1/zkp.ts`, `src/services/zkp.ts`, `tests/zkp-challenge.test.ts`.
- Test: `tests/zkp-challenge.test.ts::"computes tx_nonce = Poseidon(amount, payee, ts) deterministically"`.
- DoD: endpoint returns `{tx_nonce, session_nonce, expires_at}`; writes pending-challenge audit row.
- Depends on: C-148.

**C-164** `mobile transaction-confirmation sheet`
- Owner: Role 19.
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/txn/`.
- Test: instrumented test asserts displayed amount + payee match server payload.
- DoD: sheet displays amount in Indian numbering format, payee name + masked account, expiry countdown.
- Depends on: C-146.

**C-165** `mobile prover binds tx_nonce as public input`
- Owner: Role 17.
- Files: `mobile/prover/src/main/kotlin/dev/zeroauth/prover/`.
- Test: instrumented test generates a proof binding tx_nonce; server rejects when tx_nonce mismatches.
- DoD: prover input schema versioned; backward-compat preserved.
- Depends on: C-163, C-164.

**C-166** `FCM push notification for txn step-up`
- Owner: Role 18 (with Role 10).
- Files: `mobile/app/src/main/kotlin/dev/zeroauth/push/`, `src/services/push.ts` (new), `tests/push-fcm.test.ts`.
- Test: push delivered to a registered token; payload contains only opaque txn_id, no PII.
- DoD: FCM project provisioned; per-tenant push config; revocation tested.
- Depends on: C-163.

**C-167** `add R307 USB-OTG driver in mobile/sensors/r307`
- Owner: Role 18.
- Files: `mobile/sensors/r307/`, instrumented + on-device tests.
- Test: on-device test reads R307 over USB-OTG, captures fingerprint descriptor, hashes on-device.
- DoD: works on Pixel 7 + Samsung S22 with R307 sensor over USB-OTG; tested with two physical R307 units.
- Depends on: C-101.

**C-168** `add device-support-matrix.md tier-1 device list`
- Owner: Role 4 + Role 35.
- Files: `docs/operations/device-support-matrix.md`.
- Test: `[no-test]` — markdownlint.
- DoD: tier-1 list of top-12 Indian Android SKUs by share with verified StrongBox + BiometricPrompt + USB-OTG status.
- Depends on: C-167.

**C-169** `execute Phase 2 trusted-setup ceremony with 6 contributors`
- Owner: Role 11 + Role 27.
- Files: `circuits/identity_proof.v1.2.zkey`, `circuits/verification_key.v1.2.json`, `docs/cryptography/trusted-setup-ceremony.md`, `circuits/ceremony-transcripts/`.
- Test: `tests/circuit-v1.2-verify.test.ts::"verifies one known-good proof against v1.2 vkey"`.
- DoD: 6 contributors named, transcripts hashed and published; ADR 0018 lands; external cryptographer review attached.
- Depends on: C-019.

**C-170** `add ADR 0018 for trusted-setup ceremony v1.2 transcript`
- Owner: Role 11.
- Files: `adr/0018-trusted-setup-ceremony-v1-2.md`.
- Test: `[no-test]` — markdownlint.
- DoD: captures contributors, dates, transcript hashes, external review attestation.
- Depends on: C-169.

**C-171** `redeploy Groth16Verifier on Base Sepolia at v1.2 vkey`
- Owner: Role 25.
- Files: `contracts/Groth16Verifier.sol`, `scripts/deploy-contracts.ts`, `contracts/deployed-addresses.json`.
- Test: verifier accepts one known-good v1.2 proof, rejects v1.1 proof against v1.2 vkey.
- DoD: deployed, verified, addresses committed; rollback contract retained.
- Depends on: C-169.

**C-172** `update src/services/zkp.ts to pin v1.2 vkey hash`
- Owner: Role 11.
- Files: `src/services/zkp.ts`, `tests/zkp-version.test.ts`.
- Test: updated version test.
- DoD: vkey hash check passes; verifier loads on boot.
- Depends on: C-171.

Plus ~14 smaller commits (`C-173 .. C-186`) covering: mobile UI for R307 capture (operator-prompts), instrumented tests across more SKUs, kiosk SSE reconnect after network blip, txn-substitution demo helper toggle in operator console, more docs updates, the legal memo deliverable for Scene 4.

**Sprint 4 exit gate:**
- Scene 3 (transaction) works end-to-end.
- Trusted setup ceremony for v1.2 complete and documented.
- R307 driver working on tier-1 devices.
- Verifier on Base Sepolia at v1.2.

### Sprint 5 (weeks 11–12) — Demo polish + Anchor Bank dry run

**Theme:** All six scenes integrated. Demo operator runbook complete. Internal dry run with a mock banker panel. Load test passing. Demo videoed for handoff.

**Anchor commits:**

**C-187** `add Scene 4 (breach simulation) operator console toggle`
- Owner: Role 15 (with Role 9).
- Files: `dashboard/src/routes/operator/breach-sim.tsx`, `src/routes/admin.ts`.
- Test: end-to-end Playwright simulating the operator script — toggle on, run dump-users, observe table render.
- DoD: only enabled when tenant `demo_breach_view_allowed` flag is set; logs an audit row when invoked.
- Depends on: C-024, C-107.

**C-188** `add Scene 5 (audit integrity tamper demo) operator helper`
- Owner: Role 14 + Role 8.
- Files: `dashboard/src/routes/operator/audit-tamper-demo.tsx`, `src/routes/admin.ts`.
- Test: end-to-end Playwright simulating the operator's tamper script.
- DoD: tampers a copy of the audit_events row in a sandbox schema, runs integrity check, displays FAIL state, restores; no production data harmed.
- Depends on: C-014.

**C-189** `add Scene 6 (teller workforce flow) tenant configuration`
- Owner: Role 7 + Role 14.
- Files: `src/services/tenants.ts`, `dashboard/src/routes/operator/workforce.tsx`.
- Test: tenant flag `workforce_enabled` toggles workforce-mode features.
- DoD: workforce-mode tenant onboarding works; teller's audit rows bound to personal DID.
- Depends on: C-126.

**C-190** `add Anchor Bank operator runbook`
- Owner: Role 35 (with Role 45).
- Files: `docs/operations/anchor-bank-demo-runbook.md`.
- Test: `[no-test]` — markdownlint + screenshot links validated.
- DoD: scene-by-scene script, the screenshots, the operator's keystroke sequence, the recovery playbook for each known failure mode.
- Depends on: C-187, C-188, C-189.

**C-191** `add load test sustaining 500 RPS verify for 30 min`
- Owner: Role 23.
- Files: `tests/load/verify-load.k6.js`, `.github/workflows/load-test.yml`.
- Test: workflow runs nightly; reports p50, p95, p99 latency.
- DoD: at 500 RPS, p95 ≤ 800 ms, error rate ≤ 1 %.
- Depends on: C-148.

**C-192** `add demo-readiness Playwright suite`
- Owner: Role 23.
- Files: `tests/e2e/demo-scenes/`.
- Test: every scene 1–6 has an automated end-to-end run.
- DoD: green on every PR before merge; gate for Phase 1 exit.
- Depends on: C-187, C-188, C-189.

**C-193** `record demo dry run with internal mock bank panel`
- Owner: Role 45 (with Role 29 + Role 1).
- Files: `docs/sales/demo-recordings/anchor-bank-dry-run-1.md`.
- Test: `[no-test]` — markdownlint; embedded video link tested via link-check.
- DoD: full 22-min demo recorded; feedback captured; corrections tracked.
- Depends on: C-190.

**C-194** `update CLAUDE.md and 00-README for Phase 1 exit`
- Owner: Role 1.
- Files: `CLAUDE.md`, `docs/plan/bfsi-v1/00-README.md`.
- Test: `[no-test]` — markdownlint.
- DoD: Phase 1 marked complete on exit-gate items; Phase 2 plan referenced.
- Depends on: C-192, C-193.

Plus ~16 smaller commits (`C-195 .. C-210`) covering: UI polish across kiosk + dashboard, dark-mode and light-mode demo-friendly presets, error-state polish, copy edits, the legal memo final draft for Scene 4, threat-model updates, ADR for the Anchor Bank tenant configuration.

**Phase 1 exit gate (end of week 12):**
- All six demo scenes pass automated end-to-end suite.
- Demo dry run complete; recording reviewed by Role 1 + Role 28 + Role 42.
- Anchor Bank tenant ready in `live` environment.
- Load test passes target SLA.
- No P0 audit findings open.
- Three banker meetings scheduled in week 13–14.

---

## Phase 2 — Pilots (weeks 13–26)

Anchor commits at milestone level. Sprint-level decomposition occurs at the start of phase 2.

| Week | Theme | Anchor commits (illustrative) |
|---|---|---|
| 13–14 | First three bank demos delivered live | `record three banker-feedback rounds`, `add bank-feedback ingestion to pain-points doc`, `update demo runbook with v2 of operator script` |
| 15–16 | First pilot tenant goes live with limited userbase | `provision pilot bank tenant in live env`, `add pilot-bank-specific webhook signing`, `add SLA monitoring dashboard for pilot tenant` |
| 17–18 | SDK v1: Node | `ship @zeroauth/node-sdk 1.0.0`, `add SDK integration tests in CI`, `add SDK docs site section` |
| 19–20 | SOC 2 Type I evidence period kicks off | `enable SOC 2 audit-evidence collector`, `add evidence pack auto-bundling`, `add quarterly access review automation` |
| 21–22 | Second pilot tenant; healthcare pain-point research begins | `provision second pilot tenant`, `add healthcare pain-points draft`, `add ABDM integration spike` |
| 23–24 | ISO 27001 Stage 1 audit | `respond to ISO 27001 Stage 1 findings`, `add ISMS docs to docs/compliance/` |
| 25–26 | Third pilot tenant; SOC 2 Type I report received | `complete SOC 2 Type I evidence`, `add SOC 2 report PDF to evidence pack` |

## Phase 3 — Compliance hardening (weeks 27–39)

| Week | Theme |
|---|---|
| 27–32 | SOC 2 Type II evidence period |
| 33–36 | ISO 27001 Stage 2 audit + DPDP §8 compliance audit |
| 37–39 | RBI sandbox application; healthcare demo specification + pilot LOI |

## Phase 4 — Regulator-defensible v1 (weeks 40–52)

| Week | Theme |
|---|---|
| 40–44 | Base mainnet contract deployment + HSM-backed signer |
| 45–48 | First paid bank in production rollout (gradual) |
| 49–50 | Full disaster recovery exercise |
| 51–52 | Year-end retrospective + v2 roadmap |

---

## Cumulative commit counter (Phase 0 + Phase 1)

| Sprint | Anchor commits | Smaller commits | Cumulative |
|---|---|---|---|
| Phase 0 W1 | 17 (C-001..C-017) | — | 17 |
| Phase 0 W2 | 16 (C-018..C-033) | — | 33 |
| Phase 1 S1 | 8 (C-101..C-108) | 12 | 53 |
| Phase 1 S2 | 8 (C-121..C-128) | 14 | 75 |
| Phase 1 S3 | 8 (C-143..C-150) | 12 | 95 |
| Phase 1 S4 | 10 (C-163..C-172) | 14 | 119 |
| Phase 1 S5 | 8 (C-187..C-194) | 16 | 143 |

**Estimate:** ~143 commits to phase 1 exit. Real number will vary ± 25 %. Sprint planning at the start of each sprint reconciles.

---

LAST_UPDATED: 2026-05-27
