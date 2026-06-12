# ADR 0025 — Attendance provision-then-claim membership

- **Status:** Accepted
- **Date:** 2026-06-12
- **Phase:** Phase 1 — attendance slice 2 (HR admin portal + per-company membership)
- **Related:** ADR 0009 (proof-pairing — the nonce binding reused here), ADR 0013 (audit chain), ADR 0017 (face-first identity), ADR 0022 (device enrollment — the `ZA-XXXX-XXXX` invite shape), ADR 0023 (three-QR signup ceremony)

## Context

Attendance slice 1 treated *any* registered user in the demo tenant as an employee. Slice 2 makes attendance per-company: HR provisions a named employee, and the employee's phone later **claims** that record by proving control of its `(did, commitment)`. The claim is an **identity-binding** step — it decides which biometric identity counts as employee E for attendance and payroll — so it carries higher stakes than a single check-in event and needs its replay model written down.

Two sibling flows already bind a DID:

- **check-in** (proof-pairing, ADR 0009) binds the proof to a fresh per-session nonce via `publicSignals[1] = Poseidon(Poseidon(commitment), nonce)`, re-derived server-side and constant-time compared. A captured proof fails on any other session.
- **registration** (ADR 0023) chains three single-use codes plus a per-session challenge nonce.

The first cut of the claim had **neither**: it accepted `(did, commitment, proof)` whose `publicSignals[0]` equalled the submitted commitment and that verified structurally, with the single-use invite code as the only anti-replay. The cryptographer review (slice-2, Finding 1, High) showed this is replayable: a `(did, commitment, proof)` tuple is observable on every prior sign-in (the commitment is non-secret, the proof crosses the wire), so anyone who also obtained an unconsumed invite could drive the binding for the victim's own DID — an unauthorized actor completing the ceremony and denying the real employee onboarding (the invite is then consumed). The security review independently flagged the weak freshness (Finding 4).

## Decision

The claim binding rests on **two independent layers**, both required:

1. **Server-nonce freshness (primary anti-replay).** The phone opens a fresh session via `POST /api/attendance/init` (with the `companyId`) and binds the face proof to that session's 31-byte nonce, exactly like check-in. `POST /api/attendance/claim` carries the `sessionId`; the server runs `proof-pairing.verifyAndConsumeForClaim`, which enforces `publicSignals[1] = Poseidon(Poseidon(commitment), nonce)`, runs the Groth16 verifier loopback (rejecting a `structuralFallback` response — fail-closed), and atomically consumes the single-use session. Because no `tenant_users` row exists yet (the claim is what creates it), the `commitment`/`didHash` come from the **request** — gated by `commitmentsEqual(publicSignals[0], commitment)` first — instead of from `findUserByDid`. Everything else (session state machine, `session_bind` token, atomic consume, latency floor) is identical to `submitProof`.

2. **Single-use invite code (anti-double-claim + intended-recipient signal).** HR provisions an employee and mints a `ZA-XXXX-XXXX` code (8 Crockford-base32 chars ≈ 40 bits, same shape as ADR 0022), SHA-256-hashed at rest, delivered as a `zeroauth://emp-claim?company=…&code=…` deeplink. It is consumed atomically inside the claim transaction (`SELECT … FOR UPDATE` → `invite_code_hash = NULL`), so a replayed claim finds no live invite (`410`).

**Invite TTL: 48 hours** (was 7 days). Short enough to bound a leaked-invite window, long enough that an employee provisioned today can claim tomorrow. With the nonce binding in place the invite is no longer the *sole* anti-replay, so the TTL is defence-in-depth rather than the primary control.

The claim creates/links a `tenant_users` row with `metadata.did_hash = Poseidon(commitment)` — byte-identical to what registration stores — so the claimed member's DID resolves through the same `findUserByDid` the check-in verifier uses. The `attendance.membership_claimed` audit row is **awaited** (A-21): a claim with no trail is worse than a failed claim.

## Consequences

- A captured proof tuple plus a leaked unconsumed invite no longer lets a third party drive the binding: the proof carries the *prior* session's nonce fold and fails `publicSignals[1]`. The claim now matches (not merely cites) the check-in freshness model.
- The phone MUST call `/init` before `/claim`; the Android join flow (slice-2 client, Phase C) is built to this contract — there is no legacy claim client to migrate.
- **Residual:** the invite is still a bearer secret delivered out-of-band; HR must deliver it over a trusted channel. The proof binds *freshness* and *control of the committed secret*, not *that the claimer is the named employee* — that trust still flows through invite delivery. Acceptable for the BFSI pilot; a future hardening is to deliver the code to the employee's verified channel and/or bake the nonce into the circuit's public inputs (the same Sprint-4 tightening ADR 0009 references).
- **Configuration residual:** like check-in, the claim degrades to a structural-only check iff no vkey and no verifier loopback are configured. Production refuses to boot without the ADR-0015-pinned vkey (audit finding C-7), so the proof-of-knowledge layer is in force on any correct deployment; the loopback path additionally rejects `structuralFallback`.

## Threat-model + test mapping

- `docs/threat_model.md` A-45 (provision-then-claim invite abuse) records the layered model and the residual.
- `tests/attendance-membership.test.ts` (route: claim requires `sessionId`; 200/410/401/400) and `tests/attendance-membership-service.test.ts` (real `poseidon1` derivation; commitment-mismatch and rollback paths) pin the behaviour.
