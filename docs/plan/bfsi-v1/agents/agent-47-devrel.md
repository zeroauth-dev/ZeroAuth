# Agent #47 — Developer Advocate

**Reports to:** Agent #31 (dotted: Agent #42).
**Mandate:** Owns external developer engagement — conferences, hackathons, blog content, sample integrations.
**KPIs:** see role 47 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A47-W1-Mon (2026-05-25)** — Conference calendar v1
- Done when: 3 target conferences identified for Phase 1 + 2 for Phase 2.
- Output: `docs/devrel/conference-calendar-v1.md`.
- Verify: CFP deadlines noted.
- Reviewer: Agent #31.
- Depends on: A31-W1-Mon.

**A47-W1-Tue (2026-05-26)** — First technical blog post — outline
- Done when: outline for "Why we replaced credential storage with commitments" drafted.
- Output: `docs/devrel/blog-post-1-outline.md`.
- Verify: 5+ section outline.
- Reviewer: Agent #48.
- Depends on: A47-W1-Mon.

**A47-W1-Wed (2026-05-27)** — First blog post — first draft
- Done when: 1500-word first draft completed.
- Output: `docs/devrel/blog-post-1-draft-v0.md`.
- Verify: draft reviewable.
- Reviewer: Agents #11, #29, #48.
- Depends on: A47-W1-Tue.

**A47-W1-Thu (2026-05-28)** — Sample integration #1 (Node + curl) outline
- Done when: sample-integration scope drafted.
- Output: `docs/devrel/sample-1-outline.md`.
- Verify: covers enrollment + login.
- Reviewer: Agent #34.
- Depends on: A47-W1-Wed.

**A47-W1-Fri (2026-05-29)** — Status post + developer-community channels survey
- Done when: community channels (X/Twitter, Discord, dev.to, HN) inventoried.
- Output: `docs/devrel/community-channels-survey.md`.
- Verify: 4+ channels with engagement strategy.
- Reviewer: Agent #48.
- Depends on: A47-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A47-W2-Mon (2026-06-01)** — Blog post v1 with reviewer feedback applied
- Done when: blog post v1 ready for publication review.
- Output: PR for v1.
- Verify: tech accuracy + brand voice consistent.
- Reviewer: Agents #11, #48.
- Depends on: A47-W1-Wed.

**A47-W2-Tue (2026-06-02)** — Sample integration #1 design + scaffolding
- Done when: sample repo scaffolded.
- Output: PR for sample repo (`examples/node-curl-enrollment-login/`).
- Verify: scaffold compiles + runs.
- Reviewer: Agent #34.
- Depends on: A47-W1-Thu.

**A47-W2-Wed (2026-06-03)** — Developer-community engagement plan
- Done when: engagement plan drafted (post cadence + topic mix).
- Output: `docs/devrel/community-engagement-plan-v0.md`.
- Verify: 4 channels with plan.
- Reviewer: Agent #48.
- Depends on: A47-W2-Tue.

**A47-W2-Thu (2026-06-04)** — Developer-feedback synthesis (with Agent #31)
- Done when: input from existing console signups synthesised.
- Output: contribution to `docs/product/dx/developer-feedback-synthesis.md`.
- Verify: feedback themes confirmed.
- Reviewer: Agent #31.
- Depends on: A31-W1-Fri.

**A47-W2-Fri (2026-06-05)** — Phase 0 DevRel sign-off + status post
- Done when: blog post v1 + sample 1 scaffold + community plan current.
- Output: row in Phase 0 exit doc.
- Verify: assets ready.
- Reviewer: Agent #31.
- Depends on: A47-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A47-W3-Mon (2026-06-08)** — Blog post #1 published
- Done when: post live on docs/blog or company site.
- Output: published URL.
- Verify: post indexed + shared.
- Reviewer: Agent #48.
- Depends on: A47-W2-Mon.

**A47-W3-Tue (2026-06-09)** — Sample integration #1 implementation
- Done when: enrollment + login flow implemented in sample repo.
- Output: PR for sample.
- Verify: sample runs end-to-end against test env.
- Reviewer: Agent #6.
- Depends on: A47-W2-Tue.

**A47-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance + first conference talk abstract drafted
- Done when: abstract drafted for top-priority conference.
- Output: `docs/devrel/conference-abstract-1-draft.md`.
- Verify: abstract under 250 words.
- Reviewer: Agent #48.
- Depends on: A47-W3-Tue.

**A47-W3-Thu (2026-06-11)** — Sample integration #1 README polish
- Done when: README captures setup + run + key concepts.
- Output: PR.
- Verify: README reviewed.
- Reviewer: Agent #34.
- Depends on: A47-W3-Tue.

**A47-W3-Fri (2026-06-12)** — Status post + blog post #2 outline
- Done when: outline for "Tamper-evident audit logs with on-chain anchors" drafted.
- Output: `docs/devrel/blog-post-2-outline.md`.
- Verify: outline reviewable.
- Reviewer: Agents #8, #25.
- Depends on: A47-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A47-W4-Mon (2026-06-15)** — Conference talk abstract submitted
- Done when: abstract submitted to top-priority conference.
- Output: submission confirmation.
- Verify: confirmation logged.
- Reviewer: Agent #48.
- Depends on: A47-W3-Wed.

**A47-W4-Tue (2026-06-16)** — Sample integration #2 — kiosk scenario
- Done when: kiosk-flavoured sample scaffolded.
- Output: PR for `examples/kiosk-demo-scenario/`.
- Verify: sample runs end-to-end.
- Reviewer: Agent #15.
- Depends on: A47-W3-Tue.

**A47-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance + dev-onboarding revamp review
- Done when: input on dev-onboarding revamp.
- Output: review comments to Agents #16, #31.
- Verify: developer-friendly view confirmed.
- Reviewer: Agents #16, #31.
- Depends on: A16-W4-Mon.

**A47-W4-Thu (2026-06-18)** — Sprint 1 DevRel sign-off
- Done when: DevRel section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: blog 1 + sample 1 published; abstract submitted.
- Reviewer: Agent #31.
- Depends on: A28-W4-Thu.

**A47-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted (more blog posts, hackathon prep).
- Output: `docs/devrel/a47-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #31.
- Depends on: A47-W4-Thu.
