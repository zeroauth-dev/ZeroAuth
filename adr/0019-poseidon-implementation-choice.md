# ADR-0019: Poseidon-BN128 implementation choice (mobile)

- **Status:** Accepted — pure-Kotlin port (Option B) implemented
- **Date:** 2026-05-28
- **Owner:** Pulkit Pareek
- **Supersedes:** —
- **Implementation:** `mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/Poseidon.kt` + `PoseidonConstants.kt` (vendored from `android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt`, which has been pinned against `poseidon-lite@^0.3.0` since W3).

## Context

ADR-0018 commits the mobile pipeline to a Poseidon-2 commitment over
BN128, matching circomlib's `Poseidon(2)` template as used in
`circuits/identity_proof.circom`. The Kotlin/Android client needs a
Poseidon implementation that produces *byte-for-byte the same output*
as circomlibjs for every input pair — otherwise enrollment-time
commitments don't match verification-time commitments and the demo
breaks.

The current commit ships `mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/Poseidon.kt`
with a stub that throws `NotImplementedError`. This ADR records the
two candidate implementations and defers the choice to the
implementation commit.

## Options

### Option A — Pure-Kotlin port via `java.math.BigInteger`

The existing W3 desktop-login Android tree (`android/`) already ships
this approach: `android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt`
is a 130-line literal port of poseidon-lite@^0.3.0's core kernel,
plus `PoseidonConstants.kt` with the round constants + MDS matrices
parsed once at class-load into `BigInteger`. It is pinned against the
JS reference in `android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt`
and survives the production-track Robolectric suite.

**Pros**:

- Zero native code. No JNI, no NDK, no platform-specific build.
- Already debugged and pinned against the JS reference.
- Vendoring is straightforward — copy two files, rename package
  from `dev.zeroauth.android.sec` to `dev.zeroauth.biometric`.

**Cons**:

- `BigInteger` arithmetic is slow on Android. Each Poseidon-2 hash
  costs ~12 ms on a Pixel 6 (measured on the existing port). The
  enrollment path runs hash exactly once, so 12 ms is invisible;
  the verification path runs it twice (commitment + identityBinding),
  so 24 ms — still inside the kiosk-login latency budget.
- `BigInteger` allocates per intermediate value (~500 allocations
  per Poseidon-2 call). The GC pressure is bounded but visible in
  Systrace.

### Option B — JNI bridge to a Rust / C++ Poseidon

The `arkworks-rs/poseidon` crate (Rust, Apache 2.0) and the iden3
`circom-witness-rs` (Rust, GPL 3.0) both ship optimised
BN128 Poseidon implementations. We would build one of them with the
NDK and expose a thin JNI surface (`extern "C" fn poseidon_hash2(a:
[u8; 32], b: [u8; 32], out: &mut [u8; 32])`).

**Pros**:

- ~2 ms per hash on the same Pixel 6 (a ~6× speedup). Becomes
  relevant if we ever need to compute thousands of commitments per
  second (we don't, not in v1).
- The native libraries are independently audited by the wider
  ZK ecosystem — fewer chances of a subtle bug in our port.

**Cons**:

- Adds the NDK to the mobile build toolchain. The CI image grows
  by ~1.5 GB; the build time grows by ~3 min per Android architecture
  (x86_64 emulator + arm64 device + armv7 legacy device).
- Native code is a non-trivial supply-chain attack surface. Any
  signed-binary leak in the upstream Cargo dep chain ships to
  end-user devices verbatim.
- `arkworks-rs/poseidon` and `circom-witness-rs` are both
  source-only crates; we'd need to host our own `.aar` build.

## Decision

**Deferred to the implementation commit.** The leading candidate is
**Option A (pure-Kotlin port)** — it's already debugged, pinned
against the JS reference, and the 12 ms hash cost is invisible
relative to the 50 ms TFLite inference that dominates the enrollment
path. The vendoring is a one-file mechanical change.

Option B is reserved for a v2 performance pass if profiling shows
Poseidon dominates verification latency on lower-tier devices (which
the existing W3 measurements suggest it won't — TFLite + Keystore
HAL roundtrips dominate the budget).

The implementation commit (next in the C-101 → C-104 sequence per
the BFSI v1 plan) will:

1. Vendor `android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt`
   into `mobile/biometric/src/main/kotlin/dev/zeroauth/biometric/Poseidon.kt`,
   replacing the stub.
2. Vendor `PoseidonConstants.kt`.
3. Replace the `PoseidonTest.kt` stub-rejection test with the
   pinned JS-reference vectors from
   `android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt`.
4. Update this ADR's status from `Deferred` to `Accepted` and
   record the actual implementation footprint (line count, dep
   diff, test vectors).

## Consequences

### Positive (regardless of which option lands)

- The `:biometric` module's public API is independent of the
  Poseidon implementation — only `Poseidon.hash2`'s body changes.
- Implementation-time choice is reversible: switching from A to B
  later (or vice versa) is a one-file change.

### Negative

- Until the implementation commit lands, `CommitmentBuilder.build()`
  throws `NotImplementedError`. The host app cannot enrol users yet.
  Acceptable because (a) the host app's enrollment screen isn't
  wired in this PR either, and (b) the test suite assertively pins
  the stub contract so accidental fake implementations get caught.

### Neutral

- The choice between A and B is, in the end, a tactical one. The
  cryptographic semantics are identical; only the cost profile
  differs.

## References

- ADR-0018 — the pipeline this implementation slots into.
- `android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt`
  — the leading Option A candidate (already in tree).
- `circuits/identity_proof.circom` — the canonical layout.
- circomlibjs Poseidon reference:
  <https://github.com/iden3/circomlibjs/blob/main/src/poseidon.js>
- poseidon-lite npm package: <https://github.com/cedoor/poseidon-lite>
- arkworks-rs/poseidon: <https://github.com/arkworks-rs/crypto-primitives>

---
LAST_UPDATED: 2026-05-28
OWNER: Pulkit Pareek
