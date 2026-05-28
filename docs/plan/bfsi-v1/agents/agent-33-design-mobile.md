# Agent #33 — Designer (Mobile UX)

**Reports to:** Agent #28.
**Mandate:** Owns Android app UX — enrollment, login, transaction-confirmation, error states.
**KPIs:** see role 33 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A33-W1-Mon (2026-05-25)** — Enrollment flow Figma file v1
- Done when: enrollment flow (CameraX face → BiometricPrompt / R307 → Aadhaar consent → success) designed.
- Output: Figma file.
- Verify: 5 screens captured.
- Reviewer: Agent #19.
- Depends on: A28-W1-Mon.

**A33-W1-Tue (2026-05-26)** — Login flow Figma file
- Done when: QR scan → biometric confirm → redirect designed.
- Output: Figma file.
- Verify: 3 screens captured.
- Reviewer: Agent #19.
- Depends on: A33-W1-Mon.

**A33-W1-Wed (2026-05-27)** — Indian-numbering format treatment for amount field
- Done when: ₹5,00,000 style format specified in design tokens.
- Output: `docs/team/design/mobile/amount-format-spec.md`.
- Verify: matches Indian regional conventions.
- Reviewer: Agent #19.
- Depends on: A33-W1-Tue.

**A33-W1-Thu (2026-05-28)** — Permission flow visual design
- Done when: camera + biometric + USB permission screens designed.
- Output: Figma file.
- Verify: permission-denied state covered.
- Reviewer: Agent #19.
- Depends on: A33-W1-Wed.

**A33-W1-Fri (2026-05-29)** — Status post + error-state coverage v0
- Done when: 20 error states designed at low-fi level.
- Output: Figma file.
- Verify: 20 states captured.
- Reviewer: Agent #19.
- Depends on: A33-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A33-W2-Mon (2026-06-01)** — Transaction-confirmation sheet Figma file
- Done when: sheet with amount, payee, account, expiry countdown designed.
- Output: Figma file.
- Verify: covers Confirm / Cancel paths.
- Reviewer: Agent #19.
- Depends on: A33-W1-Fri.

**A33-W2-Tue (2026-06-02)** — Mobile dark-mode + light-mode variants
- Done when: each screen has a dark + light variant.
- Output: Figma updates.
- Verify: contrast ratios checked.
- Reviewer: Agent #19.
- Depends on: A33-W2-Mon.

**A33-W2-Wed (2026-06-03)** — Telemetry consent UI design
- Done when: opt-in toggle + privacy nudge designed.
- Output: Figma file.
- Verify: complies with DPDP consent best practices.
- Reviewer: Agents #19, #39.
- Depends on: A33-W2-Tue.

**A33-W2-Thu (2026-06-04)** — Usability test plan v0
- Done when: usability test plan for enrollment + login flows drafted.
- Output: `docs/team/design/mobile/usability-test-plan-v0.md`.
- Verify: protocol covers task completion time + error rate.
- Reviewer: Agent #28.
- Depends on: A33-W2-Wed.

**A33-W2-Fri (2026-06-05)** — Phase 0 mobile design sign-off + status post
- Done when: enrollment + login + txn + 20 error states designed.
- Output: row in Phase 0 exit doc.
- Verify: assets accessible.
- Reviewer: Agent #28.
- Depends on: A33-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A33-W3-Mon (2026-06-08)** — Internal usability test run #1 (enrollment)
- Done when: 3 testers run through enrollment Figma prototype.
- Output: `docs/team/design/mobile/usability-test-2026-06-08.md`.
- Verify: completion time + error log captured.
- Reviewer: Agent #28.
- Depends on: A33-W2-Fri.

**A33-W3-Tue (2026-06-09)** — Internal usability test run #2 (login)
- Done when: 3 testers run through login Figma prototype.
- Output: `docs/team/design/mobile/usability-test-2026-06-09.md`.
- Verify: completion time + error log captured.
- Reviewer: Agent #28.
- Depends on: A33-W3-Mon.

**A33-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + design iterate
- Done when: top-5 usability findings applied to designs.
- Output: Figma updates.
- Verify: revisions committed.
- Reviewer: Agent #28.
- Depends on: A33-W3-Tue.

**A33-W3-Thu (2026-06-11)** — Mobile error-state implementation review (with Agent #19)
- Done when: design hand-off for first 10 error states.
- Output: handover notes.
- Verify: developer-confirmed.
- Reviewer: Agent #19.
- Depends on: A33-W3-Wed.

**A33-W3-Fri (2026-06-12)** — Status post + mobile accessibility audit kickoff
- Done when: screen-reader + large-font audit kicked off on initial screens.
- Output: `docs/team/design/mobile/a11y-audit-w3.md`.
- Verify: audit checklist set up.
- Reviewer: Agent #19.
- Depends on: A33-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A33-W4-Mon (2026-06-15)** — Mobile error-state second batch hand-off
- Done when: design hand-off for remaining 10 error states.
- Output: handover notes.
- Verify: developer-confirmed.
- Reviewer: Agent #19.
- Depends on: A33-W3-Thu.

**A33-W4-Tue (2026-06-16)** — Transaction-confirmation sheet expiry countdown UX (with Agent #19)
- Done when: countdown UX behaviour reviewed; final design captured.
- Output: Figma updates.
- Verify: revisions committed.
- Reviewer: Agent #19.
- Depends on: A33-W4-Mon.

**A33-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + Hindi UI strings spec
- Done when: Hindi-translation spec drafted (which strings translate, which remain English).
- Output: `docs/team/design/mobile/i18n-strings-spec.md`.
- Verify: covers 25 highest-impact strings.
- Reviewer: Agent #19.
- Depends on: A33-W4-Tue.

**A33-W4-Thu (2026-06-18)** — Sprint 1 mobile design sign-off
- Done when: design section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: usability tests run + iterations applied.
- Reviewer: Agent #28.
- Depends on: A28-W4-Thu.

**A33-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (R307 capture screens, txn sheet polish).
- Output: `docs/team/design/mobile/a33-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #28.
- Depends on: A33-W4-Thu.
