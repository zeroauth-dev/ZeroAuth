# Agent #4 — VP Engineering, Mobile

**Reports to:** Agent #1.
**Mandate:** Owns the Android app, the rapidsnark JNI bridge, StrongBox key wrap, R307 driver, the device-support matrix.
**KPIs:** see role 4 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A04-W1-Mon (2026-05-25)** — Mobile team kickoff + rapidsnark toolchain spike start
- Done when: mobile agents 17–19 briefed; rapidsnark NDK + ABI list drafted.
- Output: `docs/team/mobile/rapidsnark-toolchain-w1.md`.
- Verify: doc covers arm64-v8a + armeabi-v7a + x86_64 emulator targets.
- Reviewer: Agent #11, Agent #17.
- Depends on: A01-W1-Mon.

**A04-W1-Tue (2026-05-26)** — Author ADR 0014 (android-only platform)
- Done when: → C-102 ADR PR opened (lands in week 3).
- Output: `adr/0014-android-only-mobile-platform.md` draft.
- Verify: draft references iOS deferral rationale (StrongBox, USB-OTG, BFSI share).
- Reviewer: Agent #1, Agent #28.
- Depends on: A04-W1-Mon.

**A04-W1-Wed (2026-05-27)** — Device-fleet procurement spec
- Done when: device list with SKUs + SDK API levels + StrongBox capability documented.
- Output: `docs/team/mobile/device-fleet-procurement.md`.
- Verify: 6 SKUs minimum: Pixel 7, S22, Redmi Note 13, OnePlus 11, Realme GT, Moto Edge.
- Reviewer: Agent #50 (procurement).
- Depends on: A04-W1-Tue.

**A04-W1-Thu (2026-05-28)** — R307 sensor procurement spec
- Done when: 2 R307 units + USB-OTG cables specced.
- Output: `docs/team/mobile/r307-procurement.md`.
- Verify: vendor confirmed; ETA ≤ week 3.
- Reviewer: Agent #18, Agent #50.
- Depends on: A04-W1-Wed.

**A04-W1-Fri (2026-05-29)** — Mobile sync (Friday) + handoff
- Done when: weekly mobile sync done; 3 statuses read.
- Output: `docs/team/mobile/w1-friday-handoff.md`.
- Verify: 3 agent statuses logged.
- Reviewer: Agent #1.
- Depends on: A04-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A04-W2-Mon (2026-06-01)** — Mobile sync (Monday) + device-support matrix v0
- Done when: tier-1 list confirmed; tier-2 list seeded; capability matrix scaffolded.
- Output: `docs/operations/device-support-matrix.md` v0.
- Verify: tier-1 has StrongBox + BiometricPrompt + USB-OTG flags per SKU.
- Reviewer: Agent #18.
- Depends on: A04-W1-Fri.

**A04-W2-Tue (2026-06-02)** — Review ADR 0015 (rapidsnark vs WebView) with Agent #11
- Done when: ADR draft reviewed; WebView fallback path agreed for Phase 1 spike.
- Output: PR comment on C-103 draft.
- Verify: ADR draft updated to reflect dual-track plan.
- Reviewer: Agent #11.
- Depends on: A04-W2-Mon.

**A04-W2-Wed (2026-06-03)** — Mobile sync (Wednesday) + JNI toolchain Pixel-7 build green
- Done when: rapidsnark builds for arm64-v8a; CI cross-compile step green.
- Output: CI workflow run link.
- Verify: artefact produced; sha256 recorded.
- Reviewer: Agent #17, Agent #21.
- Depends on: A04-W2-Tue.

**A04-W2-Thu (2026-06-04)** — Mobile risk-register kickoff
- Done when: top-10 mobile-platform risks listed; mitigations seeded.
- Output: `docs/team/mobile/risk-register-v0.md`.
- Verify: includes attestation, biometric, USB-OTG-enumeration, JNI memory-safety risks.
- Reviewer: Agent #40 (risk + audit).
- Depends on: A04-W2-Wed.

**A04-W2-Fri (2026-06-05)** — Mobile sync (Friday) + Phase 0 sign-off
- Done when: mobile section of Phase 0 exit gate green; 3 statuses read.
- Output: `docs/team/phase-exits/phase-0-mobile-signoff.md`.
- Verify: mobile-related ADRs (0014 draft, 0015 draft) in good shape.
- Reviewer: Agent #1.
- Depends on: A04-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A04-W3-Mon (2026-06-08)** — Sprint 1 mobile kickoff + device-fleet arrival check
- Done when: device fleet received; 6 SKUs inventoried.
- Output: `docs/team/mobile/device-fleet-inventory-2026-06-08.md`.
- Verify: each device has serial + IMEI logged in encrypted vault.
- Reviewer: Agent #50.
- Depends on: A04-W1-Thu.

**A04-W3-Tue (2026-06-09)** — Review C-101 (mobile subtree bootstrap)
- Done when: PR reviewed; Gradle 8.x + Kotlin 1.9 + Compose pinned.
- Output: PR comment on C-101.
- Verify: `mobile/gradlew assembleDebug` green in CI.
- Reviewer: Agent #17.
- Depends on: C-101 opened.

**A04-W3-Wed (2026-06-10)** — Review C-102 (ADR 0014) + cross-line sync attendance
- Done when: ADR APPROVE; sync attended.
- Output: PR APPROVE; sync contribution.
- Verify: ADR merged; mobile-server contract clarified.
- Reviewer: Agent #1, Agent #2.
- Depends on: A04-W3-Tue.

**A04-W3-Thu (2026-06-11)** — Review C-103 (ADR 0015 rapidsnark)
- Done when: ADR APPROVE.
- Output: PR APPROVE.
- Verify: ADR merged; toolchain pin documented.
- Reviewer: Agent #11.
- Depends on: A04-W3-Wed.

**A04-W3-Fri (2026-06-12)** — Mobile sync + R307 sensor arrival check
- Done when: R307 units arrived; physical inspection done; 3 statuses read.
- Output: `docs/team/mobile/s1-mid-mobile-health.md`.
- Verify: R307 datasheet matches received units.
- Reviewer: Agent #18, Agent #50.
- Depends on: A04-W1-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A04-W4-Mon (2026-06-15)** — Review C-104 (rapidsnark JNI POC)
- Done when: PR reviewed; smoke test on emulator green.
- Output: PR comment on C-104.
- Verify: `mobile/prover/src/androidTest/.../ProverSmokeTest.kt::"generates a valid proof against fixed witness"` green.
- Reviewer: Agent #11, Agent #17, Agent #27.
- Depends on: C-104 opened.

**A04-W4-Tue (2026-06-16)** — Mobile sync (Tue replacement of Mon sync) + prover-latency baseline
- Done when: prover latency measured against fixed witness on Pixel 7 (target ≤ 2s during sprint 1).
- Output: `docs/team/mobile/prover-latency-baseline.md`.
- Verify: numbers logged; trend graph started.
- Reviewer: Agent #17.
- Depends on: A04-W4-Mon.

**A04-W4-Wed (2026-06-17)** — Mobile sync + camera/biometric capability matrix
- Done when: tier-1 SKU capability matrix updated post-physical-test.
- Output: `docs/operations/device-support-matrix.md` updated.
- Verify: each SKU has verified BiometricPrompt + StrongBox status.
- Reviewer: Agent #18, Agent #19.
- Depends on: A04-W3-Mon.

**A04-W4-Thu (2026-06-18)** — Sprint 1 mobile exit-gate sign-off
- Done when: mobile section of S1 exit gate green; C-101..C-104 merged.
- Output: `docs/team/sprint-exits/s1-mobile.md`.
- Verify: each anchor commit referenced + merged.
- Reviewer: Agent #1.
- Depends on: A01-W4-Thu.

**A04-W4-Fri (2026-06-19)** — Mobile sync + Sprint 2 dispatch
- Done when: sprint-2 daily tickets generated for Agents #17, #18, #19.
- Output: `docs/team/mobile/sprint-2-daily-dispatch.md`.
- Verify: each agent has 5 daily tickets for week 5.
- Reviewer: Agent #1.
- Depends on: A04-W4-Thu.
