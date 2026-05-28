# `:sensors:biometric_prompt` — platform BiometricPrompt fallback

The Phase 1 fallback path when the R307 USB-OTG driver is unavailable
(either the device lacks USB host mode — see `OEM-disabled` in the
device-support matrix — or the customer simply does not have an R307
sensor at hand). Uses Android's `BiometricPrompt` API directly with
class-3 (strong) biometrics and a StrongBox-bound `CryptoObject` so
the resulting hash can be bound to a Keystore-protected key.

## What ships at C-101 (scaffold)

- `BiometricPromptFallback.kt` — the interface every fallback
  implementation conforms to. Currently a throwing stub.

## What lands at C-144

- The real BiometricPrompt invocation with
  `setAllowedAuthenticators(BIOMETRIC_STRONG)`.
- Activity-bound coroutine wrapper so callers can `await()` the
  prompt result.
- StrongBox key-wrap (`setIsStrongBoxBacked(true)` on
  `KeyGenParameterSpec.Builder`) tied to the biometric. Class-2-only
  devices (see tier-2 rows in `docs/operations/device-support-matrix.md`)
  fail closed at this point.
- `androidTest/` instrumented test asserting key creation succeeded
  and is StrongBox-backed.

## Class-3 vs class-2

Tier-1 devices satisfy class-3. Tier-2 devices marked `partial` in the
BiometricPrompt column of the device-support matrix only satisfy
class-2; on those devices the fallback fails with `BIOMETRIC_CLASS_2`
and the app surfaces the `step_up_unavailable` error path to the user.
This is enforced server-side by the per-tenant `device_policy` in
`/v1/identity/register`.
