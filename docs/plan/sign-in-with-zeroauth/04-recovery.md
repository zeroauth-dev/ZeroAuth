# 04 — Recovery (the existential problem)

If a user can lose access to **every** account by losing one phone, this
product cannot ship to consumers. Recovery is therefore not a feature bolted on
at the end — it is the spine. This document is deliberately the most detailed in
the set.

## The problem, stated plainly

The identity is the master secret on the phone. From it, every `DID_rp` (and
thus every account at every RP) is derived. Three failure modes:

1. **Lost / stolen / broken phone.** Secret gone → every site inaccessible.
2. **New phone (upgrade).** Same as above unless the secret moves.
3. **Re-install / OS reset.** Keystore wiped → secret gone.

A naive "your face is your key, just re-scan on the new phone" does **not**
solve this, because the face → secret derivation is not stable across cameras
(within-class embedding drift exceeds the quantizer tolerance — the exact issue
we hit and worked around on a single device with the FaceTemplateStore). So a
new device yields a *different* secret → different DIDs → "doesn't exist"
everywhere. Recovery must restore the *same* secret, not re-derive it.

## Design principle

**Recovery restores the master secret; the master secret regenerates all
pairwise DIDs deterministically; the RPs are never involved.** One recovery
event silently restores access to N sites, and ZeroAuth still never learns what
those N sites are.

## The layered model (ship in this order)

### Layer 1 — Recovery phrase (BIP39). Ships first; the floor.

- At enrollment, derive a 12/24-word phrase from the master secret (or from a
  dedicated recovery seed HKDF-stretched into the secret — to be pinned by the
  cryptographer-reviewer; keeping the phrase and the daily secret separable is
  cleaner for rotation).
- Shown **once**, with the standard "write it down, no screenshots, we cannot
  recover it for you" UX. Acknowledgement is mandatory before enrollment
  completes (no skip).
- New device → "Recover" → enter phrase → reconstruct secret → re-enrol the
  face locally (new template, same secret) → all DIDs regenerate.

**Pros:** mature, well-understood (every crypto wallet), fully self-sovereign,
ZeroAuth holds nothing. **Cons:** users lose phrases; UX friction. Layer 2
mitigates.

**Effort:** ~days. bip39 lib + the "Recover" entry point + the re-enrol path.

### Layer 2 — Multi-device enrollment. Ships with/just after Layer 1.

- The same identity on a second device (old phone, tablet, partner's device as
  a backup). Each device holds the same master secret (transferred via a
  secure device-to-device handshake — QR + ECDH, secret never touches Z).
- Losing one device → the other still works → recovery is "just keep using the
  other device," no phrase needed.

**Pros:** removes the single point of failure; familiar (WhatsApp multi-device).
**Cons:** requires a second device; the transfer handshake must be airtight.

**Effort:** ~1–2 weeks (device-to-device key transport + revocation).

### Layer 3 — Social / guardian recovery. P4.

- At enrollment the user picks **M guardians** (trusted contacts who also use
  ZeroAuth). The secret is split via Shamir's Secret Sharing into M shares; any
  **N-of-M** can authorize a re-bind to a new device.
- No single guardian (or Z) can reconstruct the secret; recovery needs a quorum.

**Pros:** no phrase to lose; humane; matches social-recovery wallets (Argent).
**Cons:** guardian liveness/availability; social-engineering attack surface
(must rate-limit + notify + delay).

**Effort:** ~3–4 weeks + careful threat modeling (guardian collusion, coercion).

### Layer 4 — Fuzzy extractor ("your face IS the key, on any device"). P4, research-grade.

- The aspirational endpoint: a code-offset fuzzy extractor (Boneh–Halevi–
  Hamburg / Reed–Solomon) that produces the **same secret from the same face on
  a different camera**, using public helper data, so *no phrase and no second
  device are needed* — the face alone recovers the identity anywhere.
- This is the item already captured in
  [bfsi-v1/todo-deferred.md](../bfsi-v1/todo-deferred.md) (D-2). It is months of
  cryptographer-grade work (characterize cross-device embedding noise across a
  device fleet, tune the ECC, prove the entropy bound, external review). It must
  **not** block launch; Layers 1–2 are the shippable safety net.

**Pros:** the literal "face is your key" pitch becomes true cross-device.
**Cons:** research risk; FAR/FRR tuning; needs external cryptographer sign-off
and a superseding ADR.

## How recovery interacts with the rest of the system

- **Pairwise DIDs:** recovery restores `master_secret`; since `DID_rp =
  derive(master_secret, rp_id)` is deterministic, *all* DIDs come back. This is
  precisely why pairwise DIDs and recovery must be designed together.
- **Attributes (VCs):** the VCs were issued to the old device's keys. On
  recovery, the holder proves control of the recovered secret and Z **re-issues**
  the attribute VCs to the new device key (`POST /v1/idp/recovery/rebind`).
  Email/phone need not be re-verified if the original VC is still valid and the
  recovery proof holds; high-assurance RPs may require re-verification.
- **RPs:** untouched. They keyed accounts on `DID_rp`; the same `DID_rp`
  returns. They never see "a recovery happened."
- **Old-device revocation:** recovery should let the user mark the old device's
  keys revoked (so a found/stolen old phone can't still present). Device-key
  revocation is a small allowlist the prover checks.

## Recovery abuse — the attacks recovery itself opens (must mitigate)

Recovery is a privileged path; it is also an **attack surface**:

- **Phrase phishing** — attacker tricks the user into entering their phrase
  into a fake app. Mitigation: phrase never leaves the device; app integrity
  attestation; user education.
- **Social-recovery coercion / collusion** — quorum of guardians compromised.
  Mitigation: N-of-M with notification + a mandatory time-delay + the ability
  for the real owner to cancel during the delay.
- **Recovery → account-takeover at RPs** — if recovery let an attacker
  reproduce `DID_rp`, they take over accounts. But recovery requires the
  *secret* (phrase / quorum / face), so this reduces to "protect the recovery
  material," which the layers above do. No RP-side change needed.
- **Re-bind replay** — `recovery/rebind` must be nonce-bound + audited +
  rate-limited, like every other privileged Z action.

These become threat-model entries A-R1..A-R4 in
[06-threat-model-and-positioning.md](06-threat-model-and-positioning.md).

## Recommendation

Ship **Layer 1 (phrase) + Layer 2 (multi-device) in P2**, before any
consumer-scale launch. Treat **Layer 3 (social)** and **Layer 4 (fuzzy
extractor)** as P4 differentiators. Do not let the dream of Layer 4 delay the
safety net of Layers 1–2.

---

LAST_UPDATED: 2026-06-05
