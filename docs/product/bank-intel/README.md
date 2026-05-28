# Bank intel packs — index

**INTERNAL — Pre-sales research only. Not for external distribution.**

> Status: v1 — first issue (A29-W1, week of 2026-05-25).
> Owner: Agent #29 (Senior Product Manager, BFSI).
> Reviewer: Agent #28 (VP Product).
> Consumers: Agent #43 (AE BFSI North), Agent #44 (AE BFSI South + PSBs), Agent #45 (Solutions Architect), Agent #46 (Customer Success).
> Companion documents:
>
> - [docs/plan/bfsi-v1/01-pain-points.md](../../plan/bfsi-v1/01-pain-points.md) — pain-point catalogue (P1-P10).
> - [docs/plan/bfsi-v1/02-bank-demo.md](../../plan/bfsi-v1/02-bank-demo.md) — Anchor Bank demo specification (Scenes 1-6).
> - [docs/plan/bfsi-v1/03-team.md](../../plan/bfsi-v1/03-team.md) — roster (roles 29, 43, 44 in particular).
> - [docs/operations/anchor-bank-demo-runbook.md](../../operations/anchor-bank-demo-runbook.md) — operator script for the day-of.
> - [docs/compliance/compliance-roadmap-v1.md](../../compliance/compliance-roadmap-v1.md) — 12-month compliance posture.
> - [docs/gtm/outreach-sequence-v1.md](../../gtm/outreach-sequence-v1.md) — 5-email cold sequence template.

---

## 1. Purpose

These are research-grade intel packs for pre-call sales prep. They consolidate publicly-available facts about the six Phase 1 target banks so an AE can walk into a conversation with the CISO, CFO, or CRO knowing the bank's recent posture, public commentary, and the pain points from `01-pain-points.md` that the bank has expressed publicly.

They are **not** for external distribution. They are not for inclusion in any external deck, email, or proposal. Anything that needs to leave the building goes through Agent #28 and Agent #45 first and is reviewed against the language rules in `CLAUDE.md`.

---

## 2. What every pack contains

Each pack covers, in order:

1. **Bank profile** — founded year, HQ, scale of digital banking, name of the NetBanking platform if publicly known.
2. **Recent RBI inspection cycle** — publicly-known dates if any; marked `[VERIFY]` if not in public record.
3. **Recent breach posture** — publicly-reported security incidents in the last 24 months with sources.
4. **Digital-banking platform stack** — what is publicly known from app-store listings, careers pages, news articles.
5. **Buying centre** — CISO, CFO, CRO, CIO roles (names are marked `TBD` unless verifiable in public record).
6. **3 pain points from `01-pain-points.md`** that the bank has expressed publicly (RBI inspection findings, AGM remarks, news articles).
7. **Outreach angle** — what the first cold-call email leads with.
8. **Estimated 3-year ACV** — rough sizing if they sign as a pilot bank, based on publicly-known active customer counts and the per-customer math in `01-pain-points.md`.
9. **Internal notes** — known relationships, mutual contacts, things to be careful about.

Source citations use the format `[src: <type>-<publisher>-<YYYY-MM-DD>]`, e.g. `[src: company-website-2026-Q1]`, `[src: news-economictimes-2025-12-15]`, `[src: regulatory-rbi-2024-09-30]`. Anything not cited is either marked `[VERIFY]` or has been omitted.

---

## 3. The six packs

| File | Bank | Owning AE | Primary pain hook |
|---|---|---|---|
| [hdfc.md](hdfc.md) | HDFC Bank Ltd. | Agent #43 (North) | P1 (DPDP §8 breach exposure), P4 (audit + insider abuse) |
| [icici.md](icici.md) | ICICI Bank Ltd. | Agent #43 (North) | P3 (SMS OTP cost), P6 (ATO via SIM swap) |
| [axis.md](axis.md) | Axis Bank Ltd. | Agent #43 (North) | P4 (insider abuse), P7 (transaction binding) |
| [sbi-yono.md](sbi-yono.md) | State Bank of India — YONO | Agent #44 (South + PSBs) | P2 (Aadhaar dependency cost), P9 (V-KYC drop-off) |
| [idfc-first.md](idfc-first.md) | IDFC FIRST Bank Ltd. | Agent #43 (North) | P9 (V-KYC drop-off), P3 (SMS OTP cost) |
| [rbl.md](rbl.md) | RBL Bank Ltd. | Agent #44 (South + PSBs) | P5 (digital-lending consent), P4 (audit posture) |

---

## 4. Update cadence

- **Weekly:** Each pack is reviewed once per week by the owning AE during the Friday outreach review. Discrepancies between the pack and what the AE learned in-week are queued for the next weekly update.
- **Per-meeting:** Every customer meeting produces an `internal notes` increment in the relevant pack within 24 hours. Direct quotes go in verbatim with the meeting date.
- **Quarterly:** Agent #29 re-validates publicly-cited facts (RBI inspection dates, named executives, news cycles) and bumps `LAST_UPDATED` on every pack.

---

## 5. Critical disclaimers

- **No fabrication.** Named individuals are placeholders (CISO, CFO, CRO) unless a public-record source is cited. If a name is included, the citation is in the same paragraph.
- **No leakage to bank prospects.** A pack is not a leave-behind. The leave-behind is the one-page summary PDF described in [docs/operations/anchor-bank-demo-runbook.md](../../operations/anchor-bank-demo-runbook.md) § 12.
- **No marketing buzzwords.** Every pack obeys the banned-phrase list in `CLAUDE.md`. No "AI-powered", no "deepfake-immune" without the visual-spoofing-layer qualifier, no "production stack".
- **DPDP-internal-data treatment.** These packs do not contain customer personal data, but they do contain commercially-sensitive judgements about prospects. They live in this repo (private) and are excluded from any artefact that is pushed to a public mirror.

---

## 6. Open questions for v1.1

- Are HDFC and ICICI both in the "North" AE list, or should one move under "South + PSBs" given their HQ in Mumbai? Resolution: see `03-team.md` role 43. Both stay under #43.
- Yes Bank is in role 43's list but was de-scoped from Phase 1 in favour of the six above. A pack for Yes Bank is queued for Phase 2 once Phase 1 demo-acceptance rates are known.
- Federal Bank, Karnataka Bank, Karur Vysya, Indian Bank (all role 44 territory) are Phase 2 targets. Packs queued for week 13 (Sprint 1 kick-off).

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #29 (Senior PM, BFSI)
