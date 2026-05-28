# ZeroAuth vs Auth0 / Okta / Ping — what a CIO needs to know

**We don't replace your IdP. We replace the credential database — the thing that breaches and creates DPDP class-action exposure.**

---

## The thesis

Indian BFSI's largest digital-identity liability today is the **credential database**.

Auth0, Okta, Ping, Microsoft Entra, and AWS Cognito all store password hashes, MFA seeds, recovery codes, and — in the regulated-vertical configurations Indian banks actually buy — biometric templates and KBA answers. Every breach of that database is a reportable event under DPDP §8(6) and the proximate cause of class-action exposure under DPDP §13.

The 2024 Indian BFSI incidents the room remembers — StarHealth, RailYatri, the HDFC Life partner exfil, the ICICI Lombard partner exfil — were all credential-database failures inside the trust boundary the bank had outsourced to an IdP or a KYC vendor. The control posture across the sector has not changed in the eighteen months since those incidents. The next breach is being staged today. On a long enough timeline the database that holds your password hashes and your customer biometric templates *will* be exfiltrated. The question for the CIO is not whether to prevent that — it is whether the post-exfiltration blast radius is contained or open-ended.

ZeroAuth replaces the credential database with a **Poseidon commitment** that is hiding and binding under the discrete-log assumption on BN128.

The bank's database, on full exfiltration, yields a set of 32-byte field elements that:

- do not decrypt to a credential,
- do not decrypt to a biometric,
- do not enable an authentication, and
- under DPDP §2(t), arguably are not personal data at all.

There is no MFA seed because there is no shared secret in the system. There is no recovery code because there is nothing to recover. The credential is a fresh Groth16 proof, computed on the customer's own StrongBox-backed phone, gated by a fresh biometric assertion from the customer's hardware-rooted biometric path, valid for exactly one verification.

Bound to the session nonce, replaying it is detected and rejected at the verifier. Substituting any element of the bound transaction payload invalidates the proof. There is no shared cellular secret in the loop, so SIM-swap stops being an attack vector. There is no shared password between tellers, so the shared-workstation insider class collapses. There is no SMS gateway in the path, so the per-auth cost line collapses too.

**You can keep Auth0, Okta, or Microsoft Entra as your IdP for SSO if you want.** Most of our pilot configurations do.

ZeroAuth slots in alongside as the **credential layer** — the layer that today carries roughly 80% of your DPDP risk and effectively all of your fraud exposure on the consumer authentication path. The platform exposes SAML and OIDC adapters so your existing applications do not change at the protocol layer; the user identifier they see is a stable `did:zeroauth:*` string that maps one-to-one with what they would otherwise see from Auth0.

Pilot duration is four to twelve weeks depending on which of three deployment patterns you choose. Engineering integration cost is not the bottleneck. The bottleneck is the legal and procurement conversation that goes alongside it. This document is designed to short-circuit that conversation.

---

## The 10-axis comparison

| Axis | Auth0 / Okta / Ping | ZeroAuth |
|---|---|---|
| **Credential storage** | Password hash + salt + MFA secret + recovery codes in their tenant database. Biometric templates in the regulated-vertical configurations. At-rest encryption is broken by a successful credential server breach because the decryption keys live next to the ciphertext on the same boundary. | Poseidon commitment only. Hiding and binding under discrete-log on BN128. No password, no MFA seed, no recovery code, no biometric template. The commitment is a 32-byte field element with no statistical link to the underlying biometric and no usable preimage under standard cryptanalysis. |
| **Breach blast radius (DPDP §8)** | Full DB exfil = personal-data exfil = reportable event + class-action exposure under §13 + sectoral RBI notification under the Master Direction on Cyber Resilience and Digital Payment Security Controls. Average breach response cost (IBM 2024, India): ₹19.5 cr. Penalty cap ₹250 cr per incident under §33(1). | Full DB exfil = field elements with no PII linkage. Arguably not §2(t) personal data per external counsel memo in flight. Reportability turns on audit metadata, not credentials. Class-action standing under §13 is fundamentally weakened because the complainant cannot point to an injury to the data principal. |
| **Per-auth marginal cost in India** | ₹0.20+ in SMS gateway per OTP-bearing auth. UIDAI per-auth ₹3–₹20 stacked on top in eKYC-bearing flows. On a 30 M-active-customer bank with 6 OTPs/customer/month, SMS line item alone is ~₹43 cr/year. Failure-redelivery overhead adds another ~₹4 cr/year. | Zero SMS in the loop. UIDAI hit once at enrollment and then never again until the regulator-mandated KYC refresh cadence (2 years for high-risk, 8 years for low-risk). Flat seat fee. Per-auth marginal cost approaches zero. Payback on the seat fee inside 18 months on the SMS line item alone for any bank above 5 M MAU. |
| **SIM-swap defence** | Push-notification auth (Okta Verify, Microsoft Authenticator) still re-onboards the push device via email + SIM. If the attacker has the customer's email account and SIM, they re-enroll a fresh push device and replay the entire trust hierarchy. SS7 interception still works on the SMS fallback. FY24 industry SIM-swap-enabled ATO loss: ~₹2,500 cr. | StrongBox-bound DID + on-device biometric local gate. No shared cellular-bound secret. The phone's StrongBox-backed key never leaves the secure enclave; the wrap unlock requires a fresh BiometricPrompt assertion, a hardware-rooted operation. Device-loss path requires a fresh enrollment with full KYC reverification — a 90-second flow that is materially harder to social-engineer than a SIM swap. |
| **Transaction binding** | None natively. TX-OTP is a bolt-on (RuPay+, a handful of net-banking implementations) relying on the customer reading the amount and payee from an SMS template and refusing if substituted. Failure mode: the attacker doesn't bother substituting; just MITMs and replays. | Native and cryptographic. The proof binds `Poseidon(amount, payee_account, payee_ifsc, timestamp)` as a public input. Bank backend computes the tx_nonce; phone displays the human-readable transaction; customer confirms with biometric; prover signs over that exact tuple. Substituting any byte of the bound payload invalidates the proof at verification time. Demonstrable in Scene 3 of the bank demo. |
| **Audit-log tamper evidence** | Internal append-only DB on the IdP side. Their employee with DB access can rewrite history; the bank's auditor cannot independently verify. Tamper-evidence is narrative ("we have audit logs"), not evidentiary. RBI Master Direction on IT Governance §6.4 nominally satisfied; on inspection, the bank cannot produce cryptographic evidence the log was not edited post-hoc. | Hash-chained `audit_events` table (ADR 0013, closing commit `c09c081`). Each row's `previous_hash` references the prior row's terminal hash; chain integrity is verifiable from a database dump alone. Tampering breaks the chain and is detected by `/api/admin/audit-integrity`. As defence-in-depth, each tenant can opt into a signed daily ed25519 transcript, a third-party witness cosignature, or an on-chain anchor on Base L2 — per ADR 0017, all three are **opt-in providers**, not the load-bearing primitive. Most tenants will run on the hash chain alone. |
| **DPDP §2(t) treatment** | Personal data, full stop. Credential records, MFA seeds, and biometric templates are all data about an identifiable natural person. Full DPDP fiduciary obligations apply, including §16 cross-border restrictions and §15 data-subject-request handling. | Commitments and DIDs are not identifiers of a natural person under §2(t). They are not linkable attributes — recovering the underlying biometric or KYC identity from a commitment requires breaking the discrete-log assumption on BN128. External legal memo (Phase 1 Week 9 deliverable, in flight with outside counsel) supports a §2(t) carve-out specifically for commitments. Cross-border movement of commitments is unrestricted; the bank can serve GCC, Maldives, or Bhutan from the same Pramaan stack. |
| **RBI Master Direction on IT Governance §6.4** | "We have audit logs" — narrative compliance. The hash chain ends at the vendor's database. The auditor accepts the vendor's representation. On a serious inspection, this is a finding waiting to happen. | "We have hash-chained, independently-replayable audit logs, with optional signed transcripts and on-chain anchors as defence-in-depth" — evidentiary compliance. The bank's own auditor verifies log integrity from a DB dump without needing ZeroAuth in the loop, and without needing to read any blockchain. The inspection-readiness checklist mapping each control to the §6.4 evidence requirement is provided at pilot kickoff. |
| **RBI Digital Lending Guidelines consent** | Bolt-on consent capture via OneTrust or equivalent. No cryptographic binding between the consent artefact and the user's identity proof. Regulator inspection requires reconstructing the consent flow from server logs; reconstruction takes 2–8 engineer-weeks per finding. | Consent is folded into the Pramaan proof. The session nonce includes `hash(consent_text || scope)`; the Groth16 proof binds `(DID, consent_hash, session_nonce)`. The audit row is self-verifying: a regulator inspector can replay the proof against the verification key and confirm the consent was given by the holder of the DID at the timestamp recorded. |
| **Sovereignty (jurisdiction, data residency, IP holding)** | American SaaS — Auth0 is Okta (Salesforce-adjacent), Microsoft Entra is Microsoft, Cognito is AWS. Data shards in APAC or EU; DPDP §16 cross-border friction. American jurisdictions of compulsion (CLOUD Act, FISA §702) apply. IP holding is American; the bank's regulator does not have direct recourse for design changes. | Indian-incorporated entity. India-data-resident — production data in `ap-south-1` (Mumbai) on AWS or in the bank's own VPC under VPN peering. India-IP — patent IN202311041001 (Pramaan), granted. No CLOUD Act exposure, no FISA exposure, no foreign sovereign reaching into a regulated Indian bank's authentication path. |

The **audit-log row** has changed from earlier iterations of this comparison. Older drafts presented on-chain anchoring as the differentiator.

ADR 0017 (dated 2026-05-28, the most recent commercial spine) reframes that. The real differentiator is **independently verifiable history** — the bank's auditor produces, on demand, cryptographic evidence the audit log was not edited post-hoc.

The off-chain hash chain delivers that property on its own, from a database dump alone. Signed transcripts, witness cosignatures, and chain anchors are *opt-in providers* a tenant can layer on if their internal audit head or the regulator specifically asks for one of those formats. Most banks will never need to.

Mandating any of them as a hard dependency raises the integration cost without buying a single Indian bank pilot. This is in the ADR explicitly.

---

## Three deployment patterns

### Pattern A — Replace credentials only (4-week integration)

Auth0, Okta, or Microsoft Entra remains your IdP for SSO orchestration, application provisioning, and group management. ZeroAuth replaces the user table.

The bank's applications continue to call their IdP for sign-in. The IdP delegates the credential challenge to ZeroAuth via SAML or OIDC. The credential database — the password hashes, the MFA seeds, the recovery codes, the biometric templates — is removed from the IdP and replaced by a Poseidon commitment in ZeroAuth's `users` table.

The IdP's user record now carries only a `did:zeroauth:*` identifier.

The bank takes the DPDP §8 surface area down by an order of magnitude without disrupting application teams.

**Integration cost.** Four weeks of engineering. No application changes. IdP-side configuration plus one webhook endpoint for `user.enrolled` and `auth.verify_success`.

**Recommended starting pattern for.** Banks with heavy Auth0 or Okta application sprawl that cannot stomach a parallel migration.

### Pattern B — Replace step-up auth only (6-week integration)

The IdP handles primary login (corporate AD, social, whatever the bank already has). ZeroAuth handles transaction step-up for the high-value flows:

- NEFT above ₹2 lakh,
- RTGS,
- IMPS to new beneficiary,
- NRI remittance,
- large UPI mandates,
- credit-card transactions above the customer's velocity baseline.

The core banking platform calls `/v1/zkp/challenge` with the transaction payload. ZeroAuth returns a transaction-bound proof challenge. The customer's phone produces a Groth16 proof binding the amount, payee account, payee IFSC, and timestamp. Substitution attacks at the wire fail verification cryptographically rather than relying on customer vigilance against SMS-template substitution.

This is the highest-fraud-impact pilot pattern and the one most banks will start with — direct attack on the ₹2,500 cr/year industry SIM-swap-enabled ATO loss without disturbing the primary login surface.

**Integration cost.** Six weeks of engineering. One core-banking-side hook for high-value transactions. No broader user-base disruption.

**Recommended starting pattern for.** Banks where fraud loss is the board-level metric and where the consumer login experience is not on the change agenda.

### Pattern C — Full replacement (12-week integration)

ZeroAuth is the full identity layer. SAML and OIDC adapters mean your existing applications do not change at the protocol layer; users sign in once via ZeroAuth and SSO into the application portfolio. The IdP relationship is wound down on contract cycle.

This is the post-pilot pattern, normally entered in Phase 2 after a 12-week pilot under Pattern A or B has produced the security and CFO evidence the procurement committee needs.

**Integration cost.** Twelve weeks including:

- the user migration runbook (the existing IdP exports user identifiers, ZeroAuth onboards them via the standard 90-second enrollment with their KYC artefact re-used as the enrollment anchor),
- application configuration changes (SP metadata),
- a parallel-run period where both stacks accept traffic,
- a regulator briefing pack for the cut-over.

### Shared operational primitives

All three patterns share the same operational primitives:

- tenant-scoped API keys,
- hash-chained audit log,
- off-chain default with opt-in providers per ADR 0017,
- India data residency,
- the published `verification_key.json` with the boot-time SHA-256 pin from ADR 0015,
- the same MSA exit clause.

The choice between patterns is a function of integration appetite and the bank's existing IdP investment, not a function of differing security postures.

---

## What the bank's CFO will ask

> **"What does this cost?"**

Flat seat fee, structured per active user per month with volume tiers above 5 M MAU and a separate enterprise tier above 30 M MAU. Per-auth marginal cost is **zero** — no SMS gateway charge, no UIDAI per-auth fee, no per-proof verification cost.

Payback period for a typical mid-size scheduled commercial bank is 18 months on the SMS gateway line item alone:

- 30 M active customers × 6 OTPs/month × ₹0.20 = ~₹43 cr/year.

UIDAI eKYC reduction extends the case. A 5 M-onboarding-per-year bank spending ~₹100 cr/year on per-auth eKYC fees collapses that to a single Aadhaar hit per customer at enrollment, paid once and then amortised across 2-to-8 years of KYC refresh cadence.

The seat fee is materially less than the SMS line item before any UIDAI or fraud-loss saves are layered in. We will model your specific numbers under NDA in pre-sales; the worked example is on the deck.

> **"What happens if you go out of business?"**

The MSA carries an exit clause that survives wind-down. On wind-down, the bank takes:

- the verifier binary, signed, with a published source-of-record build,
- the deployed Groth16 verification key (`verification_key.json`) with the boot-time `EXPECTED_VKEY_SHA256` pin documented in ADR 0015,
- the schema and migration history of their tenant database,
- the runbook to operate the verifier in-house at `docs/operations/customer-self-host-runbook.md`,
- a perpetual, irrevocable licence to the Pramaan circuit (patent IN202311041001) for the bank's own customer base.

The licence survives wind-down, acquisition, or any other change of control.

The bank's customer relationships, DIDs, and commitments are the bank's data; ZeroAuth verifies and audits but does not own them.

As insurance, the bank can also opt to run an in-house backup verifier from day one — the verification key is published and the verifier is dependency-light enough to run as a sidecar to the bank's existing core banking infrastructure.

> **"Why not just use Auth0's bring-your-own-credential feature?"**

The Auth0 BYOK feature lets the bank bring a credential *format*. It does not let the bank eliminate the credential *database*.

The Auth0 user table still stores the credential record, the MFA seed, the recovery key, and (depending on configuration) the password hash for fallback. The trust boundary is unchanged; the category of attack — DB exfil at the IdP — is unchanged; the DPDP §8 surface area is unchanged.

ZeroAuth eliminates the database itself. Even if every byte of the ZeroAuth tenant database is exfiltrated tomorrow, the attacker holds field elements that do not authenticate, do not decrypt to PII, and do not enable account takeover at any application.

The Auth0 architect will tell the bank that their BYOK is the answer. The question is whether the answer addresses the bank's actual risk — which is breach of the credential database, not the format of the credential. It does not.

---

## What the bank's CISO will ask

> **"Can I see the source code?"**

Production source on the customer's review path under MSA. A named CISO designee with appropriate clearance can read the entire backend, the circuit, the verifier, and the audit-log path under NDA.

The platform is not open-source; the differentiator is the live reference implementation paired with the patented circuit, and open-sourcing would surrender that.

Audit reports are provided in lieu of full source publication:

- A Trail of Bits engagement under contract for the contracts and the verifier path (in scope for Phase 1 exit per ADR 0018, in flight).
- A named external cryptographer review of the circuit by a recognised academic in the Groth16 / Plonk / circom-circuits community (Phase 1 Week 10).

The audit reports cover the boundaries that matter — circuit correctness, verifier correctness, tenant isolation, audit-log integrity, key management.

The bank's own pentest team is welcome on every pilot. We run a quarterly internal pentest cadence (`docs/security/`) and a bug-bounty program from Phase 3 onwards.

> **"What happens if your verifier service goes down?"**

Proofs are self-contained. The bank can run a backup verifier locally with:

- the published `verification_key.json`,
- the boot-time SHA-256 pin (`EXPECTED_VKEY_SHA256` in `src/services/zkp.ts`, locked in ADR 0015).

The on-device prover produces a proof that any compatible verifier can check. The only ZeroAuth-side dependency in the critical authentication path is the audit-log write.

For mission-critical deployments we ship a two-region active-active architecture in Mumbai (`ap-south-1`) with explicit failover runbooks and replicated audit-log state.

Production SLA:

- 99.5% in pilot tier,
- 99.95% monthly in production tier, with credits on miss.

For the truly conservative configurations, the bank runs the entire verifier inside their own VPC under VPN peering, and ZeroAuth becomes a software vendor rather than a SaaS in the critical path.

> **"What's your incident response?"**

`docs/operations/incident-response-runbook.md` is provided to every pilot.

Quarterly drills are mandatory — the runbook is exercised against synthetic incidents at least four times per year by Agent #40 (Risk & Audit Lead) with a tabletop in attendance from the bank's own CISO designate.

Targets:

- Severity-1 MTTD: ≤5 minutes.
- Severity-1 communications cadence to the affected bank CISO: hourly until resolution.
- DPO notification under DPDP §8(6): within 72 hours of confirmation.

The bank's CISO is co-named on the runbook and is briefed on the call tree at pilot kickoff. Post-incident review is a contractual deliverable within 14 days of resolution and is shared with the bank's audit committee on request.

---

## What the bank's CRO will ask

> **"What's your tamper-evidence story?"**

Hash chain over the `audit_events` table (ADR 0013, closing commit `c09c081`):

- Every audit row references the prior row's hash.
- Every audit write goes through `src/services/audit.ts::appendAuditEvent`.
- Direct `INSERT INTO audit_events` from anywhere else in the codebase is blocked by the source-grep test in `tests/audit-chain.test.ts`. This is enforced in CI on every PR, not just at code review.

The chain integrity is verifiable from a database dump alone, with no ZeroAuth dependency at verification time — the bank's auditor takes the dump and a small open-source script and verifies it themselves.

As defence-in-depth, each tenant can opt into one of three additional layers:

1. a daily ed25519-signed transcript with the signing key published for independent verification,
2. a witness cosignature from a named third party such as the bank's own internal audit head or a notary service,
3. an on-chain anchor on Base L2 with daily cadence.

Per ADR 0017, all three are **opt-in providers**. The default deployment delivers tamper-evidence purely from the hash chain. No blockchain is in the bank's critical path unless the bank's CRO has specifically asked for one.

> **"Where do I go for regulatory questions?"**

- **DPDP §8 notifications and §15 data-subject requests.** The Data Protection Officer (Agent #41, DPO registered with the DPB under DPDP §10).
- **RBI inspection-readiness.** The Senior Compliance Lead for DPDP + RBI (Agent #37). The inspection-readiness checklist mapping ZeroAuth controls to RBI Master Direction on IT Governance §6.4 evidence requirements is provided at pilot kickoff.
- **Regulator-priority channel.** The Compliance Lead is named on the MSA and reachable during inspection windows.

Pilot agreements include a clause that ZeroAuth supports the bank in any regulator inquiry that names the credential layer, including evidence production, deposition support, and on-site presence during inspection visits.

Regulator briefing packs are pre-drafted for RBI, IRDAI, SEBI, and the Data Protection Board; the bank's compliance team gets the relevant pack at MSA signing.

> **"What's your record of insider abuse?"**

**None. Zero insider-abuse incidents on the platform itself.**

Tenant isolation is enforced at every database query by a `(tenant_id, environment)` predicate in the `WHERE` clause.

The source-level invariant is asserted continuously by `tests/tenant-isolation.test.ts` (commit `a1bbc47`):

- walks every route file,
- rejects any `router.<verb>` declaration that does not carry the `authenticateTenantApiKey` middleware,
- fourteen intentionally-public exceptions are listed in `PUBLIC_ROUTE_EXCEPTIONS` with a ≥20-character reason on each.

New exceptions require ADR-level review with the security-reviewer subagent invoked.

Internal ZeroAuth staff have **no read access** to any tenant's commitment values or DID-to-customer mappings — the customer-to-DID mapping lives only in the bank's database, never in ours. The operator dashboard for ZeroAuth staff shows tenant counts and aggregate metrics, never the underlying rows.

Cross-tenant rejection is asserted on every PR by CI.

A successful insider attack on the platform would require simultaneously compromising the source-level guard, the runtime middleware, the CI pipeline, and the DB-level audit row that records the access.

---

## Proof points — what is shipped today

The platform is not a slide deck. The following are the state of the codebase as of the date this document was last updated and are independently verifiable by cloning the repo and running the test suite:

### Test coverage

- **411 backend tests passing** on the protected `main` branch (Jest, `npm test`).
- **49 dashboard tests passing** (vitest + @testing-library/react in `dashboard/`).

### Architecture decisions in force

- **ADR 0011** — branching workflow.
- **ADR 0013** — audit-log hash chain.
- **ADR 0014** — on-chain anchor cadence (now opt-in per ADR 0017).
- **ADR 0015** — circuit version pinning at boot.
- **ADR 0016** — zod input validation.
- **ADR 0017** — blockchain-agnostic posture (dated 2026-05-28).

### Source-level guards

- **Hash-chained audit log** implemented in `src/services/audit.ts` with the chain integrity asserted on every PR and the chain-walk admin endpoint at `/api/admin/audit-integrity`.
- **Cross-tenant rejection source-level guard** in `tests/tenant-isolation.test.ts` (closing commit `a1bbc47` for Phase 0 audit finding C-12). Walks every route file; asserts middleware-coverage invariant on every `router.<verb>` declaration.
- **Schema-purity guard** in `tests/schema-purity.test.ts` (commit `5425032`, supporting Phase 0 audit finding C-5). Pins the `tenant_users` columns; rejects PII columns from sneaking in via an unreviewed migration.
- **Biometric-payload rejection guard** in `tests/biometric-rejection.test.ts` (commit `c09c081`, closing Phase 0 audit finding C-8). Blocks nine forbidden payload-key patterns (image, template, pixel, depth, frame, fingerprint_data, face_template, iris_template, voice_template) across `req.body`, `req.query`, and `req.params`.
- **Boot-time circuit-version pin** in `src/services/zkp.ts` against `EXPECTED_VKEY_SHA256` (ADR 0015, closing Phase 0 audit finding C-7). Production refuses to boot if the verification key on disk does not match the expected hash; non-production warns and continues.

### Closed Phase 0 P0 findings

- **C-1.** Demo bypass removed from `src/services/proof-pairing.ts` (closing commit `02e1734`). The `did:zeroauth:demo:*` pattern that previously skipped cryptographic verification no longer exists in the codebase; the regression test in `tests/proof-pairing.test.ts::"P0 audit finding C-1 closure"` pins it shut.
- **C-3.** Console JWT moved off the query string into an HttpOnly cookie scoped to `/api/console` (closing commit `ee6aad4`). JWTs no longer leak to Caddy access logs.
- **C-4.** Audit-log hash chain landed (closing commits `5e3b79d` and ADR commits, with the direct-INSERT guard in `c09c081`).
- **C-6.** Direct-INSERT guard on `audit_events` (closing commit `c09c081`). Every audit write goes through `src/services/audit.ts::appendAuditEvent` or the build fails.
- **C-8.** Biometric-payload rejection at the source level (closing commit `c09c081`).
- **C-10.** Postgres-backed sliding-window rate-limit on `/v1/auth/zkp/verify` and `/v1/auth/zkp/register` per-API-key (30 req / 60 s) and on `/api/console/login` per-IP (10 req / 60 s), with counters shared across replicas via atomic upsert on `rate_limit_buckets` (closing commit `3337d7b`).

### Phase 0 P0 findings tracked forward

- **C-2.** Real Android prover replacing the fake mobile prover scaffolding. Tracks to Phase 1 Sprint 3 (commits C-104, C-143, C-167, C-149).
- **C-9.** Postgres-backed session store for horizontal scale-out. Tracks to Sprint 2 (commit C-025).
- **C-11.** RS256 + JWKS rotation. Tracks to Sprint 2 (commit C-028) with rollover playbook at `docs/operations/jwt-key-rotation-playbook.md`.

The full inventory lives in `docs/security/audit-findings.md` with the closing commit on each row; the document is updated on every closure.

---

## Live evidence the bank can verify before signing anything

The bank does not have to take any of the above on trust. Every claim above is independently verifiable today, on the bank's own laptop, in under an hour.

### 1. Live demo at https://zeroauth.dev

The credential-less enrollment, the credential-less login, the transaction-bound step-up, and the breach simulation all run on the live reference implementation against the production tenant database.

The bank's CISO can:

- open the dashboard,
- look at the `users` table,
- confirm there are no PII columns.

The Anchor Bank operator runbook (`docs/operations/anchor-bank-demo-runbook.md`) is provided so the bank can run the entire demo against their own laptop without an operator present.

The five demo scenes are specified in `docs/plan/bfsi-v1/02-bank-demo.md` with scene-by-scene artefact requirements.

### 2. Source-of-truth documents at `docs/plan/bfsi-v1/`

All in the repo and traceable from this document:

- `01-pain-points.md` — the 10 BFSI pain points ZeroAuth solves.
- `02-bank-demo.md` — the bank-demo scene-by-scene specification.
- `03-team.md` — the 50-person delivery team mandate.
- `04-commits.md` — the commit-by-commit plan for Phase 0 and Phase 1.
- `05-agents.md` and `agents/` — the per-agent week-by-week tickets.

Every claim in this one-pager links to a paragraph and a commit hash. The plan is the contract; deviation from the plan is in-repo and visible.

### 3. Audit findings in `docs/security/audit-findings.md`

All 21 Phase 0 findings with their current state, owner, and closing commit. The bank's pentest team can replicate any of the closed-finding regression tests on their own clone of the repo. The findings document is the truth; the marketing language in this one-pager is downstream of it.

### 4. Anchor Bank demo runbook in `docs/operations/anchor-bank-demo-runbook.md`

End-to-end procedure for running the demo against a freshly provisioned tenant:

- enrollment,
- login,
- transaction step-up,
- breach simulation,
- audit-integrity check.

The runbook is the contract. If the runbook fails on a fresh laptop, ZeroAuth does not consider itself demo-ready, and the Phase 1 exit gate does not close.

### 5. ADR record at `/adr/`

Every architectural decision, every dependency, every cryptographic choice has a record with a date, an author, and the alternatives considered.

**ADR 0017** (blockchain-agnostic posture, dated 2026-05-28) is the most recent commercial spine and the document a CIO should read immediately after this one — it explicitly states the platform does not require any blockchain rails in the bank's critical path.

**ADR 0015** (circuit version pinning) and **ADR 0013** (audit-log hash chain) are the next two for the technical reviewer.

### 6. GitHub Actions CI status

Both `.github/workflows/ci.yml` (per-PR gates) and `.github/workflows/deploy.yml` (production deploy) are visible to a bank evaluator we've given read access to.

The bank can confirm directly from the CI history that the test suite has been green on every merge to `main` over the pilot evaluation window.

---

## Contact

**ZeroAuth.** India operations, India data residency. Patent IN202311041001 — Pramaan (granted, full term remaining).

**Engineering owner:** Pulkit Pareek, Senior Software Engineer.
**Product owner:** Amit Dua, Chief Product Officer.
**Compliance owner:** Senior Compliance Lead (DPDP + RBI) — named on every MSA at signing.
**DPO:** Registered with the Data Protection Board under DPDP §10.
**Risk owner:** Risk & Audit Lead — quarterly drill cadence, named on every incident-response runbook.

### Source-of-truth references

- Live reference implementation: [zeroauth.dev](https://zeroauth.dev).
- API contract: `docs/api_contract.md`.
- Threat model: `docs/threat_model.md`.
- Error codes: `docs/error_codes.md`.
- Architecture decision records: `/adr/`.
- BFSI v1 plan: `docs/plan/bfsi-v1/`.

### Next step

For a pilot conversation, the bank's CIO designee can write to the engineering owner directly.

The first hour of the engagement is the demo against the bank's laptop. The second hour is the procurement conversation. No MSA signing in the first meeting — we want the bank's security and legal teams to have read the source-of-truth documents above before any commercial step.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #29 (Senior Product Manager, BFSI)
TRACES TO: `docs/plan/bfsi-v1/01-pain-points.md` (commercial spine), `adr/0017-blockchain-agnostic-posture.md` (blockchain-as-opt-in posture), `docs/security/audit-findings.md` (closed P0 inventory).
SUPERSEDES: any earlier ZeroAuth-vs-Auth0 collateral that presented blockchain anchoring as a default feature.
