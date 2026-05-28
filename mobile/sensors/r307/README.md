# `:sensors:r307` — R307 USB-OTG fingerprint sensor

The Phase 1 driver for the R307 (and compatible) fingerprint sensor when
attached to the Android device via a USB-OTG cable. Used in the
enrollment + login flows on devices that have USB host mode enabled (see
the `USB-OTG` column of `docs/operations/device-support-matrix.md`).

## What ships at C-101 (scaffold)

- `R307Driver.kt` — the interface every sensor implementation conforms
  to. Currently a throwing stub.

## What lands at C-145

- USB host mode enumeration + the per-OEM quirks table (Samsung A23,
  Realme C55, Vivo Y28 all ship with host mode disabled; documented in
  the device-support matrix R307 sub-matrix).
- R307 wire-protocol command framing: `PS_GetImage`, `PS_GenChar`,
  `PS_RegModel`, `PS_StoreChar`. SHA-256 hashing of the resulting
  template descriptor on-device, with the byte buffer GC'd before the
  function returns (per the CLAUDE.md non-goal: "never log
  biometric-derived raw data").
- Latency budget enforcement: ≤ 1.5 s enumeration, ≤ 2.5 s GETIMAGE →
  GENCHAR round-trip (per agent-18 plan).

## Hardware fallback

Devices without USB host mode fall back to the platform BiometricPrompt
via the `:sensors:biometric_prompt` module. The `:app` module picks
between them at enrollment time based on the device-capability probe.
