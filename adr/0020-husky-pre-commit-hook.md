# ADR 0020 — husky for the pre-commit hook

- **Status:** Accepted
- **Date:** 2026-05-28
- **Phase:** Phase 0, sprint 2 (closes audit finding C-15)
- **Related:** ADR 0011 (branching workflow), `docs/plan/bfsi-v1/06-ways-of-working.md` § "Commit-time gates"

## Context

Phase 0 audit finding C-15 flagged that **new dependencies can land without an ADR** — the pre-commit hook described in `docs/plan/bfsi-v1/06-ways-of-working.md` § "Pre-commit hook (mandatory, week 1 deliverable)" is documented but not actually wired. Today nothing prevents a contributor from committing a change that adds a dep to `package.json` without writing an ADR, or from committing a file containing a `Co-Authored-By: Claude` trailer, or from committing staged content with a leaked `BEGIN PRIVATE KEY` block.

The plan's deliverable is a `.husky/pre-commit` script that mirrors the CI's gate. We have the CI gate (per `.github/workflows/ci.yml`) but the local pre-commit gate is missing.

## Decision

Adopt **husky** as the pre-commit hook manager.

### Why husky

| Candidate | Selected? | Reason |
|---|---|---|
| **husky** | ✅ | De-facto standard. Single-line install. Hooks live in `.husky/` and ship with the repo. ESM-compatible. Maintained by typicode (high-trust author). |
| pre-commit (Python) | ❌ | Adds a Python toolchain to the repo for a JS-first project. Slower install on fresh clones. |
| simple-git-hooks | ❌ | Smaller (no extra runtime) but its hook-config-in-package.json model conflicts with our preference for hook scripts as standalone files. |
| Hand-rolled `npm run prepare` | ❌ | The script that installs the hook is also the thing that needs the hook — chicken-and-egg on fresh clones. |
| No tool, manual setup | ❌ | Audit finding C-15 already proves this fails — the hook described in `06-ways-of-working.md` never got wired. |

### Version pin

- `husky` `^9.1.7` (current latest). Pinned to major 9 because v8 → v9 dropped the `husky install` command; locking the major prevents silent breakage on `npm ci`.
- Adds `"prepare": "husky"` to `package.json` `scripts`.
- Single dev-dependency, zero transitive deps (husky 9 has none).

### Supply-chain check

- npm audit on `husky@9.1.7`: clean (0 vulnerabilities as of 2026-05-28).
- Author: `typicode` — widely-used. Same maintainer as `nodemon`, `json-server`, `lowdb`.
- Repo: <https://github.com/typicode/husky> — 32k+ stars, active.

### Pre-commit hook content

`.husky/pre-commit` runs the seven gates from `docs/plan/bfsi-v1/06-ways-of-working.md`:

1. `npx tsc --noEmit` — zero errors
2. `npm run lint -- --max-warnings 0` — zero ESLint errors (warnings allowed; this gate just prevents new errors)
3. Secret scan (the patterns from the standing constraints in `00-README.md` §10)
4. Forbidden-payload-key scan (the biometric keys)
5. ADR-trail scan for new deps
6. Commit-msg gate (no `Co-Authored-By: Claude`, no `feat:` prefix, etc.)
7. Test-affected-by-staged subset of `npm test`

The hook reads from a shared library `scripts/pre-commit-checks.sh` so the same logic can be invoked by CI (under `.github/workflows/ci.yml`) — single source of truth.

### What this does NOT do

- It does NOT replace CI. CI runs the same gates so an attacker who runs `git commit --no-verify` still gets caught at PR-open time.
- It does NOT block on warning-level lint output — warnings exist for a reason (gradual refactor signal). Only errors block.
- It does NOT run the full test suite on every commit — that's CI's job. The pre-commit runs `jest --findRelatedTests <staged>` which is typically a small subset.

## Consequences

**Positive**
- Closes audit finding C-15.
- Stops `Co-Authored-By: Claude` trailers at the wire (a constraint the user has been explicit about).
- Stops accidental secret leaks at commit-time (an attack class the audit ranked P2).
- Catches new-dep-without-ADR at the developer's machine, not at PR-review time.
- Faster developer feedback loop — typecheck errors surface in 2 s rather than after a CI cycle.

**Negative**
- One more `npm install` step on fresh clones to wire the hook (handled automatically by the `prepare` script).
- A developer who runs `git commit --no-verify` skips the check locally. Mitigation: the CI mirror catches it.
- Hook adds ~3-8 s to every commit (depending on staged files). Acceptable trade-off vs the alternative (broken commits landing on `dev`).

## Rollout

This commit lands husky + the hook scripts. Contributors with existing local checkouts get the hook the next time they run `npm install`. CI's `pre-commit-mirror` step continues to be the backstop.

LAST_UPDATED: 2026-05-28
OWNER: Agent #22 (Mid DevOps — CI/CD + observability)
