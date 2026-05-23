# ADR-0009 — QR-mediated proof pairing for desktop login

## Status

Proposed (cryptographer pre-review applied; awaits final sign-off after
implementation lands)

## Context

W3 of the 7-week plan ([`docs/operations/central-api-delivery-plan.md`](../docs/operations/central-api-delivery-plan.md))
calls for "one non-IoT wrapper demo built on the same API." The chosen
wrapper is desktop sign-in via a native Android phone: the user proves
on their phone (biometric → Groth16 proof), the proof crosses the air
gap as a QR code, the desktop's webcam scans it, the desktop submits to
the hosted backend, the backend mints a desktop session.

Two physical devices, two QR scans, one Groth16 proof, no new
cryptographic primitives. The W2 verifier ([`@zeroauth/verifier`](../verifier/))
is reused unchanged; the W2 circuit (`identity_proof.circom`) is reused
unchanged.

The interesting design problem is **how the desktop's session nonce
binds to the proof so a proof for session X cannot be replayed against
session Y**. Three candidate strategies were considered:

- **A — Cut a new circuit with `nonce` as a fourth public input.**
  Cleanest cryptographically. Costs a Phase-2 trusted-setup ceremony,
  a new `.zkey`, a new `verification_key.json` shipped to every
  verifier instance, and either a versioned verifier or a breaking
  change for the W2 IoT bridge. Rejected for W3 timeline.
- **B (naïve) — Phone produces `identityBinding = Poseidon(3)([secret, didHash, nonce])`.**
  Looks attractive — no circuit change in the obvious sense — but
  **does not actually work**: `circuits/identity_proof.circom:41-44`
  hard-codes `identityBinding = Poseidon(2)([biometricSecret, didHash])`.
  If the phone supplies a 3-input Poseidon as the public signal, the
  R1CS constraint is unsatisfied and `snarkjs.groth16.fullProve` throws
  before producing a proof. Caught in cryptographer pre-review.
- **B′ — Fold the nonce into `didHash` _before_ the circuit consumes
  it.** Phone computes `didHashSession = Poseidon(2)([didHash, nonce])`
  and uses `didHashSession` as the `didHash` public input to the
  circuit. The unchanged circuit still enforces
  `identityBinding === Poseidon(2)([biometricSecret, didHash])`; from
  the circuit's perspective `didHash` is just the value the verifier
  supplied. The server re-derives the expected
  `Poseidon(2)([storedDidHash, sessionNonce])` from its own records
  and rejects the proof unless `publicSignals[1]` matches. No circuit
  change. No new ceremony. Adopted.

## Decision

### Protocol (Option B′)

```
Phone side:
  didHashSession  = Poseidon(2)([storedDidHash, sessionNonce_F])
  identityBinding = Poseidon(2)([biometricSecret, didHashSession])
  publicSignals   = [commitment, didHashSession, identityBinding]
  proof           = groth16.fullProve(witness, identity_proof.wasm, circuit_final.zkey)

Server side (POST /v1/proof-pairing/sessions/:id/submit):
  ctx          = getTenantContext(req)                       // never trust body for tenant
  session      = SELECT ... FROM proof_pairing_sessions
                 WHERE id = $1 AND tenant_id = $2 AND environment = $3
                       AND state = 'issued' AND expires_at > now()
  user         = lookup by (tenant_id, did) from submit body
  expected     = Poseidon(2)([user.didHash, session.nonce])
  REJECT if publicSignals[0] != user.commitment                   → pairing_did_unknown
  REJECT if !timingSafeEqual(publicSignals[1], expected)          → pairing_nonce_mismatch
  POST { proof, publicSignals } to verifier (loopback)
  REJECT if !verified                                             → pairing_proof_invalid
  UPDATE proof_pairing_sessions SET state='consumed', consumed_at=NOW()
         WHERE id = $1 AND state = 'issued' RETURNING *
  REJECT if zero rows                                             → pairing_session_already_bound
  MINT desktop session JWT
  AWAIT recordAuditEvent('pairing_session.claimed', ...)          // critical-path, not fire-and-forget
```

### Pinned parameters

- **Nonce**: 31 bytes (248 bits) of `crypto.randomBytes`, decoded as a
  field element. 31 not 32 to avoid modular-reduction bias against
  BN128's scalar prime (≈ 2^254), matching the convention in
  [`iot/src/crypto.ts`'s `toFieldElement`](../iot/src/crypto.ts).
- **Session TTL**: 5 minutes from issuance.
- **Single-use**: enforced via an atomic `UPDATE … WHERE state='issued'
  RETURNING *` — race-safe under concurrent submits.
- **Session-bind cookie**: a `Secure; HttpOnly; SameSite=Strict;
  Path=/v1/proof-pairing/`-scoped cookie set on the issuing browser at
  `POST /v1/proof-pairing/sessions` time. The cookie value is **not**
  carried in the QR. Subsequent reads (`GET .../stream`, `GET
  .../{id}`) require the cookie. Closes A-13 (session-fixation
  phishing).
- **Back-channel**: Server-Sent Events on `GET .../{id}/stream`. SSE
  was chosen over WebSocket (one-way, easier to proxy through Caddy)
  and over polling (UX latency). Polling is documented as the
  fallback for clients without `EventSource`.
- **Phone is air-gapped from the backend.** The phone scans the
  desktop's challenge QR, generates the proof locally, and renders its
  own QR. It never POSTs to `api.zeroauth.dev`. The desktop owns the
  submission. This keeps the tenant API key on a controlled surface
  and removes phone-side network attack surface from the demo's threat
  model.

### Public surface (full contract in `docs/api_contract.md`)

| Method | Path | Scope |
|---|---|---|
| `POST` | `/v1/proof-pairing/sessions` | `proof_pairing:create` |
| `POST` | `/v1/proof-pairing/sessions/:id/submit` | `proof_pairing:claim` |
| `GET` | `/v1/proof-pairing/sessions/:id/stream` | `proof_pairing:create` (cookie) |
| `GET` | `/v1/proof-pairing/sessions/:id` | `proof_pairing:create` (cookie) |

New scopes added to `src/types/index.ts`. New error codes registered in
`docs/error_codes.md` under a "Proof pairing" section.

### Schema

New table `proof_pairing_sessions` bootstrapped from
`src/services/db.ts` (same `CREATE TABLE IF NOT EXISTS` pattern as
`attendance_events`). Columns:

```
id UUID PRIMARY KEY,
tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
environment VARCHAR(10) CHECK (environment IN ('live','test')),
api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
nonce_hex VARCHAR(62),                  -- 31 bytes = 62 hex chars
session_bind_token_hash VARCHAR(64),    -- sha256 of the bind cookie value
state VARCHAR(20) DEFAULT 'issued'
  CHECK (state IN ('issued','consumed','expired','failed')),
consumed_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
consumed_verification_id UUID REFERENCES verification_events(id),
proof_hash VARCHAR(64),                 -- audit, never the proof itself
last_error_code VARCHAR(50),
desktop_ip INET,
desktop_user_agent VARCHAR(512),
expires_at TIMESTAMPTZ NOT NULL,
consumed_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE(tenant_id, nonce_hex)
```

Indexes: `(tenant_id, environment, created_at DESC)` for console
listings, partial index on `(state, expires_at) WHERE state='issued'`
for the cleanup sweep.

### QR payload (both directions)

- **Desktop → phone (challenge QR, ≤ 200 B)** — compact ASCII:
  `za:pair:1:<sessionId>:<nonceHex>:<tenantDomain>:<integrityTag>`
  where `integrityTag` is the first 4 hex chars of
  `sha256(sessionId|nonceHex|tenantDomain)`. Operator-typeable in a
  pinch.
- **Phone → desktop (proof QR, target ≤ 1500 B)** — gzip-then-base64url
  of CBOR-encoded `{ s: sessionId, p: groth16Proof, ps: publicSignals,
  d: did, m: clientMeta }`, prefixed with `za:proof:1:`. Empirical size
  on the W2 fixture proofs: ~990 B. CI test asserts ≤ 1500 B and warns
  at ≥ 1300 B.

### Non-goals (explicitly deferred)

- **Production rapidsnark on Android.** W3 ships snarkjs-in-WebView.
  rapidsnark via JNI is ADR-0011, scheduled for W5+.
- **iOS app.** Android-only for W3.
- **Play Integrity attestation gate.** Recommended as a tenant-policy
  knob; the request payload reserves `clientMeta.playIntegrityVerdict`
  for the field. Server-side enforcement is W4 work tracked under the
  security punch list.
- **Per-tenant rate limit on `/submit`.** Existing tenant rate limiter
  applies; a tighter `/submit`-specific limit (30/min/tenant + 5/min/
  session-id) is recommended in [A-20] but lands as a follow-up.
- **Cross-circuit-version verifier.** When we cut a v2 circuit, the
  verifier needs `circuitVersion` routing. Out of scope for W3.

## Consequences

### Positive

- No new trusted-setup ceremony. Reuse the existing W2 `.zkey` + `.wasm`
  on both phone and server.
- Verifier path is unchanged from W2 — same audit log, same latency
  profile, same rate-limit accounting.
- Phone is network-isolated; tenant API key never leaves the desktop.
- 5-min single-use TTL + nonce binding (Option B′) closes the replay
  window to "scan happens inside this window with this specific
  desktop's nonce."

### Negative

- **The proof is generated by snarkjs in a WebView.** This is the
  W3 demo's single biggest live risk: a compromised WebView (supply
  chain on snarkjs, OS-level malware, debugger attached) reads the
  `biometricSecret` straight out of in-process memory. Android Keystore
  does not save you here — it protects key material, not arbitrary app
  memory. ADR-0010 documents the bundling + CSP + Play Integrity
  mitigations; the residual risk is accepted for the demo and flagged
  as a P0 blocker for any BFSI pilot.
- **The desktop holds a tenant API key.** Same posture as the IoT
  bridge. Scoped to `proof_pairing:{create,claim}` only — no
  `users:write`, no `devices:write`. **[GATE: security]** — confirm
  scope minimization for the demo console.
- **WebView snarkjs latency.** Empirical mid-range Android: 3–8 s.
  Tracked in `clientMeta.proofMs` so we get production p50/p95/p99
  immediately.

### Neutral

- The desktop QR carries a 4-char integrity tag (not security-bearing)
  so the operator can spot a hand-typed typo during the documented
  paste-fallback recovery path.

## Cryptographer's required server-side checks (every `/submit`)

These are not options. Implementation tests (`tests/proof-pairing.test.ts`)
must cover each negatively:

1. `authenticateTenantApiKey(['proof_pairing:claim'])` resolves the
   tenant context. **Tenant id never read from the request body.**
2. Session lookup keyed on `(id, tenant_id, environment)` with `state =
   'issued'` and `expires_at > now()`. No row → 404 (indistinguishable
   from "exists in a different tenant" to defeat enumeration — see
   A-25).
3. `session_bind` cookie value, sha256-hashed, must match the row's
   `session_bind_token_hash`.
4. User lookup keyed on `(tenant_id, did)` returning `commitment` and
   `did_hash`.
5. Constant-time compare `publicSignals[0]` against `user.commitment`.
6. Recompute `expectedDidHashSession = poseidon2([user.did_hash,
   session.nonce])` using `poseidon-lite@^0.3.0` (pinned in the
   `iot/` and server packages — see ADR-0008).
7. Constant-time compare `publicSignals[1]` against
   `expectedDidHashSession`.
8. Forward `{proof, publicSignals, tenantId, environment, circuitVersion:
   'v1', correlationId}` to the loopback verifier. Require
   `verified: true && structuralFallback: false`.
9. Atomic `UPDATE proof_pairing_sessions SET state='consumed', ...
   WHERE id=$1 AND state='issued' RETURNING *`. Zero rows → 409
   `pairing_session_already_bound`.
10. `await recordAuditEvent('pairing_session.claimed', ...)`. **Not**
    fire-and-forget on this path — failure to write audit returns 500.

## Alternatives considered

- **Option A (new circuit with nonce input).** Best assurance,
  rejected for the W3 timeline. Filed as the production migration
  path; revisit in W6+.
- **Naïve Option B (`Poseidon(3)([secret, didHash, nonce])`).** Caught
  in cryptographer pre-review: the current circuit hardcodes a 2-input
  Poseidon and rejects the witness.
- **Option C (EdDSA over the nonce alongside the proof).** Doubles the
  primitive count, gains a separable trust-on-attestation story.
  Useful as belt+braces alongside Option A in production; overkill
  for the W3 demo.
- **WebSocket instead of SSE.** One-way back-channel; SSE survives
  Caddy without sticky sessions; trivially polyfillable on the
  desktop.
- **Phone POSTs the proof directly to `api.zeroauth.dev`.** Inverts
  the tenant trust model (API keys distributed to user devices).
  Rejected.

## References

- W2 verifier: [ADR-0006](0006-verifier-typescript-not-rust.md)
- snarkjs / poseidon-lite pin: [ADR-0008](0008-iot-snarkjs-poseidon-lite.md)
- Circuit: [`circuits/identity_proof.circom`](../circuits/identity_proof.circom)
- W2 signal derivation: [`iot/src/crypto.ts`](../iot/src/crypto.ts)
- W2 prover: [`iot/src/proof.ts`](../iot/src/proof.ts)
- Verifier server: [`verifier/src/server.ts`](../verifier/src/server.ts)
- Threat model rows A-11..A-26 (this sprint): [`docs/threat_model.md`](../docs/threat_model.md)
- Android WebView snarkjs bundling: [ADR-0010](0010-android-webview-snarkjs-bundling.md)

---
LAST_UPDATED: 2026-05-22
OWNER: Pulkit Pareek
