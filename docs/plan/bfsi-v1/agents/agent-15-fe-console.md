# Agent #15 — Senior Frontend Engineer (developer console + kiosk demo UI)

**Reports to:** Agent #3.
**Mandate:** Owns developer console + kiosk web app used in Scene 2 of the demo.
**KPIs:** see role 15 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A15-W1-Mon (2026-05-25)** — Developer console SSE auth review
- Done when: console SSE flows reviewed; impact of C-005 captured.
- Output: `docs/team/frontend/console-sse-impact.md`.
- Verify: every console SSE consumer call site listed.
- Reviewer: Agents #3, #7.
- Depends on: A03-W1-Mon.

**A15-W1-Tue (2026-05-26)** — Console signup-to-first-API-call flow audit
- Done when: existing signup flow measured; time-to-first-API-call recorded.
- Output: `docs/team/frontend/console-onboarding-baseline.md`.
- Verify: baseline numbers logged for 3 external testers.
- Reviewer: Agent #31.
- Depends on: A15-W1-Mon.

**A15-W1-Wed (2026-05-27)** — Kiosk web app spec drafted (precursor C-147)
- Done when: spec covers QR generation, SSE consumer, post-verify redirect, latency target.
- Output: `docs/team/frontend/kiosk-spec-v0.md`.
- Verify: spec referenceable from sprint-1 planning.
- Reviewer: Agents #3, #20, #32.
- Depends on: A15-W1-Tue.

**A15-W1-Thu (2026-05-28)** — Review C-005 (access_token query fallback removal) — frontend impact
- Done when: PR reviewed; console SSE migration plan confirmed.
- Output: PR comment on C-005.
- Verify: console consumers ready for cookie-based auth.
- Reviewer: Agents #3, #7.
- Depends on: A15-W1-Wed.

**A15-W1-Fri (2026-05-29)** — Status post + console refactor design draft
- Done when: status posted; console SSE refactor design drafted.
- Output: `docs/team/frontend/console-sse-refactor-design.md`.
- Verify: design parallels dashboard pattern in C-006.
- Reviewer: Agent #3.
- Depends on: A15-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A15-W2-Mon (2026-06-01)** — Console SSE refactor implementation
- Done when: console SSE consumers updated to cookie-based auth.
- Output: PR.
- Verify: console SSE works against C-005 server changes.
- Reviewer: Agent #3.
- Depends on: A15-W1-Fri.

**A15-W2-Tue (2026-06-02)** — Console onboarding flow polish
- Done when: signup → API key → first call flow reduced by ≥ 25 % vs Tuesday's baseline.
- Output: PR.
- Verify: re-measure with 3 external testers.
- Reviewer: Agent #31.
- Depends on: A15-W2-Mon.

**A15-W2-Wed (2026-06-03)** — Kiosk demo design alignment with Agent #32
- Done when: design review session; visual design v0 finalised.
- Output: `docs/team/frontend/kiosk-design-v0.md`.
- Verify: Anchor Bank skin candidate included.
- Reviewer: Agent #32.
- Depends on: A15-W2-Tue.

**A15-W2-Thu (2026-06-04)** — Console docs polish
- Done when: in-app docs (API key panel, usage panel) refreshed.
- Output: PR.
- Verify: doc strings + tooltips current.
- Reviewer: Agent #34.
- Depends on: A15-W2-Wed.

**A15-W2-Fri (2026-06-05)** — Phase 0 console sign-off + status post
- Done when: console SSE refactor merged; onboarding metrics improved.
- Output: row in `docs/team/phase-exits/phase-0-frontend-signoff.md`.
- Verify: SSE works in console without token-in-URL.
- Reviewer: Agent #3.
- Depends on: A15-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A15-W3-Mon (2026-06-08)** — Kiosk skeleton implementation kickoff
- Done when: `dashboard/src/routes/kiosk/` skeleton + routing landed.
- Output: PR draft (precursor C-147).
- Verify: kiosk URL renders a placeholder QR.
- Reviewer: Agent #3.
- Depends on: A15-W2-Fri.

**A15-W3-Tue (2026-06-09)** — QR generator integration in kiosk
- Done when: kiosk generates session-nonce-bound QR.
- Output: PR contribution.
- Verify: QR scannable; payload includes session_nonce + tenant_id + expires_at.
- Reviewer: Agent #20.
- Depends on: A15-W3-Mon.

**A15-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; QR-pairing protocol aligned with mobile.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agents #3, #4.
- Depends on: A15-W3-Tue.

**A15-W3-Thu (2026-06-11)** — Kiosk SSE consumer + redirect-on-verify
- Done when: kiosk consumes SSE event from server; redirects to placeholder net-banking landing on `auth.verify_success`.
- Output: PR contribution.
- Verify: integration smoke against test env.
- Reviewer: Agent #3.
- Depends on: A15-W3-Wed.

**A15-W3-Fri (2026-06-12)** — Status post + demo substitution helper spike
- Done when: spike for "inject attack" toggle in operator console (precursor C-187/C-188).
- Output: `docs/team/frontend/operator-helper-spike.md`.
- Verify: spike captures the operator console UX flow.
- Reviewer: Agent #45.
- Depends on: A15-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A15-W4-Mon (2026-06-15)** — Kiosk skeleton PR review by Agent #3
- Done when: PR pre-review; redirect flow accurate.
- Output: PR comments.
- Verify: SSE reconnect logic captured.
- Reviewer: Agent #3.
- Depends on: A15-W3-Thu.

**A15-W4-Tue (2026-06-16)** — Kiosk demo-day UX run-through with Agent #32
- Done when: visual run-through done; final visual design fixes captured.
- Output: revised design notes.
- Verify: Anchor Bank skin renders correctly on a typical projection.
- Reviewer: Agent #32.
- Depends on: A15-W4-Mon.

**A15-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + dashboard sub-routes for operator helpers
- Done when: routes for `operator/breach-sim` + `operator/audit-tamper-demo` scaffolded.
- Output: PR draft.
- Verify: routes accessible (404 still fine; not yet wired to data).
- Reviewer: Agent #14.
- Depends on: A15-W4-Tue.

**A15-W4-Thu (2026-06-18)** — Sprint 1 kiosk sign-off
- Done when: kiosk skeleton + console refactor merged.
- Output: row in `docs/team/sprint-exits/s1-frontend.md`.
- Verify: kiosk renders end-to-end against test env.
- Reviewer: Agent #3.
- Depends on: A15-W4-Wed.

**A15-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (C-147 kiosk implementation + operator helpers).
- Output: `docs/team/frontend/a15-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #3.
- Depends on: A15-W4-Thu.
