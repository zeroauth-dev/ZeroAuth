# 50-person team — roster, mandates, KPIs

The full delivery team for the BFSI v1 horizon. Reduced from 51 to 50 after dropping the iOS-engineer slot (former role #22). The slot is repurposed to a second Senior Android Engineer focused on R307 USB-OTG driver and BiometricPrompt fallback reliability — see role 18.

The roster is grouped by line of business:

- **Engineering** — 27 (roles 1–27)
- **Product & Design** — 8 (roles 28–35)
- **Compliance & Risk** — 6 (roles 36–41)
- **Sales, BD, GTM** — 8 (roles 42–49)
- **Operations** — 1 (role 50)

Each row below has the same fields: **Title**, **Reports to**, **Mandate** (one sentence), **KPIs** (three bullets), **Key files / surfaces** they own.

Agents will be assigned one-to-one against these roles. The per-agent ticket list lives in `05-agents.md`.

---

## Engineering

### Role 1 — Chief Engineering Officer (CEO/CTO line)

**Reports to:** Founder.
**Mandate:** Owns engineering org. Final arbiter on architectural decisions captured in `/adr/`. Sign-off on every release.
**KPIs:**
- All P0 audit findings closed before phase 1 exit.
- Two consecutive months of "zero severity-1 incidents in production" by end of phase 4.
- 100 % of releases gated by passing CI + security-reviewer + cryptographer-reviewer subagent sign-off.

**Surfaces:** `/adr/`, `.github/workflows/`, release tags.

### Role 2 — VP Engineering, Backend

**Reports to:** Role 1.
**Mandate:** Owns the Node 20 + Express 4 + Postgres 16 + Redis stack and the `/v1/*`, `/api/console/*`, `/api/admin/*` surfaces.
**KPIs:**
- 100 % of new endpoints have a `(tenant_id, environment)` isolation test before merge.
- p95 verifier latency ≤ 800 ms by phase 1 exit.
- Zero PII columns in `users` schema verified by `tests/schema-purity.test.ts`.

**Surfaces:** `src/routes/`, `src/services/`, `src/middleware/`.

### Role 3 — VP Engineering, Frontend

**Reports to:** Role 1.
**Mandate:** Owns the React 19 + Vite 7 dashboard, the developer console, and the Docusaurus docs site.
**KPIs:**
- Lighthouse score ≥ 90 across all dashboard routes by phase 1 exit.
- 100 % of dashboard data calls pass through tenant-scoped React Query hooks.
- Zero PII leaks in client logs verified by Playwright trace audit.

**Surfaces:** `dashboard/`, `website/`, `docs/`.

### Role 4 — VP Engineering, Mobile

**Reports to:** Role 1.
**Mandate:** Owns the Android app, the rapidsnark JNI bridge, the StrongBox key wrap, the R307 driver, the device-support matrix.
**KPIs:**
- Cold-start proof latency ≤ 1.5 s p95 on Pixel 7 by phase 1 week 12.
- 100 % of device-fingerprinted production phones write a `device_attestations` audit row.
- Zero crashes on the device-support-matrix tier-1 list (top 12 Indian Android SKUs).

**Surfaces:** `mobile/` (new repo subtree to be created in week 1).

### Role 5 — VP Engineering, Infrastructure / SRE

**Reports to:** Role 1.
**Mandate:** Owns the VPS infrastructure, the Docker stack, the Caddy reverse proxy, the deploy pipeline, the CVE response process, observability.
**KPIs:**
- Mean time to detect (MTTD) ≤ 5 min for severity-1 incidents.
- 99.5 % uptime in phase 1 (pilot SLA); 99.95 % by phase 4.
- 100 % of deploys triggered via CI; zero out-of-band production changes.

**Surfaces:** `Caddyfile`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, `scripts/deploy*.sh`.

### Role 6 — Senior Backend Engineer (verifier service)

**Reports to:** Role 2.
**Mandate:** Owns `/v1/zkp/*` — the verifier path that loads the verification key, runs `snarkjs.groth16.verify`, persists the verification audit row, returns a session.
**KPIs:**
- p95 verifier latency ≤ 800 ms.
- 100 % of failing proofs result in `proof_invalid` machine code + audit row + zero side effects.
- Verifier-path test coverage ≥ 95 %.

**Surfaces:** `src/routes/v1/zkp.ts`, `src/services/zkp.ts`, `src/services/proof-pairing.ts`.

### Role 7 — Senior Backend Engineer (multi-tenancy + API keys)

**Reports to:** Role 2.
**Mandate:** Owns `(tenant_id, environment)` isolation, the `api_keys` table, the `za_{live,test}_*` key model, scope enforcement.
**KPIs:**
- 100 % of `/v1/*` endpoints pass the cross-tenant rejection test.
- API-key creation, revocation, rotation flows have an audit row on every action.
- Zero cross-tenant data leaks in penetration testing.

**Surfaces:** `src/middleware/tenant-auth.ts`, `src/services/tenants.ts`, `src/services/api-keys.ts`, `src/routes/console.ts`.

### Role 8 — Senior Backend Engineer (audit + blockchain integration)

**Reports to:** Role 2.
**Mandate:** Owns `audit_events` write path, hash-chain implementation, daily on-chain anchor cron, `DIDRegistry` interaction.
**KPIs:**
- 100 % of audit writes append a hash-chain row.
- Daily on-chain anchor success rate ≥ 99 %.
- Audit-integrity check runs in CI nightly and on every deploy.

**Surfaces:** `src/services/audit.ts` (new), `src/services/blockchain.ts`, `src/services/platform.ts`.

### Role 9 — Senior Backend Engineer (admin + reporting)

**Reports to:** Role 2.
**Mandate:** Owns `/api/admin/*`, the admin console, `audit-integrity` endpoint, the privacy-audit and compliance-export endpoints.
**KPIs:**
- All admin actions log an audit row (enforced by `tests/admin-audit-coverage.test.ts`).
- Compliance-export CSV generation completes in ≤ 30 s for 1 M-row tenants.
- 100 % of admin endpoints gated by `x-api-key` + IP allowlist.

**Surfaces:** `src/routes/admin.ts`, `src/services/usage.ts`.

### Role 10 — Senior Backend Engineer (compliance integrations)

**Reports to:** Role 2.
**Mandate:** Owns the SAML / OIDC adapters, the consent-capture flow under RBI Digital Lending Guidelines, the legal/regulator export pipelines.
**KPIs:**
- SAML/OIDC adapter passes the SSO interop test suite from one regulated bank pilot by end of phase 2.
- RBI Digital Lending consent flow runs end-to-end in a pilot loan-origination workflow.
- Audit-export package signed and rotated weekly.

**Surfaces:** `src/routes/saml.ts`, `src/routes/oidc.ts`, `src/services/consent.ts` (new).

### Role 11 — Senior Cryptography Engineer (circuit + prover)

**Reports to:** Role 1 (dotted: Role 2).
**Mandate:** Owns `identity_proof.circom`, the trusted-setup ceremony, the `*.zkey` and `verification_key.json` artefacts, prover correctness.
**KPIs:**
- Circuit version increments documented in ADR with security argument before merge.
- Trusted-setup ceremony complete with ≥ 6 contributors by phase 1 week 10.
- 100 % of generated proofs verify against the published `verification_key.json`.

**Surfaces:** `circuits/`, `adr/0005-*.md`, `docs/cryptography/`.

### Role 12 — Senior Cryptography Engineer (key management + HSM)

**Reports to:** Role 1 (dotted: Role 5).
**Mandate:** Owns the platform's key inventory, the HSM path (AWS CloudHSM or YubiHSM2), the StrongBox-rooted attestation chain for devices.
**KPIs:**
- Key rotation cadence documented and automated for JWT, session, admin keys.
- HSM-backed signer integrated by phase 4 week 4.
- 100 % of production private keys at-rest in HSM or StrongBox; none on disk.

**Surfaces:** `src/services/key-management.ts` (new), `docs/cryptography/key-inventory.md`.

### Role 13 — Mid Cryptography Engineer (Poseidon, hashing, audit hash-chain)

**Reports to:** Role 11.
**Mandate:** Owns Poseidon implementation correctness, the audit hash-chain construction, primitive-level test vectors.
**KPIs:**
- Poseidon implementation matches reference test vectors from `circomlibjs` exactly.
- Audit hash-chain spec proved correct against an external cryptographer review by phase 1 week 12.
- Hash-chain breakage detection runs in CI.

**Surfaces:** `src/services/poseidon.ts` (new wrapper), `src/services/audit.ts` (hash-chain helpers).

### Role 14 — Senior Frontend Engineer (admin dashboard)

**Reports to:** Role 3.
**Mandate:** Owns the React admin dashboard at `/dashboard` — tenant overview, users view, audit events, audit integrity, billing.
**KPIs:**
- 100 % of dashboard routes pass the "no-PII-rendered" Playwright assertion.
- Audit-events view streams new rows ≤ 2 s after server write.
- Lighthouse ≥ 90.

**Surfaces:** `dashboard/src/routes/`, `dashboard/src/components/`.

### Role 15 — Senior Frontend Engineer (developer console + kiosk demo UI)

**Reports to:** Role 3.
**Mandate:** Owns the developer console (signup, login, API keys, usage) and the kiosk web app used in Scene 2 of the demo.
**KPIs:**
- Developer signup-to-first-API-call flow completes in ≤ 4 min for a new external developer.
- Kiosk demo UI runs across Chrome / Edge / Safari with SSE.
- Demo substitution-attack helper toggle implemented.

**Surfaces:** `dashboard/src/routes/console/`, `dashboard/src/routes/demo/`.

### Role 16 — Mid Frontend Engineer (docs site + marketing landing)

**Reports to:** Role 3.
**Mandate:** Owns Docusaurus docs site, the landing page, the marketing assets, the developer experience around the public docs.
**KPIs:**
- Docs site search returns useful results on top-10 developer queries.
- Time-to-first-useful-API-call from docs ≤ 10 min for an external developer.
- Marketing landing converts ≥ 1 % to "book demo" CTA.

**Surfaces:** `website/`, `docs/`, public HTML at `/`.

### Role 17 — Senior Android Engineer (prover core + biometric prompt)

**Reports to:** Role 4.
**Mandate:** Owns the Android Pramaan core — rapidsnark JNI bridge, snarkjs/WebView prover for early phase, BiometricPrompt integration, StrongBox key wrap.
**KPIs:**
- Cold-start proof generation ≤ 1.5 s p95 on Pixel 7.
- Warm-start ≤ 600 ms p95.
- 100 % of authentications require a fresh BiometricPrompt assertion (no key cached past wrap).

**Surfaces:** `mobile/core/`, `mobile/prover/`.

### Role 18 — Senior Android Engineer (R307 USB-OTG + BiometricPrompt fallback) — *replaces former iOS slot*

**Reports to:** Role 4.
**Mandate:** Owns the R307 fingerprint sensor driver over USB-OTG, the host of fingerprint-capable Android SKUs, the fallback to BiometricPrompt when R307 is not present.
**KPIs:**
- R307 driver works on the device-support-matrix tier-1 list.
- BiometricPrompt fallback path covers ≥ 95 % of enrollments where R307 is unavailable.
- USB-OTG enumeration completes in ≤ 1.5 s.

**Surfaces:** `mobile/sensors/r307/`, `mobile/sensors/biometric_prompt/`.

### Role 19 — Mid Android Engineer (UX + flows + state)

**Reports to:** Role 4.
**Mandate:** Owns enrollment flow UI, login flow UI, transaction-confirmation sheet, in-app QR scanner, error states.
**KPIs:**
- Enrollment flow user-time ≤ 90 s on a fresh device (median).
- Transaction-confirmation sheet rendered ≤ 200 ms after FCM push.
- No raw biometric data ever surfaces in Android logcat (verified by automated logcat audit in CI).

**Surfaces:** `mobile/app/`, `mobile/ui/`.

### Role 20 — Senior IoT Engineer (kiosk + bridge)

**Reports to:** Role 4.
**Mandate:** Owns the IoT bridge (kiosk gateway for offline-capable lobby kiosks), the SSE back-channel, the QR pairing protocol on the bridge side.
**KPIs:**
- Bridge end-to-end pairing latency ≤ 2 s.
- Bridge survives 24 h burn-in without restart.
- Bridge audit events match server audit events (cross-check in CI).

**Surfaces:** `iot/`.

### Role 21 — Senior DevOps / SRE Engineer

**Reports to:** Role 5.
**Mandate:** Owns VPS infrastructure on `104.207.143.14`, the production Postgres + Redis + Caddy + app stack, the deploy pipeline, observability.
**KPIs:**
- Deploy success rate ≥ 99 % across rolling deploys.
- Severity-1 incident MTTD ≤ 5 min.
- 100 % of production secrets in `/opt/zeroauth/.env` rotated quarterly.

**Surfaces:** VPS, `Caddyfile`, `docker-compose.yml`, `scripts/deploy*.sh`, `monitoring/`.

### Role 22 — Mid DevOps Engineer (CI/CD + observability)

**Reports to:** Role 21.
**Mandate:** Owns GitHub Actions pipelines, the pre-commit hooks, the CVE monitor, structured logging via Winston, the metrics pipeline.
**KPIs:**
- CI median wall-clock ≤ 6 min from push to green.
- Pre-commit hooks block 100 % of staged secrets, raw biometric keys, and Co-Authored-By trailers.
- Metrics dashboards for verifier latency, audit-write lag, on-chain anchor lag.

**Surfaces:** `.github/workflows/`, `.git/hooks/pre-commit` (managed via husky or direct), `monitoring/`.

### Role 23 — Senior QA / SDET (E2E + load + security regression)

**Reports to:** Role 1.
**Mandate:** Owns the E2E test suite (Playwright), the load test suite (k6 or vegeta), the security regression suite.
**KPIs:**
- E2E suite covers every demo scene end-to-end.
- Load test sustains 500 RPS verify with ≤ 1 % error rate for 30 min.
- Security regression catches every closed P0 audit finding (no regression).

**Surfaces:** `tests/e2e/`, `tests/load/`, `tests/security/`.

### Role 24 — Mid QA Engineer (regression + manual + bug triage)

**Reports to:** Role 23.
**Mandate:** Owns the regression test plan for each release, the manual testing of biometric flows on a fleet of physical devices, the bug-triage queue.
**KPIs:**
- Regression suite executed on every release candidate.
- Physical device-test matrix covered before each release.
- Bug-triage SLA: P0 ≤ 4 h, P1 ≤ 1 day.

**Surfaces:** `tests/regression/`, the device-test fleet (managed).

### Role 25 — Senior Blockchain Engineer (contracts + Base L2)

**Reports to:** Role 1.
**Mandate:** Owns `DIDRegistry`, `Groth16Verifier`, contract deployment on Base Sepolia and (phase 4) Base mainnet, the audit anchor contract, contract upgradability strategy.
**KPIs:**
- Contracts deployed and verified on Basescan for Sepolia and mainnet.
- Daily anchor success rate ≥ 99 %.
- External contract audit clean by phase 3 exit (Trail of Bits or equivalent).

**Surfaces:** `contracts/`, `scripts/deploy-contracts.ts`, `contracts/deployed-addresses.json`.

### Role 26 — Senior Security Engineer (red team + AppSec)

**Reports to:** Role 1 (dotted: Role 36).
**Mandate:** Owns the OWASP top-10 posture, penetration testing internal + external, the bug-bounty program, the security-reviewer subagent operation.
**KPIs:**
- Quarterly internal pentest report; one external pentest before phase 2 exit.
- Bug bounty live by phase 3 with disclosure SLA.
- Security-reviewer subagent invoked on every PR touching sensitive paths.

**Surfaces:** `.claude/agents/security-reviewer.md`, `docs/security/`, bug-bounty platform.

### Role 27 — Senior Security Engineer (cryptanalysis + circuit review)

**Reports to:** Role 1 (dotted: Role 11).
**Mandate:** Owns the cryptographer-reviewer subagent operation, the external cryptographer engagement, the circuit-review process, the trusted-setup ceremony coordination.
**KPIs:**
- External cryptographer review complete on `identity_proof.circom` v1.2 by phase 1 week 10.
- Trusted-setup ceremony complete with ≥ 6 named contributors and transcripts published.
- Cryptographer-reviewer subagent invoked on every PR touching `circuits/`, `contracts/`, `src/services/zkp.ts`, `src/services/identity.ts`.

**Surfaces:** `.claude/agents/cryptographer-reviewer.md`, `circuits/`, `docs/cryptography/`.

---

## Product & Design

### Role 28 — Chief Product Officer

**Reports to:** Founder.
**Mandate:** Owns the product roadmap, vertical prioritisation (BFSI → Healthcare → Web3), the design partner program.
**KPIs:**
- Three BFSI design partner LoIs by phase 1 exit.
- Bank demo signed off by all six target banks by phase 2 week 4.
- Healthcare demo specification ready by phase 2 week 12.

### Role 29 — Senior Product Manager (BFSI)

**Reports to:** Role 28.
**Mandate:** Owns the bank demo, the BFSI pain-point research, the bank-CISO/CFO/CRO narrative.
**KPIs:**
- Anchor Bank demo scene-by-scene specification owned and current.
- Pain-point document (`01-pain-points.md`) updated with feedback after every bank presentation.
- Three banks complete the demo + pilot decision in phase 2.

### Role 30 — Product Manager (Healthcare)

**Reports to:** Role 28.
**Mandate:** Owns the healthcare vertical roadmap, ABDM (Ayushman Bharat Digital Mission) integration spec, hospital chain pilot research.
**KPIs:**
- Healthcare pain-point document by phase 2 week 8.
- Healthcare demo specification by phase 3 week 4.
- One healthcare design partner LoI by phase 3 exit.

### Role 31 — Product Manager (Developer Experience)

**Reports to:** Role 28.
**Mandate:** Owns the SDK strategy (Node, Python, Java, Android, Web), the developer onboarding flow, the docs UX.
**KPIs:**
- Node SDK shipped by phase 1 week 10.
- Time-to-first-API-call ≤ 10 min for a new external developer.
- Developer NPS ≥ 40 by phase 3.

### Role 32 — Senior Designer (Dashboard UX)

**Reports to:** Role 28.
**Mandate:** Owns the dashboard's visual + interaction design, the design system, the demo's projector aesthetics.
**KPIs:**
- Design system tokens consumed by 100 % of dashboard components.
- Bank-CISO usability test sessions complete pre-demo for each scene.
- Lighthouse accessibility ≥ 95.

### Role 33 — Designer (Mobile UX)

**Reports to:** Role 28.
**Mandate:** Owns the Android app's UX — enrollment flow, login sheet, transaction-confirmation sheet, error states.
**KPIs:**
- Enrollment user-test median ≤ 90 s on first run.
- Transaction-confirmation sheet comprehension ≥ 95 % across user-test cohorts.
- Error states cover the top-20 failure paths.

### Role 34 — Technical Writer (developer docs)

**Reports to:** Role 31.
**Mandate:** Owns `docs/api_contract.md`, `docs/error_codes.md`, the integration guides, the SDK READMEs.
**KPIs:**
- API contract current to within 24 h of any endpoint change.
- 100 % of error codes documented with cause + remediation.
- "Time to first-API-call" ≤ 10 min validated by external developer studies.

### Role 35 — Technical Writer (compliance + audit + legal docs)

**Reports to:** Role 36.
**Mandate:** Owns `docs/threat_model.md`, `docs/compliance/`, the SOC 2 + ISO 27001 evidence pack, the regulator briefing pack.
**KPIs:**
- Threat model updated with every architecture change.
- SOC 2 evidence pack ready for auditor at phase 2 week 12.
- RBI briefing pack ready by phase 3 week 8.

---

## Compliance & Risk

### Role 36 — Chief Compliance Officer

**Reports to:** Founder.
**Mandate:** Owns the compliance roadmap — DPDP, RBI Master Directions, SOC 2, ISO 27001, regulator engagement.
**KPIs:**
- SOC 2 Type II report by phase 3 exit.
- ISO 27001 certificate by phase 3 exit.
- RBI sandbox acceptance by phase 3 exit.

### Role 37 — Senior Compliance Lead (DPDP + RBI)

**Reports to:** Role 36.
**Mandate:** Owns DPDP Act mapping, RBI Master Directions mapping, RBI Digital Lending Guidelines compliance, regulator queries.
**KPIs:**
- DPDP §2(t) legal memo on commitments (with external counsel) by phase 1 week 9.
- RBI Master Direction on IT Governance compliance matrix by phase 2 week 4.
- Zero regulator open queries by phase 3 exit.

### Role 38 — Senior Compliance Lead (SOC 2 + ISO 27001)

**Reports to:** Role 36.
**Mandate:** Owns the SOC 2 Type I + II evidence period, the ISO 27001 Stage 1 + 2 audits, the auditor relationship.
**KPIs:**
- SOC 2 Type I report by phase 2 exit.
- SOC 2 Type II report by phase 3 exit.
- ISO 27001 certificate by phase 3 exit.

### Role 39 — Senior Privacy Engineer

**Reports to:** Role 36.
**Mandate:** Owns privacy by design audits of every feature, the data inventory, the data-minimisation enforcement, the DPDP impact assessment for each release.
**KPIs:**
- Zero PII columns in `users` schema verified continuously.
- Privacy impact assessment current for every release.
- Quarterly external privacy review clean.

### Role 40 — Risk & Audit Lead

**Reports to:** Role 36.
**Mandate:** Owns the risk register, the incident-response process, the audit-log integrity continuous verification, the on-chain anchor SLA.
**KPIs:**
- Risk register reviewed weekly, gaps tracked to closure.
- Audit-log integrity verification runs hourly with alerts.
- Incident response runbook tested quarterly.

### Role 41 — Data Protection Officer (DPO)

**Reports to:** Role 36.
**Mandate:** Owns DPO function under DPDP §10, customer data-subject requests, regulator notifications, data-breach response.
**KPIs:**
- DPO appointment registered with DPB.
- Data-subject request SLA ≤ 30 days.
- Quarterly compliance report to the board.

---

## Sales, BD, GTM

### Role 42 — Chief Revenue Officer

**Reports to:** Founder.
**Mandate:** Owns commercial strategy, pricing, the design partner program, enterprise sales pipeline.
**KPIs:**
- ₹X cr ACV in signed pilot agreements by phase 2 exit.
- First paid bank in production by phase 4 exit.
- BFSI pipeline ≥ ₹Y cr by phase 4 exit.

### Role 43 — Enterprise AE (BFSI North)

**Reports to:** Role 42.
**Mandate:** Owns relationships with HDFC, ICICI, Yes, IDFC First, Axis (HQs in Mumbai / NCR).
**KPIs:**
- Demo with each of 5 banks by phase 1 exit.
- Two pilots signed by phase 2 exit.

### Role 44 — Enterprise AE (BFSI South + PSBs)

**Reports to:** Role 42.
**Mandate:** Owns relationships with SBI YONO, Federal, Karnataka Bank, Karur Vysya, Indian Bank, plus PSBs.
**KPIs:**
- Demo with each of 5 banks by phase 1 exit.
- One pilot signed by phase 2 exit.

### Role 45 — Solutions Architect (pre-sales)

**Reports to:** Role 42.
**Mandate:** Owns technical pre-sales — runs the live demos in front of customers, drafts the integration architecture, signs the technical SOW.
**KPIs:**
- 100 % of demos delivered without operator intervention beyond the script.
- Time-to-integration-SOW ≤ 2 weeks after pilot agreement.

### Role 46 — Customer Success Manager (BFSI)

**Reports to:** Role 42.
**Mandate:** Owns post-sale relationships — pilot management, quarterly business reviews, expansion accounts, renewals.
**KPIs:**
- 100 % of pilots reach a go/no-go decision in ≤ 12 weeks.
- Net revenue retention ≥ 110 % by phase 4 exit.

### Role 47 — Developer Advocate

**Reports to:** Role 31 (dotted: Role 42).
**Mandate:** Owns external developer engagement — conferences, hackathons, blog content, sample integrations.
**KPIs:**
- 3 conference talks delivered in phase 1.
- 1,000 active developer accounts by phase 3 exit.

### Role 48 — Marketing Lead

**Reports to:** Role 42.
**Mandate:** Owns brand, content strategy, PR, regulator-facing communications.
**KPIs:**
- One tier-1 BFSI press placement in phase 2.
- Brand awareness measured via inbound demo requests ≥ 10/week by phase 3.

### Role 49 — Content / Demand-Gen Lead

**Reports to:** Role 48.
**Mandate:** Owns content production, SEO, email campaigns, webinars, lead-gen pipeline.
**KPIs:**
- 50 long-form pieces published by phase 3 exit.
- Inbound MQL/month ≥ 100 by phase 3 exit.

---

## Operations

### Role 50 — Operations / Office Manager

**Reports to:** Founder.
**Mandate:** Owns finance ops, HR ops, vendor management, office and travel, contracts admin.
**KPIs:**
- Monthly close ≤ T+5 business days.
- Vendor contracts audited quarterly.
- All vendor security questionnaires on file.

---

## Role-to-agent mapping convention

Every role above maps 1:1 to an AI agent. Agent identity is the role number — e.g. agent #17 is the Senior Android (prover core) agent, agent #25 is the Senior Blockchain agent. The per-agent ticket list in `05-agents.md` is keyed by role number.

When two agents need to coordinate, the convention is:
- The agent with the lower role number proposes the interface.
- The agent with the higher role number reviews + signs off.
- Cross-line handoffs go through the line's VP (roles 2, 3, 4, 5, 28, 36, 42).

---

LAST_UPDATED: 2026-05-27
