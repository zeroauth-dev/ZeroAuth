# Agent #50 — Operations / Office Manager

**Reports to:** Founder.
**Mandate:** Owns finance ops, HR ops, vendor management, office and travel, contracts admin.
**KPIs:** see role 50 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A50-W1-Mon (2026-05-25)** — Vendor inventory
- Done when: every active vendor catalogued (cloud, SaaS, hardware, services).
- Output: `docs/ops/vendor-inventory-v1.md`.
- Verify: 20+ vendors with renewal dates.
- Reviewer: Founder.
- Depends on: A01-W1-Mon.

**A50-W1-Tue (2026-05-26)** — Monthly close calendar
- Done when: T+5 monthly close calendar published.
- Output: `docs/ops/monthly-close-calendar-v1.md`.
- Verify: 12 months mapped.
- Reviewer: Founder.
- Depends on: A50-W1-Mon.

**A50-W1-Wed (2026-05-27)** — Payroll calendar
- Done when: monthly payroll dates set up.
- Output: `docs/ops/payroll-calendar-v1.md`.
- Verify: covers Phase 1 + Phase 2 horizon.
- Reviewer: Founder.
- Depends on: A50-W1-Tue.

**A50-W1-Thu (2026-05-28)** — Device-fleet procurement for mobile team
- Done when: 6 SKUs ordered per Agent #4's procurement spec.
- Output: order ref.
- Verify: ETA ≤ week 3.
- Reviewer: Agent #4.
- Depends on: A04-W1-Wed.

**A50-W1-Fri (2026-05-29)** — Status post + R307 sensor procurement
- Done when: 2 R307 units + OTG cables ordered.
- Output: order ref.
- Verify: ETA ≤ week 3.
- Reviewer: Agent #18.
- Depends on: A04-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A50-W2-Mon (2026-06-01)** — Vendor security questionnaire collection
- Done when: every vendor with personal-data access has a security questionnaire on file.
- Output: `docs/ops/vendor-security-questionnaires-w2.md`.
- Verify: 100 % coverage.
- Reviewer: Agent #40.
- Depends on: A50-W1-Mon.

**A50-W2-Tue (2026-06-02)** — Demo equipment kit procurement
- Done when: laptop, projection adapters, other kit items procured per Agent #45's spec.
- Output: order ref.
- Verify: ETA ≤ week 3.
- Reviewer: Agent #45.
- Depends on: A45-W1-Wed.

**A50-W2-Wed (2026-06-03)** — Vendor risk policy review (with Agent #40)
- Done when: review of vendor risk policy v0.
- Output: review comments.
- Verify: SLAs + escalations captured.
- Reviewer: Agent #40.
- Depends on: A40-W1-Thu.

**A50-W2-Thu (2026-06-04)** — HR ops: performance-review calendar
- Done when: performance-review calendar timed to phase boundaries.
- Output: `docs/ops/hr-review-calendar-v1.md`.
- Verify: 4 reviews/year scheduled.
- Reviewer: Founder.
- Depends on: A50-W2-Wed.

**A50-W2-Fri (2026-06-05)** — Phase 0 ops sign-off + status post
- Done when: inventories + calendars + procurement current.
- Output: row in Phase 0 exit doc.
- Verify: ops ready.
- Reviewer: Founder.
- Depends on: A50-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A50-W3-Mon (2026-06-08)** — Device-fleet arrival check (with Agent #4)
- Done when: device fleet received; inventoried; encrypted vault entries created.
- Output: contribution to `docs/team/mobile/device-fleet-inventory-2026-06-08.md`.
- Verify: 6 SKUs inventoried.
- Reviewer: Agent #4.
- Depends on: A50-W1-Thu.

**A50-W3-Tue (2026-06-09)** — Travel + meeting-room SOP for first AE intro calls
- Done when: SOP for in-person meetings (bank visits) drafted.
- Output: `docs/ops/travel-sop-v1.md`.
- Verify: covers Mumbai + Bengaluru + Chennai.
- Reviewer: Agents #43, #44.
- Depends on: A50-W3-Mon.

**A50-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + R307 arrival check
- Done when: R307 units arrived; inspection done.
- Output: contribution to `docs/team/mobile/r307-procurement.md`.
- Verify: 2 units operational.
- Reviewer: Agent #18.
- Depends on: A50-W1-Fri.

**A50-W3-Thu (2026-06-11)** — Demo equipment arrival check (with Agent #45)
- Done when: demo equipment received; inventory verified.
- Output: contribution to `docs/gtm/demo-kit-inventory-2026-06-04.md`.
- Verify: every item logged.
- Reviewer: Agent #45.
- Depends on: A50-W2-Tue.

**A50-W3-Fri (2026-06-12)** — Status post + DPA / vendor-contract audit
- Done when: every vendor DPA reviewed.
- Output: contribution to `docs/compliance/dpdp/vendor-dpa-inventory.md`.
- Verify: every vendor has a DPA or path.
- Reviewer: Agent #41.
- Depends on: A41-W2-Wed.

## Week 4 (2026-06-15 → 2026-06-19)

**A50-W4-Mon (2026-06-15)** — Monthly close (May)
- Done when: May monthly close completed.
- Output: `docs/ops/monthly-close-2026-05.md`.
- Verify: P&L + cash position recorded.
- Reviewer: Founder.
- Depends on: A50-W1-Tue.

**A50-W4-Tue (2026-06-16)** — Vendor renewal calendar + budget vs actual review
- Done when: budget vs actual reviewed; renewals tracked.
- Output: `docs/ops/budget-actual-2026-06-16.md`.
- Verify: variance > 10 % flagged.
- Reviewer: Founder.
- Depends on: A50-W4-Mon.

**A50-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + CI artefact retention cost review
- Done when: CI artefact storage costs reviewed (with Agent #22).
- Output: cost report.
- Verify: retention policy alignment.
- Reviewer: Agent #22.
- Depends on: A22-W4-Wed.

**A50-W4-Thu (2026-06-18)** — Sprint 1 ops sign-off
- Done when: ops section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: device fleet + R307 + demo kit + DPA inventory + monthly close all done.
- Reviewer: Founder.
- Depends on: A50-W3-Thu.

**A50-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (travel for first demos, more vendor reviews).
- Output: `docs/ops/a50-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Founder.
- Depends on: A50-W4-Thu.
