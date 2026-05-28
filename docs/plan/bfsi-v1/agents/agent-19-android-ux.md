# Agent #19 — Mid Android Engineer (UX + flows + state)

**Reports to:** Agent #4.
**Mandate:** Owns enrollment flow UI, login flow UI, transaction-confirmation sheet, in-app QR scanner, error states.
**KPIs:** see role 19 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A19-W1-Mon (2026-05-25)** — Enrollment flow Compose mockup
- Done when: enrollment screens drafted in Compose (preview-only, no live data).
- Output: `mobile/app/src/main/kotlin/dev/zeroauth/enrollment/` Compose previews.
- Verify: previews render in Android Studio.
- Reviewer: Agent #33.
- Depends on: A04-W1-Mon.

**A19-W1-Tue (2026-05-26)** — Navigation graph drafted
- Done when: nav graph for enrollment → login → txn confirmation flows landed.
- Output: `mobile/app/src/main/kotlin/dev/zeroauth/nav/`.
- Verify: NavHost compiles + previews show transitions.
- Reviewer: Agent #4.
- Depends on: A19-W1-Mon.

**A19-W1-Wed (2026-05-27)** — Login flow Compose mockup
- Done when: login screens drafted in Compose.
- Output: Compose previews.
- Verify: previews render.
- Reviewer: Agent #33.
- Depends on: A19-W1-Tue.

**A19-W1-Thu (2026-05-28)** — Permission request flow design
- Done when: camera + biometric + USB permission flow drafted.
- Output: `docs/team/mobile/permission-flow-design.md`.
- Verify: flow covers permission-denied paths.
- Reviewer: Agent #33.
- Depends on: A19-W1-Wed.

**A19-W1-Fri (2026-05-29)** — Status post + error-state matrix kickoff
- Done when: top-20 error states identified (capture fail, network fail, biometric fail, expired session, attestation fail, etc.).
- Output: `docs/team/mobile/error-state-matrix.md` v0.
- Verify: 20 rows.
- Reviewer: Agents #4, #33.
- Depends on: A19-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A19-W2-Mon (2026-06-01)** — In-app QR scanner skeleton
- Done when: scanner module skeleton with ML Kit Barcode Scanning landed.
- Output: `mobile/app/src/main/kotlin/dev/zeroauth/scanner/`.
- Verify: scanner reads a test QR.
- Reviewer: Agent #4.
- Depends on: A19-W1-Fri.

**A19-W2-Tue (2026-06-02)** — QR payload parsing
- Done when: parser extracts session_nonce, tenant_id, expires_at, environment.
- Output: PR.
- Verify: malformed QR rejected.
- Reviewer: Agent #4.
- Depends on: A19-W2-Mon.

**A19-W2-Wed (2026-06-03)** — Permission flow implementation
- Done when: camera + biometric + USB permission paths wired.
- Output: PR.
- Verify: permission-denied paths show fallback screens.
- Reviewer: Agent #33.
- Depends on: A19-W2-Tue.

**A19-W2-Thu (2026-06-04)** — Mobile crash + ANR telemetry pipeline design (precursor C-150)
- Done when: telemetry payload schema designed; allowlist of fields confirmed (no PII, no biometric data).
- Output: `docs/team/mobile/telemetry-schema-design.md`.
- Verify: allowlist enforced.
- Reviewer: Agents #4, #39.
- Depends on: A19-W2-Wed.

**A19-W2-Fri (2026-06-05)** — Phase 0 UX sign-off + status post
- Done when: Compose mockups + permission flow + QR scanner skeleton merged.
- Output: row in `docs/team/phase-exits/phase-0-mobile-signoff.md`.
- Verify: previews render + smoke build green.
- Reviewer: Agent #4.
- Depends on: A19-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A19-W3-Mon (2026-06-08)** — Mobile device-fleet onboarding
- Done when: enrollment Compose preview running on 3 SKUs (Pixel 7 + S22 + Redmi Note 13).
- Output: instrumented test runs.
- Verify: previews render on all 3.
- Reviewer: Agent #4.
- Depends on: A19-W2-Fri.

**A19-W3-Tue (2026-06-09)** — Transaction-confirmation sheet design
- Done when: sheet drafted in Compose with Indian numbering format + masked account.
- Output: Compose previews.
- Verify: previews show ₹5,00,000 formatted correctly + masked A/c.
- Reviewer: Agent #33.
- Depends on: A19-W3-Mon.

**A19-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #4.
- Depends on: A19-W3-Tue.

**A19-W3-Thu (2026-06-11)** — Error states implementation — first 10 of 20
- Done when: first 10 error states implemented as Compose screens.
- Output: PR.
- Verify: previews exist for each.
- Reviewer: Agent #33.
- Depends on: A19-W3-Wed.

**A19-W3-Fri (2026-06-12)** — Status post + logcat audit infra (no PII in logs)
- Done when: instrumented test verifies logcat contains no raw biometric / no DID / no commitment.
- Output: PR for logcat audit test.
- Verify: test green.
- Reviewer: Agent #39.
- Depends on: A19-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A19-W4-Mon (2026-06-15)** — Error states implementation — remaining 10
- Done when: remaining 10 error states implemented as Compose screens.
- Output: PR.
- Verify: previews exist.
- Reviewer: Agent #33.
- Depends on: A19-W3-Thu.

**A19-W4-Tue (2026-06-16)** — Transaction-confirmation sheet expiry countdown UX
- Done when: countdown timer + auto-cancel behaviour implemented.
- Output: PR contribution.
- Verify: instrumented test confirms auto-cancel on expiry.
- Reviewer: Agent #33.
- Depends on: A19-W3-Tue.

**A19-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + crash telemetry pipeline implementation
- Done when: telemetry pipeline skeleton landed; allowlist filter in place.
- Output: PR (precursor to C-150).
- Verify: instrumented test asserts payload allowlist.
- Reviewer: Agent #39.
- Depends on: A19-W4-Tue.

**A19-W4-Thu (2026-06-18)** — Sprint 1 UX sign-off
- Done when: UX section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-mobile.md`.
- Verify: 20 error states implemented + permission flow live.
- Reviewer: Agent #4.
- Depends on: A19-W4-Wed.

**A19-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (C-143 enrollment full flow + C-145 QR scanner production).
- Output: `docs/team/mobile/a19-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #4.
- Depends on: A19-W4-Thu.
