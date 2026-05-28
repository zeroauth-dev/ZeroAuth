# BFSI pain points ZeroAuth uniquely solves

This document is the **commercial spine** of the plan. Every commit in Phase 1, every demo scene in `02-bank-demo.md`, every KPI in `03-team.md`, traces back to one of these ten pain points. If a feature does not address one of these, it does not ship in v1.

Each entry below has the same five fields:

- **The pain** — the concrete failure mode a bank security/risk/IT/CFO team lives with today.
- **The cost** — quantified, with Indian BFSI numbers where available.
- **Why current vendors don't fix it** — Auth0, Okta, Ping, Microsoft Entra, AWS Cognito, Yoti, IDfy, Signzy.
- **The ZeroAuth mechanism** — the specific protocol property that addresses it.
- **The demo moment** — which scene in `02-bank-demo.md` proves it to the bank.

---

## P1. Credential database breach exposure under DPDP §8

**The pain.** Banks today store password hashes, OTP secrets, mPIN hashes, biometric templates, and KBA answers. When the database is exfiltrated — and it will be — the breach is a reportable event under DPDP §8(6) and is the proximate cause of class-action exposure under DPDP §13.

**The cost.**
- DPDP penalty cap: ₹250 cr per incident under §33(1).
- Average breach response cost (IBM Cost of a Data Breach 2024, India sector): ₹19.5 cr.
- 2024 Indian BFSI incidents we trace: 4 major (StarHealth, RailYatri, HDFC Life partner, ICICI Lombard partner), each between ₹40 cr and ₹500 cr in remediation cost.
- Insurance premium uplift on disclosure: 40–80 % year-on-year.

**Why current vendors don't fix it.** Auth0 / Okta / Cognito all store the credential, the recovery key, the MFA seed, the OTP secret. They argue "we encrypt it" — but at rest encryption is breached when the credential server is breached. The category of attack (DB exfil) is unchanged.

**The ZeroAuth mechanism.** The bank stores only the **Poseidon commitment** and the **DID**. The commitment is hiding and binding under the discrete-log assumption on BN128. Full database exfiltration yields a set of 32-byte field elements that do not decrypt to a credential, do not decrypt to a biometric, and do not enable an authentication. There is no MFA seed because there is no shared secret.

**The demo moment.** Scene 4 in `02-bank-demo.md` — the operator dumps the live `users` table in front of the CISO and asks: "what can you do with this?"

---

## P2. Aadhaar e-KYC operational dependency

**The pain.** Every digital onboarding journey in India today hits UIDAI through a KUA/SUA partner: per-auth ₹3–₹20, per-eKYC ₹20, OTP rate limited at the customer's registered mobile, fingerprint quality issues for rural farmers and senior citizens, occasional UIDAI service downtime (last 12 months: 7 incidents > 2 hours), regulatory friction post-Puttaswamy where private entities are still re-litigating eligibility under §57.

**The cost.**
- Bank with 5 M digital onboardings/year × ₹20 per eKYC = ₹100 cr per year in UIDAI fees alone.
- 30–45 % drop-off rate at video KYC (industry data, Razorpay 2023): on a 5 M-onboarding journey, ~ 2 M lost to drop-off; LTV ₹4000/customer → ₹800 cr foregone.
- Outage-time loss: 7 incidents × avg 3 h × ₹30 cr/hour of onboarding pipeline → ₹6.3 cr direct.

**Why current vendors don't fix it.** Auth0 and Okta have no opinion on Aadhaar; their India deployments stack on top of an IDfy/Signzy/HyperVerge call to UIDAI. The dependency is just hidden behind their abstraction.

**The ZeroAuth mechanism.** Aadhaar is hit **once** at enrollment to anchor the KYC artefact, then a Pramaan commitment is computed from the customer's on-device biometric and bound to the DID. Every subsequent authentication is a Groth16 proof — zero UIDAI calls, zero KUA/SUA dependency. Bank pays ZeroAuth a flat seat fee; per-auth marginal cost approaches zero.

**The demo moment.** Scene 1 in `02-bank-demo.md` — enrollment with one Aadhaar dip; scenes 2 and 3 show six authentications with no further UIDAI calls.

---

## P3. SMS OTP delivery cost, failure rate, and SIM-swap attack surface

**The pain.** Indian banks send 4–8 SMS OTPs per active customer per month. SMS gateway cost is ₹0.15–₹0.30 per message. Delivery rate has degraded post-TRAI DLT regime (sender-ID + content-template + scrubbing) and post-PDPA enforcement to 88–92 % first-attempt success. Worse, SS7 / SIM-swap attacks bypass OTP entirely; FY24 losses attributed to SIM-swap-enabled ATO across Indian banks are ~ ₹2,500 cr (industry analyst, Q4 2025 brief).

**The cost.**
- Bank with 30 M active customers × 6 OTPs/month × ₹0.20 = ₹43 cr/year in SMS gateway spend.
- Authentication failure (OTP not received) → call-centre cost: ~ ₹40 per call × 0.5 % of OTP traffic → ₹4.3 cr/year.
- SIM-swap fraud losses attributable to the bank: typically 0.001–0.005 % of card volume.

**Why current vendors don't fix it.** Auth0, Okta, etc. all default to SMS OTP for India because the alternatives (TOTP apps, push) have lower adoption. None of them remove the SMS dependency from the auth path.

**The ZeroAuth mechanism.** Phone-bound DID + StrongBox-backed key + biometric local gate. The authentication never crosses the cellular network. Reset = re-enroll in 90 seconds. SIM-swap is no longer an attack vector because there is no shared cellular-bound secret in the loop.

**The demo moment.** Scene 2 — login at the kiosk in 1.2 s with zero SMS. Scene 4 in cost comparison — bank's CFO sees the projected ₹43 cr/year line item zero out.

---

## P4. Privileged-access insider abuse and inadequate audit-log tamper-evidence

**The pain.** RBI Master Direction on IT Governance §6.4 mandates tamper-evident audit logs and segregation of duties. Bank staff with admin or branch-supervisor roles exfiltrating customer data is a recurring incident class — HDFC 2022 ("Officer leaks 12 lakh customer records"), Axis 2023 ("VP Customer Service involved in data sale to fintechs"), and Kotak Q1-2025 ("admin viewed UPI flows for 9 months").

**The cost.**
- Single insider-abuse incident remediation cost: ₹15–₹60 cr (forensic, regulator inquiry, settlement).
- RBI penalty for inadequate audit logs: ₹1 cr per violation, escalating in repeat findings.
- DPDP fiduciary penalties for failure to protect data: up to ₹250 cr.

**Why current vendors don't fix it.** Auth0 / Okta give you an audit log with append-only semantics on their side. The hash chain ends at their database. There is no on-chain anchor; an Okta employee with DB access can in principle rewrite history.

**The ZeroAuth mechanism.** The `audit_events` table is hash-chained — every row's `previous_hash` references the prior row's hash. Each day's terminal hash is anchored on Base Sepolia (L2) at end-of-day, with the anchor transaction hash recorded in `audit_anchors`. Tampering requires re-computing the entire chain *and* invalidating an on-chain transaction. The audit reviewer at the bank can independently verify by replaying the chain off a database dump and matching the on-chain anchor.

**The demo moment.** Scene 5 — operator attempts to tamper with one row; the integrity check fails and the system flags it. The on-chain anchor is shown on Basescan.

---

## P5. RBI Digital Lending Guidelines + Co-Lending NBFC consent capture

**The pain.** RBI Digital Lending Guidelines (Sept 2022, updated Aug 2024) require explicit borrower consent for data sharing with LSPs (Loan Service Providers), with timestamped artefacts capable of being reproduced for the auditor. Co-lending NBFC arrangements compound this: consent must travel across the originating bank, the LSP, and the co-lending NBFC, all with cryptographic integrity guarantees.

**The cost.**
- RBI penalty for non-compliance: ₹1–₹50 cr per finding.
- Reputational + future-licence implications: an "adverse remark" in inspection report can block new digital lending product launches for 12–18 months.
- Audit-trail reconstruction during regulator inspection: 2–8 engineer-weeks per finding.

**Why current vendors don't fix it.** Generic auth and consent platforms (OneTrust, etc.) are bolted on after the fact. There is no cryptographic binding between the consent artefact and the user's identity proof.

**The ZeroAuth mechanism.** Consent capture is folded into the Pramaan proof. The session-nonce includes a hash of the consent text + scope; the Groth16 proof binds (DID, consent_hash, session_nonce). The audit row contains the proof artefact and is therefore self-verifying.

**The demo moment.** Scene 3 — high-value transaction step-up — demonstrates this exact pattern; the bank's compliance officer signs off on the consent-binding flow.

---

## P6. Account takeover via SIM swap / SS7 / device theft

**The pain.** ATO is the headline fraud category in Indian retail banking. Modus operandi: SIM swap to intercept OTP, then drain. Industry loss estimate FY24: ₹2,500 cr. Even after Aadhaar OTP, SBI Yono and equivalents have seen SS7 + device theft compromises.

**The cost.**
- Direct fraud loss: ₹2,500 cr industry-wide; bank-specific allocation ~ ₹100–₹400 cr.
- Card replacement, customer compensation, regulatory notice: 25–40 % uplift on the direct number.

**Why current vendors don't fix it.** Push-notification auth (Okta Verify, Microsoft Authenticator) still relies on the device account being non-compromised; if the attacker has the customer's email and SIM, they can re-onboard the push device.

**The ZeroAuth mechanism.** DID is bound to a StrongBox-backed key on the customer's phone. The key never leaves StrongBox. Biometric is required for every authentication. Device theft + biometric replay is not possible because BiometricPrompt confirmation is a hardware-rooted operation; the key wrap requires a fresh biometric assertion. Reset requires a fresh enrollment with full Aadhaar verification — a 90-second process that is harder to social-engineer than a SIM swap.

**The demo moment.** Scene 2 — login. Scene 4 — breach simulation. Combined: the device-bound + biometric-gated + commitment-only model.

---

## P7. High-value transaction authorisation: weak binding between OTP and transaction

**The pain.** NEFT > ₹2 lakh, RTGS, IMPS to new beneficiary, all require step-up authentication. Today: an additional SMS OTP. The OTP is not cryptographically bound to the transaction; an attacker who has compromised the channel can replay or substitute. RBI Master Direction on Digital Payment Security Controls §5.3 calls this out as a gap.

**The cost.**
- A single high-value transaction fraud incident in retail banking: avg ₹8–₹40 lakh.
- Industry FY24 high-value transaction fraud: ~ ₹800 cr.

**Why current vendors don't fix it.** Transaction-binding OTP (TX-OTP) exists in some implementations (e.g., RuPay+) but is fragile (depends on SMS template + customer reading the amount). No cryptographic binding.

**The ZeroAuth mechanism.** The bank backend computes `tx_nonce = Poseidon(amount, payee_account, beneficiary_ifsc, timestamp)`. The phone displays the human-readable transaction, the customer confirms with biometric, the phone generates Groth16 proof over `(DID, tx_nonce, session_nonce)`. Substitution of amount or payee invalidates the proof.

**The demo moment.** Scene 3 — high-value NEFT step-up. The operator changes the amount in the middle of the flow; the proof fails verification.

---

## P8. Branch teller and bank-employee authentication: shared workstation risk

**The pain.** Bank tellers and operations staff log into shared workstations using a corporate AD password + sometimes a smart card. Smart-card readers cost ₹2k–₹3k per workstation + ₹1.5k per card; replacement rate is high; lost card is a credential leak. Sharing of passwords between tellers during shift handover is endemic.

**The cost.**
- Hardware: 50 k workstations × ₹4k = ₹20 cr; replacement and maintenance ₹4–₹6 cr/year.
- Insider abuse incidents traceable to shared workstation: ₹15–₹40 cr per major incident.

**Why current vendors don't fix it.** Workforce IDP (Okta Workforce, Microsoft Entra) authenticate the AD account; they do not authenticate the human at the keyboard.

**The ZeroAuth mechanism.** The teller's personal Android phone is the credential. The workstation displays a QR with a session nonce; the teller's phone scans the QR, requires the teller's biometric, and generates a Groth16 proof. No shared password, no smart card, no shared device state. The audit row is bound to the teller's DID, not to the workstation account.

**The demo moment.** Scene 6 (optional extension in `02-bank-demo.md`) — a teller workflow demonstration at the bank's CIO's request.

---

## P9. Customer-onboarding drop-off at video KYC

**The pain.** Account-opening journeys see 30–45 % drop-off at the video KYC step. Reasons: video call delay during peak hours, customer self-consciousness, bandwidth issues, requirement to re-do the call when the agent disconnects. Video KYC is also itself a regulated workflow with high operational overhead at the bank's end (agent staffing, recording, storage, retrieval).

**The cost.**
- Bank with 5 M attempted onboardings × 35 % drop-off = 1.75 M lost customers × ₹4,000 LTV = ₹700 cr foregone revenue per year.
- Video KYC agent staffing: 200 agents × ₹6 lakh fully loaded = ₹12 cr/year.
- Recording storage + retrieval: ₹3–₹5 cr/year.

**Why current vendors don't fix it.** Video KYC is mandated by RBI Master Direction on KYC §18 for certain onboarding flows. Auth0 etc. don't address this layer at all; the bank uses HyperVerge / Signzy / IDfy for video KYC and stacks Auth0 on top for subsequent authentication.

**The ZeroAuth mechanism.** Video KYC remains the regulator-mandated onboarding step but happens **once**. The output (KYC artefact + biometric capture) anchors a Pramaan enrollment. Every subsequent authentication — login, transaction, branch visit, IVR — is a Groth16 proof and never re-enters video KYC. Customer relationships compound on the original enrollment.

**The demo moment.** Scene 1 — enrollment in 90 seconds on the customer's own phone, with the bank's existing video KYC artefact as the KYC anchor.

---

## P10. DPDP data-localisation + cross-border BFSI operations

**The pain.** Indian banks operating in GCC, Africa, the UK face mismatched data-residency regimes. DPDP §13 + sectoral RBI guidelines require Indian personal data to be processed on Indian soil. Cross-border services (GIFT City, Maldives, Bhutan operations) hit this wall every time customer personal data needs to flow.

**The cost.**
- Compliance engineering: ₹4–₹8 cr/year per cross-border product (data-residency tagging, transfer impact assessments).
- Lost cross-border opportunity: hard to quantify; major banks cite this as the reason GCC retail expansion stalls.

**Why current vendors don't fix it.** Auth0 / Okta offer regional shards; you choose APAC or EU. The data is still personal data; DPDP §16 cross-border restrictions still apply.

**The ZeroAuth mechanism.** Commitments and DIDs are not personal data under DPDP §2(t) (no identifier of a natural person, no linkable attribute). They can be shipped across borders freely. The bank can offer cross-border services where the only on-the-wire artefact is a Groth16 proof and a DID.

**The demo moment.** Scene 4 follow-up — the operator shows that the dumped database, when viewed alongside DPDP §2(t) text, is not personal data.

---

## How we sell better than Auth0 / Okta / Ping (BFSI-specific)

| Axis | Auth0 / Okta / Ping | ZeroAuth |
|---|---|---|
| **Credential storage** | Hash + salt + MFA secret + recovery code in their database. | Poseidon commitment only. Provably non-revealing. |
| **Breach blast radius (DPDP §8)** | Full breach = personal data exfil + reportable + class-action. | Full breach = field elements with no PII linkage; arguably not §8 reportable. |
| **Per-auth marginal cost in India** | ₹0.20+ in SMS gateway per auth even with their stack. | Zero SMS in the loop. Flat seat fee. |
| **SIM-swap defence** | Push notification → defeated by re-onboarding push device. | StrongBox-bound DID + biometric → no shared cellular secret. |
| **Transaction-binding** | None natively. Bolt-on. | Native: `Poseidon(amount, payee, ts)` inside the proof. |
| **Audit-log tamper evidence** | Internal append-only DB. | Hash-chained DB + on-chain anchor on Base. |
| **DPDP §2(t) treatment** | Personal data, full DPDP obligations. | Commitments arguably not personal data. Cross-border friendly. |
| **RBI Master Direction on IT Governance §6.4** | "We have audit logs" → narrative compliance. | "We have hash-chained, on-chain-anchored, replayable audit logs" → evidentiary compliance. |
| **RBI Digital Lending Guidelines consent** | Bolt-on consent capture. | Cryptographically bound to the Pramaan proof. |
| **Vendor lock-in** | Customer's customer data lives on Auth0's tenant. Exit = export. | Customer's data is the bank's; ZeroAuth verifies, doesn't store credentials. Exit = take the verifier binary. |
| **Sovereignty narrative** | American SaaS, controlled by Salesforce / Microsoft / Cisco. | Indian-incorporated, India-data-resident, India-IP (patent IN202311041001 Pramaan). |

The sales narrative to the CISO is: **"We don't replace your IdP. We replace the credential database. The thing that breaches and creates class-action exposure. Your customers, your data, your sovereignty."**

The sales narrative to the CFO is: **"Per-auth marginal cost approaches zero. SMS gateway line item goes away. UIDAI eKYC fees fall by an order of magnitude. ATO fraud loss falls by a separate order of magnitude. Net 18-month payback on the seat fee."**

The sales narrative to the CRO is: **"Your audit log is now tamper-evident with on-chain anchors. Your insider-abuse incident class is structurally harder. Your DPDP §8 reportable-breach surface area shrinks to near zero. You go to the next RBI inspection with cryptographic evidence, not narrative."**

---

LAST_UPDATED: 2026-05-27
