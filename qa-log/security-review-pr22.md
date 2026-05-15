# Security review — PR #22 (retroactive)

**Reviewer:** `security-reviewer` subagent (agentId `acdae2de12c322caa`)
**Date:** 2026-05-13
**Diff range:** `git diff 69fd27e..0c325fb` (8,652 lines across 46 files)
**Production state at review time:** `main` @ `0d1741d` (live on `https://zeroauth.dev`); `dev` @ `876fac3`
**Reason for retroactive review:** PR #22 touched all four security-reviewer trigger surfaces (auth, crypto, audit, tenant boundaries) and merged without the subagent running. CLAUDE.md mandates the subagent on any change to these surfaces — discipline-debt clearance, not a pre-merge gate. Tracking issue: [#26](https://github.com/zeroauth-dev/ZeroAuth/issues/26).

---

## Summary

Net risk is **Medium**. Tenant scoping is correctly enforced — the PR's most load-bearing security property holds, and there's even a regression test for A-10. The actual issues are (a) a documented-vs-implemented drift on JWT storage that materially changes the XSS blast radius, (b) email enumeration on signup, and (c) missing rate-limit + actor-attribution on the new authenticated write paths. **No Critical. No need to rotate keys.**

## Findings

### F-1 — Console JWT stored in localStorage; threat model A-09 claims "client memory"

- **Severity:** Medium
- **Threat-model mapping:** A-09 (drift)
- **Location:** `dashboard/src/lib/api.ts:14,29-46`; `docs/threat_model.md:105`
- **Description:** `api.ts` persists the console JWT to `localStorage['zeroauth.console_token']`, but `docs/threat_model.md` A-09 explicitly asserts the token "lives in client memory and is replayed on every API call." That's wrong as shipped. localStorage is readable by any script with execution capability on the SPA origin (CSP-bypassing extensions, future supply-chain compromise of a dashboard dep, future innerHTML mistake). Mitigation (d) "short-lived (24h)" is the only thing standing between a one-shot XSS and 24h of cross-tenant API access. The governance repo's `docs/threat-model/dashboard.md` documents the localStorage choice but the API repo's `docs/threat_model.md` doesn't reflect that — pick one and reconcile.
- **Reproduction:** Open the live dashboard, sign in, run `localStorage.getItem('zeroauth.console_token')` in DevTools — returns the JWT.
- **Recommended remediation:** Either (a) move the JWT to an HttpOnly, SameSite=Strict, Secure cookie set by `/api/console/login`+`/signup` and rely on cookie auth for `/api/console/*`, or (b) keep localStorage but update `docs/threat_model.md` A-09 to reflect reality, shorten the JWT to ~2h with silent refresh, and add a `jti` allow-list so logout server-side invalidates. Run the `threat-model-update` skill.
- **Verification after fix:** A-09 row matches the code; logout from tab A invalidates the token in tab B; the jest suite covers token revocation.

### F-2 — Email enumeration on `/api/console/signup`

- **Severity:** Medium
- **Threat-model mapping:** A-05
- **Location:** `src/routes/console.ts:132-137`
- **Description:** The 409 `email_taken` distinguishes "registered" from "available" addresses. Combined with `authLimiter` capped at 10/15min/IP, a botnet can enumerate the tenant directory (high signal for spear-phishing and stuffed-credential targeting). A-05 calls this out but the implementation still emits the distinguishing 409.
- **Reproduction:** `curl -X POST .../api/console/signup -d '{"email":"target@bank.in","password":"AlsoLong1!"}'` — 409 reveals account presence vs 201 / 400.
- **Recommended remediation:** Return an opaque 202 ("If the email is new, a verification link has been sent") regardless of pre-existing account, then send the verification email on a worker. Interim: return a uniform 400 `invalid_request` and log the duplicate server-side.
- **Verification after fix:** Black-box test: response shape for `existing@x.com` is byte-identical to `fresh@x.com`.

### F-3 — Audit log not written with console operator attribution

- **Severity:** Medium
- **Threat-model mapping:** A-01 (forensic gap), audit-log completeness rule
- **Location:** `src/routes/console.ts:454-501, 522-575`; `src/services/platform.ts:154-164, 232-245, 292-302, 381-391`
- **Description:** Every state-changing console route (POST `/devices`, PATCH `/devices/:id`, POST `/users`, PATCH `/users/:id`) writes an audit row inside `platform.ts`, but with `actor_type: 'api_key'` and `actor_id: undefined` because the console routes never pass an `actorId`. Console actions therefore appear in `audit_events` as anonymous `api_key` operations with `actor_id IS NULL`. Strictly satisfies the constitution ("Never expose admin actions without an audit row") but the row is mislabelled and unattributable to the human operator email in the JWT — degrades A-01 forensics.
- **Reproduction:** Authenticate to the console, POST `/api/console/devices`, then `SELECT actor_type, actor_id FROM audit_events ORDER BY created_at DESC LIMIT 1;` — `('api_key', NULL)`.
- **Recommended remediation:** Add a 4th argument to console-side calls: `createDevice(tenantId, env, input, { actorType: 'console', actorEmail: req.console.email })`, and have `recordAuditEvent` accept and store the email in `metadata.actor_email`. The `actorType` enum already includes `'console'` (used by signup).
- **Verification after fix:** A jest test asserts that a POST `/api/console/devices` results in an audit row with `actor_type='console'` and `metadata.actor_email='dev@example.com'`.

### F-4 — No per-tenant rate-limit on authenticated console write routes

- **Severity:** Low
- **Threat-model mapping:** A-05 (extension)
- **Location:** `src/routes/console.ts:64-74, 254-310, 454-575`
- **Description:** Only `/signup` and `/login` carry the 10/15min limiter. POST `/keys`, POST `/devices`, POST `/users`, DELETE `/keys/:id` rely solely on the global 300/15min limiter from `src/app.ts:50`. A stolen JWT can mint 300 API keys before the global limiter throttles. The 10-active-keys-per-tenant guard on POST `/keys` helps but doesn't apply to `/devices` or `/users`.
- **Recommended remediation:** Add a per-tenant write limiter (e.g. 60 writes/15min keyed on `req.console.tenantId`) to the four mutating routes.

### F-5 — Console JWT lacks `jti` and audience claim

- **Severity:** Low
- **Threat-model mapping:** A-09
- **Location:** `src/routes/console.ts:78-90`
- **Description:** Tokens have no `jti` and no `aud`. If a console session is suspected of compromise, the only mitigation is suspending the tenant outright.
- **Recommended remediation:** Add `jti: crypto.randomUUID()` and `aud: 'zeroauth-console'`, and verify `aud` in `verifyConsoleToken`. Track a small revoked-jti set in Redis (already wired into compose).

### F-6 — `parseInt` on `?limit=` without guard

- **Severity:** Low
- **Location:** `src/routes/console.ts:407, 442, 510, 585, 609`
- **Description:** `parseInt(String(req.query.limit), 10)` returns `NaN` for `?limit=abc`. `sanitizeLimit` in `platform.ts` likely catches it, but the routes should reject early with 400.
- **Recommended remediation:** Wrap parsing in `Number.isInteger(parsed) && parsed > 0 && parsed <= 1000`, else 400 `invalid_limit`.

### F-7 — Error machine-code field carries human strings in 2 handlers

- **Severity:** Informational
- **Location:** `src/routes/console.ts:122, 204`
- **Description:** Violates the `{ error: '<machine_code>', message: '<human>' }` convention in CLAUDE.md. Other routes in the same file follow it correctly.

## Things checked + clean (no finding)

- **Tenant scoping:** every `pool.query` in `platform.ts` includes `tenant_id = $1` (and `environment = $2` where applicable). No string concatenation; all `pg` parameterised. **A-01 holds.**
- **Tenant inference from request body:** `console.ts` reads `tenantId` exclusively from `(req as any).console.tenantId`. The body's `tenantId` is silently ignored. The `tests/console-proxy.test.ts:101-110, 156-164` cases prove this. **A-10 holds.**
- **XSS sinks:** No `dangerouslySetInnerHTML`, `eval`, or `document.write` anywhere under `dashboard/src/`.
- **JWT in URLs:** No URL contains the JWT (always in `Authorization` header), so no Referer leakage.
- **Secret leakage in logs:** No plaintext password, JWT, or full API key in any `logger.*` call. Only `tenantId`, `email`, `keyPrefix`, `environment`. The signup response does include the full API key one time, which is intentional.
- **`jwt.verify` algorithm:** uses HS256 implicitly via jsonwebtoken's default + the `issuer` option constraint. Acceptable for now; will become a finding when RS256 lands.
- **Bcrypt timing:** `authenticateTenant` calls `verifyPassword` only on a matched row — there's a small timing oracle for "email exists vs not", aligns with F-2 rather than a separate finding.
- **Helmet + trust proxy:** CSP and `trust proxy 1` set correctly in `src/app.ts` for rate-limit IP keying behind Caddy.

## Recommendations beyond findings

1. Run `threat-model-update` skill to reconcile A-09 with the localStorage implementation, then file an ADR `0006-console-jwt-cookie-vs-localstorage.md` (numbering after counsel-engagement ADR-0005).
2. Add `actor_type='console'` + `actor_email` plumbing through `platform.ts`. Touches every audit-row writer; do as one commit.
3. Add Redis-backed `jti` revocation list — also unblocks "log out everywhere" UX.
4. While in `console.ts`, add zod via the `dep-add` skill; the manual `if (!field)` checks are now repeated 8 times.
5. Add a CSP `report-uri` (open item in threat model) so future localStorage-readers raise a signal.

## Tests that would have caught real findings

- **F-1:** `dashboard/src/lib/api.test.ts` should assert "no JWT is found in `localStorage` after `logout()`" — already passes, but extend with "no JWT is ever in `sessionStorage` either" once cookie migration happens.
- **F-2:** `tests/console-proxy.test.ts` should add: response body for signup with an existing email is byte-identical to signup with a fresh email (both 202).
- **F-3:** Add: POST `/api/console/devices` with JWT email `dev@example.com` produces audit row with `actor_type='console'` and `metadata.actor_email='dev@example.com'`.
- **F-4:** Add a rate-limit test for `/api/console/devices` POST (61st request → 429), guarded by `NODE_ENV !== 'test'`-aware fixture.
- **F-5:** Add: revoking a `jti` makes subsequent requests with that token return 401 `session_revoked`.

---

LAST_UPDATED: 2026-05-13
