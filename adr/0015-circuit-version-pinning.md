# ADR 0015 — Circuit version pinning + upgrade procedure

- **Status:** Accepted
- **Date:** 2026-05-25
- **Phase:** Phase 0, week 2 (per `docs/plan/bfsi-v1/04-commits.md` C-019)
- **Related:** `circuits/identity_proof.circom`, `src/services/zkp.ts`, ADR 0013 (audit chain), Trusted-setup ceremony ADR (lands phase 1 week 10).

## Context

ZeroAuth's identity verification uses a Groth16 circuit (`identity_proof.circom`). Today the verifier loads `verification_key.json` from disk without checking whether it matches the circuit version the running code expects. This is the kind of "circuit-key drift" mistake that ships a verifier accepting proofs for a different circuit than the one in source — silently disabling the security argument.

We need:

1. An at-boot check that the on-disk `verification_key.json` hash matches a constant compiled into the binary.
2. A documented procedure for landing a new circuit version that keeps the verifier and the verification key in lock-step.
3. A clear story for what the verifier does during a circuit-version upgrade (reject? accept both? roll forward?).

## Decision

### Version constant

`src/services/zkp.ts` exports a compile-time constant:

```typescript
export const EXPECTED_CIRCUIT_VERSION = 'identity_proof.v1.1';
export const EXPECTED_VKEY_SHA256 =
  '0x<64-hex-chars>'; // SHA-256 of canonicalised verification_key.json
```

At service boot, the verifier:

1. Reads `verification_key.json` from disk.
2. Canonicalises it (RFC 8785 JCS, same scheme as ADR 0013).
3. Computes SHA-256.
4. Asserts equality with `EXPECTED_VKEY_SHA256`. Mismatch → throws on boot, service does not start.

Boot-time refusal is the right failure mode: a verifier with a mismatched vkey is silently unsafe, so refusing to come up is strictly better than coming up and silently passing bad proofs.

### Versioning scheme

Circuit versions are `identity_proof.vMAJOR.MINOR`:

- **MAJOR** bumps when the public-signal shape or count changes (breaking).
- **MINOR** bumps for any constraint change, even one that does not change the public-signal shape.

Both kinds require:

- A trusted-setup ceremony for the new `*.zkey`.
- A redeploy of the on-chain `Groth16Verifier`.
- An ADR.

Patch-level changes (purely cosmetic, e.g. variable renames in the circuit source) do NOT bump the version — they are landed in a separate "circuit-housekeeping" commit and re-attested by re-hashing.

### Landing a new version

Order of operations (no shortcuts allowed):

1. **ADR opened** describing the constraint change + the threat-model row it addresses.
2. **Trusted-setup ceremony** for the new `*.zkey` (multi-party Phase 2).
3. **Circuit source** committed alongside the new `*.wasm`, `*.zkey`, `verification_key.json`. These large artefacts go in `circuits/` (already excluded from the secret-scan rule because zkeys can be > 50 KB; the pre-commit hook treats this directory specially per ADR 0011 / C-001).
4. **`Groth16Verifier` redeploy** on Base Sepolia (and later mainnet) with the new vkey.
5. **`src/services/zkp.ts` constants updated** to the new version + new SHA-256.
6. **Cryptographer-reviewer sub-agent APPROVE** on the PR.
7. **External cryptographer attestation** (phase 1 week 10 for v1.2; required for any v2.x).

Rollback path: keep the prior `verification_key.json` and `*.zkey` in `circuits/legacy/`; flip the version constant back if a fatal flaw is discovered post-deploy. Old on-chain verifier address is retained for replay verification of historic proofs.

### What we do NOT support

- Two circuit versions live at the same time. Verifier accepts exactly one vkey. Proofs against the old vkey are rejected after the cutover (use case: historic verification via the on-chain old verifier address only).
- Hot-swap of the vkey without process restart. Boot-time check exists exactly to prevent this.
- A `--force` flag that bypasses the boot check. Not added. Not negotiable.

## Consequences

**Positive**

- Eliminates circuit-key drift bugs.
- Forces the trusted-setup + redeploy discipline at the right time (before the new version goes live).
- Bank-facing pitch: "the verifier refuses to start if its vkey is wrong; you can verify that yourself."

**Negative**

- Adds one more pre-deploy gate (compute the SHA-256, paste into the constant) that a sloppy operator could fudge. Mitigation: the SHA-256 is computed by `npm run circuits:setup` and the constant is auto-written; manual editing is not the path.
- A botched circuit-version increment can take down production until reverted. Mitigation: deploy procedure has a 30-min wall-clock from "new vkey lives in test env" to "old verifier on `live` env retired", and the prior verifier address is held in reserve.

## Notes on v1.1 → v1.2 (planned for phase 1 week 10)

- v1.2 adds `tx_nonce` and `consent_hash` bindings to the public signals (for transaction step-up and RBI Digital Lending consent capture, respectively).
- Trusted-setup ceremony with 6 named contributors per ADR 0018 (lands week 9).
- External cryptographer review per the engagement letter Agent #27 signs in week 4.
- New `Groth16Verifier` deploy on Base Sepolia (per C-171).
- New `EXPECTED_CIRCUIT_VERSION = 'identity_proof.v1.2'` + new SHA-256 (per C-172).
