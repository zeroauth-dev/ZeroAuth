# ADR 0011 — Branching workflow: `dev` + `main` only

- **Status:** Accepted
- **Date:** 2026-05-25
- **Phase:** Phase 0, week 1 (per `docs/plan/bfsi-v1/04-commits.md` C-002)
- **Supersedes / superseded by:** none
- **Related:** `docs/plan/bfsi-v1/06-ways-of-working.md`

## Context

ZeroAuth has shipped most of its code so far via direct commits to `main`. As we move from demo-grade to production-grade we need a real protected-branch workflow that:

- separates work-in-flight from the production deploy line,
- gives CI a clear gate before a change reaches prod,
- keeps the history readable instead of growing per-feature throw-away branches that nobody trims, and
- composes cleanly with the per-agent ticket lists in `docs/plan/bfsi-v1/agents/`, where many agents commit independently in the same week.

The user has explicitly noted in their auto-memory: *"work on `dev`, PR `dev → main`, no `chore/*` or `feat/*` feature branches."* This ADR ratifies that decision and captures the operational rules.

## Decision

We use **two long-lived branches and no feature branches**:

| Branch | Protection | Receives commits from | Deploys to |
|---|---|---|---|
| `main` | Force-push disabled; PR + CI required; linear history required. | Squash-merge from `dev` only, via PR. | Production (`.github/workflows/deploy.yml`). |
| `dev` | Force-push disabled; CI required on push. | Direct push from agents working in their assigned files. | Nothing automatically; staging env on demand. |

- No `chore/*`, `feat/*`, `fix/*`, `release/*`, `hotfix/*`, or per-agent feature branches.
- Hotfixes go straight to `dev` followed by a same-day PR `dev → main`.
- Worktrees (`worktree-agent-*`) are allowed as ephemeral local checkouts but never pushed.
- Tags (`v0.x`, `v1.0.0`, …) are cut from `main` only.

## Consequences

**Positive**

- Single integration target (`dev`) for the whole 50-agent team — no merge-conflict matrix across feature branches.
- `main` is always deployable; rollback is one revert away.
- CI runs on every push to `dev`, so regressions are caught at the integration point, not at PR-open time.
- Onboarding a new agent is one line: "branch off `dev`, push to `dev`, open a PR `dev → main` at the end of the sprint."

**Negative**

- Concurrent commits on `dev` can collide for agents working in the same file. Mitigation: the per-agent ticket lists in `docs/plan/bfsi-v1/agents/` are scoped so two agents rarely touch the same file in the same day; cross-agent file-collision is handled in the daily standup.
- Bisecting a bug to a specific feature requires reading commit subjects rather than feature-branch names. Mitigation: commit subjects are required to be descriptive (≤ 72 chars, imperative) per `docs/plan/bfsi-v1/06-ways-of-working.md`.

## Compliance

CI on `dev` and `main` enforces:

- `tsc --noEmit` passes.
- `eslint .` passes (zero errors).
- `npm test` passes.
- The pre-commit mirror step (per C-001) reproduces the local hook gates.
- No `--no-verify` overrides accepted.

Pre-commit hook (per C-001) blocks every staged change that:

- Contains a `Co-Authored-By: Claude` trailer.
- Contains any of the secret-pattern strings in `docs/plan/bfsi-v1/00-README.md` §10.
- Introduces a new dependency without a matching ADR.

## Notes on the rollout (week 1)

- Day 1 (2026-05-25): this ADR lands. CLAUDE.md cross-references the workflow.
- Day 2 (2026-05-26): `main` branch protection rule updated in GitHub: PR-only, CI-required, linear-history-required.
- Day 5 (2026-05-29): first sprint-end PR from `dev` to `main`.
