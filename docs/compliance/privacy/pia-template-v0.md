# Privacy Impact Assessment — template v0

**Status:** v0 — first issue. Used by every release that introduces, changes, or expands the processing of any data element catalogued in `data-inventory-v1.md`.
**Companion documents:**

- [docs/compliance/privacy/data-inventory-v1.md](./data-inventory-v1.md) — element IDs referenced from `## Data elements affected`.
- [docs/compliance/privacy/data-retention-policy-v0.md](./data-retention-policy-v0.md) — per-element retention rules.
- [docs/compliance/dpdp-2t-commitments-memo-v0.md](../dpdp-2t-commitments-memo-v0.md) — §2(t) classification basis for OPAQUE-CRYPTOGRAPHIC elements.
- [docs/threat_model.md](../../threat_model.md) — attack-row IDs referenced from `## Threat-model rows touched`.

---

## How to use this template

1. Fork this file to `docs/compliance/privacy/pia-<PIA-ID>.md`. The PIA-ID is `PIA-YYYY-NN` where `YYYY` is the calendar year and `NN` is a zero-padded counter for the year (PIA-2026-01, PIA-2026-02, …).
2. Fill every section. A section that is genuinely not applicable carries the literal text `Not applicable — <reason>`. A section left empty fails the PIA review.
3. The PIA is reviewed by the DPO + the privacy engineer + at least one product role before the feature ships. Sign-off is captured in the `Sign-off` table at the foot of this template.
4. PIAs are referenced from the release notes for the release they cover.

---

## Subject

`<name of the feature, change, or new processing surface>`

Example: "Phase 1 PII-strip migration on `tenant_users`."

## PIA ID

`PIA-YYYY-NN`

## Date + version

- **Date authored:** `<YYYY-MM-DD>`
- **Version:** `v<n>` (bump on every revision; previous versions stay in repo with `-v<n>` suffix).
- **Status:** `draft` / `in-review` / `signed` / `superseded-by-<PIA-ID>`.

## Author + reviewers

| Role | Name | Agent # |
|---|---|---|
| Author | `<name>` | `<#>` |
| Privacy reviewer | `<name>` | #39 |
| DPO reviewer | `<name>` | #41 |
| Product reviewer | `<name>` | `<one of #28 / #29 / #30 / #31>` |
| Engineering reviewer | `<name>` | `<one of #2 / #4 / #5 / #6 / #11>` (depending on touched line) |
| CCO sign-off | `<name>` | #36 |

A PIA may not be signed unless the privacy engineer, the DPO, and at least one product role have reviewed. Engineering reviewer is mandatory when the PIA covers a code change; advisory when the PIA covers a process change.

## Description of processing

`<paragraph: what data is collected, how it is collected, what it is used for, who can read it, and how long it is kept. State the lawful basis (DPDP §6) and the role under the Act — Data Fiduciary or Data Processor — clearly.>`

Example skeleton: "The Phase 1 PII-strip migration removes `full_name`, `email`, `phone`, and `employee_code` from `tenant_users`. After this migration, ZeroAuth's tenant database holds only the OPAQUE-CRYPTOGRAPHIC artefacts (DID + commitment) plus tenant-supplied opaque identifiers. The lawful basis under DPDP §6 is the data principal's consent at enrollment for identity verification under the Pramaan protocol; the bank-tenant is the Data Fiduciary; ZeroAuth is the Data Processor."

## Data flow diagram

```
<paste ASCII data-flow diagram here, or reference a PNG in docs/compliance/privacy/diagrams/<PIA-ID>.png>
```

The diagram should show:

- The originating surface (customer device, bank teller console, admin portal, IoT terminal).
- Every hop the data takes (browser → Caddy → Express → service → DB).
- Every persistent store the data lands in (DB tables by name, log streams, on-chain anchors).
- Every cross-border egress (Sentry, on-chain anchor, future GCC/UK replica).

## Data elements affected

| Inventory ID | Element name | Classification (current) | Classification (post-change) | Notes |
|---|---|---|---|---|
| `<row in data-inventory-v1.md §3.X>` | `<element>` | `<one of NON-PII / PII / SENSITIVE-PII / SECRET / OPAQUE-CRYPTOGRAPHIC / TRANSIENT-SECRET>` | `<same or different>` | `<reason for any reclassification>` |

When the PIA introduces a new element not in the inventory, the same PR that lands the PIA must update `data-inventory-v1.md` with the new row.

## Lawful basis (DPDP §6 + RBI sectoral)

| Element | DPDP §6 basis | RBI sectoral basis | Notes |
|---|---|---|---|
| `<element>` | `consent` / `legitimate-interest` / `legal-obligation` / `not-personal-data` | `<RBI MD reference, e.g. IT-MD §6.4 audit log>` | `<basis text>` |

The "not-personal-data" basis is asserted when the §2(t) memo argument applies (commitments, DIDs, did_sha256). Reference the memo and the specific Leg (i)/(ii)/(iii)/(iv) the assertion rests on.

## Cross-border

| Element | Destination | Safeguards | DPDP §13 treatment |
|---|---|---|---|
| `<element>` | `<region/country/processor>` | `<DPA on file / encryption in transit / no PII transferred>` | `<within §13 / outside §13 by §2(t) argument>` |

If no cross-border transfer occurs, the table reads `Not applicable — all elements affected are Indian-only.`

## Retention + deletion

| Element | Retention (days) | Deletion trigger | Reference to retention policy section |
|---|---|---|---|
| `<element>` | `<n>` | `<TTL job / data-principal request / contract termination>` | `data-retention-policy-v0.md §<n>.<n>` |

## Risk assessment

Use a likelihood × impact matrix on a 1–5 scale. Likelihood: 1 = remote, 5 = near-certain. Impact: 1 = nuisance, 5 = catastrophic (penalty cap, regulator censure, headline breach).

Top 5 risks named here. Lesser risks captured in the engineering risk register `docs/team/risk-register.md`.

| Risk ID | Risk | Likelihood (1–5) | Impact (1–5) | Score | Class |
|---|---|---|---|---|---|
| R-PIA-`<PIA-ID>`-01 | `<one-line risk>` | `<n>` | `<n>` | `<L×I>` | `<class — Spoofing/Tampering/Repudiation/Information Disclosure/DoS/Elevation of Privilege per STRIDE>` |
| R-PIA-`<PIA-ID>`-02 | ... | ... | ... | ... | ... |
| R-PIA-`<PIA-ID>`-03 | ... | ... | ... | ... | ... |
| R-PIA-`<PIA-ID>`-04 | ... | ... | ... | ... | ... |
| R-PIA-`<PIA-ID>`-05 | ... | ... | ... | ... | ... |

## Mitigations

| Risk ID | Mitigation | Owner | Verifiable by |
|---|---|---|---|
| R-PIA-`<PIA-ID>`-01 | `<one-line mitigation>` | `<agent #>` | `<test file / log query / control narrative>` |
| ... | ... | ... | ... |

Every mitigation must be verifiable. "Document this in a runbook" is not a verifiable mitigation; the runbook section + the inspection cadence are.

## Residual risk acceptance

After mitigations, what risk remains? Who accepts it?

| Risk ID | Residual likelihood (1–5) | Residual impact (1–5) | Residual score | Accepted by | Reason for acceptance |
|---|---|---|---|---|---|
| R-PIA-`<PIA-ID>`-01 | `<n>` | `<n>` | `<L×I>` | `<DPO + CCO>` | `<rationale>` |

Acceptance requires the DPO (Agent #41) **and** the CCO (Agent #36) to sign. The PIA cannot proceed to "signed" status without both signatures on this section.

## DPDP §5 notice updates required

`yes` / `no`.

If `yes`, the proposed notice-text update is drafted below.

```
<paste proposed §5 notice text here, in plain prose, with the additions or deletions clearly marked.>
```

The privacy engineer and the DPO confirm the proposed text is consistent with `docs/compliance/dpdp/section-5-notice-template.md` (when that template lands; placeholder reference for now).

## Threat-model rows touched

| Threat-model row | Row title | Action in this PIA |
|---|---|---|
| `<A-NN>` | `<title from docs/threat_model.md>` | `add` / `update` / `reference only` |

Where a new threat-model row is required, it lands in the same PR as the PIA.

## Connections to compliance roadmap

| Roadmap deliverable | ID | Notes |
|---|---|---|
| `<deliverable name>` | `<D-Q<n>-<nn> from compliance-roadmap-v1.md>` | `<how this PIA contributes>` |

## Sign-off

The PIA proceeds to `signed` status only when every row below is filled with a signature timestamp.

| Reviewer | Role | Signed on | Comment |
|---|---|---|---|
| `<name>` | Author | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |
| `<name>` | Privacy engineer (Agent #39) | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |
| `<name>` | DPO (Agent #41) | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |
| `<name>` | Product reviewer | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |
| `<name>` | Engineering reviewer | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |
| `<name>` | CCO (Agent #36) | `<YYYY-MM-DD HH:MM IST>` | `<initial comment>` |

---

## Appendix A — checklist before submitting a PIA

- [ ] Subject is a single noun phrase.
- [ ] PIA ID assigned and unique for the year.
- [ ] All data elements traced to inventory rows; new elements added to inventory in the same PR.
- [ ] Lawful basis stated explicitly per element.
- [ ] Cross-border table filled (even if to assert no cross-border egress).
- [ ] Retention table cross-references the retention policy.
- [ ] At least 5 risks named with likelihood + impact + class.
- [ ] Every risk has a verifiable mitigation.
- [ ] Residual risk acceptance section signed by DPO + CCO.
- [ ] DPDP §5 notice update drafted if required.
- [ ] Threat-model rows linked (existing or new).
- [ ] Sign-off table has every row filled.

## Appendix B — escalation path

If the residual risk is accepted at score ≥ 9 (an L×I product of 9 or higher), the PIA is escalated to Agent #1 (founder / CTO) for a personal sign-off, captured as a seventh row on the sign-off table.

If the residual risk is accepted at score ≥ 16, the PIA is also escalated to the **bank's** Data Protection Officer of any pilot tenant that consumes the surface in scope, and their written acknowledgement is filed alongside this PIA.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #39 (Privacy) + Agent #41 (DPO)
