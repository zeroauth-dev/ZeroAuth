# Agent #18 — Senior Android Engineer (R307 + BiometricPrompt fallback) *— replaces former iOS slot*

**Reports to:** Agent #4.
**Mandate:** Owns R307 fingerprint sensor driver over USB-OTG; BiometricPrompt fallback for non-R307 path.
**KPIs:** see role 18 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A18-W1-Mon (2026-05-25)** — R307 datasheet review + protocol mapping
- Done when: R307 packet format, command set, response codes documented.
- Output: `docs/team/mobile/r307-protocol-reference.md`.
- Verify: covers AUTOIDENTIFY, GETIMAGE, GENCHAR, MATCH commands.
- Reviewer: Agent #4.
- Depends on: A04-W1-Mon.

**A18-W1-Tue (2026-05-26)** — USB-OTG enumeration spike (outside Android app, on host Linux)
- Done when: USB device descriptor read for an R307 unit.
- Output: `docs/team/mobile/r307-host-spike.md`.
- Verify: vendor ID + product ID identified.
- Reviewer: Agent #4.
- Depends on: A18-W1-Mon.

**A18-W1-Wed (2026-05-27)** — Survey USB-Serial Android libraries
- Done when: 3 candidate libraries compared (usb-serial-for-android, FTDI driver, libusb wrapper).
- Output: `docs/team/mobile/usb-serial-library-survey.md`.
- Verify: comparison covers licensing, supported chipsets, perf.
- Reviewer: Agents #4, #11.
- Depends on: A18-W1-Tue.

**A18-W1-Thu (2026-05-28)** — Library choice + ADR 0017 draft
- Done when: ADR 0017 (USB-Serial library decision) drafted.
- Output: `adr/0017-usb-serial-library.md` draft.
- Verify: dep-add skill steps followed.
- Reviewer: Agent #4.
- Depends on: A18-W1-Wed.

**A18-W1-Fri (2026-05-29)** — Status post + R307 driver high-level design
- Done when: design captures enumeration, command framing, response parsing, error recovery.
- Output: `docs/team/mobile/r307-driver-design.md` v0.
- Verify: covers tier-1 SKUs.
- Reviewer: Agent #4.
- Depends on: A18-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A18-W2-Mon (2026-06-01)** — Device-support matrix v0 (with Agent #4)
- Done when: tier-1 list confirmed; tier-2 list seeded.
- Output: contribution to `docs/operations/device-support-matrix.md` v0.
- Verify: per-SKU StrongBox + BiometricPrompt + USB-OTG flags.
- Reviewer: Agent #4.
- Depends on: A18-W1-Fri.

**A18-W2-Tue (2026-06-02)** — ADR 0017 merge
- Done when: ADR APPROVE + merged.
- Output: merge commit.
- Verify: dep-add skill audit clean.
- Reviewer: Agents #1, #4.
- Depends on: A18-W1-Thu.

**A18-W2-Wed (2026-06-03)** — BiometricPrompt fallback path design
- Done when: capability-detection helper designed; fallback to BiometricPrompt with native sensor outlined.
- Output: `docs/team/mobile/biometric-fallback-design.md`.
- Verify: covers tier-2 SKUs without R307.
- Reviewer: Agents #4, #12.
- Depends on: A18-W2-Tue.

**A18-W2-Thu (2026-06-04)** — Mobile risk-register contribution
- Done when: USB-OTG enumeration failures + R307 capture failures + fallback path failures added to mobile risk register.
- Output: contribution to `docs/team/mobile/risk-register-v0.md`.
- Verify: mitigations seeded.
- Reviewer: Agents #4, #40.
- Depends on: A18-W2-Wed.

**A18-W2-Fri (2026-06-05)** — Phase 0 R307 sign-off + status post
- Done when: R307 design + ADR 0017 merged.
- Output: row in `docs/team/phase-exits/phase-0-mobile-signoff.md`.
- Verify: ADR + design referenced.
- Reviewer: Agent #4.
- Depends on: A18-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A18-W3-Mon (2026-06-08)** — R307 sensor arrival + physical inspection
- Done when: 2 R307 units inspected against datasheet; serial numbers logged.
- Output: contribution to `docs/team/mobile/r307-procurement.md`.
- Verify: 2 units operational on Linux test rig.
- Reviewer: Agents #4, #50.
- Depends on: A04-W1-Thu.

**A18-W3-Tue (2026-06-09)** — R307 driver skeleton in `mobile/sensors/r307/`
- Done when: skeleton module + USB-OTG enumeration logic landed.
- Output: PR.
- Verify: enumeration completes ≤ 1.5 s on Pixel 7.
- Reviewer: Agent #4.
- Depends on: A18-W3-Mon.

**A18-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; R307 capture API contract aligned with prover input format.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agents #4, #17.
- Depends on: A18-W3-Tue.

**A18-W3-Thu (2026-06-11)** — BiometricPrompt fallback path skeleton
- Done when: capability-detection helper + fallback path landed.
- Output: PR.
- Verify: fallback path triggered on emulator (no USB-OTG).
- Reviewer: Agents #4, #12.
- Depends on: A18-W3-Wed.

**A18-W3-Fri (2026-06-12)** — Status post + R307 reliability test plan
- Done when: test plan covers warm start, cold start, repeated capture, OTG cable swap, low light.
- Output: `docs/team/mobile/r307-reliability-test-plan.md`.
- Verify: each scenario has acceptance criteria.
- Reviewer: Agent #24.
- Depends on: A18-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A18-W4-Mon (2026-06-15)** — R307 GETIMAGE → GENCHAR capture pipeline on Pixel 7
- Done when: capture on Pixel 7 produces a template hash on-device.
- Output: PR draft for capture pipeline.
- Verify: instrumented test confirms template descriptor SHA-256 computed.
- Reviewer: Agents #4, #17.
- Depends on: A18-W3-Tue.

**A18-W4-Tue (2026-06-16)** — R307 capture pipeline on Samsung S22
- Done when: capture works on S22 with same R307 unit.
- Output: contribution to `docs/operations/device-support-matrix.md`.
- Verify: latency captured.
- Reviewer: Agent #4.
- Depends on: A18-W4-Mon.

**A18-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended; integration with C-143 enrollment flow agreed.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #4.
- Depends on: A18-W4-Tue.

**A18-W4-Thu (2026-06-18)** — Sprint 1 R307 sign-off
- Done when: R307 driver skeleton + fallback path skeleton merged.
- Output: row in `docs/team/sprint-exits/s1-mobile.md`.
- Verify: capture verified on 2 SKUs.
- Reviewer: Agent #4.
- Depends on: A18-W4-Wed.

**A18-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (C-167 R307 driver production, C-168 device-support matrix v1).
- Output: `docs/team/mobile/a18-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #4.
- Depends on: A18-W4-Thu.
