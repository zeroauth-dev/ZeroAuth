# Week 1 — Engineering annex (DW10)

**Cadence:** Friday 15:30 IST input to the W05 review packet.
**Window covered:** Monday 2026-05-11 → Friday 2026-05-15 (Day 1 → Day 5 of Week 1 of the 8-week build sprint).
**Author:** Pulkit Pareek (engineering).

This is the engineering half of the W05 Friday review. Operational + commercial annexes assemble separately.

---

## Headline

**Week 1 is closed and over-shipped relative to the brainstorm.** The 8-week build order had Week 1 as "governance repo + zeroauth.dev API skeleton + first ADRs + threat model v1." We shipped all of that plus four items the brainstorm scheduled for Weeks 2–6 (verifier service split with its own audit log, security review subagent retroactively, dashboard skeleton at 10 pages, email infrastructure with F-2 mitigation). Net delta vs the brainstorm: **roughly Week 4 throughput delivered in Week 1**.

The cost: discipline gates were running behind the build for the first half of the week. Caught up by Day 3 (security-reviewer subagent on PR #22, DW01 cadence seeded, ADR-0004 for the governance split). Cadence held cleanly Day 4 + Day 5.

---

## What shipped this week

PRs merged to main, in order:

| # | PR | Headline | Impact |
|---|---|---|---|
| 1 | [#22](https://github.com/pulkitpareek18/ZeroAuth/pull/22) | Central API developer console: 10 pages, 82 tests, CI gated | Dashboard live at `/dashboard/*`. Brainstorm had this in Week 6. |
| 2 | [#24](https://github.com/pulkitpareek18/ZeroAuth/pull/24) | Dashboard `@types/node` Docker hotfix | Unblocked the build after PR #22's squash-merge surfaced a type-resolution gap. |
| 3 | [#25](https://github.com/pulkitpareek18/ZeroAuth/pull/25) | Marketing site: product-led landing with dashboard CTAs + Quickstart | Replaced single-pilot-form layout with Sign in / Get started cluster + tabbed Quickstart. |
| 4 | [#28](https://github.com/pulkitpareek18/ZeroAuth/pull/28) | Day 3 bundle: governance repo + qa-log + PR #22 security fixes + B02 plan | One PR for the Day 3 discipline-gap clearance. |
| 5 | [#29](https://github.com/pulkitpareek18/ZeroAuth/pull/29) | B02 Plan B: split Groth16 verifier into `@zeroauth/verifier` workspace | Architectural seam landed. Inline fallback retained as safety net. |
| 6 | [#30](https://github.com/pulkitpareek18/ZeroAuth/pull/30) | Test sweep — 73 → 217 tests across services, middleware, verifier package | 144 new tests in one PR. |
| 7 | [#31](https://github.com/pulkitpareek18/ZeroAuth/pull/31) | Landing page: Pramaan IP vs ZeroAuth product split + new whitepaper | Brand pivot. Yushu Excellence Technologies + Pramaan™ patent (IN202311041001) now anchored on the site. |
| 8 | [#32](https://github.com/pulkitpareek18/ZeroAuth/pull/32) | Landing page broken-link fixes | `status.zeroauth.dev` + `api.zeroauth.dev` cleaned up. |
| 9 | [#33](https://github.com/pulkitpareek18/ZeroAuth/pull/33) | Email infra (Brevo SMTP via nodemailer) + F-2 partial mitigation | Welcome + signup-attempted-notice emails operating. Brevo IP allowlisting required + done. |
| 10 | [#34](https://github.com/pulkitpareek18/ZeroAuth/pull/34) | `docs/operations/env-vars.md` runbook | Captures the `restart` vs `up -d --force-recreate` env-file gotcha + the future `PROD_ENV_FILE` GitHub secret path. |
| 11 | [#35](https://github.com/pulkitpareek18/ZeroAuth/pull/35) | B02 Phase 2: verifier as its own container in prod | Production cutover from inline to HTTP verifier. |
| 12 | [#36](https://github.com/pulkitpareek18/ZeroAuth/pull/36) | B02 Phase 2 hotfix: `127.0.0.1` not `localhost` in verifier healthcheck | 3-minute prod 502 caught + recovered via SSH `--no-deps` start; permanent fix via PR. Documented in the Dockerfile comment so the next operator doesn't revert. |
| 13 | [#37](https://github.com/pulkitpareek18/ZeroAuth/pull/37) | B02 SQLite append-only audit log + hash chain in verifier | Defense in depth — verifier-local audit log independent from Postgres. |
| 14 | [#38](https://github.com/pulkitpareek18/ZeroAuth/pull/38) | ADR-0006: verifier in TS workspace, not Rust separate repo | Formal record of Plan B decision + inline-fallback retirement timeline (2026-06-08). |

### Cross-repo PRs (governance)

| Repo | Change | Why |
|---|---|---|
| `pulkitpareek18/ZeroAuth-Governance` | Initial scaffold (30 files) + counsel-not-engaged honesty patch + verifier component threat-model promoted from stub to v1 with A-V01..A-V05 entries | Day 3 created the repo (collapsed → split per ADR-0004). Day 5 promoted the verifier threat model after PR #37 went live. |

### Total numbers

- **14 production PRs** merged to `main`
- **5 QA-log entries** (`2026-05-13` seed → `2026-05-15` Friday)
- **All deploys green** — three near-misses recovered cleanly (Docker compose env_file gotcha, Brevo IP allowlist, verifier IPv6 healthcheck)
- **228 backend tests + 39 verifier tests** = 267 passing (started Week 1 with 50)
- **Lint clean, typecheck clean** on every shipped PR

---

## Status — components

| Component | State | Note |
|---|---|---|
| Central API at `https://zeroauth.dev/v1/*` | ✅ Live | Tenant API key + scope-checked. 200 on every endpoint. |
| Developer console at `/dashboard/*` | ✅ Live | 10 pages. Brainstorm had this in Week 6. |
| Pramaan + ZeroAuth landing site | ✅ Live | Branding distinction in place. Pramaan whitepaper (25 pages) at `/docs/whitepaper.pdf`. |
| Verifier service (`@zeroauth/verifier`) | ✅ Live | Separate container; loopback-only; SQLite hash-chained audit log writing rows. `/audit/verify-chain` `ok:true`. |
| Email service (Brevo SMTP) | ✅ Live | Welcome + notice emails delivering. F-2 partial mitigation operating. |
| Audit log (Postgres) | ✅ Live | `actor_type='console'` correctly attributed since PR #22 fixes. |
| Audit log (Verifier SQLite + hash chain) | ✅ Live | Defense in depth; independent from Postgres. |
| Threat model | ✅ Live | A-01..A-10 in canonical + A-V01..A-V05 added for verifier. |
| Governance repo | ✅ Live | Independent repo; shared policy + compliance mappings + ADR index. |
| Operational runbooks | ◐ Partial | `env-vars.md` shipped Day 5. Incident response + breach notification have v1 stubs in governance but pending counsel review. |

---

## Open issues / debt carried into Week 2

| Source | Item | Severity | Owner | Next step |
|---|---|---|---|---|
| Issue [#27](https://github.com/pulkitpareek18/ZeroAuth/issues/27) | F-2 byte-identical email-enumeration fix (v2 — 202 always + verification flow) | Medium (down from Critical thanks to Day 4 timing-equalization + notice email) | Pulkit | Week 2 build item. Breaks dashboard signup flow + Playwright happy path; ~4–6h. |
| ADR-0005 (open) | Engage external DPO + IP counsel | High (gates SOW) | Amit | Pick firm at W05 review. Recommended: Ikigai Law (specialist boutique) or Khaitan & Co (full-service). |
| ADR-0006 | Inline-fallback retirement in `src/services/zkp.ts` | Low | Pulkit | Hard date: 2026-06-08 (end of Week 4). 3-week soak window starts today. |
| Verifier threat model | Periodic `/audit/verify-chain` cron + alert | Medium | Pulkit | Week 2 ops task. Daily run + page on `ok:false`. |
| Verifier threat model | Off-host backup of `verifier-audit-data` Docker volume | Medium | Pulkit | Week 2 ops task. Nightly `sqlite3 .backup` to off-host bucket. |
| Verifier threat model | vkey signature at trusted-setup time | Medium | Pulkit (with crypto reviewer) | Week 7 — evidence-pack task. |
| Issue tracking | No bug-tracker board today | Low | Pulkit | Friday: enable GitHub Projects view across issues. |
| Compliance | DPDP / IRDAI / RBI / MeitY mappings still marked PROVISIONAL | High (gates pilot SOW) | Amit + counsel | Counsel review post-engagement (~Week 2 if Amit moves fast). |
| Subagent gate | `security-reviewer` subagent isn't auto-invoked on auth/crypto/audit/tenant PRs | Medium | Pulkit | Week 2 — add a `.github/workflows/security-review.yml` triggered by labels or path filters. |
| Cadence | DW02 daily PR digest never fired | Low | Pulkit | Week 2 — wire as a GitHub Actions schedule, not Cowork. |
| Demo battery | Four demos still `Blocked` (every cadence run since 2026-05-13) | Expected | Pulkit | Unblocks Week 3 (B03 IoT firmware) + Week 5 (B04 mobile SDK). |

---

## Discipline gates — running score

| Gate | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 |
|---|---|---|---|---|---|
| DW01 demo battery cadence | — | — | seeded (late) | on-cadence ✅ | on-cadence ✅ |
| `security-reviewer` subagent on PR | ❌ | ❌ | ✅ (retroactive on PR #22) | ❌ | ❌ |
| ADR per dependency (DP6) | ✅ (rate-limit) | — | — | — | ✅ (nodemailer) ✅ (better-sqlite3 via ADR-0006 acceptance) |
| Plan mode for `src/services/zkp.ts` | n/a | n/a | ✅ (design doc) | ✅ (Plan B chosen) | ✅ (audit log per design doc) |
| Threat model updated on architecture change | — | partial | ✅ A-08..A-10 added | ✅ A-09 reconciled | ✅ A-V01..A-V05 added |
| CI green on every merge | ✅ | ✅ | ✅ | ✅ | ✅ |
| Production smoke after deploy | ✅ | ✅ | ✅ | ✅ | ✅ |

**Honest read:** the only consistently-skipped gate this week was the `security-reviewer` subagent. Retroactive run on PR #22 surfaced 7 findings (1 Critical = 0; 3 Medium, 3 Low, 1 Info), all closed or carved-out. **For Week 2, wire the subagent into CI** so it's not a remembered-discipline thing.

---

## What affects SOW signing

These are the items that block the first pilot SOW (Week 8). Ordered by criticality:

1. **DPO + IP counsel engagement** (ADR-0005, open). Most SOW templates require a named DPO. Counsel also needs to bless the DPDP §8(7) breach procedure before any pilot buyer's security team reads it.
2. **F-2 byte-identical signup fix** (Issue #27). A pilot buyer's security team WILL try the signup enumeration probe; the partial mitigation (timing equalization + notice email) is defensible but not byte-identical, which is the spec.
3. **vkey signature at trusted-setup time** (verifier A-V02). The audit story for pilot buyers includes "how do you know the vkey wasn't swapped." Today's answer is "trust GitHub Actions"; that needs to upgrade.
4. **Periodic chain-verify + off-host SQLite backup**. "What's your recovery story if the verifier's audit volume is deleted" is a buyer Q.
5. **DPDP / IRDAI / RBI / MeitY mappings counsel-reviewed**. Currently PROVISIONAL; a pilot buyer in BFSI will ask for the IRDAI mapping specifically.

Items NOT blocking SOW (but on the roadmap):

- IoT firmware (B03 Week 3) + mobile SDK (B04 Week 5) + demo wrappers (B15–B18 Week 4–6) — these are buyer-facing demos, important for the sales motion, not for the legal/security gate.
- Inline-fallback retirement — internal cleanup.
- Reproducible build provenance — nice-to-have audit story; not currently asked for by any buyer.

---

## Week 2 — proposed deliverables (5 items)

Default plan for Mon 2026-05-18 → Fri 2026-05-22, subject to revision in the W05 review:

| Day | Item | Why |
|---|---|---|
| Mon | **B03 — IoT terminal firmware skeleton** (`pulkitpareek18/ZeroAuth-IoT` new repo). Per dev brainstorm Week 3 schedule, but bringing forward to Week 2 Mon. | The four demos unblock when B03 + B13 ship. Earlier ⇒ pilot demos sooner. |
| Tue | **Counsel outreach (Amit) + Issue #27 v2** (Pulkit, in parallel). | ADR-0005 closure starts the engagement window. F-2 v2 needs the email infra that's now live. |
| Wed | **B13 — Liveness detection skeleton** + mock-hardware demos pass | Demo 1 of the four-demo battery starts to lift. |
| Thu | **Periodic chain-verify cron + off-host SQLite backup** + DPDP mapping counsel review (if Amit has firm picked) | Closes two open items the verifier threat model flagged. |
| Fri | **W05 #2 Friday review** (the second one — first weekly cadence) + **`security-reviewer` workflow file** + retirement-of-inline-fallback PR draft | Closes the discipline gap that nagged Week 1. Drafts the Week-4 retirement so it doesn't sneak up. |

Two days are spec-only (Tue + Thu); three days have shipping work (Mon + Wed + Fri). Realistic load for one engineer + one founder.

---

## Operational notes for Amit

(For the W05 review discussion, not for engineering.)

- **Brevo SMTP** is live. Free tier = 300 sends/day. We've used <10 today. Re-evaluate around Week 5 if signup traffic ramps.
- **Production VPS** has the `.env` injected (runbook in [`docs/operations/env-vars.md`](../docs/operations/env-vars.md)). Manual injection has burned ~30 min of engineering time this week; the `PROD_ENV_FILE` GitHub secret path retires that on the next env change.
- **Domain registration**: `zeroauth.dev` (Hostinger) is fine. **`status.zeroauth.dev`** is referenced in some docs but doesn't resolve — landing page tooltip notes it as roadmap. Decide if we want a real Uptime Robot / Better Uptime status page now or defer.
- **Brand language**: the Pramaan IP / ZeroAuth product split landed Thursday. All marketing copy + the whitepaper PDF reflect it. LinkedIn pages still need updating manually.
- **Patent**: IN202311041001 referenced consistently across the site + footer + every email's footer + every ADR that touches IP.

---

## Confidence statement

**Week 1 closes on a strong note.** Production is healthy. Test coverage tripled. The brand pivot is consistent. The discipline gates that mattered most (threat model + ADRs + counsel-honesty) are in place. The one we routinely skipped (security-reviewer subagent) is wired into Week 2 as the first item.

**Risks I'm watching:**

1. Single-engineer concentration — every shipped PR is mine. The bus-factor work (backup engineer JD, external cryptographer outreach) is Amit's to drive; without it, Week 2 is fragile.
2. Counsel engagement velocity — ADR-0005 is the highest-leverage open item. If Amit doesn't have a firm picked by EOD Wednesday Week 2, Week 8 SOW slips.
3. The 3-week verifier-soak window for the inline-fallback retirement — if any verifier issue surfaces between now and 2026-06-08, the retirement PR slides and the inline path stays.

Otherwise: on track for the 8-week pilot-readiness target.

---

LAST_UPDATED: 2026-05-15 15:30 IST
OWNER: Pulkit Pareek (engineering); reviewed by Amit Dua at W05 16:00 IST
