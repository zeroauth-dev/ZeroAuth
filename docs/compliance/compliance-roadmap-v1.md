# Compliance roadmap — BFSI v1 (weeks 1–52)

**Status:** v1 — first issue.
**Time horizon:** 2026-05-25 (Phase 0 week 1) → 2027-05-21 (Phase 4 close).
**Owner:** Agent #36 (Chief Compliance Officer).
**Reviewer:** Agent #1 (founder / CTO).
**Companion documents:**

- [docs/plan/bfsi-v1/00-README.md](../plan/bfsi-v1/00-README.md) — phase map + standing constraints.
- [docs/plan/bfsi-v1/06-ways-of-working.md](../plan/bfsi-v1/06-ways-of-working.md) — branch policy, commit gates, escalation.
- [docs/plan/bfsi-v1/agents/agent-36-cco.md](../plan/bfsi-v1/agents/agent-36-cco.md) — CCO daily tickets weeks 1–4.
- [docs/plan/bfsi-v1/agents/agent-37-compliance-dpdp.md](../plan/bfsi-v1/agents/agent-37-compliance-dpdp.md) — DPDP + RBI lead.
- [docs/plan/bfsi-v1/agents/agent-38-compliance-soc2.md](../plan/bfsi-v1/agents/agent-38-compliance-soc2.md) — SOC 2 + ISO lead.
- [docs/threat_model.md](../threat_model.md) — attack catalogue cross-referenced by control narratives.
- [docs/security/audit-findings.md](../security/audit-findings.md) — Phase 0 audit findings mapped to controls.

This document is the source of truth for what regulator-defensibility looks like by month 12 and how we get there. Every quarterly milestone has a named owner, a target week, a verifiable deliverable, and dependencies on prior deliverables. Update this file (and publish a retrospective) at the close of every quarter.

---

## 1. Scope

### 1.1 In-scope

The "ZeroAuth platform" certified by this roadmap is the union of:

- **Backend HTTP API** — `https://api.zeroauth.dev/v1/*` (tenant-scoped), `/api/console/*` (developer console), `/api/admin/*` (operator), `/api/health` (unauthenticated).
- **React admin dashboard** — `dashboard/` static bundle served at `/dashboard`.
- **Developer console UI** — same React bundle, console-flagged routes.
- **IoT bridge** — `iot/` reference firmware + USB-CDC / R307 fingerprint integration covered in Pramaan v1.
- **Android prover app** — `mobile/prover/` (Android 11+), Play Integrity attestation, rapidsnark prover, Pramaan QR + NFC pairing flow.
- **Smart contracts** — `DIDRegistry`, `Groth16Verifier`, `AuditAnchor` on Base Sepolia (Phase 0 → Phase 3) and Base mainnet (Phase 4).
- **Circom circuit** — `circuits/identity_proof.circom` v1.2 and any successor versions covered by ADRs under `/adr/`.
- **CI/CD pipeline** — GitHub Actions workflows under `.github/workflows/` (`ci.yml`, `deploy.yml`, `cve-monitor.yml`).
- **Production infrastructure** — VPS at `104.207.143.14` running the Caddy + Postgres + Redis + app docker compose stack under user `zeroauth-deploy`.
- **Corporate IT** — laptops, SSO (Google Workspace), password manager (1Password), code repository hosting (GitHub Enterprise Cloud), shared drives. Required for SOC 2 + ISO 27001 ISMS scope.

### 1.2 Out of scope

- **Customer banks' own infrastructure** — branch IT, core banking systems, RBI-reportable transaction systems are not in scope. ZeroAuth provides verification artefacts; customers consume them inside their own audit perimeter.
- **The marketing site** — vanilla HTML at `zeroauth.dev/` (landing page) and Docusaurus at `/docs/` are advisory content only; they do not handle PII or biometric data and are excluded from the SOC 2 boundary. They are in scope for the DPDP cookie + analytics review only.
- **iOS prover** — explicitly out of scope until v2 per `00-README.md`.
- **Third-party SaaS used internally** — covered by vendor management controls (CC9.2), not by primary controls.

### 1.3 Geographic scope

- **Primary jurisdiction:** India. RBI is the prudential regulator for any BFSI customer; the Data Protection Board of India (DPB) is the privacy regulator under DPDP Act 2023.
- **Secondary jurisdiction (Phase 4 onward):** GCC (UAE, KSA) and UK regulatory mapping. Mapping work is deferred to v2 of this roadmap; placeholder entries in Q4 row only.
- **Data residency:** Production database, audit log, and proof archive are hosted in `ap-south-1` (Mumbai) on the primary VPS and replicated to a Hyderabad DR site (Phase 4 deliverable). Cross-border processor flows are limited to GitHub (build/CI), Sentry (error reporting, scrubbed), and Cloudflare (TLS termination on the marketing site) — each covered by a DPA on file.

---

## 2. Frameworks tracked

For each framework we record: scope, target date, evidence collection cadence, and the auditor or counsel relationship.

### 2.1 DPDP Act 2023

- **Applicability:** ZeroAuth is a **Data Fiduciary** for any tenant onboarding flow that puts an individual's identifying information into our verification pipeline. We are a **Data Processor** for tenants who issue verifications on behalf of their own data principals. Both roles apply; PIA classifies the surface.
- **Sections binding ZeroAuth:** §2 (definitions, especially §2(t) "personal data" applied to commitments + DID), §4 (lawful processing), §8 (security safeguards + breach notification within 72 h), §13 (cross-border transfers), §17 (Data Protection Officer), §33 (penalties).
- **Target date:** §2(t) memo + Phase-0 PIA signed by end of Phase 0 (week 2, 2026-06-05). Compliant operation from week 1 — the Act is already in force.
- **Evidence collection cadence:** PIA reviewed quarterly; breach playbook tabletop tested quarterly (first tabletop Q3 week 33).
- **Counsel relationship:** External DPDP counsel engaged Phase 0 week 1 (Agent #37 leads). Standing retainer for §§ interpretation queries.
- **Regulator:** Data Protection Board of India (DPB). First filing under §17 (DPO appointment + processor disclosures): Phase 0 week 13.

### 2.2 RBI Master Direction on IT Governance, Risk, Controls and Assurance Practices (April 2023, updated)

- **Applicability:** Applies to "regulated entities" — i.e., the banks consuming ZeroAuth. ZeroAuth is a third-party service provider; the MD §9 requires the regulated entity to subject ZeroAuth to the same controls. We meet them prospectively to make pilots possible.
- **Sections binding ZeroAuth (de facto):** §5 (IT governance), §6 (IT infrastructure), §6.4 (audit logs + segregation of duties), §7 (information security), §8 (vulnerability assessment), §10 (third-party risk).
- **Target date:** Compliance matrix v1 signed by Phase 1 exit (week 12, 2026-08-21).
- **Evidence collection cadence:** Quarterly re-validation, plus on every new bank-pilot kickoff.
- **Auditor relationship:** None directly; the bank's own internal auditor inspects us under §10. Inspection-readiness checklist (`docs/compliance/rbi/inspection-readiness-checklist.md`) is the artefact we hand over.
- **Regulator interface:** Indirect — through the regulated bank's compliance team.

### 2.3 RBI Digital Lending Guidelines (Sept 2022, updated Aug 2024)

- **Applicability:** Activates for any lending-flow integration. Phase 1 demo Scene 4 (Anchor Bank step-up auth for a loan disbursement) intersects.
- **Sections binding ZeroAuth:** Para 3 (data localisation), Para 4 (consent), Para 5 (disclosures), Para 6 (grievance redressal), Para 7 (KFS — Key Fact Statement).
- **Target date:** Lending mapping v1 by Phase 1 exit (week 12). Para 3 (data localisation) verified by Phase 2 exit (week 26) — the Hyderabad DR replica must be operational.
- **Evidence collection cadence:** Per-tenant attestation: every bank we onboard signs a clause that the lending flow they expose through ZeroAuth is consent-captured per Para 4 and audit-logged per §6.4 of the IT MD.
- **Counsel relationship:** Same external DPDP/RBI counsel covers this MD.

### 2.4 RBI Master Direction on Digital Payment Security Controls (Feb 2021)

- **Applicability:** Activates for transaction-step-up integrations. Phase 1 Scene 4 (high-value-txn step-up) intersects.
- **Sections binding ZeroAuth:** §5 (governance), §5.3 (high-value transaction additional auth), §6 (user awareness), §7 (mobile application security), §8 (cryptography), §10 (incident management).
- **Target date:** DPS mapping v1 by Phase 1 exit (week 12). §7 mobile-app security evidenced by Phase 2 (Play Integrity attestation, R-class certificate pinning, in-app secrets handling).
- **Evidence collection cadence:** Annual SAR (Security Assurance Report) submission to RBI through partner bank, starting Phase 4.

### 2.5 RBI Master Direction on KYC (current revision)

- **Applicability:** Activates at enrollment. ZeroAuth's enrollment flow anchors a SHA-256 biometric → DID + Poseidon commitment; the bank's KYC officer still owns the underlying CKYC / V-CIP record. We act as the **biometric matcher and audit-trail provider**, not as the KYC custodian.
- **Sections binding ZeroAuth:** §3 (definitions), §16 (V-CIP), §38 (record retention), §44 (periodic updation).
- **Target date:** KYC mapping v1 by Phase 1 exit; periodic-refresh hook tested by Phase 2.
- **Evidence collection cadence:** Per-tenant attestation; ZeroAuth's role boundary is documented in the per-tenant data-processing agreement template.

### 2.6 SOC 2 Type I

- **Trust Service Criteria in scope:** Security (CC1–CC9), Confidentiality (C1.1–C1.2), Availability (A1.1–A1.3). Privacy is covered by DPDP separately.
- **Target dates:** Auditor engaged Phase 0 week 4 (2026-06-15). Point-in-time observation: week 22 (2026-10-12). Report delivery: end of Phase 2 (week 26, 2026-11-13).
- **Evidence collection cadence:** Continuous — controls implemented commit-by-commit through Phase 0 + Phase 1; the evidence collector tool aggregates artefacts automatically once chosen (decision by Phase 1 exit).
- **Auditor relationship:** Single firm selected from Sequence / Strike Graph / A-LIGN / others (shortlist deliverable A36-W1-Tue). Engagement letter signed Phase 0 week 4. Quarterly check-ins.

### 2.7 SOC 2 Type II

- **Same TSC scope as Type I.**
- **Target dates:** Evidence period weeks 27–39 (2026-11-16 → 2027-02-12). Report delivery: end of Phase 3 (week 39).
- **Evidence collection cadence:** Continuous + periodic — same evidence collector tool, supplemented by quarterly access reviews, quarterly vendor reviews, weekly incident-log dumps.
- **Auditor relationship:** Same firm as Type I; the Type II engagement is the natural continuation.

### 2.8 ISO/IEC 27001:2022

- **Scope:** Whole ISMS — the platform components in §1.1 plus corporate IT.
- **Target dates:** Lead auditor engaged Phase 0 week 4. Stage 1 audit week 23 (2026-10-19) — documentation review. Stage 2 audit week 36 (2027-01-22) — operational effectiveness. Certificate by end of Phase 3 (week 39, 2027-02-12). Annex A Statement of Applicability draft due Phase 0 exit; final by week 22.
- **Evidence collection cadence:** Continuous. Internal audit cycle: Q1 of every certification year. Management review: quarterly.
- **Auditor relationship:** NABCB-accredited certification body selected from BSI / TÜV SÜD / DNV / Bureau Veritas / Intertek (shortlist deliverable A36-W1-Wed).

### 2.9 RBI Regulatory Sandbox

- **Applicability:** Optional but strategically required — sandbox cohort acceptance is a credibility signal for bank partnership conversations and gives ZeroAuth a regulator-supervised live-data window.
- **Target dates:** Application window weeks 35–39 (cohort theme TBA — we target the next "Prevention of Frauds" or "Customer Identity & KYC" cohort). Acceptance decision by end of Phase 3.
- **Evidence collection cadence:** Application is a one-time deliverable; once accepted, monthly reporting to RBI FinTech Department for the 6-month sandbox runtime.
- **Counsel relationship:** External RBI counsel briefed by week 30; application drafted weeks 30–34.

---

## 3. Quarterly milestones

Quarters are aligned to the 12-week sprints of `00-README.md`'s phase map. Each quarter is 13 weeks; Q4 absorbs the 52-week year remainder.

### 3.1 Q1 — weeks 1–13 (2026-05-25 → 2026-08-21)

This is the **Phase 0 + Phase 1 first half** quarter. Establish the compliance scaffold and engage external partners.

- **DPDP §2(t) memo signed** by external counsel, week 4 (commitments + DID classified, cross-border treatment per §13 documented).
- **Phase-0 Privacy Impact Assessment (PIA)** signed, week 2.
- **RBI MD on IT Governance §§5–8 compliance matrix v1** drafted, week 8; signed by week 12.
- **RBI Digital Lending + Digital Payment Security + KYC mappings v1** published, week 12.
- **SOC 2 auditor engagement letter signed**, week 4.
- **ISO 27001 lead auditor engagement letter signed**, week 4.
- **External DPDP counsel engagement letter signed**, week 2.
- **External cryptographer (independent peer review)** engaged, week 4.
- **ISO 27001 Annex A applicability** v0 (week 2), v1 (week 22) — Q1 closes with v0.
- **DPB filing under §17 (DPO appointment + processor disclosures)** submitted, week 13.
- **Phase 0 exit gate review with Agent #1 + Agent #36 + Agent #42**, week 2.
- **Phase 1 first-half review**, week 8.

### 3.2 Q2 — weeks 14–26 (2026-08-24 → 2026-11-20)

Phase 1 second half through Phase 2 first half. Type I evidence + ISO Stage 1.

- **SOC 2 Type I evidence period** begins week 14, closes week 22 (8-week observation window).
- **First SOC 2 Type I report** delivered week 26.
- **ISO 27001 Stage 1 audit** week 23 (documentation review).
- **ISO 27001 Annex A SoA v1** finalised week 22.
- **Trusted-setup ceremony** held week 10 (artefact week 11) — feeds ISO control A.5.31 (Legal, statutory, regulatory, contractual requirements relating to cryptography). See [docs/cryptography/trusted-setup-ceremony.md](../cryptography/trusted-setup-ceremony.md).
- **Bank-pilot 1, 2, 3 contracts** signed by week 26 with DPDP §13 + RBI MD §10 clauses embedded.
- **First quarterly access review** (corporate IT + production VPS + GitHub + Postgres roles), week 26.
- **First quarterly vendor review** (GitHub, Sentry, Cloudflare, 1Password, the SOC 2 auditor itself, the ISO certification body), week 26.
- **Q1 retrospective** posted to `docs/compliance/retros/2026-q1.md` by week 14.

### 3.3 Q3 — weeks 27–39 (2026-11-23 → 2027-02-12)

SOC 2 Type II evidence, ISO Stage 2, RBI sandbox application.

- **SOC 2 Type II evidence period** runs weeks 27–39 (full 13-week observation).
- **ISO 27001 Stage 2 audit** week 36; certificate issuance week 38 (subject to no major non-conformities).
- **RBI sandbox application** drafted weeks 30–34, submitted week 35; acceptance decision week 39.
- **DPDP §8 breach-notification SOP tabletop** week 33 (first scheduled exercise, results in `docs/compliance/dpdp/tabletop-2026-q3.md`).
- **Bug bounty programme** opened week 27 (vendor: HackerOne or BugCrowd; selection by week 27, deliverable A36-W?? in Phase 3 ticket lists).
- **Smart-contract third-party audit** (Trail of Bits or equivalent) completed weeks 16–24; final report delivered by week 26, remediated by week 30 — closing this Q3 dependency.
- **Q2 retrospective** posted to `docs/compliance/retros/2026-q2.md` by week 27.

### 3.4 Q4 — weeks 40–52 (2027-02-15 → 2027-05-21)

Reports, RBI sandbox acceptance, lookahead to GCC/UK.

- **SOC 2 Type II report** delivered week 42 (auditor lag from period close).
- **RBI sandbox cohort acceptance** confirmed week 40 (or rolled to next cohort if not accepted; mitigation plan covers either branch).
- **ISO 27001 certificate** published on the marketing site week 44.
- **Mainnet contract deployment** week 46 — triggers a delta to ISO Annex A + SOC 2 CC scope; covered by a "change-in-scope" memo and re-confirmation letter from the auditor.
- **HSM-backed signer migration** complete week 48; an SoA update lands week 49.
- **First paid bank in production**, week 50.
- **GCC/UK regulatory mapping** — deferred to roadmap v2 (target Q1 of next FY). Placeholder entry: scoping memo by week 52 to seed v2 planning.
- **DR exercise** (failover from `104.207.143.14` to the Hyderabad replica) week 47.
- **Q3 retrospective** posted to `docs/compliance/retros/2026-q3.md` by week 40.
- **Q4 retrospective + roadmap v2 dispatch** posted to `docs/compliance/retros/2026-q4.md` by week 52.

---

## 4. Per-quarter deliverables

Each row: `Deliverable ID` (`D-<quarter>-<seq>`), `Owner` (agent #), `Target week`, `Depends on`.

### 4.1 Q1

| ID | Deliverable | Owner | Target wk | Depends on |
|---|---|---|---|---|
| D-Q1-01 | Compliance roadmap v1 published (this doc) | #36 | 1 | A01-W1-Mon |
| D-Q1-02 | SOC 2 + ISO + DPDP external counsel & auditor shortlists | #36 + #38 | 1 | D-Q1-01 |
| D-Q1-03 | SOC 2 RFP issued | #36 + #38 | 3 | D-Q1-02 |
| D-Q1-04 | ISO 27001 lead auditor outreach + engagement | #36 + #38 | 3 | D-Q1-02 |
| D-Q1-05 | DPDP §2(t) memo from counsel (v1) | #37 + #41 | 4 | D-Q1-02 |
| D-Q1-06 | Phase-0 PIA signed | #37 + #39 | 2 | D-Q1-01 |
| D-Q1-07 | SOC 2 auditor engagement letter signed | #36 + #38 | 4 | D-Q1-03 |
| D-Q1-08 | ISO 27001 lead auditor engagement letter signed | #36 + #38 | 4 | D-Q1-04 |
| D-Q1-09 | ISO Annex A applicability v0 | #38 | 2 | D-Q1-02 |
| D-Q1-10 | Audit findings → SOC 2 + ISO control mapping | #36 + #38 + #26 | 3 | C-31 (audit findings doc closed) |
| D-Q1-11 | Evidence collector tool decision (Drata / Vanta / Sprinto / in-house) | #36 + #38 + #21 | 3 | D-Q1-07 |
| D-Q1-12 | First 30 SOC 2 control narratives | #38 | 2 | D-Q1-09 |
| D-Q1-13 | RBI MD on IT-Gov §6.4 deep-dive | #37 | 1 | D-Q1-01 |
| D-Q1-14 | RBI MD on IT-Gov compliance matrix v0 | #37 | 3 | D-Q1-13 |
| D-Q1-15 | RBI MD on IT-Gov compliance matrix v1 | #37 | 8 | D-Q1-14 |
| D-Q1-16 | RBI Digital Lending mapping v1 | #37 | 12 | D-Q1-15 |
| D-Q1-17 | RBI Digital Payment Security Controls mapping v1 | #37 | 12 | D-Q1-15 |
| D-Q1-18 | RBI KYC MD mapping v1 | #37 | 12 | D-Q1-15 |
| D-Q1-19 | DPB filing under §17 (DPO appointment) | #36 + #37 | 13 | D-Q1-05 |
| D-Q1-20 | Phase-1 first-half compliance review | #1 + #36 | 8 | D-Q1-15 |

### 4.2 Q2

| ID | Deliverable | Owner | Target wk | Depends on |
|---|---|---|---|---|
| D-Q2-01 | Q1 retrospective published | #36 | 14 | D-Q1-20 |
| D-Q2-02 | SOC 2 Type I evidence-period kickoff | #38 | 14 | D-Q1-07, D-Q1-11 |
| D-Q2-03 | First 90 SOC 2 control narratives complete | #38 | 16 | D-Q1-12 |
| D-Q2-04 | Full 120+ SOC 2 control narratives complete | #38 | 20 | D-Q2-03 |
| D-Q2-05 | ISO Annex A SoA v1 finalised | #38 | 22 | D-Q1-09 |
| D-Q2-06 | ISO 27001 Stage 1 audit held | #36 + #38 | 23 | D-Q2-05 |
| D-Q2-07 | Stage 1 non-conformities (if any) closed | #38 | 25 | D-Q2-06 |
| D-Q2-08 | Trail of Bits smart-contract audit final report | #25 + #36 | 24 | D-Q1-15 |
| D-Q2-09 | Contract audit remediation merged | #25 + #26 | 26 | D-Q2-08 |
| D-Q2-10 | SOC 2 Type I report delivered | #36 + #38 | 26 | D-Q2-04 |
| D-Q2-11 | Three bank-pilot contracts signed with RBI/DPDP clauses | #36 + #42 | 26 | D-Q1-15, D-Q1-19 |
| D-Q2-12 | First quarterly access review evidence | #36 + #21 | 26 | D-Q2-02 |
| D-Q2-13 | First quarterly vendor review evidence | #36 | 26 | D-Q2-02 |
| D-Q2-14 | Trusted-setup ceremony artefact published | #11 + #12 + #36 | 11 | C-018 (circuit-version lock) |

### 4.3 Q3

| ID | Deliverable | Owner | Target wk | Depends on |
|---|---|---|---|---|
| D-Q3-01 | Q2 retrospective published | #36 | 27 | D-Q2-10 |
| D-Q3-02 | SOC 2 Type II evidence-period kickoff | #38 | 27 | D-Q2-10 |
| D-Q3-03 | Bug bounty programme launched | #26 + #36 | 27 | D-Q2-09 |
| D-Q3-04 | RBI sandbox application drafted v0 | #36 + #37 | 32 | D-Q1-16 |
| D-Q3-05 | RBI sandbox application v1 (review-ready) | #36 + #37 | 34 | D-Q3-04 |
| D-Q3-06 | RBI sandbox application submitted | #36 + #37 | 35 | D-Q3-05 |
| D-Q3-07 | DPDP §8 breach-notification tabletop held | #36 + #37 + #21 | 33 | D-Q1-05 |
| D-Q3-08 | Tabletop after-action report published | #36 | 34 | D-Q3-07 |
| D-Q3-09 | ISO 27001 internal audit cycle complete | #38 | 34 | D-Q2-05 |
| D-Q3-10 | ISO 27001 management review held | #36 + #1 | 35 | D-Q3-09 |
| D-Q3-11 | ISO 27001 Stage 2 audit held | #36 + #38 | 36 | D-Q3-10 |
| D-Q3-12 | Stage 2 non-conformities (if any) closed | #38 | 38 | D-Q3-11 |
| D-Q3-13 | ISO 27001 certificate issued | #36 | 38 | D-Q3-12 |
| D-Q3-14 | SOC 2 Type II evidence-period close + handover | #38 | 39 | D-Q3-02 |
| D-Q3-15 | RBI sandbox acceptance decision recorded | #36 + #37 | 39 | D-Q3-06 |
| D-Q3-16 | Second quarterly access + vendor review evidence | #36 + #21 | 39 | D-Q2-12, D-Q2-13 |

### 4.4 Q4

| ID | Deliverable | Owner | Target wk | Depends on |
|---|---|---|---|---|
| D-Q4-01 | Q3 retrospective published | #36 | 40 | D-Q3-14 |
| D-Q4-02 | SOC 2 Type II report delivered | #36 + #38 | 42 | D-Q3-14 |
| D-Q4-03 | Marketing site updated with ISO + SOC 2 badges | #36 + #16 + #32 | 44 | D-Q3-13, D-Q4-02 |
| D-Q4-04 | Mainnet contract deployment + change-in-scope memo | #25 + #36 | 46 | D-Q4-02 |
| D-Q4-05 | DR exercise (Mumbai → Hyderabad failover) | #21 + #36 | 47 | D-Q4-04 |
| D-Q4-06 | HSM signer migration + SoA delta | #12 + #36 + #38 | 48 | D-Q4-05 |
| D-Q4-07 | Third quarterly access + vendor review evidence | #36 + #21 | 52 | D-Q3-16 |
| D-Q4-08 | First paid bank in production | #29 + #42 + #36 | 50 | D-Q4-04 |
| D-Q4-09 | GCC/UK regulatory mapping scoping memo (roadmap v2 seed) | #36 + #41 | 52 | D-Q4-08 |
| D-Q4-10 | Q4 retrospective + roadmap v2 dispatch | #36 | 52 | D-Q4-09 |

---

## 5. Audit calendar (weeks 1–52)

A 52-row grid is verbose; the table below shows only the weeks with external interactions. Read it as: *if a row is missing, nothing external is scheduled that week and the team is in evidence-collection mode.*

| Wk | Date (Mon) | Event | Counterparty | Owner |
|---|---|---|---|---|
| 1 | 2026-05-25 | Compliance kickoff; counsel + auditor shortlists | (internal) | #36 |
| 2 | 2026-06-01 | DPDP counsel engagement letter signed | External DPDP counsel | #37 |
| 3 | 2026-06-08 | SOC 2 RFP sent to 3 firms | Sequence / Strike Graph / A-LIGN (shortlist) | #36 + #38 |
| 4 | 2026-06-15 | SOC 2 + ISO auditor engagement letters signed; external cryptographer engaged | Selected SOC 2 firm; selected NABCB body | #36 + #38 + #27 |
| 4 | 2026-06-15 | DPDP §2(t) counsel call 1 (memo briefing) | External DPDP counsel | #37 |
| 5 | 2026-06-22 | DPDP §2(t) counsel call 2 (draft review) | External DPDP counsel | #37 |
| 6 | 2026-06-29 | DPDP §2(t) memo v1 received | External DPDP counsel | #37 |
| 8 | 2026-07-13 | Pre-engagement call with SOC 2 auditor (scoping confirmation) | SOC 2 firm | #38 |
| 8 | 2026-07-13 | Pre-engagement call with ISO lead auditor | NABCB body | #38 |
| 10 | 2026-07-27 | Trusted-setup ceremony (cryptographer witnesses) | External cryptographer | #11 + #36 |
| 13 | 2026-08-17 | DPB §17 filing submitted | DPB | #36 + #37 |
| 14 | 2026-08-24 | SOC 2 Type I evidence-period kickoff call | SOC 2 firm | #38 |
| 16 | 2026-09-07 | Trail of Bits / equivalent contract audit kickoff | Contract audit firm | #25 + #36 |
| 22 | 2026-10-19 | ISO Annex A SoA v1 walkthrough with lead auditor | NABCB body | #38 |
| 23 | 2026-10-19 | ISO Stage 1 audit on-site (3 days) | NABCB body | #36 + #38 |
| 24 | 2026-10-26 | Trail of Bits / equivalent final report delivery | Contract audit firm | #25 |
| 25 | 2026-11-02 | Contract audit remediation review | Contract audit firm | #25 + #26 |
| 26 | 2026-11-09 | SOC 2 Type I evidence package handover | SOC 2 firm | #38 |
| 26 | 2026-11-09 | First SOC 2 Type I report delivered | SOC 2 firm | #36 |
| 27 | 2026-11-16 | SOC 2 Type II evidence-period kickoff call | SOC 2 firm | #38 |
| 27 | 2026-11-16 | Bug bounty platform vendor signs MSA | HackerOne / BugCrowd | #26 + #36 |
| 30 | 2026-12-07 | RBI sandbox counsel briefing | External RBI counsel | #36 + #37 |
| 33 | 2026-12-28 | DPDP §8 tabletop with counsel + SRE | External DPDP counsel + #21 | #36 + #37 |
| 34 | 2027-01-04 | RBI sandbox application review with counsel | External RBI counsel | #36 + #37 |
| 35 | 2027-01-11 | RBI sandbox application submitted | RBI FinTech Department | #36 + #37 |
| 36 | 2027-01-18 | ISO Stage 2 audit on-site (5 days) | NABCB body | #36 + #38 |
| 37 | 2027-01-25 | Stage 2 non-conformity remediation review | NABCB body | #38 |
| 38 | 2027-02-01 | ISO 27001 certificate confirmation | NABCB body | #36 |
| 39 | 2027-02-08 | SOC 2 Type II evidence package handover | SOC 2 firm | #38 |
| 39 | 2027-02-08 | RBI sandbox acceptance decision (or deferral to next cohort) | RBI FinTech Department | #36 |
| 42 | 2027-03-01 | SOC 2 Type II report delivered | SOC 2 firm | #36 |
| 44 | 2027-03-15 | Site update — ISO + SOC 2 badges published | (internal) + #16 | #36 |
| 46 | 2027-03-29 | Mainnet deployment + change-in-scope memo to SOC 2 + ISO auditors | SOC 2 firm; NABCB body | #25 + #36 |
| 47 | 2027-04-05 | DR exercise (failover drill) — observed by SRE leadership | (internal) | #21 + #36 |
| 48 | 2027-04-12 | HSM signer migration delta to SoA | NABCB body | #12 + #38 |
| 50 | 2027-04-26 | First paid bank go-live | Bank #1 | #29 + #42 |
| 52 | 2027-05-10 | RBI quarterly sandbox progress report (if accepted) | RBI FinTech Department | #36 |

External interactions are also logged contemporaneously in `docs/compliance/regulator-log.md` (see §8).

---

## 6. Vendor and counsel calendar

External-paid relationships listed in week-of-engagement order.

### 6.1 External DPDP counsel — Phase 0 week 1 (Agent #37 owns)

- **SoW:** §2(t) classification memo for commitments + DID; §13 cross-border treatment opinion; §8 breach-notification playbook review; standing retainer for §§ queries.
- **Deliverables:** §2(t) memo v1 (week 6), §13 cross-border opinion (week 8), §8 playbook review (week 13).
- **Cost envelope:** retainer + per-memo fee; budget tracked by Agent #50.
- **Conflict-of-interest check:** firm must not advise any of our anchor banks on the same matter.

### 6.2 External cryptographer — Phase 0 week 4 (Agent #27 owns)

- **SoW:** independent peer review of circuit v1.2, witness presence at the trusted-setup ceremony, sign-off letter on the Powers-of-Tau and Phase 2 contributions.
- **Deliverables:** circuit review note (week 8), ceremony witness letter (week 11), Phase 2 contribution sign-off (week 11).
- **Cost envelope:** fixed-fee engagement.
- **Independence:** must not be on the SOC 2 or ISO auditor's staff.

### 6.3 SOC 2 auditor — Phase 0 week 4 (Agent #38 owns)

- **SoW:** Type I observation, Type I report, Type II evidence-period observation, Type II report. Optional: privacy criteria add-on once DPDP §8 + §17 controls are stable (deferred to v2 of this roadmap).
- **Deliverables:** see §4.
- **Cost envelope:** Type I + Type II combined; phased payment tied to milestone delivery.
- **Independence:** must not also be the ISO certification body for ZeroAuth (separate firm).

### 6.4 ISO 27001 lead auditor — Phase 0 week 4 (Agent #38 owns)

- **SoW:** Stage 1 documentation review, Stage 2 operational audit, surveillance audits years 2 + 3.
- **Deliverables:** Stage 1 report (week 24), Stage 2 report (week 37), certificate (week 38).
- **Cost envelope:** initial certification + annual surveillance.
- **Independence:** must not be the same firm or partner network as the SOC 2 auditor.

### 6.5 Smart-contract audit firm (Trail of Bits or equivalent) — Phase 2 week 16 (Agents #25 + #36 own)

- **SoW:** Review `DIDRegistry`, `Groth16Verifier`, `AuditAnchor` contracts; review the Powers-of-Tau ceremony output and the on-chain verifier integration.
- **Deliverables:** kickoff call (week 16), interim report (week 20), final report (week 24), remediation review (week 25).
- **Cost envelope:** fixed-scope engagement; remediation hours billed separately if Critical findings exceed two.
- **Independence:** must not have advised our anchor banks on the same contracts.

### 6.6 External RBI counsel — Q3 week 30 (Agent #36 + #37 own)

- **SoW:** RBI sandbox application strategy, cohort selection advice, post-submission liaison support.
- **Deliverables:** briefing memo (week 30), application review (week 34), liaison support through week 39.
- **Cost envelope:** fixed + hourly.

### 6.7 Bug bounty platform vendor — Phase 3 week 27 (Agent #26 + #36 own)

- **SoW:** Public programme on HackerOne, BugCrowd, or Yes We Hack with scoped surface (the API endpoints, the dashboard, the prover app, the smart contracts). Triage support included.
- **Deliverables:** MSA signed (week 27), programme live (week 28), first quarterly triage summary (week 39).
- **Cost envelope:** platform fee + bounty pool; bounty budget set by Agent #26 and approved by Agent #36.
- **Disclosure timing:** 90 days standard; emergency-disclosure procedure documented in `docs/security/bug-bounty-disclosure-policy.md` (to be written, Phase 3 week 27 deliverable).

### 6.8 Evidence collector tool vendor (Drata / Vanta / Sprinto or in-house) — Phase 1 week 10 (Agent #36 + #38 own)

- **Decision deadline:** Phase 1 week 10 (D-Q2-02 dependency). The chosen vendor or the in-house equivalent must be operational before SOC 2 Type I evidence-period kickoff (week 14).
- **SoW:** continuous integration with GitHub, AWS / VPS, 1Password, Google Workspace, Postgres; control mapping pre-built for SOC 2 + ISO 27001; evidence export per audit run.
- **Deliverables:** MSA signed (week 10), production sync live (week 12).
- **Cost envelope:** SaaS subscription, annual term.
- **Risk:** see §7.2.

---

## 7. Open dependencies and risks

Each risk has an owner and a mitigation. Tracked in `docs/team/risk-register.md` once that file lands; this section is the authoritative copy for compliance-bearing risks until then.

### 7.1 R-COMP-01 — DPDP rules notification mid-evidence-period

- **Class:** Regulatory shift.
- **Likelihood:** Medium (rules are anticipated; timing uncertain).
- **Impact:** High — DPB or RBI may issue clarifying rules during the SOC 2 Type II evidence period (weeks 27–39). If new rules invalidate elements of the Phase-0 PIA, we have to redo it and may need a re-attestation from the auditor.
- **Owner:** Agent #36; with Agent #37 watching the official gazette weekly.
- **Mitigation:**
  - Subscribe to DPB / MeitY rule-notification feeds; weekly check in the Friday status post.
  - Build the PIA in a structure that lets us patch individual sections (`docs/compliance/dpdp/pia-template.md`) without rewriting end-to-end.
  - Pre-negotiate a "re-attestation clause" in the SOC 2 + ISO engagement letters so we can cleanly handle a mid-period scope shift.

### 7.2 R-COMP-02 — Evidence collector tool not finalised by Phase 1 exit

- **Class:** Vendor-selection slip.
- **Likelihood:** Low–Medium.
- **Impact:** High — manual evidence collection adds approximately 30% overhead to SOC 2 deliverables and reduces auditor confidence in continuous-monitoring claims (a Type II requirement).
- **Owner:** Agent #36; vendor evaluation lead is Agent #38; integration lead is Agent #21.
- **Mitigation:**
  - Set a hard deadline of Phase 1 week 10 (D-Q2-02 precursor) for the tool decision.
  - Maintain a manual evidence-collection fallback in `docs/compliance/soc2/manual-evidence-playbook.md` until the tool is live.
  - The fallback is acceptable for Type I (point-in-time) but not for Type II (continuous); a slip beyond week 14 (Type II evidence kickoff) is an escalation to Agent #1.

### 7.3 R-COMP-03 — Trusted-setup ceremony slip blocks ISO certification

- **Class:** Cross-line schedule dependency.
- **Likelihood:** Low (ceremony is week 10; ISO Stage 2 is week 36 — significant buffer).
- **Impact:** Medium — the ceremony output evidences ISO Annex A.5.31 (cryptography) and SOC 2 CC6.1 (cryptographic controls). A late ceremony does not block Stage 1 (week 23) but does block Stage 2 (week 36). The slip becomes critical if it pushes past week 30.
- **Owner:** Agent #36; ceremony owner is Agent #11; cryptographer is Agent #27.
- **Mitigation:**
  - Buffer time built in: week 10 target gives 26 weeks of contingency before Stage 2.
  - If ceremony slips to week 12, log a risk-update entry in `docs/compliance/regulator-log.md`. If it slips beyond week 14, escalate to Agent #1.
  - Pre-coordinate with the lead auditor so the ceremony schedule is on her calendar.

### 7.4 R-COMP-04 — Bank pilot 1 contract slip blocks SOC 2 Type I evidence on customer-touchpoint controls

- **Class:** Customer dependency.
- **Likelihood:** Medium.
- **Impact:** Medium — some SOC 2 controls (CC6.7 transmission to external parties, CC7.5 incident communication to customers) need at least one live customer touchpoint to evidence. Type I report can still issue, but the auditor will narrow the relevant control scope.
- **Owner:** Agent #36; with Agent #42 (head of partnerships) driving contracts.
- **Mitigation:**
  - Target 3 pilot contracts by week 26 (D-Q2-11); even one suffices for Type I.
  - If 0 contracts are signed by week 22, narrow the Type I scope at the auditor scoping call (week 22) rather than miss the report deadline.

### 7.5 R-COMP-05 — RBI sandbox application not accepted

- **Class:** Regulator decision.
- **Likelihood:** Medium (acceptance rates historically 15–25 % per cohort).
- **Impact:** Low – Medium — strategic credibility hit, but the SOC 2 + ISO + DPDP triad is sufficient for the regulator-defensible v1 gate. Sandbox is an accelerant, not a blocker.
- **Owner:** Agent #36; with Agent #37 on application content and Agent #42 on partner-bank co-applicants.
- **Mitigation:**
  - Identify two cohorts in flight; submit to the first eligible.
  - Pre-line up a partner bank as co-applicant; co-applications are looked on more favourably.
  - Have a documented "re-application plan" in `docs/compliance/rbi/sandbox-re-application-plan.md` (Phase 3 deliverable) so a no-acceptance does not stop Phase 4 work.

### 7.6 R-COMP-06 — Smart-contract audit Critical finding emerges late

- **Class:** Technical / security.
- **Likelihood:** Medium — first-time external review of these contracts.
- **Impact:** High — a Critical finding in `DIDRegistry` or `Groth16Verifier` blocks Phase 4 mainnet deployment and triggers a re-audit (an additional ~6 weeks + cost).
- **Owner:** Agent #36; remediation owner Agent #25; with Agent #26 reviewing.
- **Mitigation:**
  - Internal cryptographer-reviewer subagent pass before external audit kickoff.
  - Allocate a 4-week remediation buffer (weeks 24–28) before mainnet deployment in week 46.
  - Re-audit fee earmarked in the Q1 budget (Agent #50).

### 7.7 R-COMP-07 — Auditor key personnel change mid-engagement

- **Class:** Vendor-side disruption.
- **Likelihood:** Low.
- **Impact:** Medium — discontinuity in audit context; risk of new lead auditor re-opening previously cleared items.
- **Owner:** Agent #36.
- **Mitigation:** engagement letters specify named lead auditor + substitute clause; quarterly relationship calls to keep continuity.

### 7.8 R-COMP-08 — Cross-border-transfer rule (DPDP §13) tightened

- **Class:** Regulatory shift.
- **Likelihood:** Medium.
- **Impact:** High — our GitHub / Sentry / Cloudflare flows depend on the current "white-list" interpretation. A tightened §13 may require in-country alternatives.
- **Owner:** Agent #37 monitoring; Agent #36 deciding.
- **Mitigation:**
  - Maintain DPA files current with all three processors.
  - Pre-evaluate in-country alternatives (GitLab self-hosted, Sentry on-prem, Indian CDN) and document the swap-out cost in `docs/compliance/dpdp/cross-border-fallbacks.md`.

---

## 8. Document hygiene

The compliance documentation surface lives under `docs/compliance/`. The hygiene rules below are enforced via Friday status reads and the monthly phase review.

### 8.1 Quarterly retrospectives

At the close of each quarter (week 14, 27, 40, 52), the CCO publishes a one-page retro to `docs/compliance/retros/<year>-<q>.md`. The retro covers:

- Deliverables completed on time, behind schedule, descoped.
- Open risks from §7 that materialised; new risks added.
- Auditor / regulator feedback themes.
- Lessons for the next quarter (one paragraph each: process, tooling, communication).
- Sign-off line from Agent #36 + Agent #1.

### 8.2 Regulator interaction log

Every interaction with a regulator (RBI, DPB, an auditor representing a regulated bank) is logged in `docs/compliance/regulator-log.md` with: date, counterparty, channel (email / call / on-site), participants from ZeroAuth, summary, action items, owner.

Entries are append-only; corrections go in a new row referencing the original. The log is part of every quarterly retro evidence pack.

### 8.3 Evidence pack rotation

The evidence pack lives under `docs/compliance/evidence-pack/<year>-<q>/`. Each quarter:

- The previous quarter's directory is sealed and committed as immutable.
- A new directory is created and seeded from the evidence collector tool (or the manual playbook if R-COMP-02 has materialised).
- The packs covering the SOC 2 Type II evidence period (Q3 + Q4) are referenced explicitly in the Type II report.
- Off-repo artefacts (PDFs of counsel memos, signed engagement letters) are referenced by hash + storage location, not committed.

### 8.4 Document update cadence

- This roadmap is updated quarterly (week 14, 27, 40, 52) immediately after the retro.
- Material mid-quarter changes (a missed milestone, a new regulator, a fresh framework) trigger an ad-hoc update via the plan-change-proposal process from `06-ways-of-working.md`.
- The `LAST_UPDATED` line below is bumped on every PR that touches this file.

### 8.5 Cross-reference integrity

CI runs a link-check over `docs/compliance/` weekly. Stale references (broken paths, removed agent IDs) are surfaced via the Monday compliance standup.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #36 (CCO)
