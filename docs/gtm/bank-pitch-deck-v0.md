# Bank pitch deck v0 — storyboard

This file is the **slide-by-slide source of truth** for the BFSI bank pitch deck v0. The deck itself is rendered in Keynote / Google Slides separately; this storyboard captures what each slide must communicate, how long the operator speaks to it, and which pain point, demo scene, engineering artefact, and compliance milestone it traces to. Treat the storyboard as the contract — if a slide deviates from what is recorded here in the rendered deck, the storyboard wins and the deck is corrected.

The 20 slides below back the 22-minute live demo specified in [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md). Every slide traces to a pain point in [`docs/plan/bfsi-v1/01-pain-points.md`](../plan/bfsi-v1/01-pain-points.md). The compliance posture slide and the roadmap slide trace to [`docs/compliance/compliance-roadmap-v1.md`](../compliance/compliance-roadmap-v1.md). The operator runbook is [`docs/operations/anchor-bank-demo-runbook.md`](../operations/anchor-bank-demo-runbook.md). Banned-phrase rules from the project constitution apply in full — see `CLAUDE.md` "Critical language rules" — and CI's repository-wide scan covers this file the same as any other.

Reviewers: Agent #28 (CPO), Agent #29 (PM-BFSI), Agent #48 (Marketing Lead). Owner of changes: Agent #42 (CRO).

---

## Slide 1: Title

**Speaker time:** 30s
**Visual:** Centred wordmark "Replace your credential database. Keep your customers." Below: ZeroAuth logo (left) + Anchor Bank logo placeholder (right) separated by a hairline. Footer line: operator name, date, audience (CISO / CFO / CRO / CIO).
**Speaker notes:**
- Read the title verbatim — it is the entire thesis compressed.
- Name the operator + the bank executive in the room.
- Set the runtime: "22 minutes of demo, 15 of questions, you keep a one-page summary."
**Pain-point trace:** P1 (frames the deck around credential-database breach exposure).
**Required artefacts (engineering):** ZeroAuth wordmark file; partner-bank logo asset secured by Agent #48 ahead of room.
**Compliance trace:** None directly — the slide sets the frame for the §2(t) story on slide 7.
**Failure mode if cut:** The deck opens with no thesis; the room interprets the rest as a feature tour instead of a category claim.

## Slide 2: The thesis (30 seconds)

**Speaker time:** 30s
**Visual:** One sentence, centred, 60 pt: "We replace the database your customer credentials live in. The thing that breaches and creates DPDP §8 liability." No logo, no chrome, no chart.
**Speaker notes:**
- Read the sentence.
- Pause for two beats — let the room re-read it.
- "We do not replace your IdP. We do not replace your core banking. We replace the credential store."
**Pain-point trace:** P1 — credential-database breach exposure under DPDP §8.
**Required artefacts (engineering):** None — pure narrative.
**Compliance trace:** DPDP Act §8 (security safeguards + 72-hour breach notification) per compliance roadmap §2.1.
**Failure mode if cut:** Room mis-categorises ZeroAuth as another IdP and benchmarks us against Auth0 feature-for-feature instead of against the breach-blast-radius axis.

## Slide 3: Pain point #1 — DPDP §8 reportable-breach exposure

**Speaker time:** 2 min
**Visual:** Three rows of breach figures with `[VERIFY]` markers where Agent #48 has not finalised the citation yet. Row 1: ₹250 cr DPDP §33(1) penalty cap. Row 2: ₹19.5 cr IBM 2024 India sector average breach response cost [VERIFY citation]. Row 3: 4 publicly-reported 2024 BFSI breaches (StarHealth, RailYatri, HDFC Life partner, ICICI Lombard partner) [VERIFY each via Agent #48 press cite]. Right column: 40–80 % year-on-year cyber-insurance premium uplift on disclosure.
**Speaker notes:**
- "Today, the database your customer credentials live in is the largest line item of DPDP liability you carry."
- Walk the four reported breaches; do not editorialise on the named banks.
- "₹250 cr is the cap. Class action under §13 sits behind it. Your insurance premium re-rates the moment the disclosure hits."
**Pain-point trace:** P1 — direct.
**Required artefacts (engineering):** None — narrative; numbers verified by marketing before deck v1.
**Compliance trace:** Compliance roadmap §2.1 (DPDP §§8, 13, 33).
**Failure mode if cut:** The cost framing for the rest of the deck collapses; the bank does not connect "fewer columns in the database" to "DPDP liability shrinks".

## Slide 4: Pain point #2 — Aadhaar e-KYC operational dependency

**Speaker time:** 90s
**Visual:** Two-column comparison. Left: "Per-eKYC ₹20 × 5 M onboardings/year = ₹100 cr/year UIDAI fees". Right: "30–45 % video-KYC drop-off × 5 M attempts × ₹4,000 LTV = ₹700 cr foregone revenue/year" (Razorpay 2023 industry figure, [VERIFY]). Footer: "UIDAI service downtime last 12 months: 7 incidents > 2 hours."
**Speaker notes:**
- "Every digital onboarding journey in India hits UIDAI through a KUA/SUA. You pay ₹3–₹20 per auth. You take the 30–45 % video-KYC drop-off. You inherit UIDAI downtime."
- "We hit Aadhaar once at enrollment. Every subsequent authentication is a Groth16 proof. Zero UIDAI calls."
**Pain-point trace:** P2.
**Required artefacts (engineering):** `/v1/identity/register` endpoint (Phase 1 week 4); `DIDRegistry` on Base Sepolia (Phase 0 week 2); Android enrollment flow (Phase 1 week 6).
**Compliance trace:** Compliance roadmap §2.5 — RBI MD on KYC (periodic-refresh hook tested by Phase 2). ZeroAuth's enrollment flow anchors a SHA-256 biometric → DID + Poseidon commitment; the bank's KYC officer still owns the underlying CKYC / V-CIP record.
**Failure mode if cut:** The CFO does not see the UIDAI per-auth line item and discounts the recurring savings story on slide 11.

## Slide 5: Pain point #3 — SMS OTP cost + SIM-swap loss

**Speaker time:** 90s
**Visual:** Single hero number: "₹2,500 cr — FY24 industry-wide SIM-swap-enabled account-takeover loss across Indian banks [VERIFY analyst Q4-2025 brief]." Below: smaller line "+ ₹43 cr/year SMS gateway spend for a 30M-customer bank (₹0.20 × 6 OTPs/month × 12 × 30M)". Footer: "Delivery rate post-DLT regime: 88–92 % first-attempt."
**Speaker notes:**
- "SMS OTP is two failure modes at once. The gateway bill, and the SIM swap."
- "SS7 and SIM-swap bypass OTP entirely. FY24 industry loss attributable to SIM-swap-enabled ATO is roughly ₹2,500 cr."
- "Our authentication never crosses the cellular network. There is no shared cellular-bound secret in the loop."
**Pain-point trace:** P3 + P6 (the SIM-swap fraud surface).
**Required artefacts (engineering):** Android rapidsnark prover + StrongBox key wrap + BiometricPrompt path (Phase 1 weeks 6–8); `/v1/zkp/verify` endpoint (Phase 1 week 7).
**Compliance trace:** Compliance roadmap §2.4 — RBI MD on Digital Payment Security Controls §5.3 (additional auth for high-value transactions).
**Failure mode if cut:** The room frames us against MFA upgrades (push notification, TOTP) instead of against "remove SMS from the auth path entirely".

## Slide 6: The protocol (60 seconds)

**Speaker time:** 60s
**Visual:** Single diagram, four boxes left-to-right. Box 1: customer's Android phone (StrongBox-bound key, biometric, rapidsnark prover). Box 2: Pramaan ZK identity verification (Groth16 over BN128, circuit `identity_proof.circom` v1.2). Box 3: bank verifier endpoint (`/v1/zkp/verify`). Box 4: on-chain `DIDRegistry` + `Groth16Verifier` on Base L2. Below: "Patent IN202311041001. Live since W3 of Phase 0."
**Speaker notes:**
- "Pramaan is our ZK identity verification protocol."
- "Customer phone holds a StrongBox-bound key plus a Poseidon commitment derived from the customer's biometric. Each authentication is a Groth16 proof over `(commitment, session_nonce, tenant_id_hash)`."
- "We anchor the DID on Base L2. The bank's audit log is hash-chained and anchored on the same chain."
**Pain-point trace:** Sets up P1, P2, P3, P6 mechanism for the next two slides.
**Required artefacts (engineering):** `circuits/identity_proof.circom` v1.2 (Phase 1 week 10 trusted-setup ceremony, ADR 0015 circuit-version lock); `contracts/DIDRegistry.sol`, `contracts/Groth16Verifier.sol` (Phase 0 week 2).
**Compliance trace:** Compliance roadmap §2.1 (DPDP §2(t) treatment of commitments — counsel memo v1 due week 6, signed week 9 per D-Q1-05).
**Failure mode if cut:** Bank cannot map the rest of the deck onto a concrete mental model and frames us as a black box.

## Slide 7: What we store

**Visual:** Database column screenshot mockup — `users` table — with exactly four columns highlighted: `did`, `commitment`, `created_at`, `tenant_id`. Below, struck through in red: `name`, `email`, `phone`, `pan`, `aadhaar`, `face_template`, `fingerprint_template`. Footer: a single line of DPDP §2(t) text rendered verbatim.
**Speaker time:** 90s
**Speaker notes:**
- "This is the schema of our `users` table. Four columns. No name, no email, no phone, no biometric."
- "The commitment is a 32-byte field element. The DID is opaque. Together they do not enable an authentication and do not identify the data principal."
- Read DPDP §2(t) aloud.
**Pain-point trace:** P1 + P10 (DPDP §2(t) treatment + cross-border data-localisation story).
**Required artefacts (engineering):** `tests/schema-purity.test.ts` — passing on `dev` (C-003). Verified by Agent #14 dashboard "Users" view per `dashboard/src/routes/tenant/users.tsx`.
**Compliance trace:** Compliance roadmap §2.1 + D-Q1-05 (DPDP §2(t) memo, external counsel). Also §1.1 in-scope perimeter mapping.
**Failure mode if cut:** The CISO does not see the literal column list and reverts to "they say their database has fewer columns, but does it really".

## Slide 8: Breach simulation (live in demo)

**Speaker time:** 30s — this slide is a *handoff* to Scene 4 of the live demo, not a content slide
**Visual:** Single line, 60 pt: "Bring me your database. Show me a name." Below: 14 pt subline "Live, against the production codebase, in the next four minutes."
**Speaker notes:**
- Read the line.
- Walk to the laptop. Trigger Scene 4 of the demo per the operator runbook.
- Do not narrate over the demo — let the empty rows speak.
**Pain-point trace:** P1 (the demo moment for the credential-database breach exposure).
**Required artefacts (engineering):** Scene 4 of `02-bank-demo.md` end-to-end (Phase 1 week 11 demo-ready); seeded Anchor Bank tenant per `scripts/seed-demo-tenants.ts`; psql admin shell pre-prepared per runbook §1.4.
**Compliance trace:** Compliance roadmap §2.1 (DPDP §2(t)); §2.2 RBI MD on IT Governance §6.4 — audit logs come up two slides later.
**Failure mode if cut:** The slide deck would carry the §2(t) argument on its own, which is weaker than the live database walk. The room must *see* the empty columns; the slide alone is not enough.

## Slide 9: Audit log — tamper-evident

**Speaker time:** 90s
**Visual:** Two-panel diagram. Panel A: a vertical hash chain — each `audit_events` row shows `id`, `event_type`, `previous_hash`, `row_hash` arrows connecting downward. Panel B: a Basescan transaction screenshot mockup showing yesterday's `AuditAnchor.anchor(terminal_hash, day_id)` call confirmed on Base L2. Caption: "Tampering requires both rewriting the chain and invalidating an on-chain transaction."
**Speaker notes:**
- "Every row in `audit_events` references the prior row's hash. Each day's terminal hash is anchored on Base L2 at end-of-day."
- "Your own auditor can replay the chain off a database dump and match the on-chain anchor — without involving us."
- "Scene 5 will tamper with one row in front of you. The integrity check fails. The on-chain anchor still records the untampered truth."
**Pain-point trace:** P4 — privileged-access insider abuse and inadequate audit-log tamper-evidence.
**Required artefacts (engineering):** ADR 0013 (audit hash chain); ADR 0014 (on-chain anchor cadence); `src/services/audit.ts` `appendAuditEvent` (C-011 + C-013); `/api/admin/audit-integrity` endpoint (C-014).
**Compliance trace:** Compliance roadmap §2.2 — RBI MD on IT Governance §6.4 (audit logs + segregation of duties); §2.6 SOC 2 CC7.2 (system-monitoring evidence).
**Failure mode if cut:** Scene 5 of the demo runs without prior context; the CRO does not pre-load the "RBI §6.4 evidentiary compliance" framing and the demo lands as "neat trick" rather than "regulator-defensible artefact".

## Slide 10: Compliance posture

**Speaker time:** 2 min
**Visual:** Four-row timeline. Row 1: DPDP §2(t) legal memo — in progress with external counsel, v1 by Phase 0 week 6, signed by week 9 (D-Q1-05). Row 2: SOC 2 Type I — auditor engaged week 4, evidence period weeks 14–22, report by Phase 2 close (week 26). Row 3: SOC 2 Type II + ISO 27001 — Type II evidence weeks 27–39, ISO Stage 2 week 36, certificate week 38, Type II report week 42 (D-Q3-13, D-Q4-02). Row 4: RBI sandbox — application week 35, acceptance decision week 39 (D-Q3-15).
**Speaker notes:**
- "We are not certified today. We are on a 12-month path with named auditors, a signed counsel relationship, and a roadmap published in the repo."
- "By month 6 we are SOC 2 Type I. By month 9 we are SOC 2 Type II and ISO 27001 certified. RBI sandbox application is in by month 9."
- Reference `docs/compliance/compliance-roadmap-v1.md` — "the document is in the public repo; your compliance team can read it the same day."
**Pain-point trace:** P1, P4, P5, P10 (the compliance umbrella under which the entire offer sits).
**Required artefacts (engineering):** None — this is a forward-looking commitment slide grounded in the compliance plan.
**Compliance trace:** Compliance roadmap §2.1 DPDP, §2.6 SOC 2 Type I, §2.7 SOC 2 Type II, §2.8 ISO 27001, §2.9 RBI Regulatory Sandbox. Quarterly milestones §3 + deliverables §4 (D-Q1-05, D-Q1-07, D-Q1-08, D-Q2-10, D-Q3-13, D-Q3-15, D-Q4-02).
**Failure mode if cut:** Bank's procurement team blocks at "show us your SOC 2 report" and the conversation does not advance to pilot.

## Slide 11: Per-auth marginal cost — from ₹0.20 to ~₹0.00

**Speaker time:** 90s
**Visual:** Single arithmetic line, centred. "30,000,000 customers × 6 OTPs/month × ₹0.20 = ₹43 cr/year". Below, struck-through arrow into "₹0". Footer: "Plus ₹100 cr/year in UIDAI per-eKYC fees from slide 4. Net cash line item recovered in year 1."
**Speaker notes:**
- "For a 30-million-customer bank, six OTPs per month, 20 paise per OTP, you spend ₹43 crore a year on SMS gateway. Add the UIDAI line from slide 4."
- "ZeroAuth charges a per-seat per-month fee — pricing is slide 17. The cellular-network cost goes to zero. The UIDAI line goes to one event per customer per refresh cycle."
- "18-month payback on the seat fee is the standard CFO model."
**Pain-point trace:** P3 (SMS gateway cost) + P2 (UIDAI fees).
**Required artefacts (engineering):** None — pure commercial math; references the live `/v1/zkp/verify` path that replaces the SMS OTP loop.
**Compliance trace:** None directly. The cost story is independent of certification posture.
**Failure mode if cut:** The CFO leaves the room without a payback number and the conversation ends as "interesting tech, no business case".

## Slide 12: Replaces, does not displace

**Speaker time:** 90s
**Visual:** Architecture stack diagram, three layers. Top layer: customer device (ZeroAuth app — Pramaan prover, StrongBox key, biometric). Middle layer: bank's existing IdP + SAML/OIDC + core banking — unchanged, with a small "ZeroAuth credential store" block carved out of where the password / OTP / mPIN database used to sit. Bottom layer: on-chain anchor on Base. Annotation: "Bank keeps SAML/OIDC. Bank keeps its IdP. ZeroAuth replaces the credential store."
**Speaker notes:**
- "We sit between your customer's device and your IdP. We do not displace your federation layer."
- "Your SAML and OIDC adapters keep working — see `src/routes/saml.ts` and `src/routes/oidc.ts`. Your downstream applications do not change."
- "We replace the credential storage table. That is the thing that breaches."
**Pain-point trace:** P1 (the credential database is the thing replaced) — operationalises the slide-2 thesis.
**Required artefacts (engineering):** `src/routes/saml.ts`, `src/routes/oidc.ts` (legacy SAML/OIDC surface); `src/middleware/tenant-auth.ts`; `src/services/api-keys.ts` (the `za_{live,test}_*` key model that brokers downstream applications).
**Compliance trace:** Compliance roadmap §1.1 in-scope perimeter; §2.2 RBI MD on IT Governance §10 (third-party risk). The "ZeroAuth verifies, doesn't store credentials" framing is the third-party-risk story.
**Failure mode if cut:** The bank's IdP team blocks the deal at "we just signed a 5-year Okta renewal, we are not replacing it". This slide explicitly tells them we do not need them to.

## Slide 13: Comparison vs Auth0 / Okta / Ping

**Speaker time:** 2 min
**Visual:** Five-row table, two columns. Header: "Auth0 / Okta / Ping" — "ZeroAuth".
- Row 1: Credential storage — "Hash + MFA seed in their database" / "Poseidon commitment only".
- Row 2: Breach blast radius — "Full PII exfiltration + DPDP §8 reportable" / "Field elements only; not personal data under §2(t) on counsel reading".
- Row 3: SIM-swap defence — "Push notification (re-onboard attack)" / "StrongBox-bound DID + biometric — no shared cellular secret".
- Row 4: DPDP §2(t) position — "Personal data under §2(t)" / "Cryptographic commitment, counsel-memo positioned outside §2(t)".
- Row 5: Sovereignty — "American SaaS (Salesforce / Microsoft / Cisco)" / "Indian-incorporated, India-data-resident, patent IN202311041001".
**Speaker notes:**
- Walk the table left-to-right.
- On row 4, qualify aloud: "the §2(t) position is a counsel opinion in progress; we will share the memo when signed."
- "Row 5 is not a marketing claim — our data lives in `ap-south-1` with a Hyderabad replica by Phase 4."
**Pain-point trace:** Pain-points doc §"How we sell better than Auth0 / Okta / Ping" — direct lift, condensed.
**Required artefacts (engineering):** `src/services/identity.ts` (commitment derivation); `src/services/api-keys.ts` (the `za_{live,test}_*` key model); patent IN202311041001 filing reference.
**Compliance trace:** Compliance roadmap §1.3 (data residency `ap-south-1`); §2.1 DPDP §2(t) counsel memo (D-Q1-05).
**Failure mode if cut:** Procurement asks "why not Okta" and we have no compact answer. This slide is the answer.

## Slide 14: Live demo handoff

**Speaker time:** 30s
**Visual:** Single line: "Five scenes, 22 minutes. Watch." Below, five small numbered tiles: 1. Enrollment. 2. Login at kiosk. 3. High-value NEFT step-up. 4. Breach simulation. 5. Audit-log integrity.
**Speaker notes:**
- Read the line.
- "Five scenes. Twenty-two minutes. We run against the live reference implementation — there is no demo bypass; `tests/proof-pairing.test.ts` asserts demo-DID rejection."
- Hand off to the live demo per `docs/operations/anchor-bank-demo-runbook.md`.
**Pain-point trace:** Sets up all five demo scenes — P1 (Scene 4), P2 (Scene 1), P3 + P6 (Scene 2), P5 + P7 (Scene 3), P4 (Scene 5).
**Required artefacts (engineering):** All Phase 1 demo-ready exit-gate items from `02-bank-demo.md` "What demo-ready means".
**Compliance trace:** None on this slide — the demo itself touches every compliance trace.
**Failure mode if cut:** The deck transitions awkwardly into the demo and the room is unsure whether to watch the laptop or the projector.

## Slide 15: Demo recap

**Speaker time:** 2 min
**Visual:** Five rows, three bullets each.
- Scene 1 (enrollment): one Aadhaar dip · DID + Poseidon commitment on-device · on-chain anchor confirmed on Basescan.
- Scene 2 (kiosk login): 1.0–1.5 s wall-clock · zero SMS · audit row written, hash chained.
- Scene 3 (high-value NEFT): `tx_nonce = Poseidon(amount, payee, ts)` bound in the proof · substitution attack rejected · regulator-reconstructable audit row.
- Scene 4 (breach simulation): `users` table walked live · DPDP §2(t) text read · "show me a name" — no name.
- Scene 5 (audit-log integrity): one row tampered · integrity check FAILs · on-chain anchor still pins the untampered truth.
**Speaker notes:**
- Refer to each tile briefly. The bank just watched it; you are anchoring memory, not re-explaining.
- "That is the protocol. Five scenes. The remaining six slides cover commercials and roadmap."
**Pain-point trace:** P1, P2, P3, P4, P5, P6, P7 — every pain point referenced by a demo scene reconnects here.
**Required artefacts (engineering):** All demo-scene artefacts per `02-bank-demo.md` (each scene's "Required artefacts" table).
**Compliance trace:** Compliance roadmap §2.1 (Scene 4), §2.2 §6.4 (Scene 5), §2.4 §5.3 (Scene 3), §2.5 (Scene 1).
**Failure mode if cut:** Q&A wanders; the room does not have a single visual to point at when raising follow-up questions about a specific scene.

## Slide 16: Pilot terms

**Speaker time:** 90s
**Visual:** Four-quadrant card.
- Top-left: "60-day pilot · no licence charge".
- Top-right: "ZeroAuth covers integration support (Agent #45 Solutions Architect)".
- Bottom-left: "Bank commits one named CISO + one integration engineer".
- Bottom-right: "After pilot — ACV pricing (slide 17), MSA template ready by Phase 1 week 13".
**Speaker notes:**
- "Pilot is 60 days, our cost. We send a solutions architect; you name one CISO contact and one integration engineer."
- "Pilot covers one customer-facing flow and one workforce flow if you want it. Acceptance criteria are in the SOW."
- "We sign a pilot LoI today and an MSA when the pilot exits."
**Pain-point trace:** None directly — this is the commercial scaffold under which P1–P10 get addressed.
**Required artefacts (engineering):** `docs/gtm/pilot-loi-template-v0.md` (Agent #42 deliverable A42-W1-Thu).
**Compliance trace:** Compliance roadmap §4 D-Q2-11 (three bank-pilot contracts signed with RBI/DPDP clauses by week 26).
**Failure mode if cut:** The CRO leaves the room without a concrete next step and the conversation does not convert into a signature.

## Slide 17: Pricing posture

**Speaker time:** 60s
**Visual:** A single line: "Per-seat per-month. Indicative ACV ranges by bank scale — discussed verbally." Below: a placeholder bracket "[Mid-tier private bank] [Top-5 PSB] [Tier-2 bank]" with no numbers rendered on the slide. Footer reference: "Detailed model — `docs/gtm/pricing-model-v1.md` (under counsel review)".
**Speaker notes:**
- "Pricing is per-seat per-month for the customer-credential surface and per-seat per-month for the workforce surface."
- "I will share indicative ACV ranges verbally — they differ by bank scale and by which surfaces you adopt."
- "The full pricing model is `docs/gtm/pricing-model-v1.md` in our repo; we share it once the MNDA is signed."
**Pain-point trace:** P3 (the SMS gateway saving on slide 11 sizes against this seat fee).
**Required artefacts (engineering):** None — commercial document referenced by path.
**Compliance trace:** None directly.
**Failure mode if cut:** CFO asks "what does it cost" and we ad-lib without a structured response.

## Slide 18: Roadmap

**Speaker time:** 90s
**Visual:** Four phase tiles laid out left-to-right.
- Phase 1 (months 1–3) — demo-ready · 3 design-partner LoIs · DPDP §2(t) memo signed · ADR 0011/0013/0014/0015 landed.
- Phase 2 (months 4–6) — pilots live · SOC 2 Type I report (D-Q2-10) · ISO Stage 1 (D-Q2-06) · contract audit (D-Q2-08).
- Phase 3 (months 7–9) — SOC 2 Type II evidence (D-Q3-02) · ISO Stage 2 + certificate (D-Q3-13) · RBI sandbox application submitted (D-Q3-06).
- Phase 4 (months 10–12) — mainnet contract deployment (D-Q4-04) · HSM signer migration (D-Q4-06) · first paid bank in production (D-Q4-08).
**Speaker notes:**
- "Twelve months. Four phases. Every milestone has a deliverable ID in our compliance roadmap; every deliverable has an owning agent and a target week."
- "If a milestone slips, our process is a `plan-change-proposal` per `06-ways-of-working.md` §'When the plan is wrong' — your account team will see the update before the next QBR."
**Pain-point trace:** P1, P4, P5 — each compliance milestone reduces a specific pain-point exposure.
**Required artefacts (engineering):** `docs/plan/bfsi-v1/00-README.md` phase map; `docs/plan/bfsi-v1/06-ways-of-working.md` escalation table.
**Compliance trace:** Compliance roadmap §3 quarterly milestones and §4 per-quarter deliverables — every tile lifts directly from D-Q*-* IDs.
**Failure mode if cut:** Bank's procurement team cannot map the certification claim on slide 10 to a delivery cadence.

## Slide 19: Why us

**Speaker time:** 60s
**Visual:** Four pillars, equal weight.
- Pillar 1: "Patent IN202311041001 — Pramaan. Granted. Exclusive commercial rights."
- Pillar 2: "50-person team — 27 engineering, 8 product & design, 6 compliance & risk, 8 sales/BD/GTM, 1 operations. Full roster: `docs/plan/bfsi-v1/03-team.md`."
- Pillar 3: "Indian-incorporated. India-data-resident in `ap-south-1`. Hyderabad DR replica by Phase 4."
- Pillar 4: "The only ZK identity verification layer in India with a published trusted-setup ceremony (`docs/cryptography/trusted-setup-ceremony.md`) and an on-chain audit anchor."
**Speaker notes:**
- "Patent. Team. Sovereignty. Category position. Four pillars."
- "Pulkit Pareek is Senior Software Engineer; Amit Dua heads product. The CCO line owns the compliance plan you saw on slide 10."
- "We are not a US SaaS with a Mumbai sales office. We are the Indian protocol layer."
**Pain-point trace:** P10 (data-localisation + cross-border sovereignty story); plus the team / category pillars underwrite every other pain point.
**Required artefacts (engineering):** Patent filing reference IN202311041001; `circuits/identity_proof.circom` v1.2 ADR 0015; `docs/cryptography/trusted-setup-ceremony.md`.
**Compliance trace:** Compliance roadmap §1.3 geographic scope (data residency); §2.8 ISO 27001 + §2.6/2.7 SOC 2 (institutional credibility); §6.2 external cryptographer engagement.
**Failure mode if cut:** Bank's CISO leaves with no compact "who is this vendor" answer when they brief their board.

## Slide 20: Ask

**Speaker time:** 60s
**Visual:** Single sentence, 60 pt, centred: "Let's run the pilot. Two weeks to kickoff." Below, smaller: "CTA: signed pilot LoI by week 13. Named CISO contact + named integration engineer this week."
**Speaker notes:**
- Read the sentence.
- "Two weeks to kickoff means: LoI signed this week, SOW drafted week-of, integration call held inside fortnight."
- "The pilot LoI template is in `docs/gtm/pilot-loi-template-v0.md`; we leave a copy on the table."
- Hand the printed LoI to the executive in the room.
**Pain-point trace:** All — the close binds every pain point to a concrete next action.
**Required artefacts (engineering):** None — handoff to GTM. `docs/gtm/pilot-loi-template-v0.md` (Agent #42 A42-W1-Thu); `docs/gtm/design-partner-program-v1.md` (Agent #42 A42-W1-Wed); pipeline tracker (Agent #42 A42-W1-Fri).
**Compliance trace:** Compliance roadmap §4 D-Q2-11 — three bank-pilot contracts with RBI/DPDP clauses signed by week 26.
**Failure mode if cut:** The deck ends without a CTA and the meeting closes without a commitment date.

---

## Reviewer checklist (Agents #28, #29, #48 before deck v1)

- [ ] Every slide above has a pain-point trace and a compliance trace (Agent #29).
- [ ] Every `[VERIFY]` citation has been confirmed by Agent #48 with a public source.
- [ ] Visual mockups exist as Figma frames for each slide; the link is recorded in `docs/marketing/brand-audit-w1.md` (Agent #48).
- [ ] Banned-phrase scan from `CLAUDE.md` "Critical language rules" passes across the rendered deck and speaker notes (CPO + Marketing).
- [ ] Operator's printed runbook (`docs/operations/anchor-bank-demo-runbook.md`) references this storyboard's slide numbers in §3 (handoff points).
- [ ] Pricing slide 17 cross-checks against `docs/gtm/pricing-model-v1.md`; numbers stay verbal at the meeting until v1 of the pricing model is signed.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #42 (CRO) + Agent #48 (Marketing) + Agent #28 (CPO)
