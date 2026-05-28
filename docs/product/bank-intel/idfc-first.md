# IDFC FIRST Bank Ltd. — intel pack

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Owning AE: Agent #43 (BFSI North).
> Demo lead: Agent #45 (Solutions Architect).
> Pain-hook priority: P9 → P3 → P1. See [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md).
> Last updated: 2026-05-27.

---

## 1. Bank profile

- **Legal name:** IDFC FIRST Bank Limited [src: company-website-2026-Q1].
- **Founded:** 2018 (merger of IDFC Bank + Capital First, effective 2018-12-18) [src: company-press-release-2018-12-18; news-economictimes-2018-12-18].
- **Headquarters:** Mumbai, Maharashtra (corporate office at Bandra-Kurla Complex) [src: company-website-2026-Q1].
- **Registered office:** Chennai, Tamil Nadu [src: company-website-2026-Q1].
- **Stock listings:** BSE, NSE [src: company-website-2026-Q1].
- **Scale (publicly disclosed):** balance sheet of order ₹3 lakh crore; > 900 branches; among India's fastest-growing private-sector banks by deposit growth `[VERIFY exact FY26 figures]` [src: company-annual-report-most-recent-FY].
- **Distinctive market posture:** the bank publicly positions itself as a "customer-first" / "fair fees" challenger to the traditional Tier-1 private-sector banks. Public commitments include "zero fees on basic services" (e.g., no charges on IMPS, SMS alerts, debit card AMC for savings account holders) `[VERIFY exact list of fee waivers]` [src: company-website-fair-fees-page-2026-Q1].
- **Digital-banking platforms (publicly known by name):**
  - **IDFC FIRST Bank Mobile Banking** — flagship retail mobile app [src: play-store-listing-2026-Q1].
  - **NetBanking** — web channel at `my.idfcfirstbank.com` `[VERIFY exact URL]` [src: company-website-2026-Q1].
  - **FIRSTAP** — wearable / IoT payments product `[VERIFY active status]` [src: company-press-release-2020].
  - **MyFIRST Partner** — partner-channel onboarding `[VERIFY]`.
- **Active customer base:** ~ 12 M+ customers `[VERIFY exact FY26 disclosure]` [src: company-annual-report-most-recent-FY].

---

## 2. Recent RBI inspection cycle

- **Annual RBS inspection cadence** applies; IDFC FIRST Bank's inspection cycle dates and findings are **not in public record** `[VERIFY via bank compliance]`.
- **2018 merger conditional clearances:** RBI's approval of the IDFC Bank + Capital First merger included routine post-merger reporting obligations [src: regulatory-rbi-press-2018-12-18].
- **2023-2024 — capital raises and rights issues:** publicly disclosed capital raises during 2023-2024 [src: company-press-release-various-2023-2024; news-economictimes-2024 series]; RBI engagement around capital-adequacy is part of normal supervision and not a sanction.
- **No public RBI sanction on IDFC FIRST Bank's digital business** in the post-merger window `[VERIFY at time of outreach]`.
- **Customer-grievance complaint volume:** IDFC FIRST has historically had lower per-customer complaint volumes than the Tier-1 incumbents, in the RBI Banking Ombudsman annual reports `[VERIFY edition]` [src: regulatory-rbi-ombudsman-annual-report]. This is a positive talking point with the CRO.

---

## 3. Recent breach posture

- **No major customer-database breach publicly attributed to IDFC FIRST Bank** in the last 24 months at the level of regulatory disclosure `[VERIFY via news search at time of outreach]`.
- **Industry-norm phishing and smishing patterns:** the bank runs a customer-awareness microsite warning about fake SMS, fake app, and SIM-swap attacks [src: company-website-security-page-2026-Q1].
- **Smaller-bank breach blast radius:** at 12 M customers, a credential-database breach is operationally smaller than HDFC / ICICI / SBI but DPDP §8 penalty cap (₹250 cr per incident) is jurisdiction-fixed — the absolute penalty does not scale with customer count, which means the relative impact on a smaller bank is **larger**, not smaller.
- **Fast-growth-bank challenges:** growing deposit base + customer count means proportionally less time spent on legacy-system-hardening and more on new-feature shipping; this is the classic "structural credential surface debt" pattern.

**So-what for ZeroAuth:** the bank's relatively younger digital stack means a replacement of the credential layer can be ambitious without the regression-risk overhang that incumbent stacks carry. This is the optimal "early-pilot" profile.

---

## 4. Digital-banking platform stack (publicly known)

- **Mobile app:** native Android + iOS; per-customer-feedback in Play Store reviews suggests modern stack with regular feature releases [src: play-store-listing-2026-Q1].
- **Auth posture for mobile app:** customer ID + password + MPIN; BiometricPrompt (Android) / Face ID (iOS) for in-app unlock; OTP via SMS for transactions [src: company-website-security-page-2026-Q1].
- **Auth posture for NetBanking:** user ID + password + OTP; transaction-step-up via SMS OTP [src: company-website-net-banking-help-2026-Q1].
- **OTP delivery:** SMS via aggregator; DLT-registered sender headers (`IDFCFB` family) `[VERIFY exact sender ID family]`.
- **KYC stack:** Video KYC + Aadhaar-based eKYC; partner V-KYC providers may be in the stack `[VERIFY]`.
- **Account-opening flow:** the bank publicly promotes "open an account in five minutes" digital onboarding [src: company-website-account-opening-page-2026-Q1] — among the fastest in Indian retail banking, making V-KYC drop-off particularly painful at this bank.
- **Tech leadership disclosures:** the bank publicly references investment in cloud, microservices, and digital-native infrastructure post-merger [src: company-press-release-various-2020-2024 `[VERIFY specific quotes]`].

---

## 5. Buying centre

| Role | Title at IDFC FIRST Bank | Name | Status |
|---|---|---|---|
| MD & CEO | Managing Director & Chief Executive Officer | TBD | `[VERIFY — publicly disclosed in every annual report]` |
| CIO | Chief Information Officer / Head — Technology | TBD | `[VERIFY]` |
| CISO | Chief Information Security Officer | TBD | `[VERIFY]` |
| CFO | Chief Financial Officer | TBD | `[VERIFY]` |
| CRO | Chief Risk Officer | TBD | `[VERIFY]` |
| Head — Digital Banking | Head, Digital Banking / Consumer Bank | TBD | `[VERIFY]` |
| Compliance | Chief Compliance Officer | TBD | `[VERIFY]` |

**Approach rule:** verify executive names on the corporate-governance / board page at `idfcfirstbank.com` (subpath may shift) `[VERIFY exact URL]` on the day of outreach. The bank is smaller and more accessible than HDFC / ICICI; founder-CEO outreach via LinkedIn has historically been responded to in industry events `[VERIFY no specific name attribution]`.

**Likely warm-intro paths:**

- IIT / IIM alumni — multiple senior executives are publicly disclosed alumni `[VERIFY]`.
- Capital First legacy network — many post-2018-merger senior staff are ex-Capital First; consumer-lending and fintech networks are strong here.
- Fintech-startup ecosystem — IDFC FIRST has historically been more partnership-open than incumbent peers; trade-press references multiple partnerships with payment fintechs and lending platforms `[VERIFY specific partnerships and dates]`.

---

## 6. Three publicly-expressed pain points (mapped to `01-pain-points.md`)

### 6.1 P9 — Customer-onboarding drop-off at V-KYC

**Public expression:**

- The bank publicly markets "open an account in five minutes" digital onboarding [src: company-website-account-opening-page-2026-Q1]; drop-off in the V-KYC step undermines this marketing claim.
- IDFC FIRST's deposit-growth strategy is among India's most aggressive `[VERIFY exact CAGR claim]`; onboarding-completion-rate is therefore a direct lever on the headline growth number.
- Industry V-KYC drop-off norm: 30-45 % per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P9; at IDFC FIRST's volumes (~ 2-3 M attempted onboardings / year `[VERIFY]`), 35 % drop-off = 700,000-1 M lost customers per year × ₹4,000 LTV = ₹280-400 cr foregone revenue.
- The bank's investor presentations historically reference "cost per acquisition" as an operational metric where IDFC FIRST is competitive with peers `[VERIFY specific investor-deck reference]`.

**Why ZeroAuth resonates here:** Scene 1 of the demo — enrollment in 90 seconds anchored to the existing V-KYC artefact, with all subsequent authentications never re-entering V-KYC — directly improves the onboarding-completion metric. For a growth-stage bank, the ROI math is more visceral than at a saturated incumbent.

### 6.2 P3 — SMS OTP cost, failure rate, SIM-swap surface

**Public expression:**

- The bank's "fair fees" market positioning includes free SMS alerts on savings accounts [src: company-website-fair-fees-page-2026-Q1]; the absorbed SMS cost is therefore directly P&L-visible.
- SMS gateway cost on auth path + alerts at 12 M customers × 8 SMS/month × ₹0.20 = ₹23 cr / year (illustrative, not verified).
- The bank's customer-awareness microsite explicitly addresses SIM-swap and smishing attack patterns [src: company-website-security-page-2026-Q1].

**Why ZeroAuth resonates here:** for a bank where "fair fees" is the public market positioning, internalising SMS cost is genuinely painful — competitors charge customers for some of these, IDFC FIRST does not, so the line item is fully absorbed. ZeroAuth removes SMS from the auth path, freeing up the line item. Scene 2 of the demo.

### 6.3 P1 — Credential database breach exposure under DPDP §8

**Public expression:**

- IDFC FIRST Bank's annual report includes information-security and DPDP-compliance in the principal-risks section [src: company-annual-report-FY24-risk-section] `[VERIFY exact reference]`.
- The bank's DPO appointment is publicly disclosed (mandatory under DPDP §17) `[VERIFY exact date]` [src: company-website-data-protection-page-2026-Q1].
- DPDP §33 penalty cap (₹250 cr per incident) is the same for a 12 M-customer bank as for a 75 M-customer bank — relative-to-balance-sheet impact is therefore larger here.

**Why ZeroAuth resonates here:** the relative DPDP-blast-radius argument is more compelling at a smaller, growth-stage bank where ₹250 cr penalty is a larger fraction of net profit. Scene 4 of the demo lands directly. Additionally, being among the first banks to publicly adopt a non-PII credential architecture is a competitive talking point IDFC FIRST's marketing team can use.

---

## 7. Outreach angle (Email 1 lead)

**Hook:** growth-stage bank where credential infrastructure is an early-pilot opportunity with directly P&L-visible upside, not just a regulatory checkbox.

**Opening sentence (template; final phrasing in [outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) Email 1):**

> IDFC FIRST has built a customer-first digital bank in seven years. The next seven require credential infrastructure that does not become a DPDP §8 liability and does not absorb SMS gateway cost the bank has publicly chosen not to charge customers for. There is a structural fix worth a 15-minute conversation.

**Asks:**

- 15-minute call with the CIO + Head of Digital Banking.
- Demo at IDFC FIRST Bank House (BKC, Mumbai) or virtually.
- Pre-read PDF + a customer-onboarding-completion-rate ROI model attached (in Email 3, not Email 1).

**Do not say in the first email:**

- Anything that implies the bank is "small" or "early".
- Specific rupee saving figures (Email 3 territory).
- Anything about the 2018 merger as a problem (the bank has framed it as the founding moment of a new bank).

---

## 8. Estimated 3-year ACV

**Assumptions (sourced or derived):**

- Active customers: ~ 12 M `[VERIFY]`.
- Annual digital authentications per active customer: ~ 50.
- Total annual auth events: 12 M × 50 = 600 M / year.
- Estimated growth-stage-bank annual seat fee: ₹15-25 cr / year `[VERIFY pricing committee — Agent #42]`.

**3-year ACV estimate:** ₹45-75 cr cumulative ACV across a 3-year pilot-to-production engagement, of which ~ ₹6-10 cr in the pilot year. Planning estimates only.

**Cost-avoidance offer (illustrative, not promised):**

- SMS OTP gateway spend reduction: estimated ₹15-25 cr / year.
- UIDAI eKYC fees on auth path: ₹25-40 cr / year.
- Onboarding-completion-rate uplift translated to foregone-revenue-recovery: ₹100-300 cr / year on an aggressive growth trajectory (per [01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) P9 math at IDFC FIRST scale).

---

## 9. Internal notes

- **Pilot-fit:** IDFC FIRST is among the strongest candidates to be an early design-partner. The combination of (a) growth-stage agility, (b) "customer-first" public posture aligning with "we never store your credential", and (c) smaller incumbent technical debt makes the engagement profile favourable.
- **Conflict:** IDFC FIRST uses multiple identity-fintech vendors for V-KYC; we do not displace them. We replace the post-onboarding credential layer.
- **Mutual contacts:** Capital-First legacy network has multiple touchpoints into IDFC FIRST tech and product leadership `[VERIFY specific touchpoint via Agent #28 network]`.
- **Things to be careful about:**
  - Do not position ZeroAuth as a "Tier-1-bank-only" product. The pricing and engagement model must work at this customer scale.
  - The bank's "fair fees" public posture means it is sensitive to anything that looks like a hidden cost or a complicated commercial.
  - The CEO is well-known in the industry; LinkedIn outreach to the CEO with two mutual connections may be the highest-leverage entry path `[VERIFY no specific name attribution before outreach]`.
- **Open intel asks for v1.1:**
  - Confirm MD & CEO name from most recent annual report.
  - Confirm CIO, CISO, CRO names.
  - Confirm IDFC FIRST's current V-KYC and identity-fintech vendor stack.

---

LAST_UPDATED: 2026-05-27
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWER: Agent #28 (VP Product)
