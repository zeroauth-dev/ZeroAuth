# Android device-support matrix

The per-Android-SKU capability matrix used by the ZeroAuth mobile team during build/test, by sales pre-sales to answer "will it run on …?", and by the runtime `unsupported_device` error path. This is the seed document for commit `C-168` (matrix v1) and is updated continuously as the physical-device fleet expands.

The matrix has three tiers. The `unsupported_device` error and the `allow_tier_2_devices` tenant policy switch read directly from the tier classification here.

---

## 1. Tier definitions

| Tier | What it means | Customer-facing behaviour |
|---|---|---|
| **Tier 1** | Top-12 Indian Android SKUs by market share (FY24). Fully tested across the matrix. All flows supported including high-value transaction step-up. | Enrolment allowed. Login allowed. Transaction step-up allowed. |
| **Tier 2** | Working but with documented minor degradation (older StrongBox, partial BiometricPrompt class-3 support, OEM USB-OTG quirks). Enrolment + login work; high-value step-up is gated. | Enrolment allowed. Login allowed. Transaction step-up blocked with `step_up_unavailable` — customer is asked to upgrade to a tier-1 device or use the branch. |
| **Tier 3** | Denylisted. No TEE / KeyMaster, devices < Android 11, jailbroken/rooted detected, devices with publicly documented Play Integrity bypasses. | Enrolment refused at `/v1/identity/register` with `unsupported_device`. The app shows a banker-readable message: *"This device cannot host a ZeroAuth credential. Please switch to a supported device or visit a branch."* |

**Verified-by-test legend (used in the `Verified` column):**

- **PT** — Physical-device-tested. SKU exists in the ZeroAuth mobile lab; capability has been confirmed on a physical handset.
- **EM** — Emulator-only. Confirmed on Android Studio AVD with the matching API level. Treat as a working hypothesis until PT.
- **UV** — Unverified. Capability stated from OEM spec sheet or Android compatibility docs. Will be re-tested when the SKU enters the lab.

---

## 2. Capability column definitions

| Column | Values | Meaning |
|---|---|---|
| `Android` | min–max version range | OS versions ZeroAuth has tested or accepts on the SKU. Anything outside the range goes to tier 3 until tested. |
| `StrongBox` | Yes / TEE-only / No | Hardware-isolated key store backed by KeyMaster v4+. `Yes` means a discrete secure element. `TEE-only` means TEE-backed Keystore (one-trust-zone delta). `No` means no hardware-backed key isolation — automatic tier 3. |
| `BiometricPrompt` | Yes / partial / No | `Yes` = class-3 (strong) biometrics with cryptographic binding. `partial` = class-2 only (BiometricPrompt available but does not satisfy `setUserAuthenticationRequired(true)` cryptobinding). `No` = no BiometricPrompt API support. |
| `USB-OTG` | Yes / OEM-disabled / No | R307 fingerprint sensor over USB host mode. `OEM-disabled` = hardware exists but OEM ships with host mode off and no toggle. |
| `CameraX face` | Yes / front-only / No | CameraX face-capture pipeline (ML Kit face detector + CameraX preview). `front-only` = rear camera fails depth/quality gate; we restrict to front lens. |
| `Play Integrity` | STRONG_INTEGRITY / DEVICE_INTEGRITY / BASIC_INTEGRITY / unsupported | Highest verdict the SKU is expected to produce in normal operation. Tier 1 requires DEVICE_INTEGRITY minimum; STRONG_INTEGRITY is a soft bonus. |
| `Verified` | PT / EM / UV | See legend above. |
| `Notes` | free text | Known issues, OEM-specific quirks, links to internal tickets when applicable. |

---

## 3. Tier 1 — top-12 Indian Android SKUs

Market-share figures are FY24 approximations from Counterpoint India quarterly Android-only series and IDC India CY24 shipments. Where ZeroAuth has not yet independently verified a row, the cell is marked `estimated`.

| # | Manufacturer | Model | Android | StrongBox | BiometricPrompt | USB-OTG | CameraX face | Play Integrity | Verified | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Google | Pixel 7 | 13–15 | Yes | Yes | Yes | Yes | STRONG_INTEGRITY | UV | Reference device for the mobile lab. Titan M2 secure element. First SKU to land in lab (A04-W3-Mon). |
| 2 | Google | Pixel 8 | 14–15 | Yes | Yes | Yes | Yes | STRONG_INTEGRITY | UV | Titan M2. Same baseline as Pixel 7 with newer SoC. |
| 3 | Samsung | Galaxy S22 | 12–14 | Yes | Yes | Yes | Yes | STRONG_INTEGRITY | UV | Knox Vault secure element. One UI 6 confirms BiometricPrompt class-3. Second SKU to land in lab. |
| 4 | Samsung | Galaxy S23 | 13–14 | Yes | Yes | Yes | Yes | STRONG_INTEGRITY | UV | Knox Vault. Demo phone candidate per `02-bank-demo.md` Scene 1. |
| 5 | Samsung | Galaxy A54 | 13–14 | Yes | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Knox Vault present on A5x line as of A-series 2023. Estimated — confirm during physical test. |
| 6 | OnePlus | OnePlus 11 | 13–14 | Yes | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | OxygenOS 13/14. StrongBox enabled by default. |
| 7 | OnePlus | OnePlus 12 | 14 | Yes | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | OxygenOS 14. |
| 8 | Xiaomi | Redmi Note 13 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | No discrete secure element on most Redmi Note 13 SKUs; TEE-backed Keystore is the production baseline. Acceptable for tier 1 because BFSI market share is too high to denylist. Document the StrongBox-vs-TEE delta in the breach narrative. |
| 9 | Xiaomi | Redmi Note 13 Pro | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Same TEE-only posture as Note 13. |
| 10 | Realme | Realme GT Neo 5 | 13–14 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | RealmeUI 4/5. TEE-backed Keystore. Confirm Play Integrity verdict during physical test — known cases of `BASIC_INTEGRITY` on early firmware. |
| 11 | Motorola | Edge 40 | 13–14 | Yes | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Near-stock Android. Edge 40 family ships StrongBox with the Dimensity 8020 trust zone. |
| 12 | Vivo | V29 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | FunTouchOS 14. TEE-only on most V29 SKUs. Verify USB-OTG host-mode is on by default — Vivo has historically shipped it off on some entry-level lines. |

**Tier 1 rules of engagement.**

- All twelve SKUs must reach **PT** before Phase 1 exit. The procurement spec in `docs/team/mobile/device-fleet-procurement.md` covers six of these in the first batch; the remaining six are second-batch.
- A SKU dropping from `DEVICE_INTEGRITY` to `BASIC_INTEGRITY` on a firmware update **drops it to tier 2** until investigated. The matrix is reviewed within 72 h of any major Android version release.
- If a tier-1 SKU produces `STRONG_INTEGRITY` it is recorded but does not grant additional privileges in the current policy; the tenant policy `require_strong_integrity=true` (Phase 2) will read this column.

---

## 4. Tier 2 — older / budget devices with documented degradation

These SKUs ship to BFSI customers in non-trivial volume but lack one or more tier-1 prerequisites. They are allowed only when the tenant has opted in to `allow_tier_2_devices=true` after a written risk acceptance signed by the bank's CISO.

| # | Manufacturer | Model | Android | StrongBox | BiometricPrompt | USB-OTG | CameraX face | Play Integrity | Verified | Degradation |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Google | Pixel 5 | 12–14 | Yes | Yes | Yes | front-only | DEVICE_INTEGRITY | UV | Rear-lens face capture fails the depth gate on some firmware. Enrol from front camera only. |
| 2 | Samsung | Galaxy A33 | 12–13 | TEE-only | partial | Yes | Yes | DEVICE_INTEGRITY | UV | BiometricPrompt class-2 (not class-3) on early One UI 5 firmware. Step-up bound to class-3 is blocked. |
| 3 | Samsung | Galaxy A23 | 12–13 | TEE-only | partial | OEM-disabled | Yes | DEVICE_INTEGRITY | UV | USB host mode disabled by default on some Indian variants. R307 path unavailable; falls back to BiometricPrompt. |
| 4 | Xiaomi | Redmi 12 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Acceptable as tier 2 only because Play Integrity verdict is consistently `DEVICE_INTEGRITY`. Some Redmi 12 5G variants drop to `BASIC_INTEGRITY` — those are tier 3. |
| 5 | Xiaomi | Redmi 11 | 11–12 | TEE-only | partial | OEM-disabled | Yes | BASIC_INTEGRITY | UV | Acceptable with `allow_tier_2_devices=true` AND `allow_basic_integrity=true`. Both flags must be on. |
| 6 | OnePlus | Nord N20 | 11–12 | TEE-only | Yes | Yes | front-only | DEVICE_INTEGRITY | UV | Rear face capture quality degraded. Front-only restriction applies. |
| 7 | OnePlus | Nord CE 3 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Working; trial-only because OnePlus has changed the Nord CE branding and we do not yet have a long-term firmware track record. |
| 8 | Realme | Realme C55 | 13 | TEE-only | Yes | OEM-disabled | Yes | BASIC_INTEGRITY | UV | RealmeUI Lite. USB host mode disabled. Fallback to BiometricPrompt is mandatory. |
| 9 | Motorola | Moto G54 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Working; budget Motorola line. Watch for firmware regressions. |
| 10 | Vivo | Y28 | 13 | TEE-only | partial | OEM-disabled | Yes | BASIC_INTEGRITY | UV | Entry-level Vivo. Class-2 BiometricPrompt only; step-up blocked. |
| 11 | Vivo | V27 | 13 | TEE-only | Yes | Yes | Yes | DEVICE_INTEGRITY | UV | Previous-gen V-series. Acceptable as tier 2. |
| 12 | Tecno | Camon 20 | 13 | TEE-only | partial | Yes | Yes | BASIC_INTEGRITY | UV | Tecno line is widely distributed in tier-2/3 Indian cities. Class-2 biometric only. |
| 13 | Infinix | Note 30 | 13 | TEE-only | partial | Yes | Yes | BASIC_INTEGRITY | UV | Same posture as Tecno. Acceptable with both flags on. |

**Tier 2 rules of engagement.**

- Enrolment requires `allow_tier_2_devices=true` on the tenant. The default is **false**.
- High-value transaction step-up (Scene 3 in `02-bank-demo.md`) is **blocked** on tier 2. The app returns `step_up_unavailable` and the customer is prompted to either upgrade or visit the branch.
- BiometricPrompt class-2 cells (`partial`) cannot satisfy `setUserAuthenticationRequired(true)` cryptobinding; on those rows the prover input is hash-bound to a session nonce but **not** to a biometric-gated key wrap. Document this delta in the per-customer risk acceptance.
- A tier 2 SKU that achieves `STRONG_INTEGRITY` for two consecutive firmware versions is a candidate to promote to tier 1; promotion requires sign-off from Agent #4 and Agent #18.

---

## 5. Tier 3 — denylist

Devices in this list are refused at `/v1/identity/register` with `unsupported_device`. The middleware reads the denylist signal off `(manufacturer, model, android_version, root_status, play_integrity_verdict)` exposed by the device attestation payload.

| Class | Examples | Why denied |
|---|---|---|
| **No TEE / no KeyMaster** | Devices on Android < 8.1 or with vendor-disabled Keystore. Some Android Go entry-level handsets from 2018–2019. | No hardware-backed key isolation. The StrongBox key wrap that holds the biometric helper data cannot be backed by a secure element. |
| **Android < 11** | Any handset reporting `Build.VERSION.SDK_INT < 30`. | StrongBox features ZeroAuth depends on (per `Build.VERSION_CODES.R`) are unavailable. Play Integrity does not produce reliable verdicts on Android 10 or below. |
| **Rooted / jailbroken** | Magisk-rooted devices, KingoRoot, custom recovery + system-write. | Tamper status is detectable via Play Integrity (`MEETS_DEVICE_INTEGRITY=false`); StrongBox key attestation chain often broken. |
| **Custom ROMs without locked bootloader** | LineageOS, GrapheneOS, Pixel Experience installations on devices with unlocked bootloader. | Bootloader unlock breaks the verified-boot chain; key attestation root is no longer the OEM root. ZeroAuth assumes verified boot. *Exception:* GrapheneOS on a Pixel with a re-locked bootloader is allowed if it produces a `MEETS_DEVICE_INTEGRITY` verdict — granted case-by-case. |
| **Devices with documented Play Integrity bypasses** | Devices on Snapdragon firmware versions with the `LSPosed`-based bypass active. Specific firmware versions tracked in `docs/security/play-integrity-bypass-tracker.md`. | The Play Integrity verdict on those devices cannot be trusted as a tamper signal. |
| **Devices with permanently revoked attestation certificates** | OEM-revoked Samsung devices (Knox-tripped), Google-revoked Pixels. | Key attestation certificate chain will not validate at the server; enrolment fails by construction. |

**Operational notes.**

- The denylist is **fail-closed**. A device whose attestation cannot be parsed at all is treated as tier 3.
- A device that was tier 1 and later rooted (e.g. customer flashes a custom ROM mid-life) **loses access**. The next enrolment attempt fails with `unsupported_device`; the existing DID remains valid until the customer's session expires, at which point the customer must re-enrol on a clean device.
- Class 3 (rooted) detection is the single largest reason for `unsupported_device` errors in pilot data from comparable BFSI deployments. Expect a 4–6 % rejection rate at enrolment in tier-2 Indian cities.

---

## 6. Per-tier deployment behaviour

| Flow | Tier 1 | Tier 2 (`allow_tier_2_devices=true`) | Tier 3 |
|---|---|---|---|
| Enrolment (`/v1/identity/register`) | Allowed. | Allowed. | **Refused** with `unsupported_device`. |
| Login (Scene 2 — QR + biometric + proof) | Allowed. | Allowed. | Refused (no DID exists). |
| Transaction step-up (Scene 3 — high-value bound proof) | Allowed. | **Blocked** with `step_up_unavailable`. App prompts upgrade or branch visit. | Refused. |
| Audit trail | Bound to DID. | Bound to DID. Audit row carries `device_tier=2` and `degraded_features=[...]`. | No audit row beyond the rejection event. |
| Push to phone (FCM) | Allowed. | Allowed. | N/A. |
| R307 USB-OTG capture | Optional path; falls back to BiometricPrompt class-3. | Path may be `OEM-disabled` — falls back to BiometricPrompt (class-2 or class-3 per row). | N/A. |

---

## 7. Bank-specific overrides

Anchor Bank's pilot configuration is **tier-1-only** by default. The bank can opt in to tier 2 via the tenant policy:

```jsonc
{
  "tenant_id": "anchor_bank",
  "environment": "live",
  "device_policy": {
    "allow_tier_1_devices": true,
    "allow_tier_2_devices": false,        // default
    "allow_basic_integrity": false,       // default
    "require_strong_integrity": false     // phase 2
  }
}
```

To enable tier 2:

1. The bank's CISO + CRO sign a one-page risk acceptance memo. Template in `docs/operations/tier-2-risk-acceptance-template.md` (to be written before Phase 1 week 6).
2. Agent #4 + Agent #18 + Agent #26 review the memo.
3. The flag is flipped via an admin API call to `/api/admin/tenants/anchor_bank/device-policy`. The change writes an `audit_events` row with `event_type='tenant.device_policy_change'`.
4. The bank's dashboard surfaces a banner: *"Tier 2 devices are enabled. High-value transaction step-up is degraded for tier-2 customers."*

**A flag is never silently flipped.** Every change requires the audit row above.

---

## 8. R307 USB-OTG compatibility sub-matrix

This sub-matrix tracks which SKUs have been physically tested with the R307 fingerprint sensor over a USB-OTG cable. The procurement run in Phase 1 week 5 (A04-W1-Thu) brings in 2 R307 units; once they arrive, this section gets actual data. Until then everything is **UV** (Unverified).

| SKU | OEM USB host mode | R307 enumeration | GETIMAGE round-trip | Capture latency (ms) | Verified |
|---|---|---|---|---|---|
| Pixel 7 | On | UV | UV | UV | UV |
| Pixel 8 | On | UV | UV | UV | UV |
| Samsung Galaxy S22 | On | UV | UV | UV | UV |
| Samsung Galaxy S23 | On | UV | UV | UV | UV |
| Samsung Galaxy A54 | On (verify) | UV | UV | UV | UV |
| OnePlus 11 | On | UV | UV | UV | UV |
| OnePlus 12 | On | UV | UV | UV | UV |
| Xiaomi Redmi Note 13 | On (verify) | UV | UV | UV | UV |
| Xiaomi Redmi Note 13 Pro | On (verify) | UV | UV | UV | UV |
| Realme GT Neo 5 | On (verify) | UV | UV | UV | UV |
| Motorola Edge 40 | On | UV | UV | UV | UV |
| Vivo V29 | Verify default | UV | UV | UV | UV |
| Pixel 5 | On | UV | UV | UV | UV |
| Samsung Galaxy A33 | On | UV | UV | UV | UV |
| Samsung Galaxy A23 | OEM-disabled | n/a | n/a | n/a | UV |
| OnePlus Nord N20 | On | UV | UV | UV | UV |
| Xiaomi Redmi 12 | On (verify) | UV | UV | UV | UV |
| Realme C55 | OEM-disabled | n/a | n/a | n/a | UV |
| Vivo Y28 | OEM-disabled | n/a | n/a | n/a | UV |

**R307 sub-matrix acceptance criteria (filled in during ticket A18-W4-Mon / A18-W4-Tue).**

- `enumeration ≤ 1.5 s on Pixel 7` — per A18-W3-Tue.
- `GETIMAGE → GENCHAR round-trip ≤ 2.5 s on Pixel 7` — per A18-W4-Mon.
- Same on Samsung S22 — per A18-W4-Tue.
- Latency budget per SKU: capture pipeline ≤ 3 s p95 for tier 1; ≤ 4 s p95 for tier 2.

---

## 9. Update cadence

| Trigger | Action | Owner | SLA |
|---|---|---|---|
| New SKU added to the mobile lab (physical receipt) | Row flipped from `UV` to `PT`. Capability fields confirmed by instrumented test. | Agent #18. | Within 5 working days of receipt. |
| Android major version release (e.g. Android 16 GA) | Re-run the capability test matrix on each tier 1 SKU on the new OS. Update `Android` column ranges. | Agent #4 + Agent #18. | Within 30 calendar days of GA. |
| OEM firmware regression observed (Play Integrity downgrade, BiometricPrompt class change) | Row demoted (tier 1 → tier 2 → tier 3) until investigated. Banner posted on the operator console. | Agent #18 + Agent #19. | Within 72 h of observation. |
| Quarterly review | Top-12 market-share figures refreshed from Counterpoint India / IDC India quarterly data. Tier 1 list potentially re-shuffled. | Agent #4. | First Monday of each quarter. |
| Tenant adds a SKU not in matrix | Row added in `UV` state with a tracking ticket. Procurement requested if the SKU is in the requesting tenant's top-10 fleet. | Agent #4 (triage) + Agent #50 (procurement). | 10 working days to add row; 6 weeks to PT-verify. |
| Security advisory (CVE, attestation root revocation) | Affected rows updated within the same day. ADR considered if the impact is structural. | Agent #26 + Agent #18. | Same day. |

---

## 10. Open questions and known gaps

- Lower-tier-2 rows (Tecno, Infinix) are reported from spec sheets; we expect a non-trivial fraction to drop to tier 3 on physical test because of attestation chain failures. Confirm during physical test in Sprint 2.
- Foldable devices (Galaxy Z Fold, OnePlus Open) are not yet covered. Tracked as an addition for Phase 2 — the camera pipeline needs a separate test plan for inner-display vs cover-display capture.
- Tablets are out of scope for Phase 1. Customer phones only.
- Android Go editions are explicitly out of scope and are tier 3 by default.
- Per-row latency numbers are placeholders until the prover-latency baseline (A04-W4-Tue) lands. The prover latency budget is documented in `docs/team/mobile/prover-latency-baseline.md`.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #4 (VP Mobile) + Agent #18 (R307 specialist)
