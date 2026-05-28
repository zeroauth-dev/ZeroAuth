# HDFC Bank Ltd. — intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #43 (BFSI North).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P1 → P4 → P7. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-25.

---

## 1. Bank profile

- **Legal name:** HDFC Bank Limited [src: company-website-2026-Q1].
- **Founded:** 1994 [src: company-website-2026-Q1].
- **Headquarters:** Mumbai, Maharashtra (corporate office at HDFC Bank House, Senapati Bapat Marg, Lower Parel) [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE; ADRs on NYSE under ticker HDB [src: company-website-2026-Q1].
- **Merger event:** Reverse-merged with parent HDFC Ltd. effective 2023-07-01, becoming one of the largest listed entities in India by market capitalisation [src: company-press-release-2023-06-30].
- **Scale (publicly disclosed, most recent annual report):** balance sheet > ₹30 lakh crore; > 8,000 branches; > 70 million customers `[VERIFY]` against the most recent FY26 annual report when published.
- **Digital-banking platforms (publicly known by name):**
  - **NetBanking** — web-based retail banking at `netbanking.hdfcbank.com` [src: company-website-2026-Q1].
  - **HDFC Bank MobileBanking** app — Android + iOS [src: play-store-listing-2026-Q1].
  - **PayZapp** — wallet / UPI super-app [src: play-store-listing-2026-Q1].
  - **SmartHub Vyapar** — merchant-facing app [src: play-store-listing-2026-Q1].
- **API surface they expose to fintech partners:** HDFC Open Banking developer portal at `developer.hdfcbank.com` exposes account-aggregator + payment APIs `[VERIFY: URL and exact scope on the developer portal at the time of outreach]`.

---

## 2. Recent RBI inspection cycle

- **2020-12-02:** RBI directed HDFC Bank to halt all new digital business activities (Digital 2.0 program, new credit-card issuance) following repeated tech outages [src: regulatory-rbi-2020-12-02; news-economictimes-2020-12-02].
- **2021-08-17:** RBI partially lifted the restriction, allowing new credit-card issuance; full lift of digital-business-launch restrictions came in 2022 [src: regulatory-rbi-2021-08-17; news-economictimes-2021-08-17].
- **2022-03-11:** RBI fully lifted the digital-business-launch restriction [src: regulatory-rbi-2022-03-11].
- **Subsequent inspection cadence:** RBI conducts annual on-site inspections (Risk-Based Supervision) of all scheduled commercial banks; HDFC's most recent inspection cycle dates and findings are **not in public record** `[VERIFY via the bank's compliance team once a conversation is established]`.
- **Public commentary by HDFC executives on resilience:** post-2020 outage, the bank made multiple public statements that "tech and digital resilience are board-level priorities" and disclosed enhanced IT investment in subsequent annual reports `[VERIFY exact citations in FY22-FY25 annual reports before next outreach refresh]`.

**So-what for ZeroAuth:** the 2020 RBI digital-business-halt order is the most public, most memorable resilience-related regulator action against any Indian private-sector bank. It is a permission slip to lead with reliability + cryptographic-evidence-of-controls in our outreach narrative.

---

## 3. Recent breach posture

- **No major customer-database breach has been publicly attributed to HDFC Bank in the last 24 months** to the level of regulatory disclosure or class-action filing `[VERIFY via news search at time of outreach]`.
- **Industry context:** Multiple 2023-2025 incidents involved HDFC Bank's data being part of broader breaches at downstream partners (insurance arm HDFC Life, third-party loan service providers) `[VERIFY specific incidents and dates]` [src: news-economictimes-2024 series, exact dates `[VERIFY]`].
- **Phishing + social-engineering targeting HDFC customers** is a persistent theme in industry trade press, with the bank running ongoing customer-education campaigns (e.g., "Mooh band rakho" — keep your mouth shut about OTPs, a long-running awareness campaign) [src: company-press-release-2018; renewed periodically, exact dates `[VERIFY]`].
- **Public posture on biometric data handling:** the bank's app uses Android BiometricPrompt + iOS LocalAuthentication for in-app biometric unlock; biometric templates are device-local [src: app-store-privacy-disclosure-2026-Q1] `[VERIFY exact wording on the data-safety section of the Play Store listing]`.

**So-what for ZeroAuth:** the absence of a headline breach means the cold-call hook is **not** "you got breached, we fix that". It is "the next breach is statistically inevitable across the sector; your DPDP §8 exposure is the next 24 months of board agenda".

---

## 4. Digital-banking platform stack (publicly known)

- **Frontend (NetBanking):** built on a long-lived J2EE stack, refreshed over multiple releases since 2010s `[VERIFY current stack via careers postings]` [src: linkedin-careers-2026-Q1].
- **Mobile (Android MobileBanking app):** native Android, Kotlin + Java mix per public Play Store listing metadata [src: play-store-listing-2026-Q1]; per careers-page postings, the team uses Android Jetpack components `[VERIFY]` [src: linkedin-careers-2026-Q1].
- **Auth posture for net-banking login:** username + password + Aadhaar OTP / mobile OTP; biometric in the mobile app uses BiometricPrompt as a session-unlock, not as a primary auth factor [src: app-store-listing-2026-Q1].
- **OTP delivery:** SMS via aggregator (publicly visible from sender ID; specific DLT-registered headers are bank-issued, e.g. `HDFCBK`) [src: trai-dlt-registry-public-listing-2026-Q1].
- **KYC stack:** Video KYC operated in-house, with the customer onboarding flow under the `HDFC Bank Account Opening` Android app [src: play-store-listing-2026-Q1]; eKYC via UIDAI through HDFC's KUA (Know-Your-Customer User Agency) status `[VERIFY current KUA designation]`.
- **Tech leadership disclosures:** HDFC Bank's executive committee has historically named a Chief Information Officer reporting into the MD; the IT Strategy Committee of the Board is mandated under RBI's IT Governance MD [src: company-annual-report-board-committees-section, exact FY `[VERIFY]`].

---

## 5. Buying centre

| Role | Title at HDFC | Name | Status |
|---|---|---|---|
| CISO | Chief Information Security Officer | TBD | `[VERIFY via LinkedIn / company annual report at the time of outreach]` |
| CIO | Chief Information Officer / Group Head — Technology | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY — public-record name available in the most recent annual report]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — Digital Banking | Group Head, Digital Banking & Liabilities | TBD | `[VERIFY]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |

**Approach rule:** **do not** address any of these executives by name in a cold email until the name is confirmed in the company annual report or on the HDFC Bank corporate-leadership page (`hdfcbank.com/personal/about-us/board-of-directors-and-management`) on the day of outreach. If the page is not loadable, address the email by role title ("Dear Chief Information Security Officer").

**Likely warm-intro paths (not yet activated):**

- IIT Bombay / IIT Delhi alumni network — HDFC Bank technology leadership has historically included alumni `[VERIFY before claiming any specific path]`.
- NPCI ecosystem — HDFC is a major NPCI participant; any introduction via NPCI is high-leverage `[VERIFY no conflict of interest]`.
- Investor relations / board introductions — out of scope for first-cycle outreach.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P1 — Credential database breach exposure under DPDP §8

**Public expression:**

- HDFC Bank's annual report explicitly enumerates cybersecurity and data protection as principal risks in the "Risk Management" section [src: company-annual-report-FY24-risk-section] `[VERIFY exact paragraph reference in latest published AR]`.
- Post-2020 outage, multiple public statements from HDFC senior management referenced the cost of resilience and the board's prioritisation of IT-risk governance [src: news-business-standard-2021 series, exact dates `[VERIFY]`].
- DPDP Act 2023 commencement remarks by industry bodies (IBA, NASSCOM) repeatedly cite HDFC alongside other Tier-1 banks as fiduciaries needing to harden credential infrastructure [src: industry-iba-press-release-2024 `[VERIFY exact statement]`].

**Why ZeroAuth resonates here:** HDFC stores password hashes, OTP secrets, biometric-template hashes, and KBA answers across NetBanking, MobileBanking, PayZapp, and the merchant SmartHub app. The blast radius of a credential-DB breach is multiplied across these systems. ZeroAuth's Poseidon-commitment model reduces this to field elements that do not link to an individual under DPDP §2(t). Scene 4 of the demo is the conversation.

### 6.2 P4 — Privileged-access insider abuse + audit-log tamper-evidence

**Public expression:**

- A 2022 incident, reported in trade press, involved an HDFC officer leaking customer records; the bank publicly confirmed disciplinary action and tightened access reviews `[VERIFY specific publication and date]` [src: news-trade-press-2022-Q2 `[VERIFY]`].
- HDFC Bank's annual reports include a section on internal-fraud-mitigation and segregation-of-duties controls, in line with RBI IT MD §6.4 [src: company-annual-report-internal-controls-section `[VERIFY exact FY]`].
- The bank's 2020 outage post-mortem (per RBI's public order) included audit-log integrity as one of the cited remediation areas [src: regulatory-rbi-2020-12-02; news-economictimes-2020-12-02].

**Why ZeroAuth resonates here:** ZeroAuth's hash-chained `audit_events` table with end-of-day on-chain anchoring on Base L2 provides cryptographic, regulator-verifiable evidence — "we have audit logs" becomes "we have hash-chained, on-chain-anchored, replayable audit logs". Scene 5 of the demo is the conversation.

### 6.3 P7 — High-value transaction authorisation: weak binding between OTP and transaction

**Public expression:**

- RBI's Master Direction on Digital Payment Security Controls §5.3 (the regulation HDFC must follow) flags the OTP-to-transaction binding gap [src: regulatory-rbi-master-direction-digital-payments-2021].
- Industry-wide high-value transaction fraud, including incidents involving HDFC customers, is referenced in NPCI fraud advisories and RBI annual reports on banking ombudsman complaints [src: regulatory-rbi-ombudsman-annual-report; specific edition `[VERIFY]`].
- The bank publicly markets "transaction-specific OTP" but this remains a SMS-template-driven artefact, not a cryptographic binding [src: company-website-net-banking-security-page-2026-Q1].

**Why ZeroAuth resonates here:** ZeroAuth binds the proof to `Poseidon(amount, payee, ifsc, timestamp)` such that a man-in-the-middle substitution invalidates the proof. Scene 3 of the demo (the substitution attack) lands particularly hard with a CRO who has seen high-value-transaction social engineering cases.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** the next 24 months of DPDP §8 board-agenda exposure for a tier-1 private-sector bank with India's largest digital-banking-channel surface area.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> NetBanking, MobileBanking, PayZapp, and SmartHub together represent the largest credential database in Indian private-sector banking. DPDP §8 makes that database the most expensive piece of liability your board carries.

**Asks:**

- 15-minute call with the CISO (or their delegate) within 2 weeks.
- A pre-read PDF (the one-page summary from the demo runbook § 12) attached.
- A demo-scheduling offer at HDFC Bank House (Mumbai), Bandra-Kurla complex, or virtually.

**Do not say in the first email:**

- The name of any HDFC executive unless verified that morning.
- Any reference to the 2020 RBI outage (it is well-known; bringing it up unsolicited is hostile).
- Any explicit dollar / rupee saving figure (those land in Email 3, the value-prop email).

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active retail customers, NetBanking + MobileBanking together: ~ 60 M `[VERIFY]` [src: company-annual-report-customer-base-disclosure-most-recent-FY].
- Annual digital authentications per active customer: ~ 60 (login + transaction + step-up combined; conservative).
- Total annual auth events: 60 M × 60 = 3.6 B / year.
- ZeroAuth pricing model (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) commercial spine): flat seat fee, not per-auth.
- Estimated tier-1-bank annual seat fee: ₹40-60 cr / year `[VERIFY pricing committee — Agent #42]`.

**3-year ACV estimate:** ₹120-180 cr cumulative ACV across a 3-year pilot-to-production engagement, of which ~ ₹15-25 cr in the pilot year (10-15 % of full scale). These are **planning estimates only**, not commitments, and they are not to be quoted to the customer until pricing is signed off by Agent #42.

**Cost-avoidance offer the bank gets in return (illustrative, not promised):**

- SMS OTP gateway spend on auth path: estimated ₹40-50 cr / year (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P3).
- UIDAI eKYC fees on auth path: estimated ₹100 cr / year on a 5 M-new-customer-per-year base (per P2).
- Insurance premium uplift avoidance + ATO loss avoidance: directional, not modelled here.

---

## 9. Internal notes

- **Conflict:** HDFC Bank is a customer of multiple identity-fintech vendors (IDfy, HyperVerge, Signzy) for V-KYC and onboarding. We are not displacing those today — we sit alongside, replacing the post-onboarding credential layer. Be precise about this in conversation.
- **Mutual contacts:** none confirmed yet at the working level. Agent #28 + Agent #42 to drive any board-level introduction if the working-level cycle stalls.
- **Things to be careful about:**
  - HDFC's corporate communications respond aggressively to perceived FUD. Never reference the 2020 outage as a sales hook. The bank has spent five years rebuilding from that period; antagonising them gets the call ended.
  - HDFC Life and HDFC Securities are separate listed entities. Outreach to one is not outreach to the other. The pack here is for HDFC Bank Ltd. only.
- **Open intel asks for v1.1 of this pack:**
  - Confirm latest RBI inspection cycle dates from any public regulator filings.
  - Confirm names of CISO, CIO, CRO, CFO from the most recent FY annual report on the day of outreach.
  - Confirm any FY26 customer-base disclosure that supersedes the 60 M estimate.

---

LAST_UPDATED: 2026-05-25
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
