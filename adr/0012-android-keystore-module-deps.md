# ADR-0012: Android Keystore module dependencies

- **Status:** Accepted
- **Date:** 2026-05-25
- **Owner:** Pulkit Pareek
- **Supersedes:** —

## Context

W3 of the central-API delivery plan
([`docs/operations/central-api-delivery-plan.md`](../docs/operations/central-api-delivery-plan.md))
ships a native Android wrapper app for QR-mediated desktop sign-in
(ADR-0009). The Keystore-side concrete implementation landing in this
PR ([`android/app/src/main/java/dev/zeroauth/android/sec/`](../android/app/src/main/java/dev/zeroauth/android/sec/))
implements the [`KeystoreManager`](../android/app/src/main/java/dev/zeroauth/android/sec/KeystoreManager.kt)
and [`BiometricGate`](../android/app/src/main/java/dev/zeroauth/android/sec/BiometricGate.kt)
interfaces that the parallel UI engineer authored, and produces the
biometric-bound commitment that the W2 verifier consumes. It is the
mitigation row for threat-model [A-18] ("Rooted/jailbroken phone with
extracted Keystore secret"). Per DP6, every new dependency on a
regulated-industry-facing surface gets an ADR.

The capability surface the module needs from outside the Kotlin /
Android-SDK baseline:

1. **AES-256/GCM under a biometric-bound Keystore key** with the full
   threat-model-A-18 flag set (`setUserAuthenticationRequired(true)`,
   `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)`,
   `setInvalidatedByBiometricEnrollment(true)`,
   `setIsStrongBoxBacked(true)` with fallback,
   `setUnlockedDeviceRequired(true)`,
   `setRandomizedEncryptionRequired(true)`).
2. **BiometricPrompt wrapper** with a Class-3 / `CryptoObject`
   constructor, exposed as a coroutine-friendly suspend fun so the
   Compose UI calls it without juggling callbacks.

Both of these need new dependencies — `androidx.security:security-crypto`
for the Tink-backed AEAD constants and forward-compat with EncryptedFile,
and `kotlinx-coroutines-android` for `suspendCancellableCoroutine`.
The ViewModel / Robolectric test infrastructure (`robolectric`, `turbine`,
`mockito-kotlin`, `kotlinx-coroutines-test`) was already landed by the
parallel UI engineer and is reused as-is.

## Options considered

### Production deps

#### 1. `androidx.security:security-crypto:1.1.0-alpha06` — adopted

- **Capability**: Jetpack-blessed `EncryptedFile` + `MasterKey`
  helpers, and (critically for us) the package that pulls in the
  Tink-backed AEAD primitives Android Keystore uses under the hood.
  We do not in fact use `EncryptedFile` — our blob format
  (`12-byte IV ‖ AES-GCM ciphertext ‖ tag`) is hand-rolled so the
  manager owns the encrypt cipher directly and pairs it with
  BiometricPrompt's `CryptoObject`. The dep is here so the package
  is on the classpath for any future `EncryptedFile`-shaped need
  (recovery codes, secondary credential, etc.) without a second ADR.
- **License**: Apache 2.0.
- **Maintainer**: Google / AndroidX.
- **Why this version**: `1.1.0-alpha06` is the latest pre-release;
  the stable line is `1.0.0` which targets API 23+ but ships an older
  Tink. The `1.1.0-alpha*` track is what Google's own Wallet sample
  app and the BiometricPrompt sample use. Alpha is acceptable for the
  demo and tracked for promotion when stable lands.
- **Alternative**: Roll our own `EncryptedFile` equivalent.
  Rejected — Tink primitives are version-stable across the AndroidX
  surface, and re-implementing the safe-write atomic-rename + key
  handle wrapper would replicate ~300 lines of code we'd then own.

#### 2. `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1` — adopted

- **Capability**: `Dispatchers.Main.immediate` and
  `suspendCancellableCoroutine`. `AndroidBiometricGate` uses the
  latter to wrap the callback-driven `BiometricPrompt` into a suspend
  fun. The Compose UI is already coroutine-flavoured (Activity-Compose
  pulls in `kotlinx.coroutines.core`) so this is the canonical Android
  binding.
- **License**: Apache 2.0.
- **Maintainer**: JetBrains.
- **Pinned to 1.8.1** to match the existing `kotlinx-coroutines-test`
  version in [libs.versions.toml](../android/gradle/libs.versions.toml)
  — the JetBrains release notes warn against running runtime + test
  on different minor versions.
- **Alternative**: hand-roll a `CompletableFuture`-style wrapper.
  Rejected — the callback chain has three exit paths
  (success, error, cancel) and the suspend-fun form is the only one
  that correctly cancels the underlying prompt when the coroutine
  scope is cancelled.

### Test-only deps (already present; not added by this ADR)

The parallel UI engineer's commit already added:

- `org.robolectric:robolectric:4.13`
- `org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1`
- `app.cash.turbine:turbine:1.1.0`
- `org.mockito.kotlin:mockito-kotlin:5.4.0`

These are reused as-is by [`AndroidKeystoreManagerTest`](../android/app/src/test/java/dev/zeroauth/android/sec/AndroidKeystoreManagerTest.kt)
and [`PoseidonTest`](../android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt).
The Keystore tests inject a [`FakeKeystoreVault`](../android/app/src/test/java/dev/zeroauth/android/sec/FakeKeystoreVault.kt)
backed by SunJCE rather than touching the real AndroidKeyStore — see
the file header for why (Robolectric does not ship the provider).

## Decision

Add to `android/gradle/libs.versions.toml`:

| Alias | Coordinates | Scope |
|---|---|---|
| `androidx-security-crypto` | `androidx.security:security-crypto:1.1.0-alpha06` | `implementation` |
| `kotlinx-coroutines-android` | `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1` | `implementation` |

`app/build.gradle.kts` is updated to reference each alias from the
catalog.

## Consequences

### Positive

- AndroidKeystoreManager + AndroidBiometricGate land with the
  threat-model-A-18 flag set hard-pinned in code (not in transitive
  transitive configuration).
- BiometricPrompt is exposed to the Compose UI as a single suspend
  fun — call sites stay flat and the cancellation path is correct.
- The Robolectric suite gives the W3 Keystore work a fast CI
  feedback loop. An emulator-backed instrumented suite is feasible
  later for the actual AndroidKeyStore provider once the JNI / build
  is set up.

### Negative

- `androidx-security-crypto:1.1.0-alpha06` is an alpha. The
  AndroidX policy is "alpha = API not yet locked", which we accept
  for the demo (we don't depend on `EncryptedFile` yet — only the
  Tink dependency it pulls onto the classpath).
- APK size grows by ~600 KB once `security-crypto` is pulled in.
  Trivially absorbed.
- We accept that the production AndroidKeyStore provider is NOT
  exercised by the unit-test suite. That path is covered by manual
  device testing today + the instrumented suite to be set up
  alongside the prover-glue work.

### Neutral

- The `KeystoreVault` abstraction was introduced to keep the manager
  testable without an emulator. It also makes future swap-outs
  (e.g. a hardware-attested vault for BFSI tenants) a one-file
  change. No other interface changes needed.

## Supply-chain check

The sandbox in which this ADR was authored does not have an Android
SDK + Gradle toolchain, so the `./gradlew dependencyCheckAnalyze`
step that DP6 calls for cannot be executed in this PR. The
implementing engineer (or the next agent that lands an emulator-
backed CI lane) MUST run the dependency-check task before the
release-cut for this app and append the report digest to this ADR.

The two chosen deps are from well-known maintainers:

- `androidx.security:security-crypto` — Google / Android team,
  signed publication.
- `kotlinx-coroutines-android` — JetBrains, signed publication.

No CVEs filed against any of the chosen versions on the OSS Index or
GitHub Advisory Database as of 2026-05-25.

## References

- ADR-0009: QR proof-pairing protocol — calls for the Keystore module.
- ADR-0010: Android WebView snarkjs bundling — companion module.
- Threat model [A-18] — rooted phone, Keystore extraction.
- Jetpack Security Crypto:
  <https://developer.android.com/jetpack/androidx/releases/security>
- kotlinx-coroutines:
  <https://github.com/Kotlin/kotlinx.coroutines>

---
LAST_UPDATED: 2026-05-25
OWNER: Pulkit Pareek
