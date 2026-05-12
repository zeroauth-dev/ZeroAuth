# ADR-0000 — Grandfather initial dependencies

## Status
Accepted

## Context

DP6 (every dependency is an ADR) is being introduced retroactively. At the
time this ADR is written, the repo already ships 58 direct dependencies
across three workspaces (root, dashboard, website) that pre-date the
discipline. Authoring 58 individual ADRs before any further work is
disproportionate, and would either block the 60-day SoW clock (DP8) or
get rubber-stamped without thought — neither outcome serves the project.

## Decision

The dependencies listed below are **grandfathered**: they are accepted as
the working baseline. They are listed here so that
`scripts/check-dep-trail.sh` passes in advisory mode today and strict
mode in the future.

Every NEW direct dependency added from this point forward — including a
major-version bump of a grandfathered dependency — must go through the
`dep-add` skill and ship its own ADR.

When an engineer next touches a grandfathered dependency for any reason
(security patch, major bump, replacement), the work includes back-filling
a dedicated ADR for that one dependency and removing it from this list.

## Grandfathered dependencies

### Root workspace (`./package.json`)

- `@nomicfoundation/hardhat-toolbox`
- `@openzeppelin/contracts`
- `@types/cookie-parser`
- `@types/cors`
- `@types/express`
- `@types/express-session`
- `@types/jest`
- `@types/jsonwebtoken`
- `@types/node`
- `@types/pg`
- `@types/snarkjs`
- `@types/supertest`
- `@types/uuid`
- `@typescript-eslint/eslint-plugin`
- `@typescript-eslint/parser`
- `circomlib`
- `circomlibjs`
- `cookie-parser`
- `cors`
- `dotenv`
- `eslint`
- `ethers`
- `express`
- `express-rate-limit`
- `express-session`
- `hardhat`
- `helmet`
- `ioredis`
- `jest`
- `jsonwebtoken`
- `pg`
- `snarkjs`
- `supertest`
- `ts-jest`
- `tsx`
- `typescript`
- `typescript-eslint`
- `uuid`
- `winston`

### Dashboard workspace (`./dashboard/package.json`)

- `@types/react`
- `@types/react-dom`
- `@vitejs/plugin-react`
- `react`
- `react-dom`
- `typescript`
- `vite`

### Documentation site workspace (`./website/package.json`)

- `@docusaurus/core`
- `@docusaurus/faster`
- `@docusaurus/module-type-aliases`
- `@docusaurus/preset-classic`
- `@docusaurus/tsconfig`
- `@docusaurus/types`
- `@mdx-js/react`
- `clsx`
- `prism-react-renderer`
- `react`
- `react-dom`
- `typescript`

## Consequences

- **Positive:** DP6 is enforceable on net-new dependencies from day one
  without a 58-ADR write-up tax. Pre-suite deps are still visible in one
  place for review.
- **Negative:** the grandfather list defers the per-dep risk analysis we
  would otherwise have written today (supply-chain surface, license,
  maintainer health). That analysis is owed and is paid down lazily as
  each dep is next touched.
- **Neutral:** `scripts/check-dep-trail.sh` runs in advisory mode until
  the grandfather list is empty, then flips to strict.

## Alternatives considered

1. **Write 58 ADRs now.** Rejected — disproportionate to the value, and
   would produce shallow ADRs because there is no fresh decision to record
   for already-installed deps.
2. **Skip DP6 entirely until v2.** Rejected — DP6 is most useful before
   the supply chain grows further, not after.

## References

- DP6, in `zeroauth_prompt_suite/04_development_suite/00_dev_brainstorm/02_dev_principles.md`
- `dep-add` skill at `.claude/skills/dep-add/SKILL.md`
- Audit script: `scripts/check-dep-trail.sh`

---
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
