# ADR-0006 — Verifier service: TypeScript workspace, not Rust separate repo

## Status

Accepted

## Context

B02 in the dev brainstorm (`zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/build_prompts/B02_verifier_service_bootstrap.md`) calls for:

> A separate `zeroauth-verifier` repo. Rust + `arkworks-groth16` + `axum`. Append-only SQLite audit log with hash chain. Reproducible Docker build with `--provenance=true --sbom=true`. `cargo clippy -- -D warnings` clean. No `unsafe` without an ADR.

Yesterday's plan-mode design doc ([`docs/design/verifier-service-split.md`](../docs/design/verifier-service-split.md)) surfaced three options:

- **Plan A** — Rust separate repo per B02. 2.5–3.5 days of work. Most-defensible audit story.
- **Plan B** — TypeScript workspace inside the same repo, share the root `package-lock.json`. 1–1.5 days. Most pragmatic for a single engineer.
- **Plan C** — Defer B02 to Week 2 Day 1; spend Friday on the W05 review instead. No verifier today.

The plan-mode doc's §3.3 recommended **Plan A**. Pulkit picked **Plan B** on Thursday afternoon ("we'll be using typescript only no rust. start working"). This ADR formally records that decision + the rationale + what it costs us.

## Decision

The Groth16 verifier ships as **`@zeroauth/verifier`, an npm workspace inside `pulkitpareek18/ZeroAuth`**, written in TypeScript on top of `snarkjs`. It runs as a separate Docker container (`zeroauth-verifier`) bound to `127.0.0.1:3001` on the Docker network. The API container reaches it via HTTP — never inline anymore.

Shipped in three PRs today:

- [PR #35](https://github.com/pulkitpareek18/ZeroAuth/pull/35) — Dockerfile `verifier-build` + `verifier-production` stages, compose service, `VERIFIER_URL` wired into the API's environment.
- [PR #36](https://github.com/pulkitpareek18/ZeroAuth/pull/36) — Healthcheck hotfix (`localhost` → `127.0.0.1` because alpine busybox `wget` hits IPv6 first).
- [PR #37](https://github.com/pulkitpareek18/ZeroAuth/pull/37) — SQLite append-only audit log + hash chain (the design doc §4.3 component).

The inline-`snarkjs` fallback in `src/services/zkp.ts` **stays in the codebase for two more weeks** as a safety net while the verifier service soaks in production. It activates only when `VERIFIER_URL` is unset (which never happens in prod — the value is hard-set in `docker-compose.yml`'s `environment:` block). Retirement is scheduled for end of Week 4 of the build cycle (~2026-06-08), as a separate PR.

## Why Plan B over Plan A

Single-engineer velocity. The Rust path was the brainstorm's recommendation when reasoning from "1 engineer, 8 weeks, audit-class verifier required by Week 8 SOW." Three observations from the actual week of work that justify the override:

1. **The verifier is no longer the cryptographic core in practice.** Pramaan's patent is in the protocol design (commitment scheme, LSH dedup, DID derivation) — not in the verifier's choice of language. Whether the Groth16 check is `snarkjs.groth16.verify` or `arkworks::Groth16::verify` is, at the math level, identical. Choosing Rust buys defense-in-depth on memory safety + smaller attack surface; it does **not** buy a different cryptographic claim.
2. **The buyer's threat model probably doesn't care.** Pilot buyers (HDFC Life, Star Health, CoinDCX, ICICI per the brainstorm's customer list) will ask "what's the trust boundary around the verifier" and "is the audit log tamper-evident." A separate npm workspace + a non-root Docker container + a SQLite hash chain answers both. Rust would answer them *better*, but the difference between "very good" and "best" doesn't move a pilot SOW.
3. **The four-week sprint to first PoC** (Week 4–Week 8) is the binding constraint. Spending 2.5–3.5 days on a Rust rewrite this week leaves no slack for the IoT firmware (B03 Week 3), mobile SDK (B04 Week 5), or demo wrappers (B15–B18 Week 4–6). Plan B finished in 1 day. The other 2.5 days are now available for the work that buyers can actually see.

## Consequences

### Positive

- **Single repo, single lockfile.** No second `gh repo create`, no submodule, no cross-repo PR for any change that touches both surfaces. The same engineer who edits `src/services/zkp.ts` (the API-side HTTP client) can edit `verifier/src/groth16.ts` (the service-side verifier) in the same PR.
- **Shared dep tree.** The verifier's snarkjs is exactly the same version as the API's snarkjs was. Zero risk of "Groth16-bug-fixed-in-prover-but-not-verifier" drift.
- **Same TS skills.** No Rust learning curve. Tests use the same Jest + supertest stack as the rest of the repo.
- **HTTP shape is Rust-compatible.** The wire types in `verifier/src/types.ts` are intentionally minimal + JSON-serializable so a future swap to a Rust binary is a substitution, not a rewrite of the API-side client.

### Negative

- **No reproducible build provenance** for the verifier image. Docker `buildx --provenance --sbom` would produce signed attestations, but the `better-sqlite3` native build (alpine arm64-musl has no prebuilt → node-gyp compile via apk-added python+make+g++) is non-deterministic. The audit story is therefore "trust the image" not "verify the image's bytes." Acceptable for v0; this is the single biggest delta vs Plan A.
- **Larger transitive surface.** snarkjs has ~12 transitive deps vs arkworks' ~6. Each is JS, MIT-licensed, audited; but the larger surface is real.
- **`cryptographer-reviewer` subagent calibration** assumes Rust + arkworks per its current spec. The subagent works against snarkjs too (it's just JS) but the review is less precise — Rust's type system catches a class of memory-safety bugs the reviewer can stop looking for. With snarkjs, the reviewer has to reason about JS-level invariants. Documented in the subagent's known-limitations section (TBD).
- **No `--unsafe` audit story.** TypeScript has no equivalent of Rust's `unsafe` block, so the "no unsafe without an ADR" rule in B02's quality bar doesn't transfer. The closest analog is "no `any` in exported signatures + no `dangerouslySetInnerHTML` in user-rendering code" which is already in our [`coding-standards.md`](https://github.com/pulkitpareek18/ZeroAuth-Governance/blob/main/docs/shared/coding-standards.md).
- **Container image size is bigger.** Alpine + node + snarkjs + better-sqlite3 → ~140MB. A static Rust binary would be ~20MB. We're not bandwidth-constrained at single-VPS scale; revisit if/when we go multi-region.

### Neutral

- The plan-mode design doc stays valid as a reference. §4 (Plan A detail) is no longer the path we took, but is preserved for the future swap-to-Rust discussion if it ever comes up.
- B02 in the prompt suite stays as-written (it's still the "right" answer for a different team shape).

## Alternatives considered

- **Plan A — Rust separate repo per B02 spec.** 2.5–3.5 days. Best audit story (reproducible builds, smaller attack surface, `unsafe` discipline). Rejected because the marginal gain over Plan B doesn't justify the time cost in a 4-week pilot-readiness window with one engineer.
- **Plan C — Defer B02 entirely to Week 2.** Would have been correct if today's headline goal was "ship the W05 review packet cleanly." Rejected once Pulkit explicitly chose to "build, not paper."
- **Hybrid — TS now, Rust rewrite in Week 6.** Considered. Rejected because nothing is broken about the TS verifier; the rewrite cost would buy "feels more audit-defensible" not "actually safer." Revisit only if a pilot buyer's security team explicitly asks for the Rust binary, or if perf becomes an issue at scale (current p99 verify latency under load is unknown — B19 load test will tell us).

## Inline-fallback retirement plan

The `inline` code path in `src/services/zkp.ts` is the safety net while the verifier service soaks. **Retirement timeline:**

- 2026-05-15 (today) — Verifier in prod, `VERIFIER_URL` hard-set in compose, inline path unused but compiled-in.
- 2026-05-16 → 2026-06-06 (3 weeks of prod traffic) — Watch for any "ZKP: verifier service unreachable" or non-2xx log lines. If zero failures, proceed.
- 2026-06-08 (start of Week 5) — Single PR removes the inline path entirely:
  - Delete `verifyInline()` + `isValidProofStructure()` from `src/services/zkp.ts`
  - Delete `snarkjs` from root `package.json` dependencies (it stays in `verifier/package.json`)
  - Delete the inline-fallback test paths in `tests/zkp.test.ts`
  - Update `src/services/zkp.ts` to always require `VERIFIER_URL` and refuse to start without it (loud failure)
- 2026-06-09 deploy — Production runs verifier-only.

If during the soak window any verifier failure mode surfaces that we can't fix forward, the inline-fallback gets reactivated (set `VERIFIER_URL=` empty on the VPS) while we investigate. Total recovery time: ~60 seconds with the env runbook procedure.

## References

- Plan-mode design doc: [`docs/design/verifier-service-split.md`](../docs/design/verifier-service-split.md)
- B02 build prompt (rejected path): `zeroauth_prompt_suite/04_development_suite/02_claude_code_dev/build_prompts/B02_verifier_service_bootstrap.md`
- Issue tracking: [#35](https://github.com/pulkitpareek18/ZeroAuth/pull/35), [#36](https://github.com/pulkitpareek18/ZeroAuth/pull/36), [#37](https://github.com/pulkitpareek18/ZeroAuth/pull/37)
- Component threat model (to be promoted from stub in the governance repo): `pulkitpareek18/ZeroAuth-Governance: docs/threat-model/verifier.md`

---

LAST_UPDATED: 2026-05-15
OWNER: Pulkit Pareek
