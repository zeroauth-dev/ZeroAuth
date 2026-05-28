# Ways of working

The contract every agent (human or AI) signs implicitly when they pick up a ticket from `05-agents.md`. The constraints in `00-README.md` are restated here with operational mechanics.

---

## Branch policy

- **`main`** — protected, deploys to prod via `.github/workflows/deploy.yml`.
- **`dev`** — protected, deploys nothing automatically; integration branch for the whole team.
- All work happens on `dev` (per the user's branch-workflow note in `~/.claude/projects/.../memory/MEMORY.md`).
- PRs go from `dev` → `main` only when:
  - a phase exit gate is met, OR
  - a sprint exit gate is met and accumulated commits have been reviewed.
- **No `chore/*`, `feat/*`, `fix/*` feature branches.** The branching policy is `dev` + `main` only.

---

## Commit-time gates (run automatically by pre-commit hook + CI)

1. `tsc --noEmit` — zero errors.
2. `eslint .` — zero errors (warnings allowed but reviewed).
3. `jest --findRelatedTests <staged>` — green.
4. Secret scan — staged content does not contain any of the patterns enumerated in `00-README.md` standing constraint #10.
5. Forbidden-payload-key scan — Express handler files do not introduce any of `image|template|pixel|depth|frame|raw_face|raw_finger`.
6. ADR-trail scan — new dependencies in `package.json` have a matching ADR; new circuit version (changed `*.zkey`) has a matching ADR.
7. Commit-message gate — subject ≤ 72 chars, imperative mood (rejected if starts with `feat:`, `fix:`, `WIP`, `[brackets]`, or contains an emoji); body contains no `Co-Authored-By: Claude`.

Override (`--no-verify`) is disallowed. CI runs the same gates and rejects the merge if any commit on the branch fails them.

---

## Sub-agent rules

The `security-reviewer` and `cryptographer-reviewer` sub-agents are invoked automatically on PRs that touch sensitive paths. The mapping:

| Touched path | Invokes |
|---|---|
| `src/middleware/tenant-auth.ts` | security-reviewer |
| `src/services/api-keys.ts`, `src/services/tenants.ts` | security-reviewer |
| `src/services/jwt.ts`, `src/services/key-management.ts` | security-reviewer + cryptographer-reviewer |
| `src/routes/v1/zkp.ts`, `src/services/zkp.ts`, `src/services/proof-pairing.ts` | security-reviewer + cryptographer-reviewer |
| `src/services/identity.ts`, `src/services/attestation.ts` | security-reviewer + cryptographer-reviewer |
| `src/services/audit.ts`, `src/services/platform.ts` (audit-write paths) | security-reviewer + cryptographer-reviewer |
| `circuits/**` | cryptographer-reviewer |
| `contracts/**` | cryptographer-reviewer + security-reviewer |
| any new hash construction (introduced by ADR) | cryptographer-reviewer |

The PR is not mergeable until the relevant sub-agent posts an explicit `APPROVE` row in the PR thread. `REQUEST_CHANGES` blocks the merge.

---

## Plan mode

**Mandatory** for any change touching ≥ 5 files OR any of:

- `src/services/zkp.ts`
- `src/services/identity.ts`
- `src/services/api-keys.ts`
- `src/services/audit.ts`
- `src/middleware/tenant-auth.ts`
- `src/routes/v1/zkp.ts`, `src/routes/v1/identity.ts`
- `circuits/**`
- `contracts/**`
- `mobile/prover/**`
- `mobile/keystore/**`

Skipping plan mode → PR is reverted, agent is reminded.

---

## Definition of Ready (per ticket)

A ticket is **ready** to be picked up when:

- Commit ID + subject documented in `04-commits.md`.
- Files-to-touch listed.
- Test-to-pass listed.
- Owning agent role number assigned.
- Dependencies on prior commits resolved (or explicitly known and tracked).
- ADRs needed (if any) referenced.

A ticket that is not Ready is escalated to the line VP within 24 h.

---

## Definition of Done (per commit)

- Commit subject ≤ 72 chars, imperative, no prefix, no emoji.
- Commit body explains the why; references audit-finding / pain-point ID where applicable.
- Pre-commit hook green.
- CI green on the branch the commit lives on.
- Test that was added passes; tests that existed before still pass.
- Sub-agent review (where applicable) posted `APPROVE`.
- ADR (if any) landed.
- Documentation (`docs/threat_model.md`, `docs/api_contract.md`, `docs/error_codes.md`) updated where applicable.

---

## Definition of Done (per sprint)

- All anchor commits in the sprint are merged into `dev`.
- All Friday status updates posted; blockers resolved or escalated.
- Sprint retrospective held; lessons captured in `docs/team/retros/<sprint-N>.md`.
- Phase exit gate (if applicable) confirmed green.

---

## Definition of Done (per release)

- All sprint exit gates within the release green.
- Security-reviewer + cryptographer-reviewer signed off on the release artefact.
- Threat model current with release scope.
- Audit-findings doc shows all in-scope findings closed.
- Deploy pipeline green on `main`.
- Release notes published.
- Rollback plan tested in staging within the past 7 days.

---

## Daily cadence

| Time IST | Event | Attendees | Output |
|---|---|---|---|
| 09:30 | Engineering standup (15 min) | All engineering agents | Blockers, plan for the day |
| 10:00 | Sub-agent review queue check | Role 26, 27 | PR-review backlog cleared |
| 14:00 | Mobile sync (Mon, Wed, Fri only, 20 min) | Roles 4, 17, 18, 19 | Device-fleet state, prover progress |
| 16:00 | Backend + crypto sync (Tue, Thu only, 20 min) | Roles 2, 6, 7, 8, 11, 12, 13 | Audit-chain progress, prover spec |
| 18:00 (Fri) | Weekly status posts | All 50 agents | 4-line status to channel |

---

## Weekly cadence

| Day | Event |
|---|---|
| Mon AM | Sprint planning (sprint start) or progress review (mid-sprint) — Role 1 + VPs |
| Wed PM | Cross-line architecture sync — Role 1 + VPs |
| Fri PM | Friday status posts; line VPs read all 50 |
| Fri PM (end of sprint) | Sprint retrospective + next-sprint dispatch |

---

## Monthly cadence

| Date | Event | Output |
|---|---|---|
| 1st of month | Phase progress review with Role 1 + Role 28 + Role 36 + Role 42 | Phase exit-gate status |
| 15th of month | Risk register review with Role 40 | Updated risk register |
| Last Friday | Cost / spend review with Role 50 | Budget vs. actual |

---

## Escalation

| Issue | Escalate to | Within |
|---|---|---|
| Engineering technical blocker | Line VP (Roles 2, 3, 4, 5) | Same day |
| Security / crypto open question | Roles 26, 27 | Same day |
| Compliance / regulator question | Role 36 | Same day |
| Customer escalation | Role 42 → Role 46 | 4 h |
| Severity-1 production incident | Roles 5, 21, 26 → Role 1 | Pageable, 15 min |
| Sub-agent `REQUEST_CHANGES` not addressed | Role 1 | 24 h |
| Phase exit gate at risk | Role 1 + line VPs | 1 week before gate |

---

## Documentation hygiene

Every PR is responsible for keeping these documents current:

- `docs/api_contract.md` — new endpoint, changed endpoint, deprecated endpoint.
- `docs/error_codes.md` — new error code.
- `docs/threat_model.md` — new attack vector mitigated, new attack vector identified.
- `docs/security/audit-findings.md` — finding closed (with the closing commit hash).
- `adr/<n>.md` — new ADR (numbered sequentially).
- `docs/plan/bfsi-v1/04-commits.md` — commit listed in the table (yes, this doc).
- `docs/plan/bfsi-v1/05-agents.md` — agent's ticket marked complete in their week.

CI lints `04-commits.md` and `05-agents.md` for commit IDs that don't match any merged commit, and for commits in `git log` that don't appear in the plan.

---

## When the plan is wrong

The plan in this directory is a working hypothesis. It is wrong in details, and probably wrong in shape too. The expected escalation:

1. Agent notices the plan does not match reality.
2. Agent posts a `plan-change-proposal` in the team channel with three lines: what is wrong, what should it be, what is the impact.
3. The owning role (per `03-team.md`) responds within 24 h.
4. If the change passes review, a PR updates the relevant document and the new plan is in effect from merge time.
5. The ADR trail captures the rationale if the change is material.

Do not silently work to a different plan. Update the plan, then work to the updated plan.

---

LAST_UPDATED: 2026-05-27
