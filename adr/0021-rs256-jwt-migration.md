# ADR 0021 — RS256 JWT migration with JWKS endpoint

- **Status:** Accepted (dual-issuer rollover available; HS256 stays default until operator opts in)
- **Date:** 2026-05-28
- **Phase:** Phase 0, sprint 2 (closes audit finding C-11)
- **Related:** ADR 0013 (audit chain — every JWT verify writes an audit row), `docs/operations/jwt-key-rotation-playbook.md` (lands alongside this commit).

## Context

Phase 0 audit finding C-11 flagged that **JWT is signed with HS256** (symmetric `JWT_SECRET`). Three pain points:

1. **Key rotation is fleet-wide.** Every verifier — the API process today, the planned external verifier service, a future load-balanced API pod — holds the same secret. Rotating the secret requires a simultaneous redeploy across the fleet. There is no way to introduce a new key gradually.

2. **No JWKS surface.** External integrators (a bank's IdP that wants to verify our tokens on their side, a customer's gateway that proxies our API) have no public surface to fetch the verification key. The only way to get the secret is for us to give it to them, which immediately makes them a co-equal token issuer — they can mint tokens against our identity.

3. **No `kid` claim.** Today's tokens don't carry a key ID, so even if we wanted to support multiple concurrent keys (which we can't, see (1) and (2)), there'd be no way for the verifier to pick the right one.

## Decision

Adopt **RS256 with JWKS** as the migration target. Ship as a config-flag-gated rollover so existing deployments keep working unchanged until the operator opts in.

### Algorithm selection

`config.jwt.algorithm` (env: `JWT_ALGORITHM`):

- `'HS256'` — **default**. Legacy behaviour. Single shared `JWT_SECRET`. No JWKS surface.
- `'RS256'` — new. Signer holds `JWT_RS256_PRIVATE_KEY`; verifiers hold only `JWT_RS256_PUBLIC_KEY` or fetch it from `/.well-known/jwks.json`.

### Dual-issuer verify path (rollover support)

The `verifyToken` function tries RS256 first when `JWT_RS256_PUBLIC_KEY` is configured. If that fails AND a legacy `JWT_SECRET` is present, it falls back to HS256. The behaviour matrix:

| `JWT_SECRET` | `JWT_RS256_PUBLIC_KEY` | Tokens accepted |
|---|---|---|
| set (or dev default) | unset | HS256 only |
| set | set | HS256 + RS256 (rollover window) |
| unset / dev default | set | RS256 only |
| unset | unset | error — fatal |

Issuance always uses the algorithm `config.jwt.algorithm` selects.

### JWKS endpoint

`GET /.well-known/jwks.json` returns the canonical JWKS shape:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "alg": "RS256",
      "kid": "<JWT_RS256_KID>",
      "n": "<base64url RSA modulus>",
      "e": "AQAB"
    }
  ]
}
```

When RS256 is not configured the endpoint returns `{ "keys": [] }` — a future flip to RS256 is a single env-var change, no client-visible API surface flips.

`Cache-Control: public, max-age=3600` asks intermediaries to cache the JWKS for one hour; key rotations are out-of-band.

### Key rotation procedure

`scripts/jwt-rotate.ts` generates a fresh 2048-bit RSA keypair and prints it in `.env`-paste-ready form when called with `--env`. The full procedure lives in `docs/operations/jwt-key-rotation-playbook.md`:

1. Generate fresh keypair via the script; load into the secret store.
2. Deploy new env vars to the API process with both old + new private keys available (the verify path's multi-key support is a Phase 2 ticket; for now a brief acceptance gap exists at the cutover).
3. Wait one access-token TTL (default 1 h) for outstanding old-signed tokens to expire.
4. Remove the old private key from the secret store.

### What this does NOT do

- It does NOT migrate any tokens already in circulation. They keep working under HS256 until they expire naturally. After the rollover window the legacy `JWT_SECRET` is removed and any still-extant HS256 tokens are rejected.
- It does NOT introduce per-tenant signing keys. The signing key is platform-wide; per-tenant fan-out is a Phase 2 ticket if a customer demands it.
- It does NOT add HSM-backed signer support. AWS CloudHSM / YubiHSM2 integration is on the Phase 4 roadmap; for now the private key lives in the secret manager and is read from the env var.

## Consequences

**Positive**

- Closes audit finding C-11.
- External verifiers (bank IdPs, partner gateways) can self-verify our tokens with zero shared secret.
- Key rotation no longer requires fleet-wide redeploy — only the signer needs the new private key; everyone else picks it up from the JWKS.
- Standard `kid` claim in every token (when RS256 is on) lets future multi-key rollovers be seamless.

**Negative**

- RS256 verification is ~10× slower than HS256 (~80 µs vs ~8 µs per verify on a Pixel 7 / m6i.large baseline). At our verification volume (target 500 RPS in Phase 2) this is sub-ms total. Acceptable.
- Two key formats to manage (`JWT_SECRET` for HS256, `JWT_RS256_PRIVATE_KEY` + `_PUBLIC_KEY` for RS256). Mitigation: the rotation playbook script generates and prints them in one step.
- A brief acceptance gap at rotation cutover (the multi-key support is Phase 2). Mitigation: rotations happen quarterly, not daily; the gap is operationally manageable.

## Test impact

- `tests/jwt.test.ts` — existing HS256 tests remain green (the default path is unchanged).
- `tests/jwt-rs256.test.ts` — new test file. Sets `JWT_ALGORITHM=RS256` + a real keypair via env, asserts: tokens are signed with RS256 (header check), tokens are verified against the public key, JWKS endpoint returns the expected key.
- `tests/jwt-dual-issuer.test.ts` — new. Sets both `JWT_SECRET` and `JWT_RS256_*`; asserts the verifier accepts both algorithms.

## Open questions deferred

- Multi-key concurrent support (JWKS returning N keys during rotation). Today's implementation publishes one key at a time.
- HSM-backed signing (no private key in the API process). Phase 4.
- Token-type-specific algorithm choice (e.g. access tokens RS256, refresh tokens HS256 for size). Phase 2 if profiling shows JWT size matters.

LAST_UPDATED: 2026-05-28
OWNER: Agent #12 (Senior Cryptography — key management + HSM)
