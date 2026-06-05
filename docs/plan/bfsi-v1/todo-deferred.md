# Deferred work — cross-device portability + face-derived crypto

This is the holding pen for architecture pieces we agreed to defer past the
"same-device enrollment + sign-in works perfectly" milestone. The current
phone-app architecture (ADR-0017 face-first surface + multi-step enrollment
ceremony + Keystore-bound secret + face-match-as-gate) gives us:

* same DID on every sign-in from the enrolled device
* server NEVER sees the biometric, the secret, or the template
* strong face binding via multi-pose template (front + left + right + blink
  liveness)
* lockout on lost phone — the secret is bound to this device

The two items below address the lockout AND the "face IS my key on any
device" claim. They are intentionally deferred so we can stabilise the same-
device path first; that is the path the bank demo and the bulk of v1 actual
usage runs on.

---

## D-1 — BIP39 recovery mnemonic (cross-device portability, no fuzzy crypto)

### Problem

Today's secret is generated on the device during enrollment and stored
locally (Keystore-wrapped via FaceTemplateStore). If the device is lost or
factory-reset, the user cannot reproduce the secret on a new device — and
therefore cannot reproduce the DID + commitment server-side. They are locked
out.

### Solution shape

At enrollment, derive a BIP39 12-word mnemonic from the same 32-byte secret
(or from a separate seed that is HKDF-stretched into the secret — TBD by
the cryptographer-reviewer). Show the mnemonic to the user ONCE, with the
standard "write this down, no screenshots, we cannot recover it for you"
copy. Store an in-memory note that the user has acknowledged the mnemonic;
do NOT persist the mnemonic itself.

On a new device:

1. App boots into a "Recover identity" entry point alongside "Sign in" and
   "Create new identity".
2. User types the 12 words.
3. Mnemonic → seed → reconstruct the 32-byte secret.
4. Re-enrol the FACE on the new device: this gives us a fresh template
   bound to this device's camera, but the underlying secret (and therefore
   the DID + commitment) matches the registered identity.
5. From this point on, the face on the new device unlocks the recovered
   secret. The old device is implicitly de-authorised (proof-of-presence
   moves to the new device).

### Why this preserves ZK

The mnemonic is held only by the user; it never crosses the wire. Server-
side state is unchanged: DID + commitment + audit chain. The proof flow at
verification time is identical. A server breach still exposes
commitments, not secrets, not biometrics, not mnemonics.

### Effort

~2–3 days of focused work:

* bip39 derivation + word-list bundled in :biometric
* "Recover identity" entry point in the registration flow
* "Re-enrol face on this device" path (front/left/right/blink ceremony,
  but skip the secret-generation step and use the recovered secret instead)
* UX copy + a one-page docs/why-zeroauth/recovery.md explaining the
  story

### When to revisit

After: same-device enrollment + sign-in is solid in production with the
multi-step ceremony, AND we have at least one paying customer asking for
cross-device portability. Sprint 3 candidate (see
[04-commits.md](04-commits.md)).

### Cross-references

* ADR-0017 — blockchain-agnostic posture (face-first surface)
* ADR-0018 — StrongBox-backed salt + fuzzy extractor deferral
* CLAUDE.md — "Never log biometric-derived raw data" (the mnemonic
  surfaces ONCE in plaintext; we do NOT log it)

---

## D-2 — Boneh–Halevi–Hamburg fuzzy extractor (the moat)

### Problem

Even with D-1 shipped, "face IS my key" only holds locally on a given
device. The mnemonic restores the secret, not the face. A literal "same
face, same secret, any device, no helper data on the device" experience
requires a real fuzzy extractor — server-side helper data + an error-
correcting code over the face embedding space.

### Solution shape

Code-offset construction:

```
Enrolment (n samples of the same face across pose + lighting):
  embeddings → quantise → bits b (256 bits target)
  pick random codeword c ∈ ECC C
  helper H = b ⊕ c           ← stored on the server (public)
  secret s = SHA-256(c)      ← never stored anywhere

Verification (any device, any camera):
  fresh embedding → quantise → bits b'
  fetch H from server
  c' = b' ⊕ H = c ⊕ (b ⊕ b')   ← b ⊕ b' is the noise vector
  decode c' → c     (only succeeds if noise ≤ code's correction radius)
  s = SHA-256(c)
  proof generation as today
```

The cryptographic property: H reveals nothing about s. Standard formal
result (Dodis–Reyzin–Smith 2008 + Boneh–Halevi–Hamburg 2017). The ECC
choice (Reed–Solomon vs BCH vs Reed–Muller) depends on the noise
distribution of MobileFaceNet (or the embedder we end up with);
empirical characterisation needs to come first.

### Why this is genuinely hard

1. Cross-device noise dominates within-device noise. Sensor + ISP + lens
   + colourspace conversions all perturb the embedding. We need to
   characterise the within-class L2 distance distribution across at
   least 5 different camera modules (Pixel 6, Pixel 7, iPhone 13 via
   future iOS port, Samsung Galaxy mid-tier, OnePlus mid-tier) to pick
   correction parameters that work for the realistic device fleet.

2. The ECC needs enough correction radius to absorb realistic cross-
   device drift BUT not so much that two different faces collide. The
   bit-entropy of the secret is `len(c) - log2(|C|)`; if we widen the
   code too far, the entropy collapses. The sweet-spot tuning is the
   actual research contribution.

3. We need a real cryptographer to review the construction, write the
   formal security proof, and pin the parameters. The cryptographer-
   reviewer subagent (`.claude/agents/cryptographer-reviewer.md`) gets
   the first pass; an external review (Trail of Bits / Cure53 / NCC
   Group / academic crypto group) signs off before this ships.

### Effort

Roughly 2–4 weeks of focused engineering + cryptographer review:

* Characterise within-class noise on a 5-device fleet (camera fleet
  procurement, instrumented capture app, distribution analysis)
* Implement code-offset construction + ECC in :biometric
* Server-side helper-data persistence + GET endpoint (signed; verifies
  tenant scope; rate-limited)
* Cryptographer review + adversarial verification
* Test fleet — same face across all 5 devices, plus cross-day captures
* Update the marketing site to "face IS your key, on any device"

### Why this is the moat

No deployed production system today has "face IS my key on any device,
zero device-side state, server holds only public helper data". Apple
Face ID does per-device enrolment + Apple-ID-account-level identity.
Worldcoin solves it with standardised orb hardware (can't ship in a
phone app). Aadhaar biometric authentication is server-side template
matching, not zero-knowledge. If we ship a working fuzzy extractor for
face embeddings on commodity phones, that is a defensible cryptographic
asset that justifies the "zero-knowledge identity layer for regulated
industries" positioning.

### When to revisit

After D-1 has shipped and we have characterised cross-device noise on
real users (instrument the existing app to log within-class L2 distance
between front captures across sessions, anonymised). Sprint 4–5
candidate.

### Cross-references

* Dodis, Reyzin, Smith — "Fuzzy Extractors: How to Generate Strong Keys
  from Biometrics and Other Noisy Data" (SIAM J. Comput. 38(1), 2008)
* Boneh, Halevi, Hamburg — "Reusable Fuzzy Extractors for Low-Entropy
  Distributions" (J. Cryptol. 32, 2019)
* FaceFuzz (Reed–Solomon-style face-bound key derivation, 2021)
* ADR-0018 — StrongBox-backed salt + fuzzy extractor deferral (this is
  the same item, now with a concrete effort estimate)

---

LAST_UPDATED: 2026-06-04
OWNER: Pulkit Pareek (engineering) + cryptographer-reviewer (formal
review when D-2 enters Sprint 4 planning)
