# BFSI cold-outreach email sequence v1

**INTERNAL — Pre-sales templates. Do not send unmodified.**

> Status: v1 — first issue (A29-W1-Fri, week of 2026-05-25).
> Owner: Agent #29 (Senior PM, BFSI).
> Reviewer: Agent #28 (VP Product), Agent #42 (CRO), Agent #45 (Solutions Architect).
> Consumers: Agent #43 (AE BFSI North), Agent #44 (AE BFSI South + PSBs).
> Companion documents:
>
> - [docs/product/bank-intel/](../product/bank-intel/) — six per-bank intel packs.
> - [docs/plan/bfsi-v1/01-pain-points.md](../plan/bfsi-v1/01-pain-points.md) — pain-point catalogue (P1-P10).
> - [docs/plan/bfsi-v1/02-bank-demo.md](../plan/bfsi-v1/02-bank-demo.md) — Anchor Bank demo specification.
> - [docs/operations/anchor-bank-demo-runbook.md](../operations/anchor-bank-demo-runbook.md) — operator script + one-page summary PDF reference (§ 12).
> - `CLAUDE.md` — banned-phrase list (no "AI-powered", no "deepfake-immune" without qualifier, no "production stack", etc.).

---

## 1. Scope and constraints

### 1.1 What this document is

A five-email cold-outreach sequence for BFSI CISO / CIO / CRO / CFO conversations, paced over 23 days from first touch to demo invitation. Each email has a stable structure that the AE personalises per-bank using the intel pack.

### 1.2 What this document is not

- Not a marketing campaign template. Mass-mailing the same body to many recipients defeats the purpose.
- Not a leave-behind. The leave-behind is the one-page summary PDF from the demo runbook § 12.
- Not for partners or resellers. Their outreach lives elsewhere `[VERIFY: queued for v1.1]`.

### 1.3 Language constraints (non-negotiable)

Per `CLAUDE.md`:

- No "AI-powered" / "leveraging AI" — the verifier is cryptography.
- No "deepfake-immune" without the qualifier "at the visual spoofing class at the verification layer".
- No "Dr. Pulkit" — Pulkit Pareek is "Senior Software Engineer".
- No "production stack" — use "live reference implementation".
- No emojis in subject lines or bodies.
- No exaggerated claims. Every numeric claim has a citation in the corresponding intel pack.
- Subject lines: ≤ 50 chars.
- Body: 100-150 words.

### 1.4 Sequence cadence

| Email | Day | Purpose | Recipient action wanted |
|---|---|---|---|
| 1 | Day 0 | Cold intro + pain hook | Open + flag for reply (week 1) |
| 2 | Day 4 | Follow-up, different pain | Click through to blog post |
| 3 | Day 9 | Value-prop + differentiation | Forward internally |
| 4 | Day 16 | Bank-specific pain (intel-pack-driven) | Reply or call ask |
| 5 | Day 23 | Demo invitation with slots | Book a slot |

Cadence is paced, not aggressive. A 23-day cycle is bank-CISO-realistic; sub-week pings are noise.

---

## 2. Email 1 — Cold intro (day 0)

### 2.1 Subject (≤ 50 chars)

**Primary:** `DPDP §8 and your credential database` (36 chars)

**Variants per pain hook:**

- For SBI YONO (P2 hook): `YONO 2.0 and the UIDAI auth-path overhead` (41 chars)
- For ICICI / IDFC FIRST (P3 hook): `SMS OTP on the auth path — a structural fix` (43 chars)
- For RBL (P5 hook): `RBI digital-lending consent — bound to identity` (47 chars)
- For Axis (P4 hook): `Audit-log integrity with cryptographic evidence` (47 chars)
- For HDFC (P1 hook): `Replacing the credential database, not the IdP` (46 chars)

### 2.2 Body (100-150 words)

```
Dear {{role_title}},

{{intel_pack_hook_sentence}} — one of the public pain points
in the {{bank_short}} digital-banking surface today.

We have built ZeroAuth, a verifier that lets a bank replace
its credential database with a Poseidon commitment that, even
if fully exfiltrated, is not personal data under DPDP §2(t).
The bank's IdP, KYC stack, and core banking remain in place.
The verifier sits behind the bank's existing identity layer
and is exercised by a Groth16 proof on every authentication.

Patent IN202311041001 (Pramaan). India-incorporated, India-
data-resident, regulator-defensible. Cryptographic, not
heuristic. Live reference implementation at the public health
endpoint zeroauth.dev/api/health, running on Base L2.

{{mutual_contact_sentence_or_omit}}

Would 15 minutes in the next two weeks work for a first
conversation? I will hold a slot for the room of your choice.

{{signature_block}}
```

### 2.3 Personalisation slots (per-bank, from intel pack)

| Slot | Source field in intel pack | Example for HDFC |
|---|---|---|
| `{{role_title}}` | § 5 Buying centre, target role | `Chief Information Security Officer` |
| `{{intel_pack_hook_sentence}}` | § 7 Outreach angle, opening sentence | `NetBanking, MobileBanking, PayZapp, and SmartHub together represent the largest credential database in Indian private-sector banking` |
| `{{bank_short}}` | Bank short name | `HDFC` |
| `{{mutual_contact_sentence_or_omit}}` | § 9 Internal notes, mutual contacts | Omit if no verified mutual; otherwise `{{Mutual_name}} suggested I reach out.` |
| `{{signature_block}}` | Signature template § 7 below | Standard AE signature |

### 2.4 Operator notes

- Do **not** address by personal name unless the name is verified that morning on the bank's corporate-governance page (per intel pack § 5 approach rule).
- Do **not** include attachments. Email 1 is text-only; the PDF goes in Email 3.
- Send window: Tuesday or Wednesday, 09:30-11:00 IST. Avoid Mondays (full inboxes) and Fridays (deferred reading).

---

## 3. Email 2 — Follow-up with a different pain (day 4)

### 3.1 Subject (≤ 50 chars)

**Primary:** `One more thought on credential infra` (36 chars)

**Variants per pain hook (rotate from Email 1):**

- After P1 in E1, send P4 in E2: `Audit-log integrity — what regulators expect` (44 chars)
- After P3 in E1, send P6 in E2: `SIM swap as a structural attack class` (37 chars)
- After P2 in E1, send P9 in E2: `Onboarding drop-off after V-KYC` (31 chars)
- After P5 in E1, send P7 in E2: `Binding the proof to the transaction` (36 chars)

### 3.2 Body (100-150 words)

```
Dear {{role_title}},

Following the note last week.

A second pain point on the same surface: {{second_pain_one_liner}}.
The structural fix is the same — the credential never enters
the database, the OTP never enters the SMS gateway, the audit
row is cryptographically anchored at end-of-day on Base L2 and
independently replayable by the bank's auditor without ZeroAuth
in the loop.

One short read on the protocol primitive:
{{blog_post_url}}

The piece is ten minutes; it walks through how a Poseidon
commitment differs from a hash, how the proof binds to the
session, and what regulator-grade evidence looks like in the
audit log.

Happy to schedule a 15-minute call. Tuesday and Wednesday
afternoons work this side, IST.

{{signature_block}}
```

### 3.3 Personalisation slots

| Slot | Source |
|---|---|
| `{{second_pain_one_liner}}` | Intel pack § 6, second pain point (one sentence) |
| `{{blog_post_url}}` | The DevRel blog post on commitment-vs-hash (placeholder until DevRel publish — see [docs/plan/bfsi-v1/agents/](../plan/bfsi-v1/agents/) for the agent owning that publish). For v1 of this sequence, the URL is `https://zeroauth.dev/blog/poseidon-commitment-vs-hash` `[VERIFY URL live before sending]`. |

### 3.4 Operator notes

- The blog post must exist before this email is sent. If the DevRel publish slips, fall back to a published whitepaper section (`docs/whitepaper.pdf` page reference) `[VERIFY exact page]`.
- This is the email most likely to get a "thanks, busy" reply. That is a positive signal — the recipient is engaging.

---

## 4. Email 3 — Value-prop + differentiation (day 9)

### 4.1 Subject (≤ 50 chars)

**Primary:** `Why ZeroAuth, vs Auth0, Okta, Ping` (34 chars)

**Variants:**

- `A short note on what is different here` (38 chars)
- `Where we sit alongside Auth0 / Okta` (35 chars)

### 4.2 Body (100-150 words)

```
Dear {{role_title}},

A three-bullet read on what makes ZeroAuth different from
the workforce IdPs the bank already runs:

  1. Credential storage. Auth0, Okta, Ping store hashes,
     OTP secrets, and biometric templates. ZeroAuth stores
     a Poseidon commitment — a field element that does not
     decrypt to a credential. DPDP §2(t) treatment changes.

  2. Per-auth marginal cost in India. Workforce IdPs default
     to SMS OTP for India BFSI. ZeroAuth's authentication is
     a Groth16 proof: zero SMS, zero UIDAI hits post-enroll.

  3. Audit-log integrity. Append-only is the floor; we publish
     a daily on-chain anchor on Base L2 so the bank's auditor
     can replay independently.

Pre-read attached. 15 minutes when you have a window?

{{signature_block}}
```

### 4.3 Personalisation slots

| Slot | Source |
|---|---|
| `{{role_title}}` | Same as Email 1 |
| Attached PDF | The one-page summary referenced in [docs/operations/anchor-bank-demo-runbook.md](../operations/anchor-bank-demo-runbook.md) § 12 `[VERIFY file path]` |

### 4.4 Operator notes

- This is the email where the PDF lands. Verify the PDF is the latest version on the day of sending; reviewer is Agent #45.
- The "case study placeholder" — once a design partner LoI is signed (per Agent #28's KPI in `03-team.md` role 28), this email is updated to cite the actual partner.
- Do not name a competitor in any way that could be misread as a comparison claim outside the three bullets — this is the email a recipient is likeliest to forward, and forwarded text travels.

---

## 5. Email 4 — Bank-specific pain (intel-pack-driven, day 16)

### 5.1 Subject (≤ 50 chars)

**Primary:** `A {{bank_short}}-specific note` (varies by bank, ≤ 50)

**Per-bank examples:**

- HDFC: `On the post-2020 resilience posture` (35 chars). **Caveat:** test phrasing carefully — do not lead with outage history; lead with the resilience-narrative angle.
- ICICI: `iMobile Pay scale and SMS economics` (35 chars)
- Axis: `Post-Citi consolidation — credential layer` (42 chars)
- SBI: `On YONO 2.0 and credential design` (33 chars)
- IDFC FIRST: `Fair fees and the SMS line item` (31 chars)
- RBL: `Co-lending consent — cryptographic binding` (42 chars)

### 5.2 Body (100-150 words)

```
Dear {{role_title}},

A specific note tailored to {{bank_short}}'s public posture
on the topic of credential infrastructure and DPDP exposure.

{{bank_specific_paragraph_from_intel_pack_section_6}}

The demo we run is 22 minutes plus 15 minutes of questions,
against the live verifier — not a sandbox. Real biometric on
a real Android phone, real Groth16 proof, real on-chain anchor
on Base. The audit-events table writes to the production DB
during the demo and the row is then handed to the customer.
The Scene-4 walk-through opens a psql shell against the live
users table on the projector and asks the room: what can you
identify from these rows under DPDP §2(t)?

If a 15-minute exploratory call before that helps, I can hold
slots Tuesday or Wednesday afternoons, IST.

{{signature_block}}
```

### 5.3 Personalisation slots

| Slot | Source |
|---|---|
| `{{bank_specific_paragraph_from_intel_pack_section_6}}` | Lift one paragraph from intel pack § 6 (the pain point most likely to resonate with the recipient's role) and adapt for first-person. Verify citations remain accurate. |
| `{{bank_short}}` | Bank short name |

### 5.4 Operator notes

- This is the email where the AE's intel-pack reading discipline shows up. A copy-paste of § 6 without contextualisation reads as cold.
- For SBI specifically, mention "YONO 2.0" only if the public RFI / RFP timeline is current per intel pack `[VERIFY at time of send]`. If the timeline has moved, drop to a different paragraph.
- For HDFC, never lead with the 2020 outage as a hook. Lead with "post-2020 resilience posture" as a positive frame.

---

## 6. Email 5 — Demo invitation (day 23)

### 6.1 Subject (≤ 50 chars)

**Primary:** `Demo slot — 22 minutes, live, this month` (40 chars)

**Variants:**

- `Two demo slots — pick one` (25 chars)
- `Demo — {{bank_short}} CISO-CFO-CRO room` (varies, target ≤ 50)

### 6.2 Body (100-150 words)

```
Dear {{role_title}},

To bring the four notes to a head — a direct ask.

Twenty-two minutes of live demo, plus 15 minutes of Q&A.
The room is whoever you want — CISO, CFO, CRO, CIO, Head
of Digital Banking. We can do it at {{bank_office}} or
virtually over Zoom or Webex.

Three slot options:

  - {{slot_1}}
  - {{slot_2}}
  - {{slot_3}}

Pick one; reply with the room composition you would prefer.

If none of the three work, name two windows in the next four
weeks and I will hold them.

The demo runs against the live verifier — the same code that
serves zeroauth.dev today.

{{signature_block}}
```

### 6.3 Personalisation slots

| Slot | Source |
|---|---|
| `{{bank_office}}` | Per intel pack § 1 (HDFC Bank House Mumbai, ICICI Bank Towers BKC, Axis House Worli, SBI Corporate Centre, IDFC FIRST Bank House BKC, RBL Bank Corporate Office Lower Parel) |
| `{{slot_1}}`, `{{slot_2}}`, `{{slot_3}}` | Three concrete date-time slots, 22-minute blocks each. Spaced across two weeks (e.g., Tue + Wed in week 1, Thu in week 2). |

### 6.4 Operator notes

- This email is the strongest call to action in the sequence. If it gets no reply within 5 working days, the next step is a phone call to the bank's main reception with a request to be put through to the role; warm-intro via mutual contact is the alternative. Do **not** send Email 6.
- Verify the demo runbook is current (`docs/operations/anchor-bank-demo-runbook.md`) and the phones are configured before naming a slot.

---

## 7. Signature template

```
Pulkit Pareek
Senior Software Engineer, ZeroAuth
zeroauth.dev | pulkit@zeroauth.dev | +91 {{phone}}

Patent IN202311041001 (Pramaan)
DPDP §2(t) treatment of commitments — legal memo on request
```

**Do not** use:

- "Dr. Pulkit" — per `CLAUDE.md`.
- Any "AI-powered" / "deepfake-immune" / "production stack" copy in the signature line.
- Any logo larger than 80 px wide; mobile clients render large logos poorly.
- Any social-media handle other than `zeroauth.dev` for v1; LinkedIn / Twitter handles are off-by-default until v2.

For AE personalisation:

- Agent #43 (North) signs with their own credentials, with Agent #29 cc'd until Phase 1 week 12.
- Agent #44 (South + PSBs) signs with their own credentials, with Agent #29 cc'd until Phase 1 week 12.
- Agent #29's role line during this cycle: `Product Manager, BFSI`.
- Agent #42 (CRO) is bcc'd on all Email 5 (demo invitations) for tracking.

---

## 8. Per-bank personalisation guidance

This is the operator's quick-reference for which intel-pack section to lift into which email slot.

### 8.1 HDFC

- E1 hook: P1 (`intel pack § 6.1`).
- E2 second pain: P4 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body.
- E4 bank-specific: lift `intel pack § 6.1` paragraph; do **not** mention 2020 outage.
- E5 office: `HDFC Bank House, Senapati Bapat Marg, Lower Parel, Mumbai`.

### 8.2 ICICI

- E1 hook: P3 (`intel pack § 6.1`).
- E2 second pain: P6 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body.
- E4 bank-specific: lift `intel pack § 6.1` paragraph on iMobile Pay scale and SMS economics.
- E5 office: `ICICI Bank Towers, BKC, Mumbai`.

### 8.3 Axis

- E1 hook: P4 (`intel pack § 6.1`).
- E2 second pain: P7 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body.
- E4 bank-specific: lift `intel pack § 6.1` paragraph; frame Citi-acquisition consolidation as positive.
- E5 office: `Axis House, Worli, Mumbai`.

### 8.4 SBI YONO

- E1 hook: P2 (`intel pack § 6.1`).
- E2 second pain: P9 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body. **Caveat:** for PSBs, the procurement cycle is RFP-driven; this email may not generate a quick reply. Plan multi-quarter.
- E4 bank-specific: lift `intel pack § 6.1` paragraph on UIDAI dependency at scale.
- E5 office: `SBI Corporate Centre, Madame Cama Road, Mumbai`. **Caveat:** the demo invitation should be framed as a "technology briefing", not a "sales demo", per PSB cultural fit.

### 8.5 IDFC FIRST

- E1 hook: P9 (`intel pack § 6.1`).
- E2 second pain: P3 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body.
- E4 bank-specific: lift `intel pack § 6.1` paragraph on onboarding-completion as a growth-stage lever.
- E5 office: `IDFC FIRST Bank House, BKC, Mumbai`.

### 8.6 RBL

- E1 hook: P5 (`intel pack § 6.1`).
- E2 second pain: P4 (`intel pack § 6.2`).
- E3 differentiation: stock 3-bullet body.
- E4 bank-specific: lift `intel pack § 6.1` paragraph on partnership-heavy book + RBI Digital Lending Guidelines consent capture.
- E5 office: `RBL Bank Corporate Office, Lower Parel, Mumbai`.

---

## 9. Tracking and review

### 9.1 Per-touch tracking fields (in CRM)

Each send writes a CRM row with:

- Recipient: role + bank.
- Email number in sequence (1-5).
- Send timestamp (IST).
- Open + click events (if email-tracking pixel + link tracking is enabled per privacy posture).
- Reply: yes / no, sentiment (positive / neutral / negative).
- Outcome: progress to next stage / no progress.

### 9.2 Weekly review (Friday, 16:00 IST)

Agent #29 + Agent #43 + Agent #44 + Agent #42 (CRO) review:

- Send volume by stage.
- Reply rate by bank.
- Slot bookings (Email 5 conversions).
- Intel-pack discrepancies surfaced by replies (intel asks for v1.1).

### 9.3 Banned-phrase scan

Before every send, the AE runs a banned-phrase check against:

- `CLAUDE.md` non-goals language list (`AI-powered`, `leveraging AI`, `deepfake-immune` without qualifier, `Dr. Pulkit`, `production stack`).
- Any reference to a specific named executive whose name was not verified that morning.
- Any rupee saving figure in Email 1 or Email 2 (those land only in Email 3 onward, and only with a citation).

A banned-phrase hit blocks the send and is escalated to Agent #29.

---

## 10. Open items for v1.1

- **Blog post URL in Email 2** — depends on DevRel publish. Verify `https://zeroauth.dev/blog/poseidon-commitment-vs-hash` is live before each send `[VERIFY]`.
- **One-page summary PDF in Email 3** — file path under `docs/marketing/` to be confirmed once Agent #32 (Senior Designer) signs off. Current placeholder: `dist/zeroauth-one-pager-v1.pdf` `[VERIFY exact file path]`.
- **Phone number in signature** — currently `{{phone}}`; awaiting per-AE direct-dial allocation by ops.
- **Mutual-contact map** — per-bank, none verified at v1; Agent #28 + Agent #42 to surface.
- **Per-bank slot-3 logistics** — for SBI and any PSB, the third slot should be a "technology briefing" framing rather than "sales demo".

---

LAST_UPDATED: 2026-05-29
OWNER: Agent #29 (Senior PM, BFSI)
REVIEWERS: Agent #28 (VP Product), Agent #42 (CRO), Agent #45 (Solutions Architect)
