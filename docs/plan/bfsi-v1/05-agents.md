# Per-agent work document — weeks 1–4

Each of the 50 agents has an explicit ticket list for the first four weeks (Phase 0 + Sprint 1 of Phase 1). Tickets are keyed to commit IDs in `04-commits.md`. Where an agent's work is research / documentation / sales pipeline rather than commits, the ticket is described as a deliverable instead.

**Conventions:**
- `→ C-NNN` references a commit ID from `04-commits.md`.
- `[Lead]` means the agent owns the commit subject and PR.
- `[Reviewer]` means the agent signs off but does not author.
- `[Pair]` means the agent co-authors with another agent on a single PR.
- Each week's tickets are scoped to fit one ~8 h workday × 5 = 40 h.

For weeks 5+ tickets, each agent will receive an end-of-week-4 update with their next sprint plan, generated from the sprint commit list and customer feedback. The plan is intended to be re-confirmed at the start of each sprint.

---

## Engineering (roles 1–27)

### Agent #1 — Chief Engineering Officer

- **Week 1**
  - [Lead] → C-002 (ADR 0008 branching workflow), C-033 (update CLAUDE.md for Phase 0 final state — week-2 work, drafted week 1).
  - [Reviewer] every PR landed in weeks 1–2.
  - Deliverable: Phase 0 kickoff brief sent to all 50 agents end of week 1, day 1.
- **Week 2**
  - [Lead] → C-033 finalised after C-001..C-032 land.
  - [Reviewer] every PR; arbitrate any ADR disagreements; sign off Phase 0 exit gate.
  - Deliverable: Phase 0 exit-gate review with security-reviewer + cryptographer-reviewer subagents.
- **Week 3**
  - [Lead] kickoff of Phase 1 Sprint 1; review C-101..C-108 PRs.
  - Deliverable: Sprint 1 retro at end of week 4.
- **Week 4**
  - [Reviewer] C-101..C-108 final PRs; Phase 1 Sprint 1 exit-gate sign-off.
  - Deliverable: Sprint 2 ticket list confirmed with VPs.

### Agent #2 — VP Engineering, Backend

- **Week 1**
  - [Reviewer] → C-004 (demo bypass removal), C-005 (access_token query fallback removal).
  - [Lead] backend team daily standup; track per-agent progress.
  - Deliverable: backend dependency-graph for weeks 1–4 drawn and shared.
- **Week 2**
  - [Reviewer] → C-018 (circuit version lock), C-022 (zod adoption), C-025 (Postgres session store), C-026 (rate-limit).
  - Deliverable: backend agent sprint plan for sprint 1.
- **Week 3**
  - [Reviewer] → C-105 (redesigned identity register).
  - Deliverable: API contract delta document shared with mobile + frontend.
- **Week 4**
  - [Reviewer] → C-107 (dashboard users view), C-108 (Anchor Bank tenant seed).
  - Deliverable: sprint 1 retro within engineering org.

### Agent #3 — VP Engineering, Frontend

- **Week 1**
  - [Reviewer] → C-006 (dashboard SSE migration).
  - Deliverable: frontend agent sprint plan + design-system audit for sprint 1.
- **Week 2**
  - [Reviewer] no anchor commits this week from frontend; track polish items.
  - Deliverable: design tokens repo audited; demo-friendly theme prepared.
- **Week 3**
  - [Reviewer] → C-107 (users view).
  - Deliverable: Anchor Bank dashboard mock review with Role 32.
- **Week 4**
  - [Reviewer] → polish PRs for users view, audit-integrity prep.
  - Deliverable: kiosk web app spec finalised with Role 15.

### Agent #4 — VP Engineering, Mobile

- **Week 1**
  - [Lead] → C-102 (ADR 0014 android-only).
  - Deliverable: mobile-team kickoff; rapidsnark toolchain plan with Role 11; device-fleet procurement spec.
- **Week 2**
  - [Reviewer] → C-103 (ADR 0015 rapidsnark vs WebView).
  - Deliverable: device-support matrix v0; physical test phones ordered (Pixel 7, S22, Redmi Note 13, OnePlus 11, Realme GT, Moto Edge).
- **Week 3**
  - [Reviewer] → C-101 (bootstrap mobile/ subtree), C-104 (rapidsnark JNI POC).
  - Deliverable: R307 sensor procurement spec; two R307 units ordered.
- **Week 4**
  - [Reviewer] → C-104 final, weekly mobile sync, planning of Sprint 2 mobile commits.
  - Deliverable: mobile sprint 1 retro.

### Agent #5 — VP Engineering, Infrastructure / SRE

- **Week 1**
  - [Lead] → CI pipeline review; mirror pre-commit hook in CI (`C-001` follow-on).
  - [Reviewer] → C-001 (pre-commit hook).
  - Deliverable: observability inventory; metric pipeline plan.
- **Week 2**
  - [Reviewer] → C-015 (anchor-job cron), C-032 (CVE monitor).
  - Deliverable: deploy pipeline audit; secrets rotation calendar.
- **Week 3**
  - [Lead] → device-fleet CI integration plan (mobile instrumented tests against a physical-device farm).
  - Deliverable: SLA monitoring stack provisioned in `test` env.
- **Week 4**
  - [Lead] → load-test infrastructure scaffolding (`C-191` precursor).
  - Deliverable: incident-response runbook v1.

### Agent #6 — Senior Backend Engineer (verifier)

- **Week 1**
  - [Lead] → C-004 (remove demo bypass from `submitProof`).
  - [Pair with Role 23] → write `tests/proof-pairing.test.ts` cases first.
- **Week 2**
  - [Lead] → C-022 (zod validators on identity + zkp routes), C-023 (zod ADR).
  - [Reviewer] → C-018 (circuit version pin).
- **Week 3**
  - [Lead] → C-105 (redesigned `/v1/identity/register` with attestation), C-106 (ADR 0016 Play Integrity acceptance).
- **Week 4**
  - [Lead] → C-148 prep work (week 5 anchor: harden `/v1/zkp/verify`); spike the proof-verification + audit-row enrichment design.
  - Deliverable: proof-verification design doc with failure-mode matrix.

### Agent #7 — Senior Backend Engineer (multi-tenancy + API keys)

- **Week 1**
  - [Lead] → C-005 (remove access_token query fallback), C-007 (cross-tenant rejection test matrix).
- **Week 2**
  - [Lead] → C-025 (Postgres-backed session store), C-026 (rate-limit middleware), C-027 (CORS hardening).
- **Week 3**
  - [Lead] → C-108 (anchor_bank tenant seed in test env).
  - [Pair with Role 14] → users view API surface.
- **Week 4**
  - [Lead] → tenant feature-flag service refactor (precursor to workforce-mode in C-189).
  - Deliverable: tenant config schema documented in `docs/operations/tenant-config.md`.

### Agent #8 — Senior Backend Engineer (audit + blockchain)

- **Week 1**
  - [Pair with Role 11] → C-009 (ADR 0010 hash chain), C-011 (audit_events.previous_hash + event_hash columns).
- **Week 2**
  - [Lead] → C-012 (audit chain implementation), C-013 (route all writes through `appendAuditEvent`), C-014 (audit-integrity endpoint).
  - [Pair with Role 25] → C-015 (anchor cron) and C-016 (AuditAnchor contract).
- **Week 3**
  - [Lead] → audit-chain enforcement in test env, backfill migration prep.
- **Week 4**
  - [Lead] → migration dry-run on staging; observability for audit-write lag.
  - Deliverable: hash-chain runbook for on-call.

### Agent #9 — Senior Backend Engineer (admin + reporting)

- **Week 1**
  - [Pair with Role 23] → C-007 (cross-tenant test additions for admin endpoints).
- **Week 2**
  - [Lead] → C-024 (`/api/admin/dump-users` for breach-sim demo).
  - [Reviewer] → C-014 (audit-integrity endpoint).
- **Week 3**
  - [Lead] → admin compliance-export CSV scaffolding (precursor to weeks 5+ work).
- **Week 4**
  - [Lead] → admin endpoint audit-row coverage tests.
  - Deliverable: admin endpoint inventory in `docs/api_contract.md`.

### Agent #10 — Senior Backend Engineer (compliance integrations)

- **Week 1**
  - [Lead] → SAML / OIDC adapter inventory review; identify which target bank uses which.
- **Week 2**
  - [Pair with Role 37] → consent-capture data model spec for RBI Digital Lending compliance.
- **Week 3**
  - [Lead] → consent flow schema PR (precursor; not yet wired to a route).
- **Week 4**
  - [Lead] → Anchor Bank webhook receiver smoke test scaffolding (precursor to C-125).
  - Deliverable: integration-architecture template for partner banks.

### Agent #11 — Senior Cryptography Engineer (circuit + prover)

- **Week 1**
  - [Lead] → C-008 (ADR 0009 QR proof pairing protocol), C-009 (ADR 0010 audit hash chain spec).
- **Week 2**
  - [Lead] → C-018 (circuit version pin v1.1), C-019 (ADR 0012 version pinning + upgrade procedure).
  - [Reviewer] → C-012 (audit chain implementation), C-016 (AuditAnchor contract).
- **Week 3**
  - [Lead] → C-103 (ADR 0015 rapidsnark vs WebView).
  - [Reviewer] → C-104 (rapidsnark JNI POC).
- **Week 4**
  - [Lead] → trusted-setup ceremony v1.2 invitation drafts + contributor recruitment (precursor to C-169).
  - Deliverable: trusted-setup runbook draft.

### Agent #12 — Senior Cryptography Engineer (key management + HSM)

- **Week 1**
  - [Lead] → key-inventory document; identify all production keys (JWT, session, admin, blockchain, attestation).
- **Week 2**
  - [Lead] → C-028 (JWT migrate to RS256 + JWKS endpoint).
  - [Pair with Role 6] → JWKS in zod validator path.
- **Week 3**
  - [Lead] → StrongBox attestation chain validation library (precursor to mobile attestation path).
- **Week 4**
  - [Lead] → HSM evaluation: AWS CloudHSM vs YubiHSM2 trade-off paper.
  - Deliverable: HSM ADR draft.

### Agent #13 — Mid Cryptography Engineer (Poseidon + hash chain)

- **Week 1**
  - [Pair with Role 11] → Poseidon test vectors matched against `circomlibjs` reference; landed as `tests/poseidon-vectors.test.ts`.
- **Week 2**
  - [Lead] → hash-chain primitive helpers landed in `src/services/audit.ts` (companion to C-012).
- **Week 3**
  - [Lead] → external cryptographer engagement letter coordinated with Role 27.
- **Week 4**
  - [Lead] → cryptographer-reviewer subagent rules expanded (companion to C-030).
  - Deliverable: cryptanalysis-readiness checklist.

### Agent #14 — Senior Frontend Engineer (dashboard)

- **Week 1**
  - [Lead] → C-006 (dashboard EventSource migration to cookie + CSRF).
- **Week 2**
  - [Reviewer] → C-024 prep work; design system audit follow-ups.
- **Week 3**
  - [Lead] → C-107 (users view, allowed-columns enforcement).
- **Week 4**
  - [Lead] → audit-integrity dashboard view (companion to C-123, week 5 anchor).
  - Deliverable: dashboard storybook coverage for new components.

### Agent #15 — Senior Frontend Engineer (developer console + kiosk)

- **Week 1**
  - [Reviewer] → C-005 (console SSE auth migration; backend lead is Role 7).
- **Week 2**
  - [Reviewer] → C-006; spec for kiosk web app drafted.
- **Week 3**
  - [Lead] → kiosk web app skeleton (precursor to C-147).
- **Week 4**
  - [Lead] → kiosk SSE consumer + QR generator (continues into C-147 week 7).
  - Deliverable: kiosk demo-day UX run-through with Role 32.

### Agent #16 — Mid Frontend Engineer (docs + marketing)

- **Week 1**
  - [Lead] → docs site updates: new ADRs surfaced, security-findings link added.
- **Week 2**
  - [Lead] → docs site search tuning; landing page CTAs refreshed.
- **Week 3**
  - [Lead] → pain-points page on the public docs site (`docs/why-zeroauth/bfsi.md`).
- **Week 4**
  - [Lead] → developer onboarding page revamp (precursor to SDK launch in week 17).
  - Deliverable: docs-site analytics dashboard live.

### Agent #17 — Senior Android Engineer (prover core + biometric prompt)

- **Week 1**
  - [Pair with Role 4] → C-101 (mobile subtree bootstrap).
- **Week 2**
  - [Lead] → C-104 (rapidsnark JNI POC).
- **Week 3**
  - [Lead] → mobile prover module skeleton; instrumented test framework set up.
- **Week 4**
  - [Lead] → enrollment flow spike with CameraX (precursor to C-143).
  - Deliverable: prover-latency measurement on Pixel 7 against fixed witness.

### Agent #18 — Senior Android Engineer (R307 + BiometricPrompt fallback)

- **Week 1**
  - [Lead] → R307 datasheet review; USB-OTG enumeration spike outside the app.
- **Week 2**
  - [Lead] → R307 driver design doc; USB-Serial library selection (ADR 0017 candidate).
- **Week 3**
  - [Lead] → R307 driver skeleton module added to `mobile/sensors/r307/`.
- **Week 4**
  - [Lead] → BiometricPrompt fallback path skeleton; capability-detection helper.
  - Deliverable: R307 reliability test plan.

### Agent #19 — Mid Android Engineer (UX + flows)

- **Week 1**
  - [Lead] → enrollment flow Compose screens mockup; navigation graph drafted.
- **Week 2**
  - [Lead] → login flow Compose screens; QR-scan permission flow.
- **Week 3**
  - [Lead] → in-app QR scanner skeleton.
- **Week 4**
  - [Lead] → error-state screens (capture failure, network failure, expired session).
  - Deliverable: error-state coverage matrix.

### Agent #20 — Senior IoT Engineer (kiosk bridge)

- **Week 1**
  - [Lead] → IoT bridge runbook review (existing `docs/operations/demo-runbook.md`).
- **Week 2**
  - [Lead] → bridge SSE back-channel hardening; reconnect strategy documented.
- **Week 3**
  - [Lead] → bridge audit-event reconciliation with server (cross-check).
- **Week 4**
  - [Lead] → bridge 24-hour burn-in test on a staged kiosk.
  - Deliverable: bridge resilience test report.

### Agent #21 — Senior DevOps / SRE Engineer

- **Week 1**
  - [Pair with Role 22] → C-001 (pre-commit hook + CI mirror).
- **Week 2**
  - [Lead] → C-015 (anchor-job cron with CronCreate-managed schedule).
- **Week 3**
  - [Lead] → metric dashboards: verifier latency, audit-write lag, anchor lag.
- **Week 4**
  - [Lead] → physical-device-farm CI runner; instrumented test integration.
  - Deliverable: SRE runbook for Phase 0 exit-state alerting.

### Agent #22 — Mid DevOps Engineer (CI/CD + observability)

- **Week 1**
  - [Lead] → C-001 (pre-commit hook implementation + tests).
- **Week 2**
  - [Lead] → C-032 (CVE monitor workflow).
  - [Pair with Role 21] → metric pipeline scaffolding.
- **Week 3**
  - [Lead] → eslint rule additions: ban direct `audit_events` INSERT, ban `Co-Authored-By: Claude` in commit messages (commit-msg hook).
- **Week 4**
  - [Lead] → CI matrix audit: assert no `--no-verify` paths in workflows; assert no shell-script `cat` of secrets.
  - Deliverable: CI uptime + flakiness report.

### Agent #23 — Senior QA / SDET

- **Week 1**
  - [Lead] → C-003 (schema-purity test), C-007 (tenant-isolation matrix), C-021 (biometric-rejection test).
- **Week 2**
  - [Lead] → C-126 prep (sprint 2 anchor) + C-127 (audit-coverage test scaffolding).
- **Week 3**
  - [Lead] → end-to-end Playwright suite scaffolding (precursor to C-192).
- **Week 4**
  - [Lead] → e2e test for enrollment + login path against test env.
  - Deliverable: QA risk register for the Anchor Bank demo.

### Agent #24 — Mid QA Engineer (regression + manual + device fleet)

- **Week 1**
  - [Lead] → device-fleet manual-test plan for tier-1 SKUs.
- **Week 2**
  - [Lead] → regression checklist for Phase 0 exit (run all 50 existing tests on staging).
- **Week 3**
  - [Lead] → manual smoke test of enrollment flow on Pixel 7 emulator (early version).
- **Week 4**
  - [Lead] → bug-triage queue audited; SLA dashboard set up.
  - Deliverable: device-test matrix v1.

### Agent #25 — Senior Blockchain Engineer

- **Week 1**
  - [Lead] → C-010 (ADR 0011 on-chain anchor cadence).
- **Week 2**
  - [Lead] → C-016 (AuditAnchor contract on Base Sepolia), C-020 (redeploy Groth16Verifier at v1.1).
- **Week 3**
  - [Lead] → contract-test harness expansion; deployment-script idempotence.
- **Week 4**
  - [Lead] → mainnet-readiness checklist drafted; bytecode-equivalence verification documented.
  - Deliverable: contract risk register.

### Agent #26 — Senior Security Engineer (red team + AppSec)

- **Week 1**
  - [Lead] → C-031 (audit-findings doc) + tracking the 21 findings across the team.
- **Week 2**
  - [Lead] → C-029 (security-reviewer subagent hooks expansion).
- **Week 3**
  - [Reviewer] → all PRs touching auth, crypto, tenant boundaries.
- **Week 4**
  - [Lead] → internal red-team exercise plan v1; OWASP top-10 evidence audit.
  - Deliverable: bug-bounty platform vendor evaluation (phase 3 deliverable; pre-work).

### Agent #27 — Senior Security Engineer (cryptanalysis + circuit review)

- **Week 1**
  - [Reviewer] → C-008, C-009 (the QR pairing and hash-chain ADRs).
- **Week 2**
  - [Lead] → C-030 (cryptographer-reviewer subagent hooks expansion).
- **Week 3**
  - [Reviewer] → C-104 (rapidsnark JNI POC).
- **Week 4**
  - [Lead] → external cryptographer engagement secured (signed SoW); coordinated with Role 12.
  - Deliverable: trusted-setup ceremony date confirmed with 6 contributors.

---

## Product & Design (roles 28–35)

### Agent #28 — Chief Product Officer

- **Week 1**
  - Deliverable: Anchor Bank demo prioritisation matrix; final list of 6 target banks confirmed with Role 42.
- **Week 2**
  - Deliverable: pain-point document `01-pain-points.md` reviewed; updates with internal feedback.
- **Week 3**
  - Deliverable: bank-PM Role 29 working session — what the CRO at HDFC will say in Q&A.
- **Week 4**
  - Deliverable: demo runbook draft sign-off (precursor to C-190).

### Agent #29 — Senior PM (BFSI)

- **Week 1**
  - Deliverable: per-bank intel pack (HDFC, ICICI, Axis, SBI YONO, IDFC First, RBL) — CISO names, recent breach/audit posture, RBI inspection cycle.
- **Week 2**
  - Deliverable: bank-CISO Q&A bank (`02-bank-demo.md` Q&A section expanded with bank-specific lines).
- **Week 3**
  - Deliverable: pain-point doc v1.1 with quantified numbers validated against 2 industry analysts.
- **Week 4**
  - Deliverable: demo invitation drafts for each of the 6 banks; legal review of LoI template.

### Agent #30 — PM (Healthcare)

- **Week 1**
  - Deliverable: ABDM (Ayushman Bharat Digital Mission) integration overview; HRP (Health Record Provider) interface review.
- **Week 2**
  - Deliverable: healthcare pain-points draft v0 (deferred to Phase 2 but pre-work).
- **Week 3**
  - Deliverable: target healthcare partners shortlisted (Apollo, Manipal, Fortis).
- **Week 4**
  - Deliverable: healthcare demo storyboard draft.

### Agent #31 — PM (Developer Experience)

- **Week 1**
  - Deliverable: SDK strategy doc (precursor to Node SDK in Phase 2); language priority confirmed.
- **Week 2**
  - Deliverable: developer onboarding flow audit; time-to-first-API-call measurement on current docs.
- **Week 3**
  - Deliverable: SDK API surface spec for Node SDK v1.
- **Week 4**
  - Deliverable: developer-feedback synthesis from existing console signups (anonymised).

### Agent #32 — Senior Designer (Dashboard UX)

- **Week 1**
  - Deliverable: design system audit; demo-friendly theme palette explored.
- **Week 2**
  - Deliverable: users view mock with allowed-columns-only treatment.
- **Week 3**
  - Deliverable: audit-integrity view mock; on-chain anchor link treatment.
- **Week 4**
  - Deliverable: kiosk web app visual design (works for Scene 2).

### Agent #33 — Designer (Mobile UX)

- **Week 1**
  - Deliverable: enrollment flow Figma file v1 (CameraX face, biometric prompt, success state).
- **Week 2**
  - Deliverable: login flow Figma file (QR scan, biometric confirm, redirect).
- **Week 3**
  - Deliverable: transaction-confirmation sheet Figma file with Indian numbering format.
- **Week 4**
  - Deliverable: error-state coverage in Figma; usability test plan.

### Agent #34 — Technical Writer (developer docs)

- **Week 1**
  - Deliverable: `docs/api_contract.md` review for accuracy against current state.
- **Week 2**
  - Deliverable: `docs/error_codes.md` audit; map every machine-readable error to a remediation.
- **Week 3**
  - Deliverable: integration guide skeleton for a target bank's net-banking team.
- **Week 4**
  - Deliverable: kiosk integration docs page.

### Agent #35 — Technical Writer (compliance + audit + legal docs)

- **Week 1**
  - Deliverable: `docs/security/audit-findings.md` collaboration with Role 26.
- **Week 2**
  - Deliverable: threat-model `docs/threat_model.md` updated for hash chain + on-chain anchor (companion to C-017).
- **Week 3**
  - Deliverable: DPDP §2(t) legal memo draft (precursor to a counsel review in week 9).
- **Week 4**
  - Deliverable: anchor-bank demo runbook outline (precursor to C-190).

---

## Compliance & Risk (roles 36–41)

### Agent #36 — Chief Compliance Officer

- **Week 1**
  - Deliverable: compliance roadmap calendar (SOC 2 + ISO 27001 + DPDP + RBI sandbox) v1.
- **Week 2**
  - Deliverable: SOC 2 auditor shortlist (Sequence, Strike Graph, A-LIGN, Vanta-partnered).
- **Week 3**
  - Deliverable: SOC 2 scope memo drafted.
- **Week 4**
  - Deliverable: ISO 27001 ISMS scope memo drafted.

### Agent #37 — Senior Compliance Lead (DPDP + RBI)

- **Week 1**
  - Deliverable: DPDP §2(t) external counsel engagement scoped.
- **Week 2**
  - Deliverable: RBI Master Direction on IT Governance §6.4 compliance matrix v0.
- **Week 3**
  - Deliverable: RBI Digital Lending Guidelines mapping document.
- **Week 4**
  - Deliverable: DPDP §8 (data breach reporting) playbook v0.

### Agent #38 — Senior Compliance Lead (SOC 2 + ISO 27001)

- **Week 1**
  - Deliverable: SOC 2 Type I scope draft; control identification (~120 controls).
- **Week 2**
  - Deliverable: ISO 27001 Annex A control mapping draft.
- **Week 3**
  - Deliverable: evidence collector inventory (commits, PRs, access reviews, vendor reviews).
- **Week 4**
  - Deliverable: control-narrative writing started for 30 controls.

### Agent #39 — Senior Privacy Engineer

- **Week 1**
  - Deliverable: data inventory v1 — every data element processed, classified, sensitivity-tagged.
- **Week 2**
  - Deliverable: privacy impact assessment template; first PIA against current state.
- **Week 3**
  - Deliverable: data-retention policy v0 with per-table retention rules.
- **Week 4**
  - Deliverable: privacy section of threat model updated.

### Agent #40 — Risk & Audit Lead

- **Week 1**
  - Deliverable: risk register v1 (the 10-item enterprise risk register).
- **Week 2**
  - Deliverable: incident response runbook v0; severity classification grid.
- **Week 3**
  - Deliverable: audit-log integrity continuous-verification design.
- **Week 4**
  - Deliverable: quarterly risk review cadence proposed.

### Agent #41 — Data Protection Officer

- **Week 1**
  - Deliverable: DPO registration prep with Data Protection Board.
- **Week 2**
  - Deliverable: data-subject request handling SOP.
- **Week 3**
  - Deliverable: breach notification SOP.
- **Week 4**
  - Deliverable: data-localisation audit on the current stack (Indian VPS, region locked).

---

## Sales, BD, GTM (roles 42–49)

### Agent #42 — Chief Revenue Officer

- **Week 1**
  - Deliverable: pricing model v1 (per-seat per-month for BFSI, with tiered usage); MSA template scoped.
- **Week 2**
  - Deliverable: design partner program v1 (terms, IP rights, exclusivity windows).
- **Week 3**
  - Deliverable: pilot LoI template legally reviewed.
- **Week 4**
  - Deliverable: pipeline tracking spreadsheet across 6 banks.

### Agent #43 — Enterprise AE (BFSI North)

- **Week 1**
  - Deliverable: warm intros mapped for HDFC, ICICI, Axis, Yes, IDFC First, RBL CISOs/CTOs/CIOs.
- **Week 2**
  - Deliverable: outreach sequence v1; 5 first emails sent.
- **Week 3**
  - Deliverable: first 2 introductory calls booked.
- **Week 4**
  - Deliverable: first demo slot booked (target: week 13 — first week of Phase 2).

### Agent #44 — Enterprise AE (BFSI South + PSBs)

- **Week 1**
  - Deliverable: SBI YONO + Federal + KVB + KB + Indian Bank + PSB outreach prep.
- **Week 2**
  - Deliverable: outreach sequence v1; first 5 emails sent.
- **Week 3**
  - Deliverable: first 2 calls booked.
- **Week 4**
  - Deliverable: first demo slot booked.

### Agent #45 — Solutions Architect (pre-sales)

- **Week 1**
  - Deliverable: integration architecture template; 3 reference architectures (net-banking, branch teller, transaction step-up).
- **Week 2**
  - Deliverable: demo equipment kit specced (laptop, Pixel 7, Samsung S22, R307 sensor, OTG cable, projection adapters).
- **Week 3**
  - Deliverable: demo dry-run with engineering team — Scenes 1 and 2 only.
- **Week 4**
  - Deliverable: SOW template for integration phase.

### Agent #46 — Customer Success Manager (BFSI)

- **Week 1**
  - Deliverable: pilot lifecycle template (kickoff → integration → soft launch → review → expansion).
- **Week 2**
  - Deliverable: bank-specific risk tracker.
- **Week 3**
  - Deliverable: quarterly business review template.
- **Week 4**
  - Deliverable: support escalation matrix.

### Agent #47 — Developer Advocate

- **Week 1**
  - Deliverable: conference calendar v1 (3 target conferences in phase 1).
- **Week 2**
  - Deliverable: first technical blog post drafted ("why we replaced credential storage with commitments").
- **Week 3**
  - Deliverable: first blog post published.
- **Week 4**
  - Deliverable: first conference talk abstract submitted.

### Agent #48 — Marketing Lead

- **Week 1**
  - Deliverable: brand audit; press list for tier-1 BFSI tech press.
- **Week 2**
  - Deliverable: BFSI landing page draft.
- **Week 3**
  - Deliverable: first press conversation booked.
- **Week 4**
  - Deliverable: marketing funnel v1 wired up (analytics).

### Agent #49 — Content / Demand-Gen Lead

- **Week 1**
  - Deliverable: content calendar v1 (12 pieces in phase 1).
- **Week 2**
  - Deliverable: first 2 pieces in production.
- **Week 3**
  - Deliverable: SEO strategy v1; first 5 target keywords identified.
- **Week 4**
  - Deliverable: webinar program v0.

---

## Operations (role 50)

### Agent #50 — Operations / Office Manager

- **Week 1**
  - Deliverable: vendor inventory (cloud, SaaS, hardware); contract dates tracked.
- **Week 2**
  - Deliverable: monthly close calendar; payroll calendar.
- **Week 3**
  - Deliverable: travel + procurement SOP for the device fleet and R307 sensors.
- **Week 4**
  - Deliverable: HR ops calendar (performance reviews timed to phase boundaries).

---

## Cross-team handoffs in weeks 1–4

| Handoff | From | To | When | Artefact |
|---|---|---|---|---|
| Schema purity test allowlist | Role 23 | Role 6, 7 | W1 | `tests/schema-purity.test.ts` |
| Demo bypass removal sign-off | Role 6 | Role 26 + Role 27 | W1 | PR review |
| Hash-chain spec | Role 11 | Role 8 + Role 13 | W1 | ADR 0010 |
| On-chain anchor spec | Role 25 | Role 8 + Role 21 | W1 | ADR 0011 |
| Pre-commit hook | Role 22 | Role 1 + all agents | W1 | `.husky/pre-commit` |
| Cross-tenant test matrix | Role 23 | Role 7 + Role 9 | W1 | `tests/tenant-isolation.test.ts` |
| Zod adoption ADR | Role 6 | Role 1 | W2 | ADR 0013 |
| RS256 JWT migration | Role 12 | Role 6 + Role 7 | W2 | C-028 PR |
| AuditAnchor contract on Base Sepolia | Role 25 | Role 8 + Role 21 | W2 | `contracts/deployed-addresses.json` |
| Audit-findings tracking doc | Role 26 | Role 1 | W2 | `docs/security/audit-findings.md` |
| Mobile subtree bootstrap | Role 17 + Role 4 | Role 5 + Role 21 | W3 | `mobile/` PRs |
| rapidsnark JNI POC | Role 17 | Role 11 + Role 27 | W3 | C-104 PR |
| Redesigned identity register | Role 6 | Role 17 (mobile client) | W3 | C-105 PR |
| Anchor Bank tenant seed | Role 7 | Role 14 + Role 45 | W3 | C-108 PR |
| Users view rendering | Role 14 | Role 32 (UX) + Role 26 (sec) | W3 | C-107 PR |
| Pain-point doc v1.1 | Role 29 | Role 28 + Role 42 | W3 | `01-pain-points.md` |
| Demo invitation drafts | Role 29 | Role 43 + Role 44 | W4 | invitation templates |
| Demo dry run | Role 45 | Role 1 + Role 28 + Role 42 | W4 | dry-run recording |
| Integration architecture template | Role 45 | Role 43 + Role 44 | W4 | reference architecture doc |
| First demo slot booked | Role 43 or 44 | Role 1 + Role 28 + Role 42 | W4 | calendar invite |

---

## Friday-cadence status format (each agent posts at end of week)

Every agent posts a 4-line update in the team channel each Friday by 18:00 IST:

```
Agent #N — <role title>
Tickets closed: <commit IDs or deliverable refs>
Tickets in-flight: <commit IDs>
Blocker / ask: <one sentence or "none">
Next-week focus: <one sentence>
```

Role 1 + the line VPs (2, 3, 4, 5, 28, 36, 42) read every Friday update and respond by Monday standup.

---

LAST_UPDATED: 2026-05-27
