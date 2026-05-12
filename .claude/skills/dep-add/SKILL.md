---
name: dep-add
description: Add a new dependency to a ZeroAuth repo via the DP6 process (every dependency is an ADR). Use whenever a new npm, cargo, gradle, swift package, pip, or other dependency is being added. Walks the engineer through the ADR-first decision, runs supply-chain checks, updates lockfiles, and verifies the audit trail.
allowed-tools: Read, Write, Bash, Glob, Grep
---

# dep-add

You are adding a new dependency to a ZeroAuth repo. Per DP6 (every dependency is an ADR), the process is ADR-first, not install-first.

## When to invoke

- A new npm/cargo/gradle/swiftpm/pip dependency is needed
- An existing dependency's major version is being bumped
- A dependency is being replaced with a different package serving the same role

Do NOT invoke for:
- Patch/minor version bumps within the same major (those go through `dep-update` — not this skill)
- Adding a dev-only dependency that doesn't end up in the production bundle (those are advisory-only, no ADR required, but the CI check still runs)

## Process

### Step 1 — Identify the need

Ask (or read from the engineer's brief):
- What capability are we adding?
- What's the minimum surface of that capability we actually need?
- Is there an existing dependency in this repo that already covers it?

If an existing dependency covers it: stop. Use the existing.

If we genuinely need a new one: continue.

### Step 2 — Survey alternatives

Identify at least 3 candidates for the same capability (where 3 exist). For each:
- Name and version
- License (MIT, Apache 2.0, BSD, etc.)
- Maintainer / org / stars / last release / open issues
- Size (transitive dependency count, bundle size impact if frontend)
- Known CVEs (check the relevant advisory database)
- Whether it's already in the dep tree via a transitive

### Step 3 — Choose with explicit reasoning

Pick one. The ADR will record why this one over the others.

### Step 4 — Run supply-chain checks

```bash
# npm
npm audit
npx better-npm-audit audit
npx license-checker --summary

# cargo
cargo audit
cargo deny check

# gradle (Android)
./gradlew dependencyCheckAnalyze

# pip
pip-audit

# swift
swift package show-dependencies
```

Capture the output. If any critical or high finding exists, abort: the chosen dependency is rejected on supply-chain grounds.

### Step 5 — Write the ADR

Use the `adr-writer` skill with this template-fill:

- **Title**: "Adopt [dependency name] for [capability]"
- **Context**: what capability, why now
- **Decision**: name the dependency, version, license
- **Consequences**:
  - Positive: capability gained
  - Negative: dep tree growth, supply chain surface, license obligations, future-version risk
  - Neutral: replaces X / coexists with Y
- **Alternatives**: the at-least-2 from Step 2
- **Migration**: if replacing a previous dep, the swap plan
- **References**: package URL, license URL, security advisory database entry

### Step 6 — Install + commit

```bash
# Install pinning to the chosen version
npm install <name>@<exact-version>     # npm
cargo add <name>@<exact-version>       # cargo
# (similar for other ecosystems)

# Commit the lockfile + the ADR together
git add package-lock.json adr/ADR-NNNN-*.md
git commit -m "deps: adopt <name> per ADR-NNNN"
```

### Step 7 — Run CI

The CI pipeline (B07) has a `check-dep-trail` step that verifies: every dep in the lockfile has either an ADR in `/adr/` or is marked dev-only in `package.json` / `Cargo.toml`. If the check fails, the ADR was missed — go back to Step 5.

### Step 8 — Notify

- Update `/adr-index/ALL.md` in the governance repo via cross-repo PR
- If the dep changes the threat surface (network calls, file system access, native code), trigger `threat-model-update` skill

## Output

After the dep is added, print:

```
✓ Dependency added: <name> @ <version>
✓ ADR written: /adr/ADR-NNNN-adopt-<name>.md
✓ Lockfile updated: <path>
✓ Supply chain audit: [N findings — none critical | N findings — see report]
✓ CI dep-trail check: PASS

Next steps:
- Run security-reviewer if this dep is used in verifier/audit/tenant path
- Trigger threat-model-update if dep adds new threat surface
- Cross-repo: update governance /adr-index/ALL.md
```

## Rules

- A dep with a Critical CVE is never added — period
- A dep with a license incompatible with our intended use (commercial-only, GPL where we need permissive, etc.) requires explicit counsel review before the ADR
- A dep with no clear maintainer or last-release-over-2-years-old requires an ADR consequence entry naming this risk
- Dev-only deps still get logged in `/docs/dev-deps.md` for hygiene; they don't need an ADR but they don't ship to customers
