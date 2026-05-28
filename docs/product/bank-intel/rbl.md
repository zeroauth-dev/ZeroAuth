# RBL Bank Ltd. — intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #44 (BFSI South + PSBs).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P5 → P4 → P1. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-27.

---

## 1. Bank profile

- **Legal name:** RBL Bank Limited (formerly Ratnakar Bank Limited) [src: company-website-2026-Q1].
- **Founded:** 1943 (as Ratnakar Bank), re-branded RBL Bank in 2014 [src: company-website-2026-Q1].
- **Headquarters:** Mumbai, Maharashtra (corporate office at Lower Parel) [src: company-website-2026-Q1].
- **Registered office:** Kolhapur, Maharashtra [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE [src: company-website-2026-Q1].
- **Scale (publicly disclosed):** balance sheet of order ₹1.5-1.6 lakh crore; ~ 500 branches; ~ 14 M+ customers `[VERIFY exact FY26 figures]` [src: company-annual-report-most-recent-FY].
- **Distinctive market posture:** RBL Bank has historically built a large credit-card portfolio and partnership-led business model — including the BankBazaar / Bajaj Finserv co-brand credit cards `[VERIFY current state of co-brand deals]` [src: news-economictimes-various; company-press-release-various].
- **Digital-banking platforms (publicly known by name):**
  - **RBL MyBank** — flagship retail mobile-banking app [src: play-store-listing-2026-Q1] `[VERIFY current product name]`.
  - **NetBanking** — web channel at `online.rblbank.com` (subpath may shift) `[VERIFY]`.
  - **RBL Bajaj Finserv credit-card app** — co-brand product `[VERIFY active status post-2022 partnership review]`.
- **Active customer base:** ~ 14 M `[VERIFY exact FY26 disclosure]` [src: company-annual-report-most-recent-FY].

---

## 2. Recent RBI inspection cycle

- **Annual RBS inspection cadence** applies; RBL's inspection cycle dates and findings are **not in public record** `[VERIFY via bank compliance]`.
- **2021-2022 — leadership transition + RBI engagement:** In December 2021, the then-MD & CEO stepped down ahead of contract expiry, and RBI named a director on the board for the transition period [src: news-economictimes-2021-12-25; regulatory-rbi-press-2021-12-25]. The bank publicly confirmed all customer balances were safe and operations continued normally [src: company-press-release-2021-12-26]. The board appointed a new MD & CEO in 2022 [src: company-press-release-2022-06-23].
- **2022 — co-brand credit-card review:** RBI's broader oversight of co-branded credit-card programs across the sector during 2022 affected RBL's Bajaj Finserv partnership; RBL adjusted its co-brand portfolio accordingly [src: news-economictimes-2022 series, exact dates `[VERIFY]`].
- **Post-2022 — return to growth:** the bank has publicly emphasised returning to a sustainable-growth posture, with multiple quarters of guided-and-met financial performance under the new leadership [src: company-investor-call-transcripts-various-2023-2025 `[VERIFY specific quotes]`].
- **Public posture on regulator engagement:** RBL's annual reports and investor calls explicitly reference active engagement with RBI on governance and risk topics [src: company-annual-report-corporate-governance-section] `[VERIFY exact section reference]`.

---

## 3. Recent breach posture

- **No major customer-database breach publicly attributed to RBL Bank** in the last 24 months `[VERIFY via news search at time of outreach]`.
- **Partnership-stack risk surface:** RBL's partnership-heavy model (co-brand cards, lending partnerships, digital-lending LSP arrangements) creates a wide cross-entity data-sharing surface. RBI's Digital Lending Guidelines (Sept 2022, updated Aug 2024) require explicit consent capture across this surface [src: regulatory-rbi-digital-lending-guidelines-2022; regulatory-rbi-digital-lending-update-2024].
- **2022-2024 — phishing patterns targeting credit-card customers:** RBL credit-card customers have been targeted in trade-press-reported smishing campaigns `[VERIFY specific dates]` [src: news-trade-press-2023 series `[VERIFY]`]; the bank runs an awareness microsite [src: company-website-security-page-2026-Q1].
- **Class-action posture under DPDP §13:** while no class action has been filed against RBL Bank publicly `[VERIFY at time of outreach]`, the DPDP §13 + §33 framework means any future credential-DB breach has a ₹250 cr per-incident penalty cap. For RBL's balance-sheet size, this is materially larger relative to net profit than at HDFC or ICICI.

**So-what for ZeroAuth:** the partnership-heavy business model is exactly the surface where RBI Digital Lending Guidelines consent + cryptographic-binding lands hardest. Scene 3 of the demo (transaction-binding) and the consent-binding follow-up are the conversation.

---

## 4. Digital-banking platform stack (publicly known)

- **Mobile app:** native Android + iOS; mid-volume Play Store ranking among Indian BFSI apps [src: play-store-listing-2026-Q1].
- **Auth posture for mobile app:** customer ID + password + MPIN; BiometricPrompt (Android) / Face ID (iOS) for in-app unlock; OTP via SMS for transactions [src: company-website-security-page-2026-Q1].
- **Auth posture for NetBanking:** user ID + password + OTP; transaction-step-up via SMS OTP `[VERIFY exact pattern]`.
- **OTP delivery:** SMS via aggregator; DLT-registered sender headers `RBLBNK` family `[VERIFY exact sender ID]`.
- **KYC stack:** Video KYC + Aadhaar-based eKYC; partner V-KYC providers (Signzy, IDfy or similar) likely in the stack `[VERIFY]`.
- **Co-brand / partner platforms:** the partnership-led business model means credit-card onboarding flows touch partner systems (BankBazaar, Bajaj Finserv historically) — each such partner is a data-sharing surface under RBI Digital Lending Guidelines §4 [src: regulatory-rbi-digital-lending-guidelines-2022].
- **Tech leadership disclosures:** post-2022 management transition, the bank has referenced investment in digital, risk, and customer-grievance infrastructure [src: company-press-release-various-2022-2024 `[VERIFY specific quotes]`].

---

## 5. Buying centre

| Role | Title at RBL Bank | Name | Status |
|---|---|---|---|
| MD & CEO | Managing Director & Chief Executive Officer | TBD | `[VERIFY — publicly disclosed in every annual report; 2022 appointment]` |
| CIO | Chief Information Officer / Head — Technology | TBD | `[VERIFY]` |
| CISO | Chief Information Security Officer | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — Digital Banking | Head, Digital Banking & Consumer Bank | TBD | `[VERIFY]` |
| Head — Cards & Lending | Head, Credit Cards / Head, Retail Lending | TBD | `[VERIFY — relevant given partnership business]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |

**Approach rule:** verify executive names on the corporate-governance / board page at `rblbank.com` (subpath may shift) `[VERIFY exact URL]` on the day of outreach.

**Likely warm-intro paths:**

- Ex-Yes Bank / ex-Citi network — RBL has historically attracted senior talent from these institutions `[VERIFY no specific name attribution]`.
- IIM-A / IIM-B alumni — multiple senior executives are alumni `[VERIFY]`.
- Partnership-channel — BankBazaar / Bajaj Finserv / lending-partner introductions may surface a working-level intro to the digital team.
- Investor base — institutional shareholders (TPG, others) sometimes facilitate strategic introductions; out of scope for first-cycle outreach.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P5 — RBI Digital Lending Guidelines + co-lending consent capture

**Public expression:**

- RBI Digital Lending Guidelines (Sept 2022, updated Aug 2024) require explicit borrower consent for data sharing with LSPs (Loan Service Providers) [src: regulatory-rbi-digital-lending-guidelines-2022; regulatory-rbi-digital-lending-update-2024].
- RBL's partnership-led credit-card and lending business directly engages multiple LSPs and co-lending NBFCs; the consent-capture obligation cascades across each partner [src: regulatory-rbi-digital-lending-guidelines-2022, para 4].
- Trade-press commentary on RBL's lending business has periodically noted the operational complexity of multi-party consent capture `[VERIFY specific publication and date]` [src: news-trade-press-2024 `[VERIFY]`].
- RBI penalty for non-compliance: ₹1-50 cr per finding (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P5); RBL has publicly engaged with regulators on Digital Lending Guidelines compliance in its annual report compliance section [src: company-annual-report-compliance-section] `[VERIFY exact FY`].

**Why ZeroAuth resonates here:** ZeroAuth folds consent capture into the Pramaan proof: the session-nonce includes a hash of the consent text + scope; the Groth16 proof binds (DID, consent_hash, session_nonce). The audit row contains the proof artefact and is self-verifying — exactly the cryptographic-evidence posture RBI wants. Scene 3 of the demo (high-value-transaction step-up with consent-binding) lands directly.

### 6.2 P4 — Privileged-access insider abuse + audit-log tamper-evidence

**Public expression:**

- Post-2022 leadership transition, RBL's board has publicly committed to enhanced internal-controls and risk-management posture [src: company-press-release-various-2022; company-annual-report-corporate-governance-section] `[VERIFY exact statements]`.
- RBI IT Master Direction §6.4 (tamper-evident logs + segregation of duties) is the regulatory backbone here [src: regulatory-rbi-master-direction-it-governance-2023].
- The bank's annual report includes vigilance and internal-audit sections referencing actions taken against employees for code-of-conduct violations [src: company-annual-report-vigilance-section] `[VERIFY exact FY]`.

**Why ZeroAuth resonates here:** Scene 5 of the demo — operator attempts to tamper with an audit row, integrity check fails, on-chain anchor on Base shows the original terminal hash — directly addresses the regulator-evidence question that the bank's CRO and Head of Internal Audit have had to answer in inspections. For a post-transition bank, demonstrating an enhanced cryptographic-audit-log posture is a competitive credential when engaging the board.

### 6.3 P1 — Credential database breach exposure under DPDP §8

**Public expression:**

- RBL Bank's annual report enumerates information-security and DPDP-compliance as principal risks [src: company-annual-report-FY24-risk-section] `[VERIFY exact reference]`.
- DPDP §33(1) penalty cap (₹250 cr per incident) is materially larger relative to RBL's net profit than at Tier-1 incumbents.
- The partnership-led business model multiplies the credential-data-sharing surface; this is a topic the bank's risk team must already be tracking.

**Why ZeroAuth resonates here:** Scene 4 of the demo — the dumped `users` table with no PII — is the same conversation, with the additional point that partnership-channel data-sharing becomes simpler (commitments + DIDs are not personal data under DPDP §2(t), so the cross-partner consent + transfer impact assessments tighten substantially). This makes ZeroAuth a *business-enablement* story at RBL, not just a *risk-mitigation* story.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** RBI Digital Lending Guidelines consent-capture obligation across a partnership-heavy credit-card and lending book.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> RBI Digital Lending Guidelines, updated August 2024, make consent capture a cryptographic obligation across every LSP and co-lending partner. RBL's partnership-led book multiplies that surface. The consent artefact can be cryptographically bound to the customer's identity proof in one operation, with a single audit row that any regulator can replay.

**Asks:**

- 15-minute call with the CIO + Head of Credit Cards/Lending + CCO.
- Demo at RBL Bank corporate office (Lower Parel, Mumbai) or virtually.
- Pre-read PDF + RBI Digital Lending Guidelines mapping note (companion to [docs/compliance/compliance-roadmap-v1.md](../../compliance/compliance-roadmap-v1.md) § 2.3) attached.

**Do not say in the first email:**

- Anything that references the 2021 leadership transition.
- Anything about the Bajaj Finserv co-brand changes as a problem.
- Specific rupee saving figures.

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active customers: ~ 14 M `[VERIFY]`.
- Annual digital authentications per active customer: ~ 50.
- Total annual auth events: 14 M × 50 = 700 M / year.
- Partnership-channel additional consent-capture transactions: ~ 5-10 M / year `[VERIFY]`.
- Estimated mid-size-private-sector-bank annual seat fee: ₹15-25 cr / year `[VERIFY pricing committee — Agent #42]`.

**3-year ACV estimate:** ₹45-75 cr cumulative ACV across a 3-year pilot-to-production engagement, of which ~ ₹6-10 cr in the pilot year. Planning estimates only.

**Cost-avoidance offer (illustrative, not promised):**

- SMS OTP gateway spend reduction: estimated ₹15-25 cr / year.
- RBI Digital Lending Guidelines non-compliance penalty avoidance: ₹1-50 cr per finding avoided.
- Audit-trail reconstruction during inspections: 2-8 engineer-weeks per finding avoided (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P5).

---

## 9. Internal notes

- **Pilot-fit:** RBL is among the strongest candidates for a Phase 1 design partner specifically because of the digital-lending angle. The combination of (a) partnership-heavy business model, (b) RBI Digital Lending Guidelines obligation, and (c) post-2022 board appetite for governance-strengthening makes the cryptographic-consent-binding pitch unusually well-aligned.
- **Conflict:** RBL works with multiple identity-fintech vendors and lending-as-a-service partners. We do not displace them; we replace the post-onboarding credential layer and add cryptographic consent-binding to the partnership-channel flows.
- **Mutual contacts:** Ex-Yes / Ex-Citi network may surface working-level intros; Agent #28 + Agent #42 to assess `[VERIFY specific touchpoint]`.
- **Things to be careful about:**
  - Do not reference the 2021 management transition. The bank has framed the post-2022 period as a new chapter; engage with that framing.
  - Be careful with co-brand-partner references. RBL's partnership stack has shifted; cite only what is currently active per company website.
  - The bank is institutional-investor-watched (TPG and others); public disclosures matter — anything ZeroAuth says in a meeting must be regulator-defensible.
- **Open intel asks for v1.1:**
  - Confirm MD & CEO name from most recent annual report.
  - Confirm CIO, CISO, CRO names.
  - Confirm RBL's current co-brand and lending-partnership stack (changes regularly).
  - Confirm RBL's current LSP / co-lending-NBFC relationships (consent-binding lands here).

---

LAST_UPDATED: 2026-05-27
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
