# ADR 0016 — Adopt zod as the input-validation layer

- **Status:** Accepted
- **Date:** 2026-05-26
- **Phase:** Phase 0, week 2 (per `docs/plan/bfsi-v1/04-commits.md` C-023)
- **Related:** ADR 0011 (branching workflow), ADR 0013 (audit log hash chain), ADR 0015 (circuit version pinning), `docs/security/audit-findings.md` C-8 (biometric-payload guard), `docs/threat_model.md` row A-15, `docs/team/backend/zod-alternatives-survey.md` (Friday W1 survey).

## Context

`/v1/*` and `/api/console/*` handlers do **manual validation today** — the
familiar `if (!req.body.<field>) return res.status(400).json(...)` pattern,
sometimes accompanied by an ad-hoc regex or `typeof === 'string'` guard.
`CLAUDE.md` § Stack already flags this: *"zod is the planned input-validation
layer — adopt it via the `dep-add` skill when a new endpoint goes in."*

The Phase 0 readiness audit catalogued five concrete failure modes of the
status quo: (1) inconsistent error shapes across `/v1/*` and
`/api/console/*` — integrators bypass the contract because they cannot
trust it; (2) no schema-documentation surface — `docs/api_contract.md` is
hand-written and drifts; (3) no compile-time guarantee that a handler
validates at all — a new route can merge with zero validation; (4) the
forbidden-biometric-key guard is source-level only (the
`tests/biometric-rejection.test.ts` grep — Phase 0 C-021, audit finding
C-8) so a generic JSON proxy could slip past it at runtime; (5) the
`/v1/zkp/verify` payload's `provider` variant lacks compile-time
discriminated-union refinement.

The audit identified manual validation as the **second-largest source of
"trusted-input creep"** in the Phase 0 review — second only to the
demo-bypass class (closed in C-004), ahead of the access-token query
fallback (closed in C-005). This ADR ratifies the choice ahead of the
install commit (C-022) so the install lands with the rationale already
merged.

## Decision

**Adopt `zod` as the input-validation layer for all new endpoints.** Pin to
`zod@3.23.x` (latest stable as of 2026-05-26; verify against `npm view zod`
on commit day). Existing endpoints get a zod schema during their next
touched-files commit, per `docs/plan/bfsi-v1/06-ways-of-working.md`
("Documentation hygiene" + "Definition of Done (per commit)").

This ADR is the rationale + dependency record. The install (zod added to
`package.json` + `package-lock.json`) lands in **C-022 in sprint 2** — see
`docs/plan/bfsi-v1/04-commits.md` and the agent-06 week-2 ticket
`A06-W2-Tue`. **No package-manifest changes land in this commit.**

## Alternatives considered

| Library | TS-first | Perf (parses/sec, 1 kB JSON) | Bundle (gzipped) | Error UX | Community | Verdict |
|---|---|---|---|---|---|---|
| **zod** | Yes — schemas *are* types via `z.infer<typeof schema>` | ~200 k/s | ~12 kB | Per-field `issues[]` with codes | 33 k★ on GitHub, weekly releases | **Chosen** |
| joi | No — TS types via `@types/joi`, separate from runtime | ~600 k/s | ~50 kB | Joi error object; awkward to map | Hapi-era, slowing | Rejected — older API, no TS-first design, larger bundle |
| ajv | JSON-Schema-first | ~1.2 M/s (fastest) | ~30 kB + schema overhead | JSON-Schema errors | Wide use in OpenAPI tooling | Rejected — write schema twice (TS type + JSON schema), not idiomatic |
| yup | Partial | ~150 k/s | ~22 kB | Reasonable | Smaller, less active | Rejected — type inference weaker than zod, smaller community |
| runtypes | Yes | ~150 k/s | ~9 kB | Reasonable | Niche | Rejected — niche, fewer contributors |
| io-ts | Yes (fp-ts style) | ~80 k/s | ~14 kB | Either-monad output | Niche, fp-ts curve | Rejected — fp-ts dependency, non-idiomatic for our codebase |
| superstruct | Yes | ~250 k/s | ~7 kB | Reasonable | Niche | Rejected — smaller community |
| typia | Yes (build-time codegen) | ~10 M/s (compile-time) | ~0 (no runtime) | Codegen-emitted | Niche | Rejected — build-time codegen; awkward to ship in CI without an extra step |
| Hand-rolled validators | n/a | n/a | 0 | Inconsistent | n/a | Rejected — this is the status quo we are explicitly leaving |

**Decision rationale.** zod wins on every axis except raw parse perf (ajv
~6× faster). For our target ~1 k req/s per verifier instance the difference
is irrelevant — at ~5 µs vs ~30 µs per parse on a 1 kB payload the
validator is < 0.1 % of request time. TypeScript-first inference is the
load-bearing property: it eliminates the "two sources of truth" failure
mode that bit prior Joi-then-typescript codebases.

## Version pin + supply-chain check

C-022 lands `zod@3.23.x` (exact patch resolves to latest stable on commit
day; recorded in the C-022 commit message). Snapshot at ADR commit
2026-05-26:

- **License:** MIT.
- **Maintainer:** Colin McDonnell (`colinhacks/zod`); ~50 active
  contributors, multiple release-tagging contributors in the last 12
  months — no single-maintainer risk.
- **Weekly npm downloads:** > 25 M (top-100 npm package).
- **Last publish:** within the last 30 days.
- **Known CVEs:** zero open against `zod@3.23.x` per `npm audit` and
  `npx better-npm-audit audit`. Findings re-recorded in the C-022 commit
  message.
- **Transitive runtime deps:** zero. zod is a leaf in the graph.

We will **NOT** pull zod plug-ins (`zod-to-openapi`, `zod-prisma-types`,
`@hookform/resolvers/zod`, ...) in v1 — the dependency surface stays
minimal. Each plug-in would require its own ADR through the `dep-add`
skill if we want it later.

## Migration plan

Three stages, each tied to a sprint exit gate per `06-ways-of-working.md`:

- **Stage 1 — Sprint 2, weeks 5–6** (lands with C-022): schemas for
  `POST /v1/identity/register` (`src/validators/identity.ts`) and
  `POST /v1/zkp/verify` (`src/validators/zkp.ts`). Forbidden-key blocklist
  in both (see below). Tests: `tests/validator-identity.test.ts`,
  `tests/validator-zkp.test.ts`.
- **Stage 2 — Sprint 3, weeks 7–8**: `POST /v1/zkp/challenge` (new, lands
  with device-attestation refactor C-105) plus all `/api/console/*` write
  endpoints in `src/validators/console-*.ts`.
- **Stage 3 — Sprint 4–5, weeks 9–12**: every remaining `/v1/*` and
  `/api/console/*` endpoint. Exit criterion: a CI check asserts every
  POST/PUT/PATCH handler has a `.parse(...)` / `validate(...)` call
  against a zod schema declared in `src/validators/`.

Existing tests stay green at every stage — schemas add belt-and-braces,
they do not change the wire contract.

## Error contract

zod schemas use `safeParse` (never `parse`) and route the failure through a
single helper in `src/middleware/validation.ts` (new in C-022):

```typescript
// src/middleware/validation.ts (target shape; not landed in this commit)
import type { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, ZodError } from 'zod';

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(zodToErrorBody(result.error));
    }
    (req as any).validated = result.data;
    next();
  };
}

function zodToErrorBody(err: ZodError) {
  return {
    error: 'invalid_input',
    message: err.issues[0]?.message ?? 'request body failed validation',
    details: err.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    })),
  };
}
```

This is **backwards-compatible** with the existing error UX
(`{ error: '<machine_code>', message: '<human>' }` per `CLAUDE.md` § Error
handling) — we only add an optional `details` array.

## Forbidden-key enforcement

Every zod schema for a `/v1/*` POST/PUT/PATCH endpoint must:

1. Use `.strict()` — reject unknown keys at the top level and at every
   nested object.
2. Additionally call `.refine()` against the biometric-payload forbidden
   key list, mirrored from `tests/biometric-rejection.test.ts`:

   ```
   image | template | pixel | depth | frame |
   raw_face | raw_finger | biometric_data | photo
   ```

This is **defence in depth** with respect to the source-grep test:

- The grep test (Phase 0 C-021, audit finding C-8) catches the keyword
  in source text — useful but coarse.
- The zod refinement catches the keyword in the runtime payload — useful
  if some future code path goes through a generic JSON proxy and bypasses
  the named-field-read pattern the grep test relies on.

Both layers stay live. ADR 0016 strengthens C-8 at runtime; it does not
replace the source-level grep guard. The cross-reference in
`docs/security/audit-findings.md` C-8 names this ADR explicitly.

## Audit + rollback

**Observability.** A new Prometheus counter
`validation_error_count_total{route, reason}` is incremented for every
4xx returned by the validator helper. The reason label uses the zod
issue code (`invalid_type`, `unrecognized_keys`, `custom` for the
forbidden-key refinement, ...). The dashboard panel lands with C-022.
Schema regressions become visible within minutes of deploy.

**Roll-forward.** A bad schema is patched with a same-day commit;
schemas live in `src/validators/` and have unit tests in `tests/` — a
broken schema usually shows up in CI first.

**Rollback.** Revert the schema commit; manual validation comes back
with it. No DB schema impact, no migration, no on-chain dependency —
the validator layer is a thin middleware shim.

## Forbidden-key blocklist drift

The forbidden-key list lives in **one** place. C-022 introduces
`src/validators/forbidden-keys.ts` and `tests/biometric-rejection.test.ts`
imports `FORBIDDEN_KEYS` from there. Test, validator, and threat model
row A-15 stay in lock-step; adding a key (e.g. `iris_template`) is a
one-file change picked up by both source-grep and runtime refinement.

## Open questions deferred

- **OpenAPI 3.1 generation from schemas?** Tempting — `zod-to-openapi`
  would give us a generated `openapi.json` for `docs/api_contract.md`.
  Deferred to **phase 2**; revisits as its own ADR via `dep-add`.
- **`z.discriminatedUnion` for `provider: 'saml' | 'oidc' | 'zkp'` in
  `/v1/zkp/verify`?** Yes, but the refactor lands per-endpoint, not as
  one big bang — Stage 2 of the migration plan covers it.
- **zod for env-var parsing in `src/config/`?** Deferred to sprint 4 —
  boot-time validation failures escalate differently from
  request-validation failures, and the right helper is not the same.

## Consequences

**Positive.** Single source of truth: schema = type via `z.infer`; drift
is impossible by construction. Consistent error UX across `/v1/*` and
`/api/console/*`. Compile-time guarantee handlers validate (Stage 3 CI
check). Runtime defence in depth for the biometric-payload guard —
strengthens audit finding C-8 closure beyond source-grep alone.
Discriminated unions catch "provider switch with wrong fields" at parse
time.

**Negative.** One new direct dependency (mitigated by long-lived 3.x line
pin); ~12 kB gzipped runtime cost (negligible for the API; dashboard does
not import zod yet); a schema mistake can reject valid payloads (mitigated
by validator unit tests + same-day roll-forward).

**Neutral.** Replaces ad-hoc validation code; handlers shrink. Coexists
with `canonicalize` (ADR 0013) — the two are orthogonal.

## References

- Package — <https://www.npmjs.com/package/zod>
- License — MIT, <https://github.com/colinhacks/zod/blob/master/LICENSE>
- Source — <https://github.com/colinhacks/zod>
- Related ADR — `adr/0011-branching-workflow.md` (where this commit lands)
- Related ADR — `adr/0013-audit-log-hash-chain.md` (forbidden-key + audit
  guarantee story)
- Related ADR — `adr/0015-circuit-version-pinning.md` (boot-time-check
  pattern referenced by the validator helper)
- Related finding — `docs/security/audit-findings.md` C-8 (biometric-payload
  guard) — strengthened at runtime by this ADR.
- Plan reference — `docs/plan/bfsi-v1/04-commits.md` C-022 (install) +
  C-023 (this ADR).
- Plan reference — `docs/plan/bfsi-v1/agents/agent-06-backend-verifier.md`
  A06-W2-Mon (ADR authorship ticket).
- Threat model — `docs/threat_model.md` row A-15 (raw-biometric-on-the-wire).

---

LAST_UPDATED: 2026-05-26
OWNER: Agent #6 (Senior Backend Engineer, verifier service)
