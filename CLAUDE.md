# ZeroAuth — Claude Code constitution

You are working in the **zeroauth.dev API + dashboard + docs** repo. Read this file at the start of every session. It overrides anything in inline comments or sub-folder READMEs that contradicts it.

## Current phase

ZeroAuth is on the BFSI v1 production plan. The plan is the source of truth for everything below — phase boundaries, commit ordering, agent responsibilities. Read these documents alongside this file:

- [docs/plan/bfsi-v1/00-README.md](docs/plan/bfsi-v1/00-README.md) — phase map + the 10 standing constraints.
- [docs/plan/bfsi-v1/01-pain-points.md](docs/plan/bfsi-v1/01-pain-points.md) — the 10 BFSI pain points ZeroAuth solves; every commit must trace to one.
- [docs/plan/bfsi-v1/02-bank-demo.md](docs/plan/bfsi-v1/02-bank-demo.md) — the Anchor Bank demo (5 scenes + optional Scene 6); Phase 1 exit gate is "all 6 scenes run end-to-end without operator intervention beyond the script."
- [docs/plan/bfsi-v1/03-team.md](docs/plan/bfsi-v1/03-team.md) — 50-person roster + KPIs.
- [docs/plan/bfsi-v1/04-commits.md](docs/plan/bfsi-v1/04-commits.md) — commit-by-commit plan (C-001..C-194 for Phase 0 + Phase 1). Commit subjects in the codebase reference these IDs.
- [docs/plan/bfsi-v1/05-agents.md](docs/plan/bfsi-v1/05-agents.md) — per-agent week-by-week tickets.
- [docs/plan/bfsi-v1/agents/](docs/plan/bfsi-v1/agents/) — per-agent daily Mon-Fri tickets for weeks 1-4 with 5-field DoD per ticket.
- [docs/plan/bfsi-v1/06-ways-of-working.md](docs/plan/bfsi-v1/06-ways-of-working.md) — branch policy, commit gates, sub-agent rules, cadence.

Phase 0 (weeks 1-2) closes the 21 Phase 0 audit findings (tracked in [docs/security/audit-findings.md](docs/security/audit-findings.md)). Phase 1 (weeks 3-12) builds the Anchor Bank demo end-to-end.

Phase 0 closed P0 findings as of LAST_UPDATED: C-1 (demo bypass), C-3 (access_token query fallback), C-4 (audit hash chain), C-6 (direct INSERT guard), C-7 (vkey integrity), C-8 (biometric-payload guard), C-10 (rate-limit), C-12 (cross-tenant matrix), C-14 (CVE monitor). C-2 (fake mobile prover) tracks to Phase 1 Sprint 3.

## Blockchain-agnostic pivot (ADR 0017)

The platform is **blockchain-agnostic by default**. Per [adr/0017-blockchain-agnostic-posture.md](adr/0017-blockchain-agnostic-posture.md), the on-chain anchor + DIDRegistry + on-chain verifier are now **opt-in providers** keyed on `tenant.security_policy`:

- `did_provider`: `off-chain` (default) | `base-sepolia` | `base-mainnet` | `custom-chain`
- `verifier_provider`: `off-chain` (default) | `on-chain`
- `audit_anchor_provider`: `none` (default) | `signed-transcript` | `base-sepolia` | `base-mainnet` | `witness-cosign`

A default tenant boots with zero `BLOCKCHAIN_PRIVATE_KEY`, zero contract address, zero RPC dependency. The Pramaan ZK protocol + hash-chained audit log work end-to-end off-chain. The Auth0 differentiation pitch ([docs/why-zeroauth/vs-auth0.md](docs/why-zeroauth/vs-auth0.md)) does not require any blockchain to hold.

## Face-first identity surface (ADR 0017)

The production register + verify endpoints are:

- `POST /v1/identity/register` — accepts on-device-computed `(did, commitment)` only. No biometric template, no image, no embedding ever crosses the wire.
- `POST /v1/identity/verify` — looks up user by DID, asserts `publicSignals[0]` matches stored commitment, runs `snarkjs.groth16.verify` against the boot-pinned vkey, mints session.

The legacy `/v1/auth/zkp/register` (which accepts a base64 biometricTemplate) and `/v1/auth/zkp/verify` (no DID lookup) are retained for backward compat with the W3 demo client and carry `Deprecation: true` + `Sunset: 2026-12-31` headers. New integrations MUST use `/v1/identity/*`.

On-device commitment pipeline lives in [mobile/biometric/](mobile/biometric/):

- `FaceEmbedder` (TFLite MobileFaceNet) → 128-dim L2-normalised embedding
- `Quantizer` → 256-byte deterministic int16 BE
- `Sha256` (with buffer zeroing) → 32-byte secret
- `Poseidon.hash2(secret, salt)` → 32-byte commitment (BN128 field element, byte-identical to `circomlibjs.poseidon2`)
- `Keccak256(commitment)[:20]` → DID suffix

CameraX face-capture + ML Kit detection lives in [mobile/face/](mobile/face/).

## What this repo is

ZeroAuth is the zero-knowledge identity verification layer for India's regulated industries (BFSI, healthcare, government). This repo holds:

- the central tenant-scoped HTTP API at `https://zeroauth.dev/v1/*`
- the developer console at `/api/console/*`
- the React admin dashboard at `/dashboard`
- the Docusaurus docs site at `/docs/`
- the Solidity contracts (`DIDRegistry`, `Groth16Verifier`) on Base Sepolia L2
- the Circom circuit `identity_proof.circom`
- the multi-stage Docker stack and the GitHub Actions deploy pipeline

Live production: <https://zeroauth.dev>. VPS at `104.207.143.14` under user `zeroauth-deploy`. CI + auto-deploy live; see `.github/workflows/`.

## Load-bearing capabilities

1. **Tenant management** — multi-tenant; each customer is isolated by tenant ID + environment (`live` vs `test`).
2. **API keys** — `za_{live,test}_{48 hex}` format, SHA-256 hashed at rest, scope-checked per endpoint.
3. **Device registration, user enrollment, verification events, attendance events, audit events** — the central API surface under `/v1/*`.
4. **ZKP proof verification** — Groth16 over BN128, off-chain in `snarkjs`, optionally re-verified on-chain.
5. **Identity registration** — SHA-256 biometric → DID, Poseidon commitment, anchored on Base Sepolia.
6. **Tamper-evident audit log** — append-only `audit_events` table; every write surface logs an event.
7. **Health + admin** — `/api/health`, `/api/admin/{stats,blockchain,privacy-audit,leads}` gated by `x-api-key`.

## Non-goals (enforce in code review)

- **Never accept raw biometric data over the wire.** No images, templates, depth maps, pixel arrays. The verifier accepts proofs and signatures only.
- **Never log biometric-derived raw data.** SHA-256 / Poseidon hashes are stored; the input buffer is GC'd immediately after the hash.
- **Never expose admin actions without an audit row.** Every admin or console action writes a row to `audit_events`.
- **Never expose one tenant's data to another.** Every query is gated by `(tenant_id, environment)` in the WHERE clause.
- **Never deploy a verifier whose circuit version is not in `/adr/`.**

## Stack (what's actually in the repo today)

- **Language:** Node.js 20+ with TypeScript 5 in `strict` mode. Avoid `any` in exported signatures; localised `(req as any).tenantContext` is allowed until we ship Express module augmentation.
- **API framework:** Express 4. Manual `if (!field) res.status(400).json(...)` validation today; **zod is the planned input-validation layer** — adopt it via the `dep-add` skill when a new endpoint goes in.
- **Database:** PostgreSQL 16 via the `pg` driver. Schema is bootstrapped at startup in `src/services/db.ts` using `CREATE TABLE IF NOT EXISTS`. Prisma is **not** used — when we outgrow the bootstrap schema, propose a migration tooling decision via an ADR.
- **Sessions / rate-limits:** in-memory today (`src/services/session-store.ts`, `src/middleware/tenant-auth.ts`). Redis is wired in compose but unused by code; multi-instance scale-out requires the Redis backing — open issue.
- **Auth:** Tenant API key for `/v1/*`. Console JWT for `/api/console/*`. Admin x-api-key for `/api/admin/*`. JWTs are HS256 (symmetric); RS256 is on the roadmap so we can publish a real JWKS.
- **Logging:** structured JSON via Winston. NEVER log biometric-derived data. Reject any payload containing keys named `image`, `template`, `pixel`, `depth`, `frame` in input validators when zod lands.
- **Error handling:** Routes return JSON `{ error: '<machine_code>', message: '<human>' }` with appropriate HTTP status. Sensitive details (DB errors, internal trace) stay in Winston, not in the response.
- **Tests:** Jest. Unit + request-level tests in `tests/*.test.ts`. Currently 50/50 passing. Every new endpoint adds a request-level test before merge.
- **Smart contracts:** Solidity 0.8 via Hardhat; deployed to Base Sepolia (chain 84532).
- **Frontend (developer console / dashboard):** React 19 + Vite 7 + TypeScript strict. Routing via `react-router-dom`. Server state via `@tanstack/react-query`. Styling via Tailwind CSS + a small set of hand-written primitives (`Button`, `Input`, `Card`, `Table`, `Badge`, `Modal`, `Toast`). Unit tests with vitest + @testing-library/react. Lives in `dashboard/`, served as static files by Express at `/dashboard`. The suite's `dashboard_CLAUDE.md` calls for Next.js 15 — see [adr/0002-dashboard-stack-vite-not-nextjs.md](adr/0002-dashboard-stack-vite-not-nextjs.md) for why we deferred that migration.
- **Frontend (marketing site):** Docusaurus 3 for the docs site at `/docs`; vanilla HTML/CSS for the landing page at `/`.
- **Commits:** Plain English subject + body explaining "why". Conventional Commits not enforced.

## Critical language rules (enforce in PR review)

NEVER use these phrases in code, comments, docs, commit messages, or marketing copy:

- ~~"AI-powered" / "leveraging AI"~~ — the verifier is cryptography, not AI.
- ~~"deepfake-immune"~~ without the qualifier "at the visual spoofing class at the verification layer".
- ~~"Dr. Pulkit"~~ — Pulkit Pareek is "Senior Software Engineer".
- ~~"production stack"~~ — use "live reference implementation".

## Build / test / lint commands

```bash
npm run setup        # install root + dashboard + website, then build:all
npm run dev          # tsx watch src/server.ts on :3000
npm test             # jest --forceExit --detectOpenHandles
npm run lint         # eslint v9 flat config
npm run build        # tsc to dist/
npm run build:all    # backend + dashboard + docs site
npm start            # node dist/server.js
```

Docker:

```bash
./scripts/deploy.sh dev    # local stack with hot reload
./scripts/deploy.sh prod   # full prod stack (Caddy + Postgres + Redis + app)
```

Before any commit:

```bash
npx tsc --noEmit && npm run lint && npm test
```

The CI workflow at [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the same gates on every PR and every push to `main`. CI must be green before merge.

## Standing instructions

1. **Read [docs/api_contract.md](docs/api_contract.md) before adding or changing any endpoint.** That doc is the source of truth. If the doc is unclear, propose a contract revision in plan mode before coding.

2. **Write the request-level test before the implementation.** Especially for verification, replay defence, and tenant isolation. The test for "wrong tenant rejected" must exist before "right tenant accepted" can be merged. Tests live in `tests/`; see `tests/central-api.test.ts` for the pattern.

3. **Use plan mode for anything touching 5+ files OR any of these paths:** `src/services/zkp.ts`, `src/services/identity.ts`, `src/services/api-keys.ts`, `src/middleware/tenant-auth.ts`, the audit-log path in `src/services/platform.ts`, the contracts under `contracts/`, the circuit under `circuits/`.

4. **Invoke the `security-reviewer` subagent after any change to auth, crypto, audit, or tenant boundaries.** It's installed at `.claude/agents/security-reviewer.md`. Don't ask — just invoke.

5. **Invoke the `cryptographer-reviewer` subagent for any change under `circuits/`, `contracts/`, `src/services/zkp.ts`, `src/services/identity.ts`, or anywhere a hash or commitment scheme is being introduced.** Installed at `.claude/agents/cryptographer-reviewer.md`.

6. **Add every new dependency via the `dep-add` skill** at `.claude/skills/dep-add/SKILL.md`. The skill walks through the ADR-first decision; ADRs land under `/adr/`. The `scripts/check-dep-trail.sh` script audits the dep tree against `/adr/`.

7. **Update [docs/threat_model.md](docs/threat_model.md) when the architecture changes.** Every new mitigation should reference an `A-NN` attack entry, and every new test should map to one.

8. **Never deploy without a passing CI run on `main`.** The deploy workflow at `.github/workflows/deploy.yml` runs on push; if CI is red, the deploy fails fast.

9. **Never commit secrets.** `.env`, `PRODUCTION_CREDENTIALS.md`, `GITHUB_SECRETS.md` are gitignored. Production secrets live on the VPS in `/opt/zeroauth/.env` and in your password manager.

10. **When you (Claude) get stuck:**
    - Ambiguous requirements → ask, don't guess.
    - Conflicting standards (this file vs. inline comments vs. a doc) → this file wins; flag the conflict.
    - A new dependency → run the `dep-add` skill; do not `npm install` silently.
    - A new endpoint pattern → propose in plan mode; update `docs/api_contract.md` first.

## Folder layout

```
.
├── src/
│   ├── server.ts                  ← entry point (async init + graceful shutdown)
│   ├── app.ts                     ← Express app: middleware, route mounting
│   ├── config/                    ← env loading + parsing
│   ├── middleware/                ← auth, tenant-auth, error-handler
│   ├── routes/
│   │   ├── v1/                    ← tenant-API-key-authed endpoints (zkp, identity,
│   │   │                            devices, users, verifications, attendance, audit)
│   │   ├── console.ts             ← developer console (signup, login, keys, usage, overview)
│   │   ├── admin.ts               ← x-api-key-authed admin endpoints
│   │   ├── health.ts              ← unauthenticated health check
│   │   └── leads.ts               ← marketing forms (pilot + whitepaper)
│   ├── services/                  ← business logic (jwt, identity, zkp, blockchain,
│   │                                tenants, api-keys, platform, usage, db, session-store)
│   └── types/                     ← TypeScript interfaces, enums, scope literals
├── tests/                         ← Jest suite (currently 50 tests, all passing)
├── circuits/                      ← Circom source + compiled WASM/zkey/vkey
├── contracts/                     ← Solidity sources + deployed-addresses.json
├── dashboard/                     ← React + Vite admin UI
├── website/                       ← Docusaurus docs site (sources in /docs at repo root)
├── docs/                          ← markdown for the docs site + api_contract + threat_model
├── adr/                           ← architecture decision records (DP6)
├── scripts/                       ← deploy.sh, deploy-remote.sh, setup-zkp.sh,
│                                    deploy-contracts.ts, transfer-ownership.ts,
│                                    check-dep-trail.sh
├── .github/workflows/             ← ci.yml + deploy.yml
├── .claude/
│   ├── skills/                    ← shared engineering skills (DP3)
│   └── agents/                    ← shared subagents (security-reviewer, cryptographer-reviewer)
├── Dockerfile                     ← multi-stage (dev / test / api-build / dashboard-build /
│                                    docs-build / production)
├── docker-compose.yml             ← dev / test / prod profiles
└── Caddyfile                      ← TLS + reverse proxy for zeroauth.dev
```

## Subagents available

| Name | File | When to invoke |
|---|---|---|
| `security-reviewer` | [.claude/agents/security-reviewer.md](.claude/agents/security-reviewer.md) | After any change to auth, crypto, audit, tenant boundaries, key handling, or network ingress. Runs in plan mode on Opus. |
| `cryptographer-reviewer` | [.claude/agents/cryptographer-reviewer.md](.claude/agents/cryptographer-reviewer.md) | After any change under `circuits/`, `contracts/`, or any service that touches Poseidon, SHA-256 commitments, the Groth16 verifier, or the DID derivation. Plan mode on Opus. |

More agents (`perf-investigator`, `release-shepherd`, `compliance-mapper`, `poc-integration-engineer`) live in the operator's prompt suite (`zeroauth_prompt_suite/`, gitignored) and can be installed on demand.

## Skills available

| Name | File | What it does |
|---|---|---|
| `dep-add` | [.claude/skills/dep-add/SKILL.md](.claude/skills/dep-add/SKILL.md) | Walks through DP6 (every dep is an ADR): identify need → survey alternatives → supply-chain check → write ADR → install → commit. |

More skills (`release-cut`, `test-from-threat-model`, `migration-writer`, `adr-writer`, `circuit-review`, `demo-qa-logger`, `evidence-pack-update`, `threat-model-update`) live in the operator's prompt suite and can be installed on demand.

## Source of truth pointers

- **API contract:** [docs/api_contract.md](docs/api_contract.md)
- **Threat model:** [docs/threat_model.md](docs/threat_model.md)
- **Error codes:** [docs/error_codes.md](docs/error_codes.md)
- **Architecture decisions:** [adr/](adr/)
- **Deployed contract addresses:** [contracts/deployed-addresses.json](contracts/deployed-addresses.json)
- **Live production health:** <https://zeroauth.dev/api/health>

---

LAST_UPDATED: 2026-05-28
OWNER: Pulkit Pareek (engineering) + Amit Dua (product)
