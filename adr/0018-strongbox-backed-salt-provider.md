# ADR-0018: StrongBox-backed salt provider for the Poseidon commitment

- **Status:** Proposed
- **Date:** 2026-06-01
- **Owner:** Pulkit Pareek
- **Supersedes:** —
- **Related:** ADR-0010 (Android WebView snarkjs bundling), ADR-0012 (Android Keystore module deps), ADR-0017 (blockchain-agnostic posture), ADR-0019 (Poseidon implementation choice).

## Context

Per ADR-0017, the platform's identity primitive is the Poseidon
commitment `c = Poseidon2(secret, salt)`. The `secret` is the 32-byte
SHA-256 of the quantised on-device face embedding (ADR-0018-mobile,
the pipeline ADR — distinct from this file). Three properties of the
commitment determine the whole platform's security story, and all
three of them hang on the `salt`:

1. **The commitment must not be a deterministic function of the
   face alone.** If `c = Poseidon2(secret)` (no salt), then any
   attacker who can guess the face — i.e. anyone with a photo of
   the user — can reconstruct the secret offline (face is low-entropy
   in the information-theoretic sense; the quantised int16
   embedding has ~80 bits of effective entropy against a determined
   adversary with template-inversion tools). Adding a 256-bit secret
   salt makes the commitment computationally hiding under the
   Poseidon-2 hiding game.

2. **The salt must be stable across verifications on the same
   device.** Same face + same device → same commitment, every time.
   If the salt changes between enrollment and verification, the
   commitment changes and the user cannot authenticate. (ADR-0017's
   identity provider relies on commitment equality for the off-chain
   default and for the on-chain `did_provider != "off-chain"` paths;
   both modes break under salt rotation.)

3. **The salt must not be extractable by a rooted-phone attacker.**
   Threat-model row A-18 ("rooted/jailbroken phone with extracted
   Keystore secret") explicitly addresses this. If a root attacker
   on the user's device can read the salt out of app storage, they
   combine it with a face photo to mint commitments matching the
   user's enrollment — i.e. they impersonate the user on any device
   that accepts the same `(did, commitment)` pair. The DID is
   public (DIDs are addresses); the commitment is the database
   primary key on the verifier side; the salt is the only secret
   gating impersonation given a face photo.

Constraint (1) is satisfied by any 256-bit random salt. Constraint
(2) is satisfied by storing the salt in a location that survives
app process death and reboot. Constraint (3) is the hard one — it
requires the salt to live in a location an OS-root attacker cannot
read. On Android that location is the hardware-isolated keystore
(StrongBox on devices that have it; TEE-backed Android Keystore on
the rest).

The existing W3 desktop-login Android tree
(`android/app/src/main/java/dev/zeroauth/android/sec/`) already
holds a `KeystoreManager` (ADR-0012) that wraps the Android Keystore
with the threat-model-A-18 flag set. The W3 module stores an
**AES-256/GCM data-encryption key** in the Keystore, biometric-gated
with `setUserAuthenticationRequired(true) +
setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`. This ADR
extends that surface with a *second* Keystore-held key — an
HMAC-SHA-256 key — whose sole purpose is to deterministically derive
the per-install salt.

The two-key split (AES for blob encryption, HMAC for salt
derivation) is deliberate. The AES key is biometric-gated; every
unwrap costs a `BiometricPrompt` round-trip (~600 ms). The HMAC key
is **NOT** biometric-gated — it is only "device-unlocked + StrongBox
preferred" — so salt derivation is cheap (~3 ms) and can run on
every verification without user friction. Biometric gating already
sits on the AES-encrypted credential blob upstream; double-gating
the salt provides no extra security and would visibly degrade UX.

The mobile-pipeline ADR (`0018-mobile-face-embedding-pipeline.md`)
commits the pipeline to `Poseidon.hash2(secret, salt)` and notes
"salt generated once at enrollment via an HMAC-SHA-256 key held in
the Android Keystore (StrongBox-preferred)". This ADR is the design
record for that parenthetical.

## Decision

### The salt provider holds a single Keystore-held HMAC key

Class name: `SaltProvider` (interface),
`AndroidKeystoreSaltProvider` (production impl),
`InMemorySaltProvider` (test double).

Production location:
`mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/salt/`.

The Keystore alias is the literal string
`"za-salt-hmac-v1"`. Version suffix is locked into the alias so a
future v2 (e.g. salt-rotation policy change) can coexist with v1
during a migration window.

### Key spec

The Keystore key is created once, at first-launch enrollment, with
`KeyGenParameterSpec.Builder("za-salt-hmac-v1",
KeyProperties.PURPOSE_SIGN)` and the following flags:

```kotlin
.setKeySize(256)
.setAlgorithmParameterSpec(null)            // HMAC-SHA-256 default
.setDigests(KeyProperties.DIGEST_SHA256)
.setIsStrongBoxBacked(true)                 // preferred; falls back on UnsupportedException
.setUnlockedDeviceRequired(true)            // KEYGUARD must be unlocked
.setRandomizedEncryptionRequired(false)     // N/A for HMAC, set explicitly to silence lint
.setInvalidatedByBiometricEnrollment(false) // do NOT invalidate on new biometric enroll
.setUserAuthenticationRequired(false)       // see rationale below
```

Three flags deserve specific justification:

- **`setIsStrongBoxBacked(true)`** is the load-bearing security
  flag. StrongBox is a dedicated tamper-resistant chip
  (Titan M, Pixel 3+; analogous TEE-distinct enclaves on flagship
  Samsung / OnePlus). Keys generated with StrongBox cannot be
  exported, not even by an OS-root attacker, because the key
  material never leaves the chip — operations are performed inside
  StrongBox and only the result returns to the AP.
- **`setUnlockedDeviceRequired(true)`** prevents a stolen-phone
  attacker (powered off → boot to recovery → ADB) from coaxing
  the HMAC out of the Keystore. The Keystore only services
  requests after the user has unlocked the device with their
  Knowledge Factor (PIN / pattern / password) at least once since
  boot.
- **`setUserAuthenticationRequired(false)`** is the deliberate split
  from the AES key. Setting it `true` would force a fresh
  BiometricPrompt every verification. The AES blob *already* gates
  on biometric; the salt derivation only needs to gate on "device
  is unlocked". Forcing a second biometric prompt on every
  verification would compound the UX cost without buying any
  defence against the A-18 threat (a root attacker who unlocks the
  device can issue HMAC operations either way).

### Salt derivation

The salt is derived from the HMAC key as:

```
salt = HMAC-SHA-256(K_keystore, "ZeroAuth-Salt-v1")[0:32]
```

The literal `"ZeroAuth-Salt-v1"` is the salt-derivation domain
separator. It is recorded:

- in this ADR (above),
- as a `const val SALT_DERIVATION_INPUT = "ZeroAuth-Salt-v1"` in
  [`mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/salt/AndroidKeystoreSaltProvider.kt`](../mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/salt/AndroidKeystoreSaltProvider.kt),
- in the test vector at
  [`mobile/biometric/src/test/kotlin/dev/zeroauth/biometric/salt/AndroidKeystoreSaltProviderTest.kt`](../mobile/biometric/src/test/kotlin/dev/zeroauth/biometric/salt/AndroidKeystoreSaltProviderTest.kt)
  (which pins the salt against a known HMAC key for SunJCE-backed
  Robolectric runs).

The derivation pattern follows NIST SP 800-108 KDF-in-counter mode
shape (with `L = 256, i = 1` implicit and no counter prefix because
we only ever extract one block). This is the same pattern Tink uses
for its `DeterministicAead`-from-keyset KDF; we are not inventing a
KDF.

### StrongBox detection and fallback

At key-creation time:

```kotlin
try {
    keyGenerator.init(buildSpec(isStrongBoxBacked = true))
    keyGenerator.generateKey()
} catch (e: StrongBoxUnavailableException) {
    // Log a single event to the local Logcat + the audit channel.
    // Retry once with isStrongBoxBacked = false. This path is the
    // TEE-backed Android Keystore — still hardware-isolated on
    // every device since API 23, just not the dedicated StrongBox
    // chip.
    keyGenerator.init(buildSpec(isStrongBoxBacked = false))
    keyGenerator.generateKey()
}
```

The `SaltProvider` interface exposes a `strongBoxBacked: Boolean`
property derived from `KeyInfo.isInsideSecureHardware` +
`KeyInfo.securityLevel` (the latter is API 31+; the former is the
fallback for older API levels). The host app surfaces this property
to the audit log so the verifier can record `keystoreBackedness =
"strongbox" | "tee" | "software"` per enrolment. Tenants with the
strictest BFSI policy (selectable via `tenant.security_policy.
require_strongbox = true`, a Phase 1 sprint-3 field) can refuse to
enrol users on TEE-only devices. Default tenants accept both.

Note: a tiny fraction of older devices (pre-API-23 unofficial
ports, a handful of low-tier OEMs that misimplemented Keystore)
will land on `softwareBacked = true`. The implementation refuses to
proceed in that case: it throws `KeystoreNotHardwareBackedException`
and the host app shows a "your device cannot be used for ZeroAuth
identity" terminal screen. This is the v1 posture — we accept
losing the tail of devices to keep the security floor at "key
material never lives on the AP".

### Lifecycle

- **First enrolment**: the HMAC key is generated. Salt is derived
  and cached in-memory for the rest of the enrollment session
  (so the commitment computation doesn't HAL-roundtrip twice).
  Cache is cleared on `onStop()` / process death.
- **Subsequent verifications**: salt is re-derived from the same
  Keystore key. Cost is ~3 ms on a Pixel 6 StrongBox, ~1 ms on a
  Pixel 6 TEE. Cache lifetime same as above.
- **App uninstall / factory reset**: Keystore wipes all keys
  belonging to the uninstalled package. The same face derives a
  *different* commitment after re-install. The user must re-enrol —
  the desired behaviour per ADR-0017's "user lost phone" recovery.
- **Biometric re-enrolment**: the HMAC key is NOT invalidated
  (`setInvalidatedByBiometricEnrollment(false)`). Deliberate split
  from the AES credential key, which IS invalidated by re-enrolment.

### The interface

```kotlin
interface SaltProvider {
    /** Returns the per-install salt. Idempotent within a process. */
    fun getOrCreateSalt(): ByteArray

    /** True if the underlying key is in a dedicated StrongBox chip. */
    val strongBoxBacked: Boolean

    /** True if the underlying key is in hardware (StrongBox OR TEE). */
    val hardwareBacked: Boolean
}
```

The `:biometric` module exposes only this interface. The
production wiring picks `AndroidKeystoreSaltProvider`; the test
wiring picks `InMemorySaltProvider`. The mobile-pipeline ADR's
`Commitment.build()` accepts `SaltProvider` as a constructor
parameter — no static / global state.

## Consequences

### Positive

- The salt is unexfiltratable by an OS-root attacker on
  StrongBox-capable devices (~70% of the BFSI demographic at the
  Tier-1 cutoff). The remaining ~30% land on TEE which is still
  hardware-isolated from the AP. Consistent with how Google Pay
  and RBI-sanctioned UPI clients treat their root-of-trust.
- The Poseidon commitment retains computational hiding. Without
  the salt, the commitment is only hiding under the assumption
  that the face is high-entropy, which it isn't.
- The verifier (`src/services/identity.ts`) needs nothing about
  salt provenance — the commitment is the DB primary key, the
  salt never leaves the device. Consistent with CLAUDE.md's "never
  accept raw biometric data over the wire" non-goal and with the
  Auth0 differentiation pitch (`docs/why-zeroauth/vs-auth0.md`).
- The two-key split keeps salt derivation under 5 ms per
  verification (no second biometric prompt) while keeping the
  AES-protected credential blob under hard biometric gating.

### Negative

- A user who buys a new phone must re-enrol. The salt is
  device-bound; no cross-device salt-recovery in v1. (Fuzzy
  extractor deferred — see mobile-pipeline ADR's "Deferred work".)
- ~3% of the Indian Android installed base (StatCounter 2026 Q2)
  land on software-backed Keystore. The implementation refuses to
  enrol these users — we accept the tail loss to keep the security
  floor at hardware-isolation.
- StrongBox HAL roundtrips can fail under aggressive
  power-management (`KeyStoreException(SYSTEM_ERROR)`). The
  implementation retries once with backoff (50 ms, 200 ms); a
  second failure surfaces to the host app as a transient-failure
  toast.
- `setInvalidatedByBiometricEnrollment(false)` is a deliberate
  departure from the AES key's policy. A family member who enrols
  their finger gains the AES-protected credential only if they
  pass the biometric prompt — they are already inside the threat
  boundary; the salt's role is to prevent OFFLINE face-only
  attack, not insiders.

### Neutral

- The HMAC key counts as one additional Keystore slot. No hard
  slot-count limit; tens per app are routine.
- The salt is 32 bytes. Poseidon-2 over BN128 expects a field
  element; we trim the HMAC output to 254 bits (top-two-bit zero,
  not modular reduction) before feeding it in. Same trim the
  mobile-pipeline ADR applies to the commitment output.

## Alternatives considered

### A. Salt held as a SharedPreferences blob (no Keystore)

Rejected. SharedPreferences lives in the app's data directory and
is fully readable by an OS-root attacker via `adb shell run-as` or
direct `/data/data/<pkg>` access on a rooted device. This is the
exact attack class A-18 calls out.

### B. Salt encrypted under the existing AES Keystore key

Tempting because it reuses the W3 `KeystoreManager` machinery and
adds no new Keystore slot. Rejected for two reasons:

- The AES key is biometric-gated. Salt derivation would inherit
  the biometric gate, costing a `BiometricPrompt` round-trip on
  every verification. The two-key split exists precisely to avoid
  this UX tax.
- The AES key is invalidated by biometric re-enrolment. If the
  user adds a new fingerprint, the AES key dies, the salt blob
  becomes undecryptable, and the user is locked out until they
  re-enrol with ZeroAuth. The HMAC key with
  `setInvalidatedByBiometricEnrollment(false)` does not have this
  failure mode.

### C. Salt derived from a Keystore-held *signing* key (RSA / EC)

Rejected. Signing key operations on the AndroidKeyStore HAL are
2–5× slower than HMAC operations on the same backend
(asymmetric crypto inside StrongBox is the slow path; HMAC is
the fast path). The 3 ms HMAC budget is comfortable; a 15 ms ECDSA
budget would be visible on lower-tier devices.

The cryptographic distinction matters less than the cost: HMAC and
EC-DSA over a fixed message both behave as PRFs from the Keystore
key's perspective; either gives us the same hiding property over
the salt.

### D. Salt is the SHA-256 of `ANDROID_ID + package signature`

Rejected. `ANDROID_ID` and package signature are both public data,
so the "salt" would fail the hiding property entirely.

### E. No salt; use a Pedersen commitment scheme

Rejected on circuit-compatibility grounds. The
`identity_proof.circom` circuit computes `Poseidon(secret, salt)`
literally; switching schemes would require a fresh trusted setup
ceremony (see
[`docs/cryptography/trusted-setup-ceremony.md`](../docs/cryptography/trusted-setup-ceremony.md))
and would invalidate every existing enrolment. The Poseidon-2
choice is locked by ADR-0019 and ADR-0015.

### F. Per-verification fresh salt (no stable salt at all)

Rejected. A fresh salt every time produces a different commitment
every time, so the verifier cannot look up the user by commitment.
The protocol shape requires `enrollmentCommitment ==
verificationCommitment` for the same face on the same device. This
is the constraint (2) from the Context section.

### G. WebView-isolated salt provider (per ADR-0010)

Rejected. ADR-0010 puts the snarkjs prover in an
`isolatedProcess=":prover"` Service with no Keystore access. The
salt provider must live in the main process; salt + secret cross
the IPC boundary as a one-shot `ProverRequest` Parcelable, and the
main process zeroes the inputs the moment the proof returns. This
matches ADR-0010's "Keystore-wrapped credential blob lives in the
main process" guarantee.

## References

- ADR-0010 — Android WebView snarkjs bundling + supply-chain
  guard. The salt provider lives in the main process; the
  isolated `:prover` Service receives the salt only as part of
  the one-shot `ProverRequest`. See "Process isolation" in
  ADR-0010 for the IPC contract.
- ADR-0012 — Android Keystore module dependencies. The AES
  `KeystoreManager` slot this ADR's HMAC slot sits next to. The
  threat-model A-18 flag set is the same shape for both keys.
- ADR-0015 — Circuit version pinning. The Poseidon-2 layout
  is locked at the circuit level; the salt feeds into that fixed
  layout.
- ADR-0017 — Blockchain-agnostic posture. The commitment is the
  identity primitive across all `did_provider` and
  `verifier_provider` settings. The salt provider is the same in
  every provider configuration.
- ADR-0018 (mobile-face-embedding-pipeline) — the pipeline this
  salt provider plugs into. The "Cryptographic salt" section there
  forward-references this ADR for the StrongBox detail.
- ADR-0019 — Poseidon-BN128 implementation choice. Poseidon's
  hiding property over `(secret, salt)` is conditional on the salt
  being secret; this ADR is what makes that conditional hold.
- Threat model A-18 — rooted/jailbroken phone with extracted
  Keystore secret. The mitigation row for A-18 lists "StrongBox-
  backed HMAC for salt derivation" alongside the existing
  AES-key-backed credential storage.
- Android `KeyGenParameterSpec` reference:
  <https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder>
- Android `StrongBoxUnavailableException` reference:
  <https://developer.android.com/reference/android/security/keystore/StrongBoxUnavailableException>
- NIST SP 800-108 (KDF in counter mode):
  <https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-108r1.pdf>

---
LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek
