# ADR-0001 — Adopt `express-rate-limit` as a direct dependency for signup/login throttling

## Status
Accepted

## Context

The whole-repo security review surfaced two issues on the developer console:

- **H7 (review finding).** `/api/console/signup` and `/api/console/login` had no per-IP throttle. The global Express limiter at `app.use(rateLimit({ max: 300, windowMs: 15min }))` is shared across every endpoint, so a credential-stuffing campaign against `/login` would not be cut off.
- The 409 vs 201 response shape on `signup` is an enumeration oracle (an attacker can tell whether an email is taken by sniffing status codes). A per-IP cap raises the cost of mass enumeration without changing the user-visible flow.

`express-rate-limit` was already in the lockfile as a transitive dependency of the global limiter in `src/app.ts`, so the supply-chain surface is zero — this ADR promotes it to a direct dependency so that:

1. the version is pinned in `package.json` and surfaces in Dependabot,
2. `scripts/check-dep-trail.sh` reports it as audited (rather than hidden in the transitive tree).

## Decision

Adopt `express-rate-limit@^8.4.1` as a **direct** dependency in `./package.json`. Use it inside `src/routes/console.ts` to apply a stricter per-IP limiter (10 attempts per 15 minutes, skipped under `NODE_ENV=test`) on the unauthenticated signup and login endpoints.

The global limiter in `src/app.ts` stays as the catch-all coarse limit; this is the second, tighter layer on the two highest-value enumeration targets.

## Consequences

- **Positive:** Credential stuffing and email enumeration via signup get an order-of-magnitude harder. Dependabot will alert on future CVEs against `express-rate-limit` directly.
- **Negative:** Two limiters can interact confusingly during debugging — the tighter one trips first under sustained traffic. Documented in `CLAUDE.md` and the route comments.
- **Neutral:** No bundle-size change (already in the tree). No license change (MIT, already accepted via the global limiter).

## Alternatives considered

1. **Keep relying on the global limiter only.** Rejected — too coarse; an attacker who paces a signup attack under 300 req / 15 min globally still gets ~3,000 attempts per hour against `/signup` alone.
2. **Roll our own per-IP counter on `req.ip`.** Rejected — re-implementing sliding-window logic per the rate-limit spec is busywork; `express-rate-limit` has the standard `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers covered.
3. **Move all rate-limiting to Caddy.** Considered. Defensible long-term posture but parking that until the Redis-backed session and rate-limit work (H2 in the review) is scheduled; the in-process limiter unblocks today's threat without a deploy-shape change.

## Supply-chain check

- License: MIT (`license-checker` confirms).
- Package: <https://github.com/express-rate-limit/express-rate-limit>.
- Active maintainer (`@nfriedly`); regular releases.
- `npm audit` reports no advisories at `8.4.1`.

## References

- Whole-repo review report (in conversation, not committed).
- Commit `ce126c9` ("Security hardening: gate demo SAML/OIDC; safer password verify") introduces the per-IP limiter use.
- `src/routes/console.ts` — `authLimiter` middleware.

---
LAST_UPDATED: 2026-05-12
OWNER: Pulkit Pareek
