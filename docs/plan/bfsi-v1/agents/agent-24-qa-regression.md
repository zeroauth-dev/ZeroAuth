# Agent #24 — Mid QA Engineer (regression + manual + bug triage)

**Reports to:** Agent #23.
**Mandate:** Owns regression test plan, manual testing of biometric flows on physical fleet, bug-triage queue.
**KPIs:** see role 24 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A24-W1-Mon (2026-05-25)** — Existing test inventory
- Done when: every test in `tests/` catalogued with what it asserts.
- Output: `docs/team/qa/test-inventory-w1.md`.
- Verify: 50+ tests catalogued.
- Reviewer: Agent #23.
- Depends on: A01-W1-Mon.

**A24-W1-Tue (2026-05-26)** — Device-fleet manual-test plan v0
- Done when: per-SKU manual test checklist drafted.
- Output: `docs/team/qa/device-fleet-manual-test-plan.md`.
- Verify: covers tier-1 SKUs.
- Reviewer: Agent #4.
- Depends on: A24-W1-Mon.

**A24-W1-Wed (2026-05-27)** — Bug-triage queue setup
- Done when: triage queue configured in tracker; SLAs documented.
- Output: `docs/team/qa/bug-triage-process.md`.
- Verify: queue accessible; SLA dashboard live.
- Reviewer: Agent #23.
- Depends on: A24-W1-Tue.

**A24-W1-Thu (2026-05-28)** — Regression run on staging — current state
- Done when: existing 50 tests executed on staging; results logged.
- Output: `docs/team/qa/regression-run-2026-05-28.md`.
- Verify: pass/fail recorded per test.
- Reviewer: Agent #23.
- Depends on: A24-W1-Wed.

**A24-W1-Fri (2026-05-29)** — Status post + manual test of demo-bypass-removal (C-004)
- Done when: manual verification on staging confirms `did:zeroauth:demo:*` paths now rejected.
- Output: `docs/team/qa/demo-bypass-manual-verify.md`.
- Verify: every demo-DID path tested manually + rejected.
- Reviewer: Agent #6.
- Depends on: A24-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A24-W2-Mon (2026-06-01)** — Manual test of new validators (C-022)
- Done when: zod-validated endpoints manually exercised with malformed payloads.
- Output: `docs/team/qa/validator-manual-test.md`.
- Verify: 12 malformed-payload scenarios tested.
- Reviewer: Agent #6.
- Depends on: A24-W1-Fri.

**A24-W2-Tue (2026-06-02)** — Manual test of Postgres session store (C-025)
- Done when: cross-restart persistence verified manually.
- Output: `docs/team/qa/session-store-manual-test.md`.
- Verify: session survives restart on staging.
- Reviewer: Agent #7.
- Depends on: A24-W2-Mon.

**A24-W2-Wed (2026-06-03)** — Manual test of rate-limit (C-026)
- Done when: rate-limit triggered via hammer test; recovery verified.
- Output: `docs/team/qa/rate-limit-manual-test.md`.
- Verify: 429 returned after threshold; resets after window.
- Reviewer: Agent #7.
- Depends on: A24-W2-Tue.

**A24-W2-Thu (2026-06-04)** — Regression checklist for Phase 0 exit
- Done when: checklist drafted with go/no-go criteria.
- Output: `docs/team/qa/phase-0-exit-regression-checklist.md`.
- Verify: every closed P0 finding has a check.
- Reviewer: Agents #23, #26.
- Depends on: A24-W2-Wed.

**A24-W2-Fri (2026-06-05)** — Phase 0 regression run + status post
- Done when: full regression on staging green; checklist signed off.
- Output: `docs/team/qa/phase-0-regression-2026-06-05.md`.
- Verify: 50/50 tests + new tests green.
- Reviewer: Agent #23.
- Depends on: A24-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A24-W3-Mon (2026-06-08)** — Mobile device-fleet manual smoke
- Done when: emulator-based smoke of enrollment flow performed on 3 SKUs.
- Output: `docs/team/qa/mobile-smoke-2026-06-08.md`.
- Verify: enrollment Compose previews render correctly on all 3.
- Reviewer: Agent #4.
- Depends on: A04-W3-Mon.

**A24-W3-Tue (2026-06-09)** — Manual test of cookie-based SSE auth in browser
- Done when: SSE flow verified on Chrome + Edge + Safari + Firefox.
- Output: `docs/team/qa/sse-cross-browser.md`.
- Verify: all 4 browsers green.
- Reviewer: Agent #14.
- Depends on: A24-W3-Mon.

**A24-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #23.
- Depends on: A24-W3-Tue.

**A24-W3-Thu (2026-06-11)** — Bug-triage SLA dashboard v1
- Done when: dashboard shows P0/P1/P2 counts + age.
- Output: dashboard URL.
- Verify: live data visible.
- Reviewer: Agent #23.
- Depends on: A24-W3-Wed.

**A24-W3-Fri (2026-06-12)** — Status post + device-test matrix v1
- Done when: device-test matrix v1 with verified rows for 3 SKUs.
- Output: `docs/team/qa/device-test-matrix-v1.md`.
- Verify: each row has manual test status.
- Reviewer: Agents #4, #23.
- Depends on: A24-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A24-W4-Mon (2026-06-15)** — Manual test of identity register (C-105) — happy path
- Done when: happy-path enrollment manually performed against test env from emulator with fake attestation.
- Output: `docs/team/qa/identity-register-manual-test.md`.
- Verify: DID registered + audit row visible.
- Reviewer: Agent #6.
- Depends on: A06-W4-Mon.

**A24-W4-Tue (2026-06-16)** — Manual test of identity register — adversarial paths
- Done when: 5 negative paths verified (no attestation, expired verdict, tampered chain, replayed nonce, wrong tenant).
- Output: contribution to `docs/team/qa/identity-register-manual-test.md`.
- Verify: each negative path returns expected error.
- Reviewer: Agents #6, #26.
- Depends on: A24-W4-Mon.

**A24-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + dashboard users-view manual test
- Done when: users view manually verified to render only allowed columns.
- Output: `docs/team/qa/users-view-manual-test.md`.
- Verify: no PII shown.
- Reviewer: Agent #14.
- Depends on: A24-W4-Tue.

**A24-W4-Thu (2026-06-18)** — Sprint 1 QA regression
- Done when: regression run on staging post-S1; all green.
- Output: `docs/team/qa/sprint-1-regression-2026-06-18.md`.
- Verify: every closed sprint-1 commit has a regression check.
- Reviewer: Agent #23.
- Depends on: A24-W4-Wed.

**A24-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (mobile prover device-fleet smoke + audit-integrity manual tests).
- Output: `docs/team/qa/a24-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #23.
- Depends on: A24-W4-Thu.
