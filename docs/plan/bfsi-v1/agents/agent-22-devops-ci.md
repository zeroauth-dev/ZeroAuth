# Agent #22 — Mid DevOps Engineer (CI/CD + observability)

**Reports to:** Agent #21.
**Mandate:** Owns GitHub Actions pipelines, pre-commit hooks, CVE monitor, structured logging via Winston, metrics pipeline.
**KPIs:** see role 22 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A22-W1-Mon (2026-05-25)** — Implement C-001 (pre-commit hook) — first half
- Done when: `.husky/pre-commit` with first 4 gates (tsc, eslint, jest findRelatedTests, secret scan) wired.
- Output: PR draft for C-001.
- Verify: hook runs on a stage with a violation.
- Reviewer: Agents #5, #21.
- Depends on: A05-W1-Tue.

**A22-W1-Tue (2026-05-26)** — Implement C-001 — remaining 3 gates (biometric-key scan, ADR-trail scan, commit-msg gate)
- Done when: all 7 gates wired.
- Output: C-001 PR.
- Verify: `scripts/test-pre-commit.sh` green.
- Reviewer: Agent #21.
- Depends on: A22-W1-Mon.

**A22-W1-Wed (2026-05-27)** — CI mirror of pre-commit gates
- Done when: `.github/workflows/ci.yml` adds `pre-commit-mirror` step.
- Output: PR.
- Verify: CI run on a violating branch fails.
- Reviewer: Agent #21.
- Depends on: A22-W1-Tue.

**A22-W1-Thu (2026-05-28)** — CVE monitor workflow design (precursor C-032)
- Done when: workflow design captures `npm audit`, `osv-scanner`, GitHub Dependabot signal.
- Output: `docs/team/infra/cve-monitor-design.md`.
- Verify: covers cadence, alert channel, suppression policy.
- Reviewer: Agents #21, #26.
- Depends on: A22-W1-Wed.

**A22-W1-Fri (2026-05-29)** — Status post + commit-msg gate test on PR titles
- Done when: lint workflow rejects PR titles with `feat:`/`fix:`/`WIP`/`[]` prefixes.
- Output: PR.
- Verify: workflow rejects on a violating PR title.
- Reviewer: Agent #21.
- Depends on: A22-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A22-W2-Mon (2026-06-01)** — CVE monitor workflow implementation (C-032)
- Done when: → C-032 PR opened; workflow runs nightly; dry-run alert verified.
- Output: `.github/workflows/cve-monitor.yml`.
- Verify: dry-run with a known-vulnerable lockfile fires alert.
- Reviewer: Agents #21, #26.
- Depends on: A22-W1-Fri.

**A22-W2-Tue (2026-06-02)** — Pair with Agent #21 on metric pipeline scaffolding
- Done when: Prometheus exporters + Grafana dashboards stood up.
- Output: contribution to `docs/team/infra/metric-pipeline-bootstrap.md`.
- Verify: 3 metrics flowing.
- Reviewer: Agent #21.
- Depends on: A22-W2-Mon.

**A22-W2-Wed (2026-06-03)** — eslint rule: ban direct `audit_events` INSERT
- Done when: custom eslint rule landed.
- Output: PR.
- Verify: rule catches a planted violation.
- Reviewer: Agents #8, #21.
- Depends on: A22-W2-Tue.

**A22-W2-Thu (2026-06-04)** — eslint rule: ban `Co-Authored-By: Claude` trailer
- Done when: commit-msg hook + CI step block any commit with the trailer.
- Output: PR.
- Verify: planted commit message rejected.
- Reviewer: Agent #1.
- Depends on: A22-W2-Wed.

**A22-W2-Fri (2026-06-05)** — Phase 0 CI sign-off + status post
- Done when: pre-commit + CI mirror + CVE monitor + custom lint rules merged.
- Output: contribution to `docs/team/phase-exits/phase-0-infra-signoff.md`.
- Verify: gates active.
- Reviewer: Agents #5, #21.
- Depends on: A22-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A22-W3-Mon (2026-06-08)** — CI matrix audit
- Done when: every workflow audited for `--no-verify` overrides + secret-leaks.
- Output: `docs/team/infra/ci-matrix-audit.md`.
- Verify: 100 % workflow coverage.
- Reviewer: Agents #21, #26.
- Depends on: A22-W2-Fri.

**A22-W3-Tue (2026-06-09)** — CI median wall-clock measurement
- Done when: CI wall-clock median measured over last 30 runs.
- Output: `docs/team/infra/ci-perf-baseline.md`.
- Verify: median + p95 reported.
- Reviewer: Agent #21.
- Depends on: A22-W3-Mon.

**A22-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + Docker layer-cache audit
- Done when: Docker layer cache reviewed; opportunities for speedup listed.
- Output: `docs/team/infra/docker-cache-audit.md`.
- Verify: top 3 speedup opportunities documented.
- Reviewer: Agent #5.
- Depends on: A22-W3-Tue.

**A22-W3-Thu (2026-06-11)** — CI flakiness report
- Done when: top-5 flaky tests identified; tickets opened.
- Output: `docs/team/infra/ci-flakiness-2026-06-11.md`.
- Verify: each flaky test has an owner.
- Reviewer: Agent #23.
- Depends on: A22-W3-Wed.

**A22-W3-Fri (2026-06-12)** — Status post + CVE monitor tune
- Done when: alert thresholds tuned to avoid noise; suppression rules captured.
- Output: PR for tuned workflow.
- Verify: 5 days of low-noise alerts logged.
- Reviewer: Agent #26.
- Depends on: A22-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A22-W4-Mon (2026-06-15)** — Speed-up implementation: Docker layer cache + jest parallel-shard
- Done when: CI median dropped by ≥ 25 %.
- Output: PR.
- Verify: 5 consecutive runs show drop.
- Reviewer: Agent #21.
- Depends on: A22-W3-Thu.

**A22-W4-Tue (2026-06-16)** — Mobile CI integration: physical-device-farm runner PoC results
- Done when: 1 instrumented test runs on physical-device-farm vendor.
- Output: contribution to `docs/team/infra/device-farm-poc.md`.
- Verify: artefact + run log.
- Reviewer: Agents #4, #21.
- Depends on: A21-W3-Tue.

**A22-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + CI artefact retention policy
- Done when: retention policy captured; old artefacts auto-purged after 30 days.
- Output: PR.
- Verify: cost report logged.
- Reviewer: Agents #5, #50.
- Depends on: A22-W4-Tue.

**A22-W4-Thu (2026-06-18)** — Sprint 1 CI sign-off
- Done when: CI section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: CI median ≤ 6 min; flakiness reduced; CVE monitor low-noise.
- Reviewer: Agent #5.
- Depends on: A22-W4-Wed.

**A22-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (device-farm CI integration, more eslint rules).
- Output: `docs/team/infra/a22-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #5.
- Depends on: A22-W4-Thu.
