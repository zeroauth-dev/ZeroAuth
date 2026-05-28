# Agent #21 — Senior DevOps / SRE Engineer

**Reports to:** Agent #5.
**Mandate:** Owns VPS infrastructure on `104.207.143.14`, production Postgres + Redis + Caddy + app stack, deploy pipeline, observability.
**KPIs:** see role 21 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A21-W1-Mon (2026-05-25)** — Pair with Agent #22 on C-001 (pre-commit hook + CI mirror)
- Done when: hook + CI mirror specced.
- Output: contribution to `.husky/pre-commit` + `.github/workflows/ci.yml` step.
- Verify: hook design reviewed.
- Reviewer: Agent #5.
- Depends on: A05-W1-Mon.

**A21-W1-Tue (2026-05-26)** — Production observability inventory
- Done when: existing telemetry surfaces inventoried + sinks identified.
- Output: contribution to `docs/team/infra/observability-inventory.md`.
- Verify: covers Winston, Caddy, Postgres, Docker.
- Reviewer: Agent #5.
- Depends on: A21-W1-Mon.

**A21-W1-Wed (2026-05-27)** — Review C-001 implementation
- Done when: PR reviewed; CI mirror step `pre-commit-mirror` green.
- Output: PR comment.
- Verify: hook + mirror enforce all 7 gates.
- Reviewer: Agent #5.
- Depends on: A21-W1-Tue.

**A21-W1-Thu (2026-05-28)** — Deploy pipeline audit
- Done when: `deploy.yml` reviewed step-by-step; risk areas listed.
- Output: `docs/team/infra/deploy-pipeline-audit-w1.md`.
- Verify: each step has reviewer note.
- Reviewer: Agent #5.
- Depends on: A21-W1-Wed.

**A21-W1-Fri (2026-05-29)** — Status post + secret-rotation calendar contribution
- Done when: rotation entries scheduled.
- Output: contribution to `docs/team/infra/secret-rotation-calendar.md`.
- Verify: 5 categories × 4 quarterly entries each.
- Reviewer: Agent #12.
- Depends on: A21-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A21-W2-Mon (2026-06-01)** — Anchor-job cron implementation (C-015)
- Done when: → C-015 PR opened; cron + alert wiring implemented.
- Output: `src/services/anchor-job.ts`.
- Verify: `tests/anchor-job.test.ts::"computes terminal hash and submits to AuditAnchor contract"` green.
- Reviewer: Agents #8, #25.
- Depends on: A21-W1-Fri.

**A21-W2-Tue (2026-06-02)** — Pair with Agent #22 on metric pipeline scaffolding
- Done when: Prometheus + Grafana (or equivalent) deployed in test env.
- Output: `docs/team/infra/metric-pipeline-bootstrap.md`.
- Verify: minimum 3 metrics flowing.
- Reviewer: Agent #5.
- Depends on: A21-W2-Mon.

**A21-W2-Wed (2026-06-03)** — Anchor-job cron deploy to test env
- Done when: cron live in test env; first 24 h of anchor data flowing.
- Output: deploy log.
- Verify: `audit_anchors` table populating daily.
- Reviewer: Agent #5.
- Depends on: A21-W2-Tue.

**A21-W2-Thu (2026-06-04)** — Review C-025 (Postgres session store) — infra impact
- Done when: PR reviewed; Postgres connection-pool sizing confirmed.
- Output: PR comment on C-025.
- Verify: pool size + connection-leak monitor configured.
- Reviewer: Agent #7.
- Depends on: A21-W2-Wed.

**A21-W2-Fri (2026-06-05)** — Phase 0 infra sign-off + status post
- Done when: anchor-job cron live; metric pipeline bootstrapped; deploy pipeline audit closed.
- Output: contribution to `docs/team/phase-exits/phase-0-infra-signoff.md`.
- Verify: each item verified.
- Reviewer: Agent #5.
- Depends on: A21-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A21-W3-Mon (2026-06-08)** — Metric dashboards live in test env
- Done when: verifier-latency + audit-write-lag + anchor-lag panels live.
- Output: dashboard URLs in `docs/team/infra/grafana-dashboards.md`.
- Verify: panels populated.
- Reviewer: Agent #5.
- Depends on: A21-W2-Fri.

**A21-W3-Tue (2026-06-09)** — Physical-device-farm CI runner PoC
- Done when: 1 vendor (e.g., Firebase Test Lab) configured for instrumented test execution.
- Output: `docs/team/infra/device-farm-poc.md`.
- Verify: 1 instrumented test runs successfully.
- Reviewer: Agents #4, #5, #24.
- Depends on: A21-W3-Mon.

**A21-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #5.
- Depends on: A21-W3-Tue.

**A21-W3-Thu (2026-06-11)** — Load-test infra bootstrap (precursor C-191)
- Done when: k6 runner deployed in test env; smoke run 10 RPS for 60 s.
- Output: contribution to `docs/team/infra/load-test-bootstrap.md`.
- Verify: smoke green.
- Reviewer: Agent #23.
- Depends on: A21-W3-Wed.

**A21-W3-Fri (2026-06-12)** — Status post + on-call rotation v0
- Done when: on-call rota for sprint 1 + 2 set up; PagerDuty (or equivalent) wired to severity-1 alerts.
- Output: `docs/operations/on-call-rota.md`.
- Verify: rota covers 24/7.
- Reviewer: Agent #5.
- Depends on: A21-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A21-W4-Mon (2026-06-15)** — Incident-response runbook contribution (with Agent #5)
- Done when: runbook covers severity grid + escalation tree.
- Output: contribution to `docs/operations/incident-response-runbook.md`.
- Verify: cross-references `06-ways-of-working.md`.
- Reviewer: Agent #5.
- Depends on: A21-W3-Fri.

**A21-W4-Tue (2026-06-16)** — Test deploy on staging
- Done when: staging deploy executed; rollback dry run completed.
- Output: contribution to `docs/team/infra/staging-deploy-2026-06-16.md`.
- Verify: rollback successful; MTTD captured.
- Reviewer: Agent #5.
- Depends on: A21-W4-Mon.

**A21-W4-Wed (2026-06-17)** — Observability finalised
- Done when: 3 production-quality dashboards live with 7-day backfill.
- Output: dashboard URLs.
- Verify: each dashboard has expected metrics.
- Reviewer: Agent #5.
- Depends on: A21-W4-Tue.

**A21-W4-Thu (2026-06-18)** — Sprint 1 infra sign-off
- Done when: infra section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: anchor-job + dashboards + device farm PoC all complete.
- Reviewer: Agent #5.
- Depends on: A21-W4-Wed.

**A21-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted.
- Output: `docs/team/infra/a21-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #5.
- Depends on: A21-W4-Thu.
