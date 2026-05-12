# Architecture Decision Records

Each non-trivial change to ZeroAuth that introduces a dependency, a protocol, a cryptographic primitive, a tenant-isolation strategy, or a data-storage choice ships with an ADR here. This is **DP6** from the development principles (every dependency is an ADR) plus **DP1** (spec before code).

The CI `scripts/check-dep-trail.sh` enforces that every direct dependency in `package.json`, `dashboard/package.json`, and `website/package.json` is either (a) named in [`0000-grandfather-initial-deps.md`](0000-grandfather-initial-deps.md) or (b) covered by its own `NNNN-adopt-<name>.md` file in this folder.

## File naming

```
NNNN-<short-slug>.md
```

`NNNN` is a four-digit zero-padded sequence number, monotonically increasing. `<short-slug>` is kebab-case and starts with a verb (`adopt-`, `drop-`, `switch-`, `pin-`, `migrate-`).

## Template

```markdown
# ADR-NNNN — <title>

## Status
Accepted | Superseded by ADR-XXXX | Deprecated

## Context
What is the situation that forced a decision? Reference the issue, PR, or
spec session that drove it.

## Decision
What we chose. State it as a sentence, then expand.

## Consequences
- **Positive:** capability gained, problem solved.
- **Negative:** dep tree growth, supply chain surface, license obligations,
  future-version risk, lock-in.
- **Neutral:** replaces X, coexists with Y.

## Alternatives considered
At least two, with the reason each was rejected. Skip only when the answer
is "stay with the standard library / no third-party dep".

## References
- Package URL, license, security advisory, related PR or commit, related ADR.

---
LAST_UPDATED: YYYY-MM-DD
OWNER: <name>
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0000](0000-grandfather-initial-deps.md) | Grandfather initial dependencies | Accepted |
| [0001](0001-adopt-express-rate-limit-as-direct-dep.md) | Adopt `express-rate-limit` as a direct dependency for signup/login throttling | Accepted |

Add new rows in chronological order.
