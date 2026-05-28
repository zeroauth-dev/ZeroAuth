# Agent #20 — Senior IoT Engineer (kiosk + bridge)

**Reports to:** Agent #4.
**Mandate:** Owns IoT bridge (kiosk gateway), SSE back-channel, QR pairing protocol on the bridge side.
**KPIs:** see role 20 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A20-W1-Mon (2026-05-25)** — IoT bridge runbook review
- Done when: existing `docs/operations/demo-runbook.md` reviewed; gaps for production-quality bridge listed.
- Output: `docs/team/iot/bridge-runbook-gap-analysis.md`.
- Verify: 10+ gap items listed.
- Reviewer: Agents #4, #5.
- Depends on: A04-W1-Mon.

**A20-W1-Tue (2026-05-26)** — Bridge architecture audit
- Done when: current bridge implementation in `iot/` reviewed; SSE consumer + QR generator paths mapped.
- Output: `docs/team/iot/bridge-architecture-audit.md`.
- Verify: every code path reviewed.
- Reviewer: Agents #4, #5.
- Depends on: A20-W1-Mon.

**A20-W1-Wed (2026-05-27)** — SSE reconnect strategy design
- Done when: design covers exponential backoff, max reconnect window, fallback to polling.
- Output: `docs/team/iot/sse-reconnect-design.md`.
- Verify: design reviewable.
- Reviewer: Agents #4, #15.
- Depends on: A20-W1-Tue.

**A20-W1-Thu (2026-05-28)** — Bridge audit-event reconciliation design (precursor)
- Done when: cross-check protocol between bridge audit events and server audit events designed.
- Output: `docs/team/iot/audit-reconciliation-design.md`.
- Verify: design covers eventual consistency window + alert threshold.
- Reviewer: Agents #4, #8.
- Depends on: A20-W1-Wed.

**A20-W1-Fri (2026-05-29)** — Status post + bridge runbook v0 update
- Done when: runbook updated with gap analysis closure plan.
- Output: PR for `docs/operations/demo-runbook.md` update.
- Verify: closure plan items have owners.
- Reviewer: Agent #4.
- Depends on: A20-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A20-W2-Mon (2026-06-01)** — Bridge SSE reconnect implementation
- Done when: exponential backoff + fallback wired.
- Output: PR.
- Verify: `iot/src/central-api.test.ts` updated to cover reconnect path; green.
- Reviewer: Agent #4.
- Depends on: A20-W1-Fri.

**A20-W2-Tue (2026-06-02)** — Bridge resilience tests
- Done when: tests simulate network blip, server restart, bridge restart, QR expiry.
- Output: PR for resilience test suite.
- Verify: all 4 scenarios green.
- Reviewer: Agent #23.
- Depends on: A20-W2-Mon.

**A20-W2-Wed (2026-06-03)** — Bridge audit-event reconciliation implementation start
- Done when: bridge writes a row to a local journal; reconciliation job designed.
- Output: PR draft.
- Verify: journal entries align with server audit-row IDs.
- Reviewer: Agent #8.
- Depends on: A20-W2-Tue.

**A20-W2-Thu (2026-06-04)** — Bridge observability metrics
- Done when: bridge emits metrics for pairing latency, SSE drop rate, error rate.
- Output: PR.
- Verify: metrics visible in Grafana.
- Reviewer: Agent #21.
- Depends on: A20-W2-Wed.

**A20-W2-Fri (2026-06-05)** — Phase 0 bridge sign-off + status post
- Done when: bridge reconnect + observability merged.
- Output: row in `docs/team/phase-exits/phase-0-mobile-signoff.md`.
- Verify: bridge resilient against 4 scenarios.
- Reviewer: Agent #4.
- Depends on: A20-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A20-W3-Mon (2026-06-08)** — Pair with Agent #15 on QR-pairing protocol alignment
- Done when: kiosk + bridge QR format aligned with mobile QR format (Agent #19).
- Output: `docs/team/iot/qr-pairing-alignment.md`.
- Verify: payload schema versioned + documented.
- Reviewer: Agent #4.
- Depends on: A20-W2-Fri.

**A20-W3-Tue (2026-06-09)** — Bridge audit-event reconciliation cross-check CI
- Done when: CI step compares bridge journal vs server audit_events for test env nightly run.
- Output: PR.
- Verify: dry-run green.
- Reviewer: Agents #8, #22.
- Depends on: A20-W3-Mon.

**A20-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #4.
- Depends on: A20-W3-Tue.

**A20-W3-Thu (2026-06-11)** — Bridge end-to-end pairing latency baseline
- Done when: bridge p95 pairing latency measured on staged kiosk.
- Output: `docs/team/iot/bridge-latency-baseline.md`.
- Verify: p95 ≤ 2 s (target).
- Reviewer: Agent #21.
- Depends on: A20-W3-Wed.

**A20-W3-Fri (2026-06-12)** — Status post + bridge 24-hour burn-in start
- Done when: bridge running for 24 h with no restart on staging kiosk; metric capture live.
- Output: burn-in start log.
- Verify: monitor confirms uptime.
- Reviewer: Agent #21.
- Depends on: A20-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A20-W4-Mon (2026-06-15)** — Bridge 24-hour burn-in result review
- Done when: burn-in result reviewed; failure modes (if any) documented.
- Output: `docs/team/iot/bridge-burn-in-2026-06-15.md`.
- Verify: 24-hour metric trace logged.
- Reviewer: Agents #4, #21.
- Depends on: A20-W3-Fri.

**A20-W4-Tue (2026-06-16)** — Bridge security audit (with Agent #26)
- Done when: bridge attack surface mapped; mitigations against MITM, tampering, replay reviewed.
- Output: `docs/team/iot/bridge-security-audit.md`.
- Verify: each surface has a mitigation.
- Reviewer: Agent #26.
- Depends on: A20-W4-Mon.

**A20-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + bridge config-management
- Done when: per-tenant bridge config + secret rotation cadence designed.
- Output: `docs/team/iot/bridge-config-design.md`.
- Verify: config covers tenant-id, webhook URL, signing keys.
- Reviewer: Agent #7.
- Depends on: A20-W4-Tue.

**A20-W4-Thu (2026-06-18)** — Sprint 1 bridge sign-off
- Done when: bridge section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-mobile.md`.
- Verify: burn-in passed + reconciliation CI green.
- Reviewer: Agent #4.
- Depends on: A20-W4-Wed.

**A20-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (bridge hardening, multi-bridge config).
- Output: `docs/team/iot/a20-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #4.
- Depends on: A20-W4-Thu.
