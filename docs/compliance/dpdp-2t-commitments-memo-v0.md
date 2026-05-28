# Memo — DPDP §2(t) treatment of ZeroAuth Pramaan commitments and DIDs

## 1. Subject and reading audience

**Subject.** DPDP §2(t) treatment of ZeroAuth Pramaan commitments and DIDs.

**Reading audience.**

- External counsel retained under the engagement letter scoped in A37-W1-Thu.
- General Counsels of pilot-bank tenants (HDFC, ICICI, Axis, SBI YONO, IDFC First, RBL) preparing their own §2(t) defensibility opinions for internal sign-off.
- RBI inspectors and the RBI Sandbox Cell, who will read this memo as part of the inspection-readiness pack scoped in A37-W4-Tue.
- The Data Protection Board (DPB) of India, in the event of a §8 breach-notification filing where the data category of "commitment" is in scope.
- Internally: Agent #36 (CCO), Agent #37 (DPDP + RBI lead), Agent #41 (DPO), Agent #40 (Risk + Audit), and the engineering line via Agent #1.

**Posture.** This is **skeleton v0**. It is written by ZeroAuth engineering and compliance staff. It is not a legal opinion. It captures the framework, the position we want counsel to confirm, the conservative fallback, and the open questions we want counsel to address in v1 and to write a formal opinion on in v2. Banks should not rely on this memo for their own compliance posture; they should retain their own counsel.

---

## 2. Background

### 2.1 Pramaan protocol — what is stored, where

ZeroAuth's Pramaan protocol (patent IN202311041001) stores, per enrolled user, exactly two artefacts on the central tenant database:

- a **Decentralised Identifier (DID)** of the form `did:zeroauth:<40 hex chars>`, where the 40 hex characters are the leading 20 bytes of `keccak256(commitment)`. The DID is generated client-side and is, by construction, opaque relative to the underlying biometric.
- a **Poseidon commitment** to the user's biometric secret and a per-user salt: `commitment = Poseidon(2)([secret, salt])`. The commitment is a single field element in `Fr` of the BN128 elliptic curve (~32 bytes when serialised).

Neither the secret nor the salt is transmitted to the bank's tenant. Neither is logged. Both are derived on the customer's own device from on-device biometric capture (face descriptor + optional fingerprint descriptor) through a stable fuzzy extractor, and are bound to a StrongBox-backed (or TEE-backed, where StrongBox is unavailable) hardware key wrap on the customer's phone.

### 2.2 What the bank never receives

The bank's tenant API never accepts, never stores, never logs:

- raw biometric capture (camera frames, ML Kit face descriptors, R307 fingerprint templates, depth maps, pixel arrays);
- SHA-256 digests of any biometric capture;
- the user's biometric secret in any form;
- the device's hardware-backed key material.

The input-validation layer at the API boundary will reject (via zod, once landed per the standing CLAUDE.md commitment) any payload whose key set intersects `{image, template, pixel, depth, frame, raw_face, raw_finger}`. The forbidden-payload-key scan in the pre-commit hook enforces this at code-review time.

### 2.3 Cryptographic properties of the commitment

The Poseidon commitment is **hiding** and **binding** under the discrete-log assumption on the BN128 curve, with the following operational consequence:

- **Hiding.** Two different (secret, salt) pairs produce indistinguishable commitments to any computationally bounded observer. Inversion (recovering the secret from the commitment without the salt) requires brute-force search over the input space of the fuzzy extractor; current published cryptanalysis offers no shortcut.
- **Binding.** It is computationally infeasible to produce a second (secret', salt') pair that hashes to the same commitment; collision resistance is a folkloric property of Poseidon under standard assumptions.

Each authentication is a **Groth16 proof** verifying knowledge of the (secret, salt) pair that opens the commitment, with additional public inputs binding the proof to the session and (where applicable) to the transaction payload. The verifier is an Ethereum-compatible Solidity contract on Base Sepolia; off-chain verification uses snarkjs against the same verification key.

### 2.4 Cross-references

- Architecture decision: see `adr/0015-circuit-version-lock.md` for the locked circuit version and the trusted-setup ceremony manifest.
- Trusted-setup audit trail: `docs/cryptography/trusted-setup-ceremony.md`.
- Demo moment that exercises this memo: `docs/plan/bfsi-v1/02-bank-demo.md` Scene 4 — the breach simulation — invites the CISO and General Counsel to read DPDP §2(t) alongside a dump of the `users` table and to conclude that the rows do not enable identification of a natural person.
- Engineering pain-point this memo unblocks: `docs/plan/bfsi-v1/01-pain-points.md` P1 (Credential database breach exposure under DPDP §8) and P10 (DPDP data-localisation + cross-border BFSI operations).
- Threat model linkage: `docs/threat_model.md` A-22 (PII in pairing logs) and the wider §8 purpose-limitation discussion. A standalone A-NN entry for the §2(t) treatment of commitments will be added in the Phase-0 close-out PR; this memo is the citation source for that entry.

---

## 3. Statutory text — relevant DPDP provisions

The provisions reproduced below are the proximate statutory anchors for the question in §4. Counsel is asked to confirm the citations against the gazette-notified text in force as of the engagement-letter execution date.

### 3.1 §2(t) — "personal data"

> "personal data" means any data about an individual who is identifiable by or in relation to such data.

The DPDP Act adopts a single definition for personal data; the EU GDPR's separation into "personal data" and "pseudonymised data" is not replicated. The identifiability test is read alongside the recitals and the rules notification.

### 3.2 §2(u) — "personal information"

Counsel to confirm the text. Our working understanding: `2(u)` provides the umbrella concept linking personal data to the data principal, and is the cross-reference for §§4-13.

### 3.3 §2(o) — "identifiable"

Counsel to confirm whether the Act provides a standalone definition or relies on §2(t)'s use of "identifiable." Our reading is that the Act treats identifiability functionally: data is "identifiable" if a natural person can be singled out from a population using the data alone or in combination with other data the fiduciary can reasonably access.

### 3.4 §5 — notice to data principal

§5 requires the data fiduciary to give the data principal a notice covering: the personal data being processed, the purpose, the manner of consent withdrawal, the manner of exercise of rights, and the manner of complaint to the DPB. The notice form is standardised by rules. Counsel to confirm rules-notification status as of v1.

### 3.5 §8 — data breach reporting

§8(6) obliges the data fiduciary to notify the DPB and affected data principals of every personal-data breach. The notification window is set by the rules; our working assumption is 72 hours from awareness, mirroring the GDPR Art. 33 cadence. Counsel to confirm the rules and whether "awareness" is to be read as "confirmation."

### 3.6 §13 — cross-border transfer

§13 empowers the central government to restrict the transfer of personal data outside India by notification. Our working assumption: replication to a non-Indian region of artefacts that are not "personal data" is not a §13 transfer; replication of artefacts that are personal data is a §13 transfer that may require a transfer-impact assessment.

### 3.7 §17 — sensitive personal data

Biometric data is treated as a category of personal data with elevated obligations. Counsel to confirm whether §17 imposes obligations *on the underlying biometric* (i.e., the input to our fuzzy extractor on the customer's device, which the bank never sees) or *on derivatives of the biometric* (i.e., the commitment, which the bank stores).

### 3.8 §33 — penalties

§33(1) sets the penalty cap for personal-data breaches at ₹250 crore per incident. The DPB has discretion to determine the actual quantum on a factor-weighted basis. Counsel to confirm whether the "commitments are not personal data" position, if accepted, removes the conduct from §33 jurisdiction or merely reduces the quantum.

---

## 4. The legal question

> **Are the (DID, commitment) tuples stored in the ZeroAuth tenant database "personal data" within the meaning of DPDP §2(t)?**

A consequential question — to which the answer affects the bank's §5 notice obligations, §8 breach-reporting surface area, §13 cross-border restrictions, §17 sensitive-data treatment, and §33 penalty exposure — and a question on which we have a strong engineering view but no legal opinion of record.

We frame the answer in two arguments: Argument-A (our hypothesis, which we ask counsel to confirm) and Argument-B (the conservative fallback, which describes the obligations even if Argument-A fails).

---

## 5. Argument-A — the position we ask counsel to confirm

**Claim.** The (DID, commitment) tuples are **not** personal data within the meaning of DPDP §2(t).

The argument rests on four independent legs. Counsel is asked to evaluate each on its own and the conjunction as a whole.

### 5.1 Leg (i) — Commitments are field elements with no direct semantic content

The commitment is a single element in the prime-order group `Fr` of BN128. It is a number. It does not encode a name, an address, a phone number, an Aadhaar number, a PAN, a date of birth, a photograph, a biometric template, a behavioural trace, or any attribute that a human reading the database row could associate with the underlying data principal.

A DPB reviewer pulling a commitment out of the `users` table sees `0x2f7a…b919`. The reviewer cannot, from that 32-byte string alone, deduce anything about the data principal. This is structurally different from a "hashed email" — hashed email is vulnerable to dictionary attack because the input space is small and known; the input to the Poseidon commitment is a fuzzy-extractor output over a high-entropy biometric capture, salted, and computed inside a circuit whose pre-image is not enumerable.

### 5.2 Leg (ii) — The data principal is not "identifiable by or in relation to" the field element

§2(t)'s identifiability test is the load-bearing clause. We submit that identification of the data principal from a (DID, commitment) tuple requires the joint possession of:

- the commitment (which the bank stores);
- the salt (which the customer's device holds; never transmitted; never stored centrally);
- the secret (which is derived from on-device biometric capture; never transmitted; never stored centrally);
- the off-stack inversion of the Poseidon hash (which under current published cryptanalysis is computationally infeasible at the security parameter of BN128 — 128-bit security against generic attacks).

In the absence of any of these four ingredients, no observer can perform identification. The fiduciary (the bank) does not possess them. The data principal does. Therefore, the data principal is not identifiable "by or in relation to" the field element from the fiduciary's vantage.

### 5.3 Leg (iii) — The DID is an opaque, device-issued public identifier

The DID is the leading 20 bytes of `keccak256(commitment)`. It inherits the opacity of the commitment: the DID does not encode any attribute of the natural person; it does not enable a directory lookup against an Aadhaar number, mobile number, or other UIDAI-issued identifier; it is not derivable from a public registry.

A DID exposed in a database breach is not, on its own, a primitive that enables the attacker to impersonate the data principal: authentication requires the Groth16 proof, which requires possession of the secret and salt, neither of which the attacker has.

### 5.4 Leg (iv) — Legislative intent and the §2(t) telos

§2(t) is part of a statute whose preamble announces the purpose of protecting personal data. The mischief addressed is the identifiability of an individual from data held by a fiduciary. The legislative telos is to ensure that data fiduciaries do not, by their processing activities, expose natural persons to harm flowing from identification.

A field element that, by cryptographic construction, does not enable identification of any natural person is outside this mischief. To read §2(t) as covering Pramaan commitments would expand the Act to cover artefacts whose entire engineering purpose is the elimination of personal-data risk — a reading that runs against the constructional canon of effective interpretation (Heydon's Rule, as adopted by the Supreme Court in *State of Karnataka v. Appa Balu Ingale* (1995) and reaffirmed in *RBI v. Peerless General Finance* (1987)).

### 5.5 Anticipated DPB and counsel objections

We invite counsel to test Argument-A against the following anticipated objections.

- **Objection.** "Pseudonymous data is still personal data."
  - Response. The DPDP Act, unlike the GDPR, does not adopt the term "pseudonymous." The identifiability test in §2(t) is a single threshold. Pseudonymous treatment under GDPR Art. 4(5) is a category that survives because identification with additional information held by the controller is possible; in our case the additional information (the secret) is on the data principal's device, not the controller's.
- **Objection.** "But the bank holds the device-attestation chain; in principle linkage is possible."
  - Response. The device-attestation chain proves device integrity. It does not contain the biometric or the secret. The same response applies to the Play Integrity verdict.
- **Objection.** "Linkage to the bank's KYC artefact at enrollment makes this re-identifying."
  - Response. The KYC artefact (Aadhaar dip, video KYC) is held in the bank's KYC system, not in the ZeroAuth tenant database. The link between the KYC artefact and the (DID, commitment) tuple is the `enrollment_audit_id`, a UUID. The audit row carries a `did_sha256` rather than the raw `did` (see threat-model entry A-22). The two systems are isolated by tenant ID and environment. Counsel is asked whether, on the totality of these isolations, the linkage risk crosses the §2(t) threshold for the ZeroAuth tenant database considered in isolation.
- **Objection.** "Even commitments tied to an authentication event leak metadata about the data principal."
  - Response. The audit-log row carries timestamp + did_sha256 + event type. The fiduciary may treat this metadata as personal data for §2(t) purposes — a position we accept and discuss in Argument-B. The commitment in the `users` table is a separate artefact from the audit-log row.

---

## 6. Argument-B — the conservative fallback

**Claim.** Even if counsel concludes that the (DID, commitment) tuples are personal data, the data-fiduciary obligations under the Act are easily met and the §8 reportable-breach surface is materially reduced.

This argument is the fallback the bank's General Counsel will want — a position that holds even if the regulator rejects Argument-A.

### 6.1 §§6, 7 consent and lawful processing are easily satisfied

The only meaningful processing of the commitment is **identity verification** for the data principal's own benefit. The processing is the proximate cause of the data principal's ability to access the bank's services. Consent at enrollment is informed (privacy notice scoped per A41-W1-Wed), specific (the consent text names the Pramaan protocol and lists the processing activities), and revocable (revocation triggers DID voidance and biometric re-enrollment elsewhere if the customer migrates).

### 6.2 §8 breach-reporting surface is reduced

A breach exposing the (DID, commitment) tuples does not expose the underlying biometric. It does not enable impersonation. The attacker who exfiltrates the entire `users` table cannot authenticate as any data principal because the secret remains in StrongBox on the device.

The §8 notification, under the conservative reading, recites:

- the categories of data exposed (commitments + DIDs);
- the cryptographic properties of those categories (hiding, binding, non-invertible at 128-bit security);
- the operational consequence (no impersonation primitive; no PII leakage);
- the mitigations already in place (audit-log hash chain, on-chain anchor, key revocation path).

We submit that the DPB, presented with such a notification, will treat the incident as a low-harm breach for §33 quantum purposes — substantially below the cap of ₹250 crore.

### 6.3 §17 sensitive-personal-data obligations attach to the input, not the output

The biometric capture is sensitive personal data. The capture is on the customer's device, never transmitted. The fuzzy-extractor output is a derived secret that lives only on the device. The Poseidon commitment, derived from the secret, is a downstream artefact. Counsel is asked to confirm that §17's elevated obligations attach to the on-device capture (under the customer's own custody) and not to the central-database derivative — a distinction the Act does not yet draw explicitly.

### 6.4 Comparative posture vs. incumbent BFSI auth platforms

Even in the conservative reading, ZeroAuth's DPDP exposure is materially lower than that of:

- **Auth0 / Okta / Cognito tenants:** which store password hashes, MFA seeds, recovery codes, and (in some BFSI deployments) Aadhaar OTP transcripts and KYC artefacts. A full breach of those tenants is a personal-data breach with broad §8 surface area.
- **Bank-owned biometric template stores:** which hold the raw biometric template (BFSI ABCC-compliant fingerprint vault). A breach yields a primitive that can be replayed on biometric matchers; ZeroAuth's breach yields field elements that cannot be replayed against the Groth16 verifier.

This comparative posture is the commercial spine of the engineering pain-point catalogue: see P1 in `docs/plan/bfsi-v1/01-pain-points.md`.

---

## 7. Counsel-engagement questions (open)

The following are the six open questions we ask counsel to address in the v1 memo and to write a formal opinion on in v2.

### Q1 — Defensibility of Argument-A in front of the DPB

Is the position in §5 defensible if the DPB were to argue that commitments are personal data under §2(t)?

- Sub-question. What is the burden of proof on the fiduciary to establish non-identifiability — does the fiduciary discharge it by producing a cryptographic-properties brief, or is an expert opinion required?
- Sub-question. Is there value in pre-emptively engaging the DPB through a consultative letter ahead of pilot launch, to surface their reading of §2(t) before a §8 incident forces the question?

### Q2 — §5 minimum-viable notice if commitments are personal data

If counsel rejects Argument-A, what is the minimum-viable notice under §5 that the bank must give to enrolled customers? Specifically:

- (a) Must the notice describe the cryptographic operation (Poseidon commitment, BN128 group) or is "your biometric is processed via a zero-knowledge proof system" sufficient?
- (b) Must the notice quantify the breach blast radius, given the cryptographic properties?
- (c) Must the notice describe the on-chain anchor (Base Sepolia in pilot, Base mainnet in production), since this is data that crosses borders?
- (d) Is the notice required at enrollment only, or repeatedly at each authentication?

### Q3 — §13 cross-border transfer treatment

The pilot architecture replicates database content to a UK-resident or GCC-resident read replica for the bank's overseas operations (Phase 4 deliverable). The artefacts replicated are: `users` (commitments + DIDs), `device_registrations` (device-id hashes + Play Integrity verdicts + cert-chain hashes), `audit_events` (event types + did_sha256 + timestamps + hash-chain entries).

- (a) If commitments are not personal data per Argument-A, is the replication of `users` and `device_registrations` outside §13?
- (b) Is the replication of `audit_events` — which contains timestamps and did_sha256 — within §13?
- (c) Does a transfer-impact assessment under §13 require a documented threat-model entry for each cross-border data category, and if so, what is the template?
- (d) Does the central government's notification of "restricted regions" under §13 apply per region or per data category, and is the UK currently restricted?

### Q4 — §17 elevation via ABHA linkage in a future pilot

A planned bank pilot (BFSI Phase 2, deferred) involves linking the ZeroAuth DID to an Ayushman Bharat Digital Mission (ABHA) health-identity number for the bank's bancassurance health-insurance underwriting flow.

- (a) Does ABHA linkage elevate the (DID, commitment) tuple to sensitive personal data under §17?
- (b) If the ABHA number is stored on the bank side and only its keccak256 hash is exposed to ZeroAuth, does that change the §17 treatment?
- (c) What is the right consent regime for ABHA-linked authentication: the DPDP general consent, the NDHM-specific consent template, or a composite?

### Q5 — §8 breach-notification timeline — "awareness" or "confirmation"

The §8 notification window is to be set by rules (currently expected 72 hours per the draft notification). Within that:

- (a) Does the clock start at the SOC alert (initial detection signal), the incident-commander confirmation (triage gate), or the forensic root-cause confirmation?
- (b) Does ZeroAuth's role as a sub-processor for the bank tenant create a back-to-back notification chain, where ZeroAuth notifies the bank within X hours and the bank notifies the DPB within (72 - X) hours?
- (c) Is the notification template (form, fields, channel) gazette-notified, and does it accommodate the "commitments are not personal data" assertion as a category in the notification body?

### Q6 — Standard of care on the device-side SHA-256 of the biometric template

Prior to the Poseidon commitment computation, the customer's device computes a SHA-256 of the biometric template. This SHA-256 exists briefly in RAM on the customer's device — not on any ZeroAuth-controlled infrastructure. It is then consumed by the fuzzy-extractor stage and the input buffer is GC'd.

- (a) Is the SHA-256, while resident in RAM, "processed" by ZeroAuth as a data fiduciary, given that the code path is shipped in the ZeroAuth Banking app?
- (b) What is the standard of care expected: app obfuscation, anti-debug, certificate pinning, runtime-application-self-protection (RASP)?
- (c) Are there documented precedents (RBI inspection findings, DPB guidance, foreign comparative jurisprudence) on the in-RAM lifetime of sensitive data and the fiduciary's discharge of duty?
- (d) Counsel is asked to confirm whether ADR 0015's circuit-version lock — which freezes the fuzzy-extractor stage at a published, audited version — discharges this duty.

---

## 8. References and citations

### 8.1 Indian statutory and regulatory sources

- The Digital Personal Data Protection Act, 2023 (Act 22 of 2023). Gazette notification: 11 August 2023. To be read alongside rules notified by the central government from time to time. Counsel to attach the rules-notification version current at v1.
- The Indian Telegraph Act, 1885 and the Information Technology Act, 2000 §§43A, 72A (residual data-protection regime predating DPDP).
- *Justice K. S. Puttaswamy (Retd.) v. Union of India* (2017) 10 SCC 1 — privacy as a fundamental right; the contextual integrity test.
- RBI Master Direction on Information Technology Governance, Risk, Controls and Assurance Practices, 2023 (Master Direction RBI/2023-24/108) — §6.4 (audit logs and segregation of duties), §6.6 (cryptography), §6.13 (data leakage prevention).
- RBI Master Direction on Digital Payment Security Controls (Master Direction DPSS.CO.PD No. 1810/02.14.008/2020-21) — §5.3 (high-value transaction authentication), §6 (user awareness).
- RBI Master Direction on KYC, 2016 (as amended) — §18 (video KYC), §17 (periodic KYC refresh).
- RBI Digital Lending Guidelines, September 2022 (as amended August 2024) — consent capture and LSP / co-lending obligations.

### 8.2 Cryptographic sources

- Boneh and Shoup, *A Graduate Course in Applied Cryptography*, draft 0.6, Stanford 2023 — §3 (hiding and binding commitments), §13 (zero-knowledge proofs).
- Jens Groth, *On the Size of Pairing-Based Non-interactive Arguments*, EUROCRYPT 2016, LNCS 9666 — the Groth16 proof system used in ZeroAuth.
- Lorenzo Grassi, Dmitry Khovratovich, Christian Rechberger, Arnab Roy, Markus Schofnegger, *Poseidon: A New Hash Function for Zero-Knowledge Proof Systems*, USENIX Security 2021 — the Poseidon hash function used in the ZeroAuth commitment.
- Yevgeniy Dodis, Rafail Ostrovsky, Leonid Reyzin, Adam Smith, *Fuzzy Extractors: How to Generate Strong Keys from Biometrics and Other Noisy Data*, SIAM Journal on Computing 38(1), 2008 — the fuzzy-extractor primitive applied to face + fingerprint capture.

### 8.3 Internal ZeroAuth sources

- Patent IN202311041001 — Pramaan, granted; ZeroAuth holds exclusive commercial rights.
- `adr/0015-circuit-version-lock.md` — locked circuit version manifest.
- `docs/cryptography/trusted-setup-ceremony.md` — multi-party ceremony transcript and contributor list.
- `docs/threat_model.md` A-22, A-28, and the §2(t) entry to be added in the Phase-0 close-out PR.
- `docs/plan/bfsi-v1/01-pain-points.md` P1 and P10.
- `docs/plan/bfsi-v1/02-bank-demo.md` Scene 4 — the breach simulation that exercises this memo.

---

## 9. Process expected after this v0 lands

The memo proceeds through four versions. The audit trail at every step lives under `docs/compliance/dpdp/`.

### 9.1 v0 — this skeleton

- Author: Agents #35, #37, #41.
- Status: posted as a PR; reviewers sign off that the framework is reasonable; no legal content asserted.
- Use: input to counsel engagement; bank General Counsels asked to read for context only.

### 9.2 v0.5 — counsel pre-engagement comments

- Counsel reads v0, sends written comments on framework, scope, and missing questions.
- Engagement letter signed (target: A37-W3-Wed counsel call). Letter scopes a written legal opinion deliverable for v2.

### 9.3 v1 — counsel incorporates comments

- Counsel produces a revised memo addressing the six questions in §7 with citations to statutes, rules, and case law.
- Reviewed by Agent #36 (CCO), Agent #37 (DPDP lead), Agent #41 (DPO).
- Status: working draft; bank General Counsels may begin to read with the caveat that v2 is the formal artefact.
- Target landing: A37-W4-Mon (counsel v1 memo review).

### 9.4 v2 — counsel's formal opinion

- Counsel attaches a written legal opinion on firm letterhead.
- Signed and watermarked. Stored alongside the engagement letter.
- Published with appropriate redactions to `docs/compliance/dpdp/dpdp-2t-commitments-memo-v2.md`.
- Bank General Counsels treat v2 as the authoritative ZeroAuth-side artefact; they retain their own counsel for the bank-specific opinion.
- Target landing: BFSI Sprint 2 (mid-June onward).

### 9.5 Post-v2 maintenance

- The memo is reviewed annually or on a triggering event:
  - DPB rules notification that affects §2(t) interpretation;
  - any DPB enforcement action against a peer fiduciary that touches commitment-style artefacts;
  - any RBI inspection finding that questions the §2(t) treatment;
  - any change to the Pramaan protocol's commitment or DID construction (which triggers an ADR and a circuit-version bump per the standing CLAUDE.md commitment).

---

## 10. Limitations of this memo

This memo carries the following load-bearing caveats. Bank General Counsels and the DPB are asked to read them before relying on any conclusion herein.

- **Not a legal opinion.** Written by ZeroAuth engineering and compliance staff. The arguments in §5 and §6 are hypotheses formed against our reading of the statutory text. They are not the opinion of counsel and should not be treated as such until v2 lands with counsel's signature.
- **Not a substitute for the bank's own counsel.** Each pilot bank's General Counsel will form an independent view based on the bank's own pilot configuration, customer base, and regulatory posture. This memo is a starting point for that work, not an endpoint.
- **Snapshot in time.** The memo treats the Act as in force as of the latest gazette notification reviewed by counsel for v1. Rules notifications, DPB enforcement orders, and judicial pronouncements may modify §2(t)'s effective scope. Maintenance per §9.5 applies.
- **Engineering assumptions are version-bound.** Argument-A leans on the cryptographic properties of Poseidon, BN128, and Groth16 at the security parameter of the locked circuit version (`adr/0015-circuit-version-lock.md`). A circuit-version bump, a cryptanalytic advance against Poseidon, or a discovered weakness in BN128 invalidates Argument-A; this memo must be re-evaluated.
- **Scope: tenant database only.** The memo addresses the (DID, commitment) tuples in the ZeroAuth tenant `users` table. Audit-log artefacts, device-attestation chains, and KYC artefacts at the bank tenant's edge are addressed separately and may carry different §2(t) treatment.
- **Not adjudicated.** No DPB enforcement order or judicial pronouncement has yet addressed the §2(t) treatment of zero-knowledge proof commitments. The position in §5 is, to our knowledge, a question of first impression.

---

## 11. Open dependencies

The memo's progression to v2 is gated by external events tracked in `docs/compliance/dpdp/dependencies-tracker.md` (to be created). The current open dependencies are:

- **DPB rules notification.** Status: pending. Tracked in the Phase 0 week 1 compliance check by Agent #37. Rules may modify the effective scope of §2(t), §8 (breach-window), and §13 (cross-border restrictions). Memo cannot advance to v2 without sight of the gazette-notified rules current at the date of counsel's opinion.
- **External counsel engagement letter.** Status: scoped Phase 0 week 1 (A37-W1-Thu), targeted signature Phase 0 week 3. Owner: Agent #37. The letter must capture the v2 written-opinion deliverable, the indemnification ceiling, and the scope of follow-on advice on §§8, 13, 17.
- **Bank General Counsel review.** Status: each pilot bank's GC reviews v1 and v2 independently before pilot signing. Owner: Agent #43 (north) and Agent #44 (south) at the AE level; Agent #37 supports. Bank GCs may surface bank-specific objections that we incorporate as appendices.
- **A-NN threat-model entry.** Status: to be added in the Phase-0 close-out PR. The entry will cross-reference this memo and the Pramaan whitepaper. Owner: Agent #26 (security red-team) or Agent #37; assignment captured in the Phase-0 exit checklist.
- **DPB pre-engagement letter.** Status: optional, surfaced as a sub-question in Q1. If counsel recommends, Agent #36 owns drafting; target Phase 1 week 4.
- **ABHA linkage opinion.** Status: deferred to BFSI Phase 2. Cannot land until the Phase 2 pilot is scoped, but the question in Q4 should be answered in v2 to avoid a re-engagement cost later.

---

LAST_UPDATED: 2026-05-28

STATUS: SKELETON v0 — counsel review pending

OWNERS: Agent #37 (DPDP lead) + Agent #41 (DPO) + Agent #35 (writer)
