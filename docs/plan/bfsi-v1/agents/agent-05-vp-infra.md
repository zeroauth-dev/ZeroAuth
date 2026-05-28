# Agent #5 — VP Engineering, Infrastructure / SRE

**Reports to:** Agent #1.
**Mandate:** Owns VPS infrastructure, Docker stack, Caddy reverse proxy, deploy pipeline, CVE response, observability.
**KPIs:** see role 5 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A05-W1-Mon (2026-05-25)** — Infra team kickoff + observability inventory
- Done when: existing telemetry surfaces inventoried (Winston logs, Caddy access, Postgres slow query log, Docker stats).
- Output: `docs/team/infra/observability-inventory.md`.
- Verify: inventory covers all 4 telemetry sources.
- Reviewer: Agent #1, Agent #21, Agent #22.
- Depends on: A01-W1-Mon.

**A05-W1-Tue (2026-05-26)** — Co-design pre-commit hook + CI mirror with Agent #22
- Done when: hook spec + CI-mirror spec aligned.
- Output: `docs/team/infra/pre-commit-spec.md`.
- Verify: covers all 7 violation patterns in `06-ways-of-working.md`.
- Reviewer: Agent #22.
- Depends on: A05-W1-Mon.

**A05-W1-Wed (2026-05-27)** — Review C-001 (pre-commit hook PR)
- Done when: PR reviewed; CI mirror step `pre-commit-mirror` confirmed.
- Output: PR comment on C-001.
- Verify: `scripts/test-pre-commit.sh` green.
- Reviewer: Agent #1.
- Depends on: A05-W1-Tue.

**A05-W1-Thu (2026-05-28)** — Secret-rotation calendar drafted
- Done when: JWT, SESSION, ADMIN, BLOCKCHAIN secrets each have a quarterly rotation date.
- Output: `docs/team/infra/secret-rotation-calendar.md`.
- Verify: calendar entries scheduled in Google Calendar with infra-on-call invited.
- Reviewer: Agent #12.
- Depends on: A05-W1-Wed.

**A05-W1-Fri (2026-05-29)** — Friday status + deploy-pipeline audit kickoff
- Done when: Agent #21, Agent #22 statuses read; deploy-pipeline audit started.
- Output: `docs/team/infra/deploy-pipeline-audit-w1.md`.
- Verify: workflow inventory + step-level review begun.
- Reviewer: Agent #1.
- Depends on: A05-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A05-W2-Mon (2026-06-01)** — Co-design anchor-job cron with Agent #21
- Done when: CronCreate-managed daily anchor schedule reviewed; 00:30 IST confirmed; failure-alert path agreed.
- Output: `docs/team/infra/anchor-job-spec.md`.
- Verify: spec referenced by C-015 PR.
- Reviewer: Agent #21, Agent #25.
- Depends on: A05-W1-Fri.

**A05-W2-Tue (2026-06-02)** — Review C-015 (anchor-job cron)
- Done when: PR reviewed; alert wiring confirmed.
- Output: PR comment on C-015.
- Verify: `tests/anchor-job.test.ts` green against Hardhat fork.
- Reviewer: Agent #25.
- Depends on: A05-W2-Mon.

**A05-W2-Wed (2026-06-03)** — Review C-032 (CVE monitor workflow)
- Done when: workflow reviewed; dry-run alert delivered to security mailing list.
- Output: PR comment on C-032.
- Verify: dry-run workflow run link recorded.
- Reviewer: Agent #22, Agent #26.
- Depends on: C-032 opened.

**A05-W2-Thu (2026-06-04)** — Metric pipeline plan
- Done when: metric sinks chosen (Prometheus + Grafana or hosted equivalent); verifier-latency + audit-write-lag + anchor-lag metrics specced.
- Output: `docs/team/infra/metric-pipeline-plan.md`.
- Verify: each of 3 metrics has source, sink, dashboard, alert thresholds.
- Reviewer: Agent #21.
- Depends on: A05-W2-Wed.

**A05-W2-Fri (2026-06-05)** — Phase 0 infra exit sign-off + status read
- Done when: infra section of Phase 0 exit gate green.
- Output: `docs/team/phase-exits/phase-0-infra-signoff.md`.
- Verify: pre-commit hook + CVE monitor live; secret-rotation calendar published.
- Reviewer: Agent #1.
- Depends on: A05-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A05-W3-Mon (2026-06-08)** — SLA monitoring stack provisioning in test env
- Done when: Grafana dashboard live in test env with 3 metric panels.
- Output: dashboard URL recorded in `docs/team/infra/grafana-dashboards.md`.
- Verify: panels populated with at least 24 h of data by Friday.
- Reviewer: Agent #21.
- Depends on: A05-W2-Thu.

**A05-W3-Tue (2026-06-09)** — Device-fleet CI runner plan
- Done when: physical-device-farm CI runner architecture documented (Firebase Test Lab vs local fleet vs BrowserStack-Android).
- Output: `docs/team/infra/device-fleet-runner-plan.md`.
- Verify: vendor short-list + cost comparison + 2-vendor PoC plan.
- Reviewer: Agent #4, Agent #21, Agent #24.
- Depends on: A05-W3-Mon.

**A05-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; mobile CI runner integration confirmed for sprint 2.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A05-W3-Tue.

**A05-W3-Thu (2026-06-11)** — Load-test infra scaffolding (precursor to C-191)
- Done when: k6 runner infra in test env stood up; smoke load test executed.
- Output: `docs/team/infra/load-test-bootstrap.md`.
- Verify: smoke 10 RPS for 60 s green.
- Reviewer: Agent #23.
- Depends on: A05-W3-Wed.

**A05-W3-Fri (2026-06-12)** — Friday status + mid-sprint infra health
- Done when: 2 infra agent statuses read; risks logged.
- Output: `docs/team/infra/s1-mid-health.md`.
- Verify: risks colour-coded; alerting wired.
- Reviewer: Agent #1.
- Depends on: A05-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A05-W4-Mon (2026-06-15)** — Incident-response runbook v1
- Done when: runbook drafted with severity grid + escalation tree + on-call rota.
- Output: `docs/operations/incident-response-runbook.md`.
- Verify: cross-references `06-ways-of-working.md` escalation matrix.
- Reviewer: Agent #21, Agent #40.
- Depends on: A05-W3-Fri.

**A05-W4-Tue (2026-06-16)** — Test deploy on staging environment
- Done when: full deploy pipeline executed on staging; rollback exercise dry-run completed.
- Output: `docs/team/infra/staging-deploy-2026-06-16.md`.
- Verify: rollback exercise log captured; MTTD measured.
- Reviewer: Agent #21.
- Depends on: A05-W4-Mon.

**A05-W4-Wed (2026-06-17)** — Observability dashboards finalised
- Done when: 3 production-quality dashboards (verifier latency, audit-write lag, anchor lag) live + linked from on-call runbook.
- Output: dashboard URLs in `docs/team/infra/grafana-dashboards.md`.
- Verify: each dashboard has 7-day backfill.
- Reviewer: Agent #21.
- Depends on: A05-W4-Tue.

**A05-W4-Thu (2026-06-18)** — Sprint 1 infra exit sign-off
- Done when: infra section of S1 exit gate green.
- Output: `docs/team/sprint-exits/s1-infra.md`.
- Verify: dashboards + runbook + CI device runner spec all referenced.
- Reviewer: Agent #1.
- Depends on: A01-W4-Thu.

**A05-W4-Fri (2026-06-19)** — Sprint 2 dispatch + status read
- Done when: sprint-2 daily tickets generated for Agents #21, #22.
- Output: `docs/team/infra/sprint-2-daily-dispatch.md`.
- Verify: each agent has 5 daily tickets for week 5.
- Reviewer: Agent #1.
- Depends on: A05-W4-Thu.
