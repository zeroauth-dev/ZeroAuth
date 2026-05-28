# ICICI Bank Ltd. — intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #43 (BFSI North).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P3 → P6 → P1. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-25.

---

## 1. Bank profile

- **Legal name:** ICICI Bank Limited [src: company-website-2026-Q1].
- **Founded:** 1994 (commercial banking); parent ICICI Limited founded 1955 [src: company-website-2026-Q1].
- **Headquarters:** Mumbai, Maharashtra (registered office at Vadodara, corporate at BKC, Mumbai) [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE; ADRs on NYSE under ticker IBN [src: company-website-2026-Q1].
- **Scale (publicly disclosed, most recent annual report):** balance sheet > ₹19 lakh crore; > 6,400 branches; one of India's three largest private-sector banks by deposits `[VERIFY exact FY26 figures]` [src: company-annual-report-most-recent-FY].
- **Digital-banking platforms (publicly known by name):**
  - **iMobile Pay** — flagship retail mobile-banking app [src: play-store-listing-2026-Q1].
  - **InstaBIZ** — SME / merchant mobile-banking app [src: play-store-listing-2026-Q1].
  - **Pockets** — wallet super-app [src: play-store-listing-2026-Q1].
  - **NetBanking** — web channel at `infinity.icicibank.com` [src: company-website-2026-Q1].
  - **iLens** — internal lending platform `[VERIFY public references]`.
- **Active customer base:** ~ 75 M+ retail customers `[VERIFY exact FY26 disclosure]` [src: company-annual-report-most-recent-FY].
- **Distinctive digital posture:** ICICI Bank has historically been the most aggressive Tier-1 Indian bank on digital-first onboarding. iMobile Pay was opened to non-ICICI customers in 2020 [src: company-press-release-2020-12-08], a notable signal that the bank treats the mobile channel as a customer-acquisition engine.

---

## 2. Recent RBI inspection cycle

- **Annual on-site inspection cadence:** ICICI Bank is in RBI's RBS (Risk-Based Supervision) regime; annual inspections occur but specific cycle dates and findings are **not in public record** `[VERIFY via the bank's compliance team]`.
- **2018 / Videocon-Chanda Kochhar matter:** Former CEO investigated by CBI / SFIO; ICICI Bank cooperated with regulator and made disclosures in subsequent annual reports [src: news-economictimes-2018 series; regulatory-rbi-press-2018]. This is **not** a hook for sales — it is governance history, fully resolved at the institutional level, and not relevant to the credential infrastructure conversation.
- **Public regulator interactions on tech:** RBI has periodically directed Indian banks (including ICICI) to enhance digital-payment fraud controls and improve customer-grievance redressal under the Banking Ombudsman scheme; ICICI's compliance posture on these directions is referenced in its annual report's "Regulatory Compliance" section [src: company-annual-report-regulatory-compliance-section, exact FY `[VERIFY]`].
- **No public RBI sanction or restriction on ICICI Bank's digital business** in the 2020-2025 window comparable to the HDFC 2020 order `[VERIFY at time of outreach]`.

---

## 3. Recent breach posture

- **2022 — iMobile Pay limited disruption:** there was at least one publicly-reported service incident affecting iMobile Pay during the 2022-2023 window `[VERIFY exact dates and scope]` [src: news-business-standard-2022 series, exact dates `[VERIFY]`]; the bank issued a customer advisory and the matter was resolved without RBI escalation `[VERIFY]`.
- **2022-2024 — phishing + smishing trends:** ICICI Bank customers have been a frequent target of smishing campaigns (fake SMS messages impersonating the bank), referenced in the bank's own customer-awareness microsite [src: company-website-security-page-2026-Q1].
- **Industry context:** Multiple incidents in 2023-2025 involved ICICI Bank's data being indirectly affected through partner ecosystems (ICICI Lombard, ICICI Prudential, ICICI Securities are separate listed entities) `[VERIFY specific events]`. These are not directly attributable to ICICI Bank Ltd.
- **Customer-records leaks via misconfigured cloud storage (2022):** there was a widely reported incident concerning misconfigured S3-style storage exposing some banking-form / loan-application data linked to ICICI customer records `[VERIFY exact event, publisher, date]` [src: news-trade-press-2022 `[VERIFY]`]. The bank responded with public statements that core banking systems were not affected.

**So-what for ZeroAuth:** the recurring theme is that even when ICICI's core banking is uncompromised, *credential and customer-form data* through adjacent surfaces creates DPDP §8 exposure. This is exactly the surface ZeroAuth replaces.

---

## 4. Digital-banking platform stack (publicly known)

- **iMobile Pay:** native Android + iOS; the app is one of the most-downloaded BFSI apps in India per Play Store rankings [src: play-store-listing-2026-Q1].
- **Auth posture for iMobile Pay:** username + password + 4-digit mPIN; Android BiometricPrompt + iOS Face ID for in-app unlock; OTP via SMS for transactions [src: company-website-security-page-2026-Q1].
- **Auth posture for NetBanking (Infinity):** user ID + password + Aadhaar OTP or grid card (legacy); Aadhaar OTP path requires UIDAI hit per session [src: company-website-net-banking-help-2026-Q1].
- **OTP delivery:** SMS via aggregator; DLT-registered sender headers include `ICICIB` family [src: trai-dlt-registry-public-listing-2026-Q1].
- **KYC stack:** Video KYC operated in-house under the iMobile Pay onboarding flow; eKYC via UIDAI through ICICI's KUA status `[VERIFY current KUA designation]`. Partner V-KYC providers may also be in the stack `[VERIFY]`.
- **Push notification stack:** FCM-based push for transaction confirmations and step-up [src: app-store-privacy-disclosure-2026-Q1].
- **Distinguishing feature — iMobile Pay's "Pay to Contacts" UPI flow** uses biometric unlock + mPIN; the user-experience is well-documented in the bank's own help pages [src: company-website-imobile-help-2026-Q1].

---

## 5. Buying centre

| Role | Title at ICICI Bank | Name | Status |
|---|---|---|---|
| CISO | Chief Information Security Officer | TBD | `[VERIFY via LinkedIn / annual report at time of outreach]` |
| CIO | Chief Technology / Information Officer | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY — name available in most recent annual report]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — Digital Banking | Head, Digital Channels and Partnerships | TBD | `[VERIFY]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |
| Cybersecurity | Head, Cyber Defence Operations | TBD | `[VERIFY]` |

**Approach rule:** the same as HDFC — do not address an executive by name until verified that morning on the corporate-governance / board-leadership page of the bank's website. ICICI Bank's leadership page is at `icicibank.com/about-us/who-we-are` (subpath may shift) `[VERIFY exact URL]`.

**Likely warm-intro paths (not yet activated):**

- ICICI Bank technology leadership has historically been TCS / Infosys / Wipro alumni-rich `[VERIFY]`.
- NPCI / BBPS ecosystem — ICICI is a major participant.
- IIT / IIM alumni — multiple senior executives are publicly disclosed alumni `[VERIFY]`.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P3 — SMS OTP cost, failure rate, SIM-swap surface

**Public expression:**

- ICICI Bank is one of the largest issuers of SMS OTPs in Indian retail banking (driven by 75 M+ customer base + aggressive digital channel adoption) `[VERIFY exact volume]`.
- The bank has periodically been quoted in trade press on the operational cost of SMS DLT compliance (TRAI's distributed-ledger sender-ID regime) [src: news-business-standard-2021-04 `[VERIFY]`].
- ICICI's customer-grievance disclosures (Banking Ombudsman annual report) include OTP-not-received and OTP-fraud categories among top complaint themes [src: regulatory-rbi-ombudsman-annual-report; specific edition `[VERIFY]`].
- The bank's customer-awareness microsite explicitly warns about SIM-swap and SS7 attack patterns [src: company-website-security-page-2026-Q1].

**Why ZeroAuth resonates here:** at 75 M customers × ~6 OTPs/month × ₹0.20 per SMS, ICICI's annualised SMS-on-auth-path spend is in the ₹100+ cr range (illustrative, not verified). ZeroAuth removes SMS from the auth path entirely. Scene 2 of the demo (kiosk login, zero SMS) lands directly with the CFO.

### 6.2 P6 — Account takeover via SIM swap / SS7 / device theft

**Public expression:**

- The bank's customer-awareness microsite explicitly addresses SIM-swap and device-theft scenarios [src: company-website-security-page-2026-Q1].
- ICICI Bank participates in NPCI's fraud-monitoring committees; NPCI's annual reports cite SIM-swap-enabled UPI fraud as a top fraud category `[VERIFY specific NPCI publication and date]` [src: industry-npci-annual-report `[VERIFY]`].
- Industry analyst estimates place SIM-swap-enabled ATO losses across Indian banks at ~ ₹2,500 cr in FY24 per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P6; ICICI's allocation is directional, not publicly disclosed.

**Why ZeroAuth resonates here:** ZeroAuth's StrongBox-backed device-bound key + mandatory biometric assertion per authentication structurally removes the SIM-swap attack class. There is no cellular-bound shared secret to swap. Scene 2 + Scene 4 combined make the structural argument.

### 6.3 P1 — Credential database breach exposure under DPDP §8

**Public expression:**

- ICICI Bank's annual report enumerates information-security and DPDP-compliance as principal risks [src: company-annual-report-FY24-risk-section] `[VERIFY exact paragraph reference]`.
- The bank has publicly disclosed its DPO appointment (as required under DPDP §17) `[VERIFY exact filing date and DPO name]` [src: company-website-data-protection-page-2026-Q1].
- ICICI is one of the named members of industry working groups (IBA, FICCI) on DPDP-Act-implementation; their public commentary references the operational complexity of fiduciary obligations under §8 `[VERIFY specific IBA / FICCI publication]`.

**Why ZeroAuth resonates here:** the same structural argument as HDFC — ICICI's credential database across iMobile Pay + NetBanking + Pockets + InstaBIZ is the single largest DPDP §8 exposure. ZeroAuth replaces the credential database with a Poseidon commitment store. Scene 4 of the demo is the conversation.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** SMS OTP economics + SIM-swap attack surface, against a customer base where the mobile channel is the primary engagement surface.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> iMobile Pay's growth has made it your largest channel by transaction count. It is also your largest SMS gateway line item and your largest SIM-swap attack surface. Both can be removed from the auth path with no change to your KYC posture.

**Asks:**

- 15-minute call with the CISO or the Head of Digital Channels.
- Demo at ICICI Bank Towers (BKC, Mumbai) or virtually.
- One-page summary PDF pre-read attached.

**Do not say in the first email:**

- Any specific rupee saving figure (Email 3 territory).
- Anything about Chanda Kochhar / 2018 — irrelevant and toxic.
- Any reference to the 2022 iMobile Pay service incident.

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active retail customers: ~ 75 M `[VERIFY]`.
- Annual digital authentications per active customer: ~ 80 (iMobile Pay is more transaction-heavy than NetBanking-first peers).
- Total annual auth events: 75 M × 80 = 6 B / year — among the highest in Indian retail banking.
- Estimated tier-1-bank annual seat fee: ₹50-70 cr / year `[VERIFY pricing committee — Agent #42]`.

**3-year ACV estimate:** ₹150-210 cr cumulative ACV across a 3-year pilot-to-production engagement, of which ~ ₹20-30 cr in the pilot year. Planning estimates only.

**Cost-avoidance offer the bank gets in return (illustrative, not promised):**

- SMS OTP gateway spend reduction: estimated ₹50-70 cr / year (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P3 math applied at 75 M customers).
- UIDAI eKYC fees on auth path: ₹100-150 cr / year on the new-onboarding base.
- ATO fraud-loss avoidance: directional, ₹50-150 cr / year per industry analyst estimates.

---

## 9. Internal notes

- **Conflict:** ICICI Bank is a customer of multiple identity-fintech vendors for V-KYC and onboarding (IDfy, Signzy, HyperVerge are widely cited Indian-bank vendors). We do not displace them — we sit alongside, replacing the post-onboarding credential layer.
- **Mutual contacts:** none confirmed at the working level. Agent #28 + Agent #42 own any board-level introduction.
- **Things to be careful about:**
  - ICICI Bank communications is professional and process-driven. Cold outreach to general inboxes (info@, contact@) is unlikely to surface. Direct LinkedIn outreach to the CISO + head of digital banking, with one mutual connection, is the highest-yield path.
  - ICICI Bank, ICICI Lombard, ICICI Prudential, ICICI Securities are distinct entities. This pack is for ICICI Bank Ltd. only.
  - **Do not** reference the 2018 governance matter in any external communication.
- **Open intel asks for v1.1:**
  - Confirm names of CISO, CIO, CRO, CFO from most recent FY annual report.
  - Confirm the bank's current SMS-aggregator vendor (sender-ID public data may indicate).
  - Confirm if ICICI has signed any public partnership with an identity-fintech in the last 12 months (would change competitive posture).

---

LAST_UPDATED: 2026-05-25
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
