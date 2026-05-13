# ADR-0004 — Split governance docs into a separate repo (`pulkitpareek18/ZeroAuth-Governance`)

## Status

Accepted

## Context

The dev suite's B06 build prompt (`04_development_suite/02_claude_code_dev/build_prompts/B06_governance_repo_bootstrap.md`) calls for a separate `zeroauth-governance` repo — "the first repo to bootstrap; everything else links to this." It would hold:

- A shared security policy that every product repo's `CLAUDE.md` links to
- The canonical cross-repo threat model
- DPDP / IRDAI / RBI / MeitY compliance mappings
- An ADR index across all repos
- A release coordination matrix
- Evidence-pack source checksums

Through Day 2 of Week 1 we operated with governance content embedded inside this API repo: `CLAUDE.md` (constitution), `docs/threat_model.md`, `docs/api_contract.md`, `docs/error_codes.md`, and three ADRs in `adr/`. That covered most of B01's quality bar but explicitly skipped B06.

On Day 3, we re-examined the decision and decided to execute B06 properly.

The reasons we revisited:

1. **The DPDP §8(7) breach-notification procedure was unwritten.** No document anywhere named which lawyer gets called, in what time window, with what information. That's a legal-teeth gap, not a hygiene gap. It has to land somewhere; writing it in a code repo would mix legal blast radius with engineering blast radius.
2. **Compliance mappings have multiple-regulator scope.** A DPDP / IRDAI / RBI / MeitY mapping is read by auditors and a buyer's security team. Forcing them to clone a TypeScript repo to find it is friction at exactly the wrong moment in a pilot conversation.
3. **The canonical threat model needs a stable URL** before repo #2 (verifier, B02, Week 2) exists. If the verifier's component threat model points at `pulkitpareek18/ZeroAuth/docs/threat_model.md`, the link rots the moment we split the verifier; if it points at a governance repo, the URL is stable forever.
4. **Two-reviewer enforcement is easier with a dedicated repo.** Path-globbed CODEOWNERS in a code repo gets bypassed under deadline pressure ("just merge the policy change inline, fix it later"). A standalone repo where every PR is *by definition* a policy change makes the discipline mechanical.

## Decision

Create `pulkitpareek18/ZeroAuth-Governance` as a separate public GitHub repo with the structure from `governance_CLAUDE.md`:

- `docs/shared/{security-policy, coding-standards, naming-conventions, incident-response, breach-notification}.md`
- `docs/threat-model/{canonical, api, verifier, iot, sdk, dashboard}.md`
- `docs/compliance/{dpdp, irdai, rbi, meity}-mapping.md` + `audit-format.md`
- `adr-index/ALL.md`
- `release-coordination/matrix.md` + `changelogs/`
- `evidence-pack-sources/{CHECKSUMS, RELEASES}.md`
- `CODEOWNERS` (two-reviewer rule on `/docs/shared/` and `/docs/compliance/`)
- `.github/workflows/lint.yml` (markdownlint + link-check on every PR)

The repo is **public**, CC-BY-4.0 licensed — same posture as the main `ZeroAuth` repo. The audit story benefits from open visibility.

This repo (`pulkitpareek18/ZeroAuth`) keeps:

- `CLAUDE.md` — the constitution for this repo, links to the canonical shared docs
- `docs/api_contract.md` — API-specific contract (won't move)
- `docs/error_codes.md` — API-specific (won't move)
- `docs/threat_model.md` — **deprecated** in favor of `docs/threat-model/canonical.md` in the governance repo. We keep the file for now with a header pointing at the canonical, until Week 2 when we remove it entirely.
- `adr/` — local ADRs. The governance repo's `adr-index/ALL.md` is the cross-repo index pointing here.

## Consequences

- **Positive — DPDP §8(7) procedure now exists.** Written down, with named counsel contacts (TODO entries where contacts aren't confirmed yet). Drillable. Reviewable.
- **Positive — auditor-friendly surface.** A buyer's security team can clone one repo and read every policy without slogging through TypeScript. The W08 evidence-pack assembler from the operational suite reads from `evidence-pack-sources/CHECKSUMS.md` cleanly.
- **Positive — stable URLs across the 8-week build.** When B02 (verifier, Week 2), B03 (IoT, Week 3), B04 (SDK, Week 5) split out, they all link to `github.com/pulkitpareek18/ZeroAuth-Governance/blob/main/docs/threat-model/canonical.md` — that URL doesn't move.
- **Positive — two-reviewer rule is mechanical.** CODEOWNERS in the governance repo names both Pulkit and Amit on `/docs/shared/` and `/docs/compliance/`. Counsel review is enforced manually (counsel doesn't have GitHub access) by a note in the PR description before merge.
- **Negative — two repos to clone on a fresh dev machine.** Mitigated: `scripts/setup-dev.sh` (TODO) will clone both side by side.
- **Negative — cross-repo links rot more easily than same-repo links.** Mitigated by `markdown-link-check` CI on every PR in both repos.
- **Negative — context switch when authoring a policy change that's tied to a code change.** Engineer has to open two PRs and link them. Acceptable cost — the discipline is the point.
- **Neutral — `docs/threat_model.md` in this repo is in deprecation limbo.** It's still the most current text today; the governance repo's `canonical.md` was synced from it on 2026-05-13. By the end of Week 2, the canonical is authoritative and the file in this repo becomes a 1-line pointer.

## Alternatives considered

- **Option A — Stay collapsed.** Keep one repo, enforce two-reviewer via CODEOWNERS on path globs. **Rejected** because: (1) the DPDP §8(7) procedure deserves its own surface; (2) the audit story is materially weaker; (3) cross-repo link stability becomes a problem the moment B02 ships.
- **Option C — Split only the regulator-facing pieces** (breach-notification + compliance) and keep security-policy / coding-standards / threat-model inline. **Rejected** because: a buyer's security team expects everything in one place. Splitting the policy surface in two creates confusion about which one is authoritative.
- **Option D — Submodule the governance dir into product repos.** **Rejected** universally and on first principles — submodules are hated for good reason.
- **Option E — Stay collapsed forever, accept the discipline gap.** **Rejected** — DPDP §8(7) is a regulatory requirement, not a discipline gap.

## Cost of the change

- One-time setup: ~3 hours (this session — Wed May 13 2026)
- Per-policy-PR friction: estimated ~5 minutes extra (clone the governance repo, work there, link the PR back to the code PR if relevant)
- CI cost: trivial (markdownlint + link-check, no Node compile / Jest)

## Exit ramps (when to consolidate back, if ever)

The governance repo doesn't get folded back into the API repo. The split is monotonic — once separated, stays separated. If something ever justifies re-collapsing, that's a new ADR superseding this one.

## References

- B06 build prompt: `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/build_prompts/B06_governance_repo_bootstrap.md`
- Governance constitution: `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/CLAUDE_md/governance_CLAUDE.md`
- New repo: <https://github.com/pulkitpareek18/ZeroAuth-Governance>
- Canonical threat model (new home): <https://github.com/pulkitpareek18/ZeroAuth-Governance/blob/main/docs/threat-model/canonical.md>
- Brainstorm session on Day 3 (Wed May 13 2026) weighing collapsed vs separate repo: this conversation

---

LAST_UPDATED: 2026-05-13
OWNER: Pulkit Pareek
