# Axis Bank Ltd. — intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #43 (BFSI North).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P4 → P7 → P1. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-26.

---

## 1. Bank profile

- **Legal name:** Axis Bank Limited [src: company-website-2026-Q1].
- **Founded:** 1993 (as UTI Bank), renamed Axis Bank in 2007 [src: company-website-2026-Q1].
- **Headquarters:** Mumbai, Maharashtra (corporate office at Axis House, Worli; registered office at Ahmedabad) [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE [src: company-website-2026-Q1].
- **Scale (publicly disclosed):** third-largest private-sector bank in India by deposits; > 5,000 branches `[VERIFY exact FY26 figures]` [src: company-annual-report-most-recent-FY].
- **Notable corporate transactions:** Acquired Citibank India's retail banking, credit-card, and wealth-management business; transaction completed in 2023 [src: news-economictimes-2022-03-30; news-economictimes-2023-03-01]. This added ~ 2.5 M new credit-card customers and ~ ₹50,000 cr deposit base [src: company-press-release-2023-03-01].
- **Digital-banking platforms (publicly known by name):**
  - **Axis Mobile** — retail mobile-banking app [src: play-store-listing-2026-Q1].
  - **Axis NetBanking** — web channel at `omni.axisbank.co.in` [src: company-website-2026-Q1].
  - **Open by Axis Bank** — neo-banking + SME [src: play-store-listing-2026-Q1].
  - **Buzz by Axis** — millennial/youth banking app `[VERIFY active status]`.
  - **Axis Bank Tab Banking** — for branch RM-assisted account opening [src: company-website-2026-Q1] `[VERIFY current product name]`.
- **Active customer base:** ~ 50 M+ retail customers including post-Citi-acquisition uplift `[VERIFY exact FY26 disclosure]` [src: company-annual-report-most-recent-FY].

---

## 2. Recent RBI inspection cycle

- **Annual RBS inspection cadence** as with other Tier-1 private-sector banks; specific cycle dates and findings are **not in public record** `[VERIFY via the bank's compliance team]`.
- **2024 — Banking Ombudsman Complaints:** Axis Bank's complaint volume is publicly disclosed in the RBI Banking Ombudsman annual report; the bank features in top-5 complaint volumes across categories `[VERIFY exact edition and category breakdown]` [src: regulatory-rbi-ombudsman-annual-report `[VERIFY]`].
- **2023 — Citi acquisition regulatory clearances:** RBI, CCI, NCLT clearances all received in the 2022-2023 window without conditional orders affecting digital infrastructure [src: news-economictimes-2023-03-01].
- **No public RBI sanction on Axis Bank's digital business** comparable to HDFC's 2020 order, in the 2020-2025 window `[VERIFY at time of outreach]`.
- **Public posture on risk:** Axis Bank's annual report's "Risk Management" section names cybersecurity, fraud, and information-security risks among principal risks [src: company-annual-report-FY24-risk-section] `[VERIFY exact paragraph]`.

---

## 3. Recent breach posture

- **2021 — data exposure at a third-party Axis Bank subsidiary (Axis Bank Foundation / Axis Securities):** widely reported in trade press `[VERIFY exact event, scope, date]` [src: news-trade-press-2021 `[VERIFY]`]. Axis Bank Ltd. itself responded with public statements that core banking systems were not affected.
- **2022 / 2023 — staff data-exfil incidents:** the bank has, over multiple periods, disclosed disciplinary action against staff for misuse of customer data; specific incident disclosures are in line with RBI fraud-reporting requirements `[VERIFY specific publications]` [src: news-trade-press-2023 series `[VERIFY]`].
- **Industry context:** Axis Bank customers, like those of other Tier-1 banks, are continuously targeted by smishing and vishing campaigns; the bank runs a "Take action against fraud" awareness microsite [src: company-website-security-page-2026-Q1].
- **Citi-acquisition data-migration integrity:** during the 2022-2023 customer-data-migration window, integrity testing was a major audit focus; the bank has not publicly disclosed any breach in the migration window `[VERIFY]`.

**So-what for ZeroAuth:** the recurring privileged-access / staff-data-exfil pattern at Axis is the cleanest live case for Pain Point #4 in the demo. Scene 5 (audit-log integrity demonstration) is the conversation.

---

## 4. Digital-banking platform stack (publicly known)

- **Axis Mobile:** native Android + iOS; consistently ranked in the top 5 Indian BFSI apps by Play Store reviews [src: play-store-listing-2026-Q1].
- **Auth posture for Axis Mobile:** customer ID + password + 6-digit MPIN; BiometricPrompt (Android) / Face ID (iOS) for in-app unlock; OTP via SMS for transactions; Aadhaar OTP for high-friction operations [src: company-website-security-page-2026-Q1].
- **Auth posture for Axis NetBanking:** customer ID + password + Aadhaar OTP / mobile OTP; transaction-step-up via SMS OTP [src: company-website-net-banking-help-2026-Q1].
- **OTP delivery:** SMS via aggregator; DLT-registered sender headers `AXISBK` family [src: trai-dlt-registry-public-listing-2026-Q1].
- **KYC stack:** Video KYC operated in-house under Axis Mobile / Open by Axis onboarding flows; eKYC via UIDAI through Axis's KUA status `[VERIFY current KUA designation]`.
- **Branch / teller stack:** post-2020 transition to cloud-first teller workstations is publicly referenced in careers postings [src: linkedin-careers-2026-Q1].
- **API surface:** Axis Bank Open Banking platform at `developer.axisbank.com` (subpath may shift) `[VERIFY]`.

---

## 5. Buying centre

| Role | Title at Axis Bank | Name | Status |
|---|---|---|---|
| CISO | Chief Information Security Officer | TBD | `[VERIFY via LinkedIn / annual report]` |
| CIO | Chief Technology Officer / Head — IT | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY — name in most recent annual report]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — Digital Banking | President & Head, Digital Business | TBD | `[VERIFY]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |
| Internal Audit | Head, Internal Audit | TBD | `[VERIFY — relevant for Scene 5 pitch]` |

**Approach rule:** verify names on the day of outreach via the corporate-governance / board page at `axisbank.com` (subpath may shift) `[VERIFY exact URL]`. If unverifiable, address by role title.

**Likely warm-intro paths:**

- TCS / Wipro / Infosys alumni network — Axis's technology org is widely staffed from major Indian IT services.
- IIM-A / IIM-B alumni — Axis's executive committee has historically had strong IIM-A / IIM-B representation `[VERIFY]`.
- Citi alumni now at Axis Bank — post-2023 acquisition, multiple senior Citi India leaders moved to Axis; this is publicly discussed in trade press but specific names are `[VERIFY]`.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P4 — Privileged-access insider abuse + audit-log tamper-evidence

**Public expression:**

- The 2023 disciplinary action against a senior officer involved alleged misuse of customer information; the matter was referenced in trade press `[VERIFY specific publication and date]` [src: news-trade-press-2023 `[VERIFY]`].
- Axis Bank's annual report includes a section on "Vigilance and Internal Audit" referencing actions taken against employees for code-of-conduct violations [src: company-annual-report-vigilance-section] `[VERIFY exact FY]`.
- The Citi-India retail-acquisition data migration (2023) made data-access controls a board-priority topic per public commentary `[VERIFY specific quote]`.
- RBI IT MD §6.4 (tamper-evident logs + segregation of duties) is the regulatory backbone here [src: regulatory-rbi-master-direction-it-governance-2023].

**Why ZeroAuth resonates here:** Scene 5 of the demo — operator attempts to tamper with an audit row, integrity check fails, on-chain anchor on Base shows the original terminal hash — directly addresses the regulator-evidence question that a CRO and Head of Internal Audit have had to repeatedly answer in inspections.

### 6.2 P7 — High-value transaction authorisation: weak OTP-transaction binding

**Public expression:**

- RBI Master Direction on Digital Payment Security Controls §5.3 (binding regulation for Axis Bank) flags the OTP-transaction binding gap [src: regulatory-rbi-master-direction-digital-payments-2021].
- Axis Bank's transaction-step-up flow uses SMS OTP with a transaction-specific template `[VERIFY exact template]` — vulnerable to substitution if the customer skims the SMS rather than reading it.
- Banking Ombudsman annual reports cite high-value-transaction fraud as a top complaint category across the sector [src: regulatory-rbi-ombudsman-annual-report `[VERIFY edition`].

**Why ZeroAuth resonates here:** Scene 3 of the demo — substitution attack on the amount mid-flow, proof rejected — is the most CRO-resonant scene. The audit row contains the full transaction payload + proof_hash, regulator-replayable in one row.

### 6.3 P1 — Credential database breach exposure under DPDP §8

**Public expression:**

- Axis Bank's risk-management disclosures in the annual report enumerate cybersecurity and DPDP-Act-compliance as principal risks [src: company-annual-report-FY24-risk-section].
- The bank has publicly disclosed DPO appointment and grievance-redressal infrastructure for DPDP §17 compliance `[VERIFY exact date]` [src: company-website-data-protection-page-2026-Q1].
- The post-Citi-acquisition customer data migration was publicly framed as an opportunity to harden the credential surface `[VERIFY exact quote]`.

**Why ZeroAuth resonates here:** Scene 4 of the demo — the dumped `users` table with no PII — is the same conversation as with HDFC and ICICI. For Axis, the additional resonance is the post-Citi-acquisition data-consolidation moment: a credential-replacement project lands cleanly on top of an organisation already mid-consolidation.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** privileged-access insider risk + the post-Citi-acquisition opportunity to harden the consolidated credential layer.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> The consolidated retail credential database post-Citi-acquisition is now the single largest concentration of authentication data Axis Bank has ever held in one stack. RBI IT MD §6.4 audit-log integrity, DPDP §8 breach exposure, and privileged-access insider risk all stack against this concentration. There is a clean structural fix.

**Asks:**

- 15-minute call with the CISO + Head of Internal Audit (Scene 5 is their conversation).
- Demo at Axis House, Worli (Mumbai), or virtually.
- One-page summary PDF pre-read attached.

**Do not say in the first email:**

- Specific staff names from any disciplinary case.
- Any rupee saving figure.
- Anything that frames Citi-acquisition as a problem (the bank has spent two years framing it as a success).

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active retail customers, post-Citi-consolidation: ~ 50 M `[VERIFY]`.
- Annual digital authentications per active customer: ~ 60.
- Total annual auth events: 50 M × 60 = 3 B / year.
- Estimated tier-1-bank annual seat fee: ₹35-50 cr / year `[VERIFY pricing committee — Agent #42]`.

**3-year ACV estimate:** ₹100-150 cr cumulative ACV across a 3-year pilot-to-production engagement, of which ~ ₹12-20 cr in the pilot year. Planning estimates only.

**Cost-avoidance offer (illustrative, not promised):**

- SMS OTP gateway spend reduction: estimated ₹30-45 cr / year.
- UIDAI eKYC fees on auth path: ₹60-100 cr / year on the new-onboarding base.
- Insider-abuse incident remediation cost avoidance: ₹15-60 cr per major incident avoided (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P4).

---

## 9. Internal notes

- **Conflict:** Axis Bank uses multiple identity-fintech vendors for V-KYC and onboarding (IDfy, HyperVerge widely referenced). We do not displace them; we replace the post-onboarding credential layer.
- **Citi-acquisition angle:** the migration of ~ 2.5 M Citi credit-card customers into Axis Bank Ltd. is a topic the bank discusses openly in investor calls. Demonstrating that ZeroAuth makes future migrations of this kind structurally cleaner (no PII in the user table to migrate) is a strong corollary point.
- **Mutual contacts:** none confirmed at the working level. Agent #28 + Agent #42 own any board-level introduction.
- **Things to be careful about:**
  - Axis Bank communications team responds quickly to perceived FUD. Do not cite the 2023 disciplinary action by name in any external communication.
  - The Citi-acquisition story is a topic of corporate pride. Lead with "now that you've consolidated, here is how to harden" not "the migration created risk".
- **Open intel asks for v1.1:**
  - Confirm names of CISO, CIO, CRO, CFO, Head of Internal Audit from most recent FY annual report.
  - Confirm Axis Bank's current identity-fintech vendor stack.
  - Confirm if Axis has signed any public partnership with a credential-replacement vendor in the last 12 months (would change competitive posture).

---

LAST_UPDATED: 2026-05-26
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
