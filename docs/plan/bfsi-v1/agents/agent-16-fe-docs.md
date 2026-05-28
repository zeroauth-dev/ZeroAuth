# Agent #16 — Mid Frontend Engineer (docs site + marketing landing)

**Reports to:** Agent #3.
**Mandate:** Owns Docusaurus docs site, landing page, marketing assets, developer experience around public docs.
**KPIs:** see role 16 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A16-W1-Mon (2026-05-25)** — Docs-site analytics audit
- Done when: current docs traffic + search-query log reviewed.
- Output: `docs/team/frontend/docs-analytics-w1.md`.
- Verify: top-10 search queries identified.
- Reviewer: Agents #3, #31.
- Depends on: A03-W1-Mon.

**A16-W1-Tue (2026-05-26)** — Add link-check CI to docs site
- Done when: link-check workflow added to GitHub Actions; flagged broken links fixed.
- Output: `.github/workflows/docs-link-check.yml` + fixes.
- Verify: link-check green on `dev`.
- Reviewer: Agent #22.
- Depends on: A16-W1-Mon.

**A16-W1-Wed (2026-05-27)** — Surface new ADRs (0008..0013) on docs site
- Done when: ADRs indexed in docs site navigation.
- Output: PR updating Docusaurus config + sidebar.
- Verify: ADRs visible from `/docs/adr/`.
- Reviewer: Agent #34.
- Depends on: A16-W1-Tue.

**A16-W1-Thu (2026-05-28)** — Add security-findings page to docs site
- Done when: page reads from `docs/security/audit-findings.md`; published.
- Output: PR for new page.
- Verify: page renders + reflects current state.
- Reviewer: Agent #26.
- Depends on: A16-W1-Wed.

**A16-W1-Fri (2026-05-29)** — Status post + landing-page CTA audit
- Done when: status posted; existing CTAs measured + bottleneck identified.
- Output: `docs/team/frontend/landing-cta-audit.md`.
- Verify: bounce + conversion numbers logged.
- Reviewer: Agent #48.
- Depends on: A16-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A16-W2-Mon (2026-06-01)** — Docs site search tuning
- Done when: search index re-tuned for top-10 queries; weighting adjusted.
- Output: PR for search config.
- Verify: top-10 queries return useful results.
- Reviewer: Agent #31.
- Depends on: A16-W1-Fri.

**A16-W2-Tue (2026-06-02)** — Landing page CTAs refresh
- Done when: "Book demo" CTA + "Why ZeroAuth" CTA refreshed.
- Output: PR.
- Verify: layout passes visual review.
- Reviewer: Agents #32, #48.
- Depends on: A16-W2-Mon.

**A16-W2-Wed (2026-06-03)** — Docusaurus + landing-page Lighthouse measurement
- Done when: Lighthouse run on docs + landing; baseline logged.
- Output: contribution to `docs/team/frontend/lighthouse-baseline-2026-06-04.md`.
- Verify: scores ≥ 85 on desktop, ≥ 75 on mobile.
- Reviewer: Agent #3.
- Depends on: A16-W2-Tue.

**A16-W2-Thu (2026-06-04)** — Add CookieBot or equivalent consent banner (DPDP-compliant)
- Done when: consent banner live with reject-all option.
- Output: PR.
- Verify: consent banner present on every public-site page.
- Reviewer: Agents #39, #41.
- Depends on: A16-W2-Wed.

**A16-W2-Fri (2026-06-05)** — Phase 0 docs-site sign-off + status post
- Done when: docs site updates merged.
- Output: row in `docs/team/phase-exits/phase-0-frontend-signoff.md`.
- Verify: ADRs surfaced + link-check live + consent banner live.
- Reviewer: Agent #3.
- Depends on: A16-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A16-W3-Mon (2026-06-08)** — Pain-points page on public docs site
- Done when: `docs/why-zeroauth/bfsi.md` created from `01-pain-points.md` (public summary).
- Output: PR.
- Verify: page renders; co-reviewed by Agent #29.
- Reviewer: Agent #29.
- Depends on: A16-W2-Fri.

**A16-W3-Tue (2026-06-09)** — Anchor Bank case-study placeholder page
- Done when: placeholder page with "Case study coming W12" stub published; sign-up to be notified live.
- Output: PR.
- Verify: page renders; CTA wired.
- Reviewer: Agent #48.
- Depends on: A16-W3-Mon.

**A16-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + docs nav refresh
- Done when: docs nav reflects new sections.
- Output: PR.
- Verify: navigation tested across viewports.
- Reviewer: Agent #3.
- Depends on: A16-W3-Tue.

**A16-W3-Thu (2026-06-11)** — Marketing analytics dashboard set up
- Done when: GA4 + Plausible (or equivalent) dashboard live.
- Output: dashboard URL recorded.
- Verify: visitor + conversion metrics tracking.
- Reviewer: Agents #48, #49.
- Depends on: A16-W3-Wed.

**A16-W3-Fri (2026-06-12)** — Status post + developer-onboarding page revamp design
- Done when: design for revamped onboarding page drafted.
- Output: `docs/team/frontend/dev-onboarding-revamp-design.md`.
- Verify: precursor to Node SDK launch later.
- Reviewer: Agent #31.
- Depends on: A16-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A16-W4-Mon (2026-06-15)** — Implement revamped developer-onboarding page
- Done when: page live; signup → first API call walkthrough captured.
- Output: PR.
- Verify: time-to-first-API-call reduced.
- Reviewer: Agents #31, #47.
- Depends on: A16-W3-Fri.

**A16-W4-Tue (2026-06-16)** — Add BFSI-specific landing variant
- Done when: BFSI-focused landing page live with pain-point hero.
- Output: PR.
- Verify: layout passes review.
- Reviewer: Agents #29, #48.
- Depends on: A16-W4-Mon.

**A16-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + add demo-request form
- Done when: demo-request form on BFSI landing live.
- Output: PR.
- Verify: form submission tested; lead goes to GTM dashboard.
- Reviewer: Agent #42.
- Depends on: A16-W4-Tue.

**A16-W4-Thu (2026-06-18)** — Sprint 1 docs sign-off
- Done when: docs section of S1 exit gate green.
- Output: row in `docs/team/sprint-exits/s1-frontend.md`.
- Verify: dev-onboarding revamp live + BFSI landing live.
- Reviewer: Agent #3.
- Depends on: A16-W4-Wed.

**A16-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (more BFSI content, conference-launch pages).
- Output: `docs/team/frontend/a16-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #3.
- Depends on: A16-W4-Thu.
