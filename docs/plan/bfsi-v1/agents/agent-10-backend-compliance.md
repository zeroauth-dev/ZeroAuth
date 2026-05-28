# Agent #10 — Senior Backend Engineer (compliance integrations)

**Reports to:** Agent #2.
**Mandate:** Owns SAML / OIDC adapters, consent-capture flow under RBI Digital Lending Guidelines, legal/regulator export pipelines.
**KPIs:** see role 10 in `../03-team.md`.

---

## Week 1 (2026-05-25 → 2026-05-29)

**A10-W1-Mon (2026-05-25)** — Inventory existing SAML / OIDC adapter surfaces
- Done when: `src/routes/saml.ts`, `src/routes/oidc.ts` reviewed; current bindings + assertions documented.
- Output: `docs/team/backend/sso-adapter-inventory.md`.
- Verify: HTTP-POST binding and HTTP-Redirect binding state captured.
- Reviewer: Agent #2.
- Depends on: A02-W1-Mon.

**A10-W1-Tue (2026-05-26)** — Map each of the 6 target banks to their SSO posture
- Done when: per-bank SSO posture documented (which IdP, which binding, which user-attributes).
- Output: `docs/team/backend/bank-sso-posture.md`.
- Verify: 6 bank rows; coordinated with Agent #29.
- Reviewer: Agent #29, Agent #45.
- Depends on: A10-W1-Mon.

**A10-W1-Wed (2026-05-27)** — Consent-data-model draft (RBI Digital Lending)
- Done when: data model captures consent_text_hash, scope, timestamp, signature method, signer DID.
- Output: `docs/team/backend/consent-data-model.md`.
- Verify: model references C-105 attestation flow.
- Reviewer: Agents #37, #11.
- Depends on: A10-W1-Tue.

**A10-W1-Thu (2026-05-28)** — Sync with Agent #37 on consent-capture compliance binding
- Done when: 30-min sync; consent-text variants + scope dictionary agreed.
- Output: `docs/team/backend/consent-spec-w1.md`.
- Verify: spec captures 5 scope categories per RBI guidelines.
- Reviewer: Agent #37.
- Depends on: A10-W1-Wed.

**A10-W1-Fri (2026-05-29)** — Status post + integration-architecture template kickoff
- Done when: status posted; template skeleton drafted.
- Output: `docs/integrations/bank-integration-architecture-template.md` v0.
- Verify: covers net-banking, branch-teller, txn step-up architectures.
- Reviewer: Agent #45.
- Depends on: A10-W1-Thu.

## Week 2 (2026-06-01 → 2026-06-05)

**A10-W2-Mon (2026-06-01)** — Consent schema PR (skeleton, not yet wired to route)
- Done when: `src/services/consent.ts` skeleton + migration for `consent_records` table.
- Output: PR draft.
- Verify: schema migration idempotent.
- Reviewer: Agent #2.
- Depends on: A10-W1-Fri.

**A10-W2-Tue (2026-06-02)** — Review C-027 (CORS hardening) — SSO impact check
- Done when: SSO endpoints don't break with tenant-scoped CORS.
- Output: PR comment on C-027.
- Verify: `tests/cors.test.ts` covers SSO POST binding.
- Reviewer: Agent #7.
- Depends on: A10-W2-Mon.

**A10-W2-Wed (2026-06-03)** — Anchor Bank webhook receiver smoke test scaffolding (precursor C-125)
- Done when: mock webhook receiver written; HMAC signature path tested.
- Output: `scripts/mock-webhook-receiver.ts` v0.
- Verify: receiver verifies signature + nonce.
- Reviewer: Agent #23.
- Depends on: A10-W2-Tue.

**A10-W2-Thu (2026-06-04)** — Compliance-export pipeline design
- Done when: design captures rotation cadence, signing of evidence pack, content scope.
- Output: `docs/team/backend/compliance-export-pipeline-design.md`.
- Verify: covers SOC 2 control evidence + RBI audit response.
- Reviewer: Agent #38.
- Depends on: A10-W2-Wed.

**A10-W2-Fri (2026-06-05)** — Phase 0 compliance-integration sign-off + status post
- Done when: compliance schema skeleton merged.
- Output: row in `docs/team/phase-exits/phase-0-backend-signoff.md`.
- Verify: consent-schema PR merged.
- Reviewer: Agent #2.
- Depends on: A10-W2-Thu.

## Week 3 (2026-06-08 → 2026-06-12)

**A10-W3-Mon (2026-06-08)** — SSO posture deep-dive: HDFC + ICICI
- Done when: HDFC's PingFederate + ICICI's AzureAD configurations documented; integration steps drafted.
- Output: `docs/team/backend/sso-deep-dive-hdfc-icici.md`.
- Verify: covers federation metadata, attribute mapping, signing certs.
- Reviewer: Agent #29.
- Depends on: A10-W2-Fri.

**A10-W3-Tue (2026-06-09)** — SSO posture deep-dive: Axis + IDFC First
- Done when: SSO posture for 2 more banks documented.
- Output: `docs/team/backend/sso-deep-dive-axis-idfc.md`.
- Verify: federation metadata, attribute mapping, signing certs.
- Reviewer: Agent #29.
- Depends on: A10-W3-Mon.

**A10-W3-Wed (2026-06-10)** — Cross-line architecture sync attendance
- Done when: sync attended; SSO integration with `/v1/identity/register` clarified.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A10-W3-Tue.

**A10-W3-Thu (2026-06-11)** — Integration architecture template v1
- Done when: template updated with SSO patterns per bank.
- Output: `docs/integrations/bank-integration-architecture-template.md` v1.
- Verify: per-bank annexes drafted.
- Reviewer: Agent #45.
- Depends on: A10-W3-Wed.

**A10-W3-Fri (2026-06-12)** — Status post + RBI Digital Lending consent-flow design (precursor)
- Done when: status posted; design doc for end-to-end consent flow drafted.
- Output: `docs/team/backend/rbi-digital-lending-consent-flow.md`.
- Verify: flow binds consent_hash + tx_nonce + session_nonce in Pramaan proof.
- Reviewer: Agents #11, #37.
- Depends on: A10-W3-Thu.

## Week 4 (2026-06-15 → 2026-06-19)

**A10-W4-Mon (2026-06-15)** — SSO posture deep-dive: SBI YONO + Federal Bank
- Done when: deep-dive for 2 more banks documented.
- Output: `docs/team/backend/sso-deep-dive-sbi-federal.md`.
- Verify: federation metadata captured.
- Reviewer: Agent #29, Agent #44.
- Depends on: A10-W3-Tue.

**A10-W4-Tue (2026-06-16)** — Webhook receiver test scaffolding hardened
- Done when: replay protection (nonce + 5-min window) verified.
- Output: PR for hardening.
- Verify: replay test green.
- Reviewer: Agent #23.
- Depends on: A10-W2-Wed.

**A10-W4-Wed (2026-06-17)** — Cross-line architecture sync attendance
- Done when: sync attended.
- Output: sync notes contribution.
- Verify: notes published.
- Reviewer: Agent #1.
- Depends on: A10-W4-Tue.

**A10-W4-Thu (2026-06-18)** — Sprint 1 compliance sign-off
- Done when: compliance-integration section of S1 exit gate green.
- Output: row in S1 exit doc.
- Verify: integration template v1 + consent skeleton merged.
- Reviewer: Agent #2.
- Depends on: A10-W4-Wed.

**A10-W4-Fri (2026-06-19)** — Sprint 2 self-plan + status post
- Done when: sprint-2 daily tickets drafted; consent-capture endpoint scoped.
- Output: `docs/team/backend/a10-sprint-2-plan.md`.
- Verify: 5 daily tickets.
- Reviewer: Agent #2.
- Depends on: A10-W4-Thu.
