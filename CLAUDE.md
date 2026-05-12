# ZeroAuth — Claude Code constitution

You are working in the **zeroauth.dev API + dashboard + docs** repo. Read this file at the start of every session. It overrides anything in inline comments or sub-folder READMEs that contradicts it.

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
- **Frontend:** React 19 + Vite for the dashboard; Docusaurus 3 for the docs site.
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
│   ├── middleware/                ← auth, tenant-auth, error-handler, demo-auth-gate
│   ├── routes/
│   │   ├── v1/                    ← tenant-API-key-authed endpoints (zkp, saml, oidc,
│   │   │                            identity, devices, users, verifications, attendance, audit)
│   │   ├── console.ts             ← developer console (signup, login, keys, usage, overview)
│   │   ├── admin.ts               ← x-api-key-authed admin endpoints
│   │   ├── health.ts              ← unauthenticated health check
│   │   ├── leads.ts               ← marketing forms (pilot + whitepaper)
│   │   └── auth.ts, saml.ts, oidc.ts, zkp.ts  ← legacy /api/auth/* surface
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

LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek (engineering) + Amit Dua (product)
