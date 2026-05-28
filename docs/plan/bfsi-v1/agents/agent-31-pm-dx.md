# Agent #31 — PM (Developer Experience)

**Reports to:** Agent #28.
**Mandate:** Owns SDK strategy (Node, Python, Java, Android, Web), developer onboarding flow, docs UX.
**KPIs:** see role 31 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A31-W1-Mon (2026-05-25)** — SDK strategy doc kickoff
- Done when: SDK strategy v0 captures languages priority + first 3 ship dates.
- Output: `docs/product/dx/sdk-strategy-v0.md`.
- Verify: priority order: Node → Java → Python → Android-Kotlin → Web-TypeScript.
- Reviewer: Agent #28.
- Depends on: A28-W1-Mon.

**A31-W1-Tue (2026-05-26)** — Developer onboarding flow audit
- Done when: existing signup-to-first-API-call flow measured.
- Output: `docs/product/dx/onboarding-baseline.md`.
- Verify: time-to-first-API-call baseline for 3 testers.
- Reviewer: Agent #15.
- Depends on: A31-W1-Mon.

**A31-W1-Wed (2026-05-27)** — Docs UX audit
- Done when: top-10 docs queries from analytics reviewed; gaps identified.
- Output: `docs/product/dx/docs-ux-audit.md`.
- Verify: 10 gaps logged.
- Reviewer: Agent #34.
- Depends on: A31-W1-Tue.

**A31-W1-Thu (2026-05-28)** — Node SDK v1 API surface spec
- Done when: spec captures `verifyProof`, `registerDevice`, `generateChallenge`, `getAuditEvents`, `streamSessions`.
- Output: `docs/product/dx/node-sdk-api-spec.md`.
- Verify: each method has signature + example.
- Reviewer: Agent #34.
- Depends on: A31-W1-Wed.

**A31-W1-Fri (2026-05-29)** — Status post + developer-feedback synthesis
- Done when: feedback from existing console signups (anonymised) synthesised.
- Output: `docs/product/dx/developer-feedback-synthesis.md`.
- Verify: top-5 themes captured.
- Reviewer: Agent #28.
- Depends on: A31-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A31-W2-Mon (2026-06-01)** — SDK strategy v1 with team feedback
- Done when: strategy updated based on engineering inputs.
- Output: PR for v1.
- Verify: ship-dates aligned with Phase 2.
- Reviewer: Agent #28.
- Depends on: A31-W1-Fri.

**A31-W2-Tue (2026-06-02)** — Docs search tuning input to Agent #16
- Done when: top-10 query mapping + suggested weighting handed off.
- Output: handover notes.
- Verify: Agent #16 confirms.
- Reviewer: Agent #16.
- Depends on: A31-W2-Mon.

**A31-W2-Wed (2026-06-03)** — Onboarding flow improvement spec
- Done when: spec captures the 4 friction points + planned fixes.
- Output: `docs/product/dx/onboarding-improvements-spec.md`.
- Verify: each friction has a fix.
- Reviewer: Agent #15.
- Depends on: A31-W2-Tue.

**A31-W2-Thu (2026-06-04)** — Developer-NPS instrumentation design
- Done when: NPS survey design (in-app + post-API-call) captured.
- Output: `docs/product/dx/nps-instrumentation-design.md`.
- Verify: covers privacy + opt-out path.
- Reviewer: Agents #39, #41.
- Depends on: A31-W2-Wed.

**A31-W2-Fri (2026-06-05)** — Phase 0 DX PM sign-off + status post
- Done when: DX pre-work landed.
- Output: row in Phase 0 exit doc.
- Verify: SDK strategy + onboarding spec + docs gaps current.
- Reviewer: Agent #28.
- Depends on: A31-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A31-W3-Mon (2026-06-08)** — Node SDK v1 spec finalised
- Done when: spec signed off; ready for engineering implementation.
- Output: PR for `docs/product/dx/node-sdk-api-spec.md` v1.
- Verify: every method has signature + example.
- Reviewer: Agents #6, #34, #47.
- Depends on: A31-W2-Fri.

**A31-W3-Tue (2026-06-09)** — Onboarding flow A/B test plan
- Done when: A/B plan captures variant (old vs new flow) + sample size + duration.
- Output: `docs/product/dx/onboarding-ab-test-plan.md`.
- Verify: 95 % significance plan captured.
- Reviewer: Agent #28.
- Depends on: A31-W3-Mon.

**A31-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #28.
- Depends on: A31-W3-Tue.

**A31-W3-Thu (2026-06-11)** — Docs UX improvements landed (with Agent #16)
- Done when: top-3 gaps closed.
- Output: contribution to docs PRs.
- Verify: 3 specific gaps closed.
- Reviewer: Agent #16.
- Depends on: A31-W3-Wed.

**A31-W3-Fri (2026-06-12)** — Status post + developer conference shortlist
- Done when: top-5 conferences identified.
- Output: `docs/product/dx/conference-shortlist.md`.
- Verify: 5 conferences with CFP deadlines.
- Reviewer: Agent #47.
- Depends on: A31-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A31-W4-Mon (2026-06-15)** — Developer-onboarding revamp page review (with Agent #16)
- Done when: page reviewed; flow confirmed.
- Output: review comments.
- Verify: revised time-to-first-API-call ≤ 10 min target.
- Reviewer: Agent #16.
- Depends on: A31-W3-Thu.

**A31-W4-Tue (2026-06-16)** — Java SDK v1 API surface spec (precursor)
- Done when: spec drafted.
- Output: `docs/product/dx/java-sdk-api-spec.md`.
- Verify: parallel to Node SDK spec.
- Reviewer: Agent #34.
- Depends on: A31-W4-Mon.

**A31-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + sample-integration repo plan
- Done when: plan for `examples/` repo (Node + curl) drafted.
- Output: `docs/product/dx/sample-integrations-plan.md`.
- Verify: 3 examples scoped.
- Reviewer: Agent #47.
- Depends on: A31-W4-Tue.

**A31-W4-Thu (2026-06-18)** — Sprint 1 DX PM sign-off
- Done when: DX PM section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: SDK + onboarding + docs all advancing.
- Reviewer: Agent #28.
- Depends on: A28-W4-Thu.

**A31-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (Node SDK alpha implementation oversight).
- Output: `docs/product/dx/a31-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #28.
- Depends on: A31-W4-Thu.
