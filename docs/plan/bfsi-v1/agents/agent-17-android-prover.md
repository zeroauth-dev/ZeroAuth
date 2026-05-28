# Agent #17 — Senior Android Engineer (prover core + biometric prompt)

**Reports to:** Agent #4.
**Mandate:** Owns Android Pramaan core — rapidsnark JNI bridge, snarkjs/WebView prover for spike, BiometricPrompt integration, StrongBox key wrap.
**KPIs:** see role 17 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A17-W1-Mon (2026-05-25)** — Mobile subtree layout design (precursor C-101)
- Done when: `mobile/` module structure designed (app, prover, sensors, keystore, scanner, telemetry).
- Output: `docs/team/mobile/subtree-layout-design.md`.
- Verify: each module has owner role assigned.
- Reviewer: Agents #4, #19.
- Depends on: A04-W1-Mon.

**A17-W1-Tue (2026-05-26)** — Pair with Agent #4 on rapidsnark toolchain spike
- Done when: NDK + CMake build attempted on Linux dev box; arm64-v8a artefact produced.
- Output: `docs/team/mobile/rapidsnark-build-spike.md`.
- Verify: artefact sha256 recorded.
- Reviewer: Agent #4.
- Depends on: A17-W1-Mon.

**A17-W1-Wed (2026-05-27)** — JNI wrapper design
- Done when: API surface `generateProof(witnessJson) -> proofJson` designed; memory-safety considerations captured.
- Output: `docs/team/mobile/jni-wrapper-design.md`.
- Verify: cryptographer-reviewer pre-review.
- Reviewer: Agent #11, Agent #27.
- Depends on: A17-W1-Tue.

**A17-W1-Thu (2026-05-28)** — JNI wrapper proof-of-concept against fixed witness
- Done when: standalone JNI bridge produces proof against fixed witness on Linux x86_64 emulator.
- Output: `docs/team/mobile/jni-poc-result.md`.
- Verify: proof verifies against `verification_key.json`.
- Reviewer: Agents #4, #11.
- Depends on: A17-W1-Wed.

**A17-W1-Fri (2026-05-29)** — Status post + Pixel-7 emulator green build
- Done when: rapidsnark builds + JNI bridge runs on Pixel-7 emulator.
- Output: emulator run log committed.
- Verify: CI cross-compile step green.
- Reviewer: Agent #21.
- Depends on: A17-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A17-W2-Mon (2026-06-01)** — Mobile subtree bootstrap PR (C-101)
- Done when: → C-101 PR opened.
- Output: `mobile/` tree.
- Verify: `mobile/gradlew assembleDebug` green in CI.
- Reviewer: Agent #4.
- Depends on: A17-W1-Fri.

**A17-W2-Tue (2026-06-02)** — Address PR feedback on C-101
- Done when: feedback addressed; merge-ready.
- Output: PR updates.
- Verify: review APPROVE.
- Reviewer: Agent #4.
- Depends on: A17-W2-Mon.

**A17-W2-Wed (2026-06-03)** — Rapidsnark JNI POC PR open (C-104 precursor)
- Done when: standalone POC committed to feature branch (not yet C-104 PR).
- Output: feature-branch commits.
- Verify: smoke test runs in CI on emulator.
- Reviewer: Agents #4, #11.
- Depends on: A17-W2-Tue.

**A17-W2-Thu (2026-06-04)** — Instrumented test framework set up
- Done when: instrumented test harness in `mobile/prover/src/androidTest/` configured; runs on emulator + CI device farm.
- Output: PR.
- Verify: harness runs `ProverSmokeTest.kt` skeleton.
- Reviewer: Agent #21.
- Depends on: A17-W2-Wed.

**A17-W2-Fri (2026-06-05)** — Phase 0 mobile prover sign-off + status post
- Done when: POC + harness merged; CI builds green.
- Output: row in `docs/team/phase-exits/phase-0-mobile-signoff.md`.
- Verify: artefacts produced; harness runs.
- Reviewer: Agent #4.
- Depends on: A17-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A17-W3-Mon (2026-06-08)** — Rapidsnark JNI POC PR (C-104) opened
- Done when: → C-104 PR opened with smoke test.
- Output: C-104 PR.
- Verify: `ProverSmokeTest.kt::"generates a valid proof against fixed witness"` green.
- Reviewer: Agents #4, #11, #27.
- Depends on: A17-W2-Fri.

**A17-W3-Tue (2026-06-09)** — Prover-latency baseline measurement
- Done when: prover latency measured on Pixel 7 + emulator; results logged.
- Output: contribution to `docs/team/mobile/prover-latency-baseline.md`.
- Verify: numbers logged.
- Reviewer: Agent #4.
- Depends on: A17-W3-Mon.

**A17-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + StrongBox wrap design
- Done when: StrongBox key-wrap design captured (precursor C-144).
- Output: `docs/team/mobile/strongbox-keywrap-design.md`.
- Verify: design covers `setIsStrongBoxBacked(true)` + biometric-bound key.
- Reviewer: Agents #12, #27.
- Depends on: A17-W3-Tue.

**A17-W3-Thu (2026-06-11)** — Address feedback on C-104 — first pass
- Done when: cryptographer-reviewer comments addressed.
- Output: PR updates.
- Verify: APPROVE secured from at least one sub-agent review.
- Reviewer: Agents #11, #27.
- Depends on: A17-W3-Mon.

**A17-W3-Fri (2026-06-12)** — Status post + enrollment-flow CameraX spike (precursor C-143)
- Done when: spike confirms CameraX face detection on-device.
- Output: `docs/team/mobile/cameramx-spike.md`.
- Verify: capture cycle works on Pixel 7.
- Reviewer: Agent #19.
- Depends on: A17-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A17-W4-Mon (2026-06-15)** — Merge C-104 + post-merge smoke
- Done when: C-104 merged; smoke test re-run on `dev`.
- Output: merge commit.
- Verify: CI green.
- Reviewer: Agent #4.
- Depends on: A17-W3-Thu.

**A17-W4-Tue (2026-06-16)** — Prover latency baseline on multiple SKUs
- Done when: latency measured on Pixel 7 + Samsung S22 + Redmi Note 13.
- Output: contribution to `docs/team/mobile/prover-latency-baseline.md`.
- Verify: numbers logged for 3 SKUs.
- Reviewer: Agent #4.
- Depends on: A17-W4-Mon.

**A17-W4-Wed (2026-06-17)** — BiometricPrompt + StrongBox wrap implementation (precursor C-144)
- Done when: skeleton lands in `mobile/app/src/main/kotlin/dev/zeroauth/keystore/`.
- Output: PR draft.
- Verify: instrumented test asserts key created with `setIsStrongBoxBacked(true)`.
- Reviewer: Agents #4, #12, #27.
- Depends on: A17-W4-Tue.

**A17-W4-Thu (2026-06-18)** — Sprint 1 prover sign-off
- Done when: prover section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-mobile.md`.
- Verify: C-104 merged; prover-latency baseline current.
- Reviewer: Agent #4.
- Depends on: A17-W4-Wed.

**A17-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (C-143 enrollment flow, C-144 keystore, C-146 e2e login).
- Output: `docs/team/mobile/a17-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #4.
- Depends on: A17-W4-Thu.
