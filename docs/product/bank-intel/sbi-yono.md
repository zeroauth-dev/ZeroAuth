# State Bank of India — YONO intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #44 (BFSI South + PSBs).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P2 → P9 → P6. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-26.

---

## 1. Bank profile

- **Legal name:** State Bank of India [src: company-website-2026-Q1].
- **Founded:** 1955 (re-organised from Imperial Bank of India under the State Bank of India Act 1955) [src: company-website-2026-Q1; regulatory-rbi-historical].
- **Headquarters:** Mumbai, Maharashtra (corporate centre at Madame Cama Road) [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE [src: company-website-2026-Q1].
- **Ownership posture:** majority government-owned (Government of India ~ 57 %) [src: company-shareholding-pattern-most-recent-quarter].
- **Scale (publicly disclosed):** largest commercial bank in India by every metric — balance sheet, branches (> 22,000), customers (> 450 M individual customers), ATMs (> 65,000) `[VERIFY exact FY26 figures]` [src: company-annual-report-most-recent-FY].
- **Digital-banking platforms (publicly known by name):**
  - **YONO (You Only Need One)** — flagship retail + lifestyle super-app, launched 2017 [src: company-press-release-2017-11-24; play-store-listing-2026-Q1].
  - **YONO Business** — SME / corporate-banking variant [src: play-store-listing-2026-Q1].
  - **YONO Krishi** — agri-loans + farmer-services variant [src: play-store-listing-2026-Q1] `[VERIFY active status]`.
  - **SBI Quick** — missed-call / SMS-driven balance enquiry service [src: company-website-2026-Q1].
  - **OnlineSBI** — web NetBanking at `onlinesbi.sbi` [src: company-website-2026-Q1].
- **YONO active users:** > 75 M `[VERIFY exact most-recent disclosure]` [src: company-press-release-yono-milestone].
- **YONO Phase 2 / next-gen platform:** SBI has publicly disclosed plans for "YONO 2.0" / next-generation app, with technology-vendor selection processes referenced in trade press `[VERIFY exact RFP / RFI dates and status]` [src: news-economictimes-2024 series, exact dates `[VERIFY]`].

---

## 2. Recent RBI inspection cycle

- **Annual RBS inspection cadence** applies as with other commercial banks; SBI's inspection cycle dates and findings are **not in public record** `[VERIFY via SBI compliance team]`.
- **PSB-specific reporting obligations:** SBI files with the Ministry of Finance + RBI under the Public Sector Bank framework. Some posture is visible in Parliament-question responses `[VERIFY specific Lok Sabha / Rajya Sabha questions on SBI's tech infrastructure]`.
- **2020 — YONO outage referenced in RBI's IT-Governance posture:** RBI's broader push for tech-resilience across all scheduled commercial banks included citations of YONO outages in 2020-2021 as case studies in industry discourse `[VERIFY specific publication and date]` [src: news-economictimes-2020 series `[VERIFY]`].
- **Public regulator stance:** SBI is regularly featured in RBI's Financial Stability Reports and Banking Ombudsman annual reports; cyber-fraud complaints are a top-3 category at SBI by volume `[VERIFY edition of Ombudsman report]` [src: regulatory-rbi-ombudsman-annual-report].

---

## 3. Recent breach posture

- **2020 — SBI YONO outage / login issues:** widely reported during 2020-2021, with multiple customer-grievance threads on social media [src: news-trade-press-2020 series, exact dates `[VERIFY]`]. The bank issued public statements that customer data was not exfiltrated; the events were availability-not-confidentiality.
- **Multiple periods 2020-2023 — fraud cases targeting SBI customers:** SIM-swap-enabled fraud, fake-app phishing campaigns (clones of YONO), and call-centre social-engineering have been recurring categories in RBI Ombudsman reports `[VERIFY edition]` [src: regulatory-rbi-ombudsman-annual-report].
- **2022 — Mobikwik-incident-style allegations against partner ecosystem:** some allegations of SBI customer data appearing in dark-web dumps were tied to partner ecosystems rather than SBI's core systems `[VERIFY specific event]` [src: news-trade-press-2022 `[VERIFY]`].
- **No major publicly-confirmed breach of SBI's core banking systems** in the 2020-2025 window comparable to international peer events `[VERIFY at time of outreach]`.

**So-what for ZeroAuth:** YONO is the highest-volume, highest-density customer-credential surface in Indian banking. Even modest per-customer hardening of the credential model has outsized aggregate impact.

---

## 4. Digital-banking platform stack (publicly known)

- **YONO native:** native Android + iOS; large team, mix of Kotlin / Java on Android per careers postings [src: linkedin-careers-2026-Q1].
- **YONO architecture:** publicly discussed as built on private-cloud + multi-tier microservices; original platform built with Accenture as principal SI in the 2017-2019 launch window [src: news-economictimes-2017-11-24; case-study-accenture-public-2018 `[VERIFY exact case study URL]`].
- **YONO 2.0 / next-gen platform:** publicly discussed RFI / RFP processes during 2024-2025 `[VERIFY exact bid status]` [src: news-economictimes-2024 series, exact dates `[VERIFY]`]. The next-generation platform is the strategic moment for any structural identity-layer replacement.
- **Auth posture for YONO:** customer ID + password + 6-digit MPIN; Android BiometricPrompt + iOS Face ID for in-app unlock; OTP via SMS for transactions; Aadhaar OTP for select onboarding flows [src: company-website-yono-security-page-2026-Q1].
- **Auth posture for OnlineSBI:** user ID + password + OTP; profile password additional layer for high-friction operations; transaction-step-up via SMS [src: company-website-onlinesbi-help-2026-Q1].
- **OTP delivery:** SMS via aggregator + bank-issued SBI sender IDs (`SBIINB`, `SBIYNO` family) [src: trai-dlt-registry-public-listing-2026-Q1].
- **KYC stack:** Video KYC operated in-house via YONO; eKYC via UIDAI as primary KUA — SBI is among India's largest KUAs by volume `[VERIFY exact ranking]`.
- **SBI's UIDAI volume:** SBI is one of the highest-volume eKYC requesters in the country, giving it disproportionate exposure to UIDAI-pricing and -availability shifts [src: regulatory-uidai-annual-report `[VERIFY edition]`].

---

## 5. Buying centre

| Role | Title at SBI | Name | Status |
|---|---|---|---|
| Chairman | Chairman | TBD | `[VERIFY — public record; named in every annual report]` |
| MD (Digital / IT) | Managing Director — Digital Banking / Innovation | TBD | `[VERIFY]` |
| CIO | Chief Information Officer / DMD (IT) | TBD | `[VERIFY]` |
| CISO | Chief Information Security Officer | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — YONO | Deputy Managing Director / Chief Digital Officer (YONO) | TBD | `[VERIFY]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |

**Approach rule:** SBI's leadership names are public record (mandatory disclosures under PSB Act + RBI guidelines). Verify on `sbi.co.in/web/about-us/leadership` `[VERIFY exact URL]` on the day of outreach.

**Likely warm-intro paths:**

- IIM-A / IIM-B alumni — many SBI senior executives are alumni `[VERIFY]`.
- IRDAI / NPCI cross-board memberships — SBI executives sit on multiple industry boards.
- Government-relations channels — for a PSB, government affiliation matters; introductions through ex-MoF / ex-RBI advisors have higher leverage than purely commercial channels.

**Caution for a PSB:**

- Procurement is government-process-driven (RFP-based, GFR-compliant). A "design partner LoI" cycle is not the typical first step at SBI — it is "respond to our RFI / RFP". Plan the outreach sequence accordingly.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P2 — Aadhaar e-KYC operational dependency

**Public expression:**

- SBI is among India's largest UIDAI KUAs by volume; per-transaction eKYC fees and OTP-rate-limit constraints are well-documented operational realities `[VERIFY UIDAI fee history]` [src: regulatory-uidai-circulars-on-kua-fees].
- UIDAI service downtime incidents (last 12 months: 7 incidents > 2 hours, per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P2) disproportionately affect SBI's onboarding pipeline.
- The 2018 Puttaswamy judgement + §57 Aadhaar Act litigation cycle made SBI publicly cautious about Aadhaar use cases `[VERIFY specific RBI / SBI communications]` [src: regulatory-rbi-circular-on-aadhaar-use `[VERIFY]`].
- SBI's annual reports include sections on onboarding-cost-per-customer; UIDAI eKYC line items are part of the operational cost discussed in investor calls `[VERIFY specific quote from investor call transcript]`.

**Why ZeroAuth resonates here:** at SBI's scale (potentially > 10 M new onboardings / year + recurrent authentications), reducing UIDAI hits from "every auth" to "once per enrollment" is a multi-hundred-crore line item. Scene 1 of the demo — enrollment with one Aadhaar dip; six subsequent authentications with zero UIDAI calls — is the conversation.

### 6.2 P9 — Customer-onboarding drop-off at video KYC

**Public expression:**

- SBI's mass-market customer base (largest in India by absolute count, ~ 450 M+) means drop-off rates have outsized absolute-customer impact.
- Video KYC drop-off at 30-45 % is the industry norm per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P9; at SBI's volume, 35 % of 10 M attempted onboardings = 3.5 M lost customers per year.
- SBI's annual report references customer-acquisition-cost (CAC) and onboarding-completion-rate as operational metrics `[VERIFY exact section]` [src: company-annual-report-customer-acquisition-section].
- Bharat-rural-customer onboarding is a strategic priority for SBI; V-KYC bandwidth constraints in tier-3 / tier-4 cities make this acutely painful `[VERIFY specific public statement]`.

**Why ZeroAuth resonates here:** Scene 1 of the demo positions V-KYC as the one-time anchor; subsequent authentications never re-enter the V-KYC funnel. For SBI, this is the difference between "we lose 3.5 M attempted customers a year to drop-off" and "we keep them post-anchor regardless of subsequent friction".

### 6.3 P6 — Account takeover via SIM swap / SS7 / device theft

**Public expression:**

- SBI customer SIM-swap fraud is among the most-reported categories in RBI Banking Ombudsman reports `[VERIFY edition]` [src: regulatory-rbi-ombudsman-annual-report].
- The bank publicly runs SIM-swap-awareness campaigns; press notices on fake-YONO-clone apps are a recurring theme [src: company-website-security-page-2026-Q1].
- Per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P6, the industry FY24 SIM-swap-enabled ATO loss is ~ ₹2,500 cr; SBI's share is directional, not publicly disclosed.

**Why ZeroAuth resonates here:** StrongBox-backed device-bound key removes the SIM-swap attack class. Scene 2 + Scene 4 combined. At SBI's customer volume, even a 50 % reduction in SIM-swap losses is hundreds of crores.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** YONO 2.0 / next-gen platform is the strategic moment to replace the credential layer at the moment of platform refresh, not as a retrofit.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> YONO 2.0 is the strategic moment to retire the SMS-OTP-plus-Aadhaar-on-every-auth model that today carries multi-hundred-crore operational overhead. The next-generation platform can ship with cryptographic credentials that never enter the SMS or UIDAI hot path post-enrollment.

**Asks:**

- 15-minute call with the CDO / Head of YONO + CISO.
- Demo at SBI Corporate Centre (Madame Cama Road, Mumbai) or virtually.
- Pre-read PDF + one-page on RBI Master Direction §6.4 cryptographic-evidence posture attached.

**Do not say in the first email:**

- Any reference to the 2020 YONO outage.
- Any "PSB-is-slow" implication. SBI's digital team is among India's most ambitious.
- Specific cost figures.

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active YONO users: ~ 75 M `[VERIFY]`.
- Additional OnlineSBI + branch-channel auth: ~ 100 M more touchpoints / month.
- Annual digital authentications: > 8 B / year — the highest in Indian banking.
- Estimated PSB-flagship-bank annual seat fee: ₹60-100 cr / year `[VERIFY pricing committee — Agent #42]`.
- PSB procurement cycles are longer; pilot-to-production may stretch 24-36 months.

**3-year ACV estimate:** ₹180-300 cr cumulative ACV across a 3-year engagement, of which ~ ₹20-40 cr in the pilot year (PSB procurement typically prices the pilot relatively lower than steady-state). Planning estimates only.

**Cost-avoidance offer (illustrative, not promised):**

- SMS OTP gateway spend reduction: estimated ₹80-120 cr / year.
- UIDAI eKYC fees on auth path: ₹200-400 cr / year on the new-onboarding + recurring base.
- Video KYC onboarding-drop-off recovery: ₹500-1,000 cr / year in foregone-revenue avoidance (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P9 math at SBI scale).

---

## 9. Internal notes

- **Procurement reality:** SBI is a PSB; procurement is government-process-driven (RFP / GFR-compliant). The "first call → pilot LoI" pattern that works at HDFC / ICICI / Axis does **not** work here. The first call must position ZeroAuth as a credible respondent to the next YONO 2.0 RFI / RFP. This is a multi-quarter cycle, not a multi-week one.
- **Government affiliation:** SBI executive interactions sometimes include MoF or RBI representatives. Anything said in a SBI meeting must be regulator-defensible — be precise about ZeroAuth's compliance posture in real time. Companion documents: [docs/compliance/compliance-roadmap-v1.md](../../compliance/compliance-roadmap-v1.md), [docs/compliance/dpdp-2t-commitments-memo-v0.md](../../compliance/dpdp-2t-commitments-memo-v0.md).
- **Conflict:** SBI works with major Indian SIs (TCS, Infosys, Wipro) and global SIs (Accenture, IBM). ZeroAuth's positioning is as a verifier-component within an SI-led platform, not as a competing SI.
- **Things to be careful about:**
  - Never frame YONO as having "lost" anything (outages, fraud). Frame as "YONO 2.0 is an opportunity to design in cryptographic credentials from day one".
  - PSB customer-data sensitivity is higher than at private-sector peers; the "we don't touch PII" message must be the headline, not an aside.
  - Procurement cycle: budget for 12-18 months from first call to first RFP response.
- **Open intel asks for v1.1:**
  - Confirm YONO 2.0 RFP / RFI status and timeline.
  - Confirm DMD (IT) / CDO / CISO names from most recent FY annual report.
  - Confirm SBI's current SI vendor for YONO operations (Accenture? someone else?).

---

LAST_UPDATED: 2026-05-26
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
