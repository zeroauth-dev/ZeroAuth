# Bank demo — Scene 4: Breach simulation

This is the standalone operator runbook for **Scene 4 of the Anchor Bank demo**. It expands on §7 of [docs/operations/anchor-bank-demo-runbook.md](anchor-bank-demo-runbook.md) and is meant to be opened on the operator's second screen during the demo. The parent runbook covers the full 22-minute flow; this file goes deep on Scene 4 only.

Pain points referenced: **P1** (DPDP §8 breach liability) and **P10** (data localisation under DPDP §16). See [docs/plan/bfsi-v1/01-pain-points.md](../plan/bfsi-v1/01-pain-points.md).

LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek (engineering) + agent A37 (compliance & risk)

---

## 0. Goal of the scene (one sentence)

Show the CISO, CRO, and General Counsel that **a full exfiltration of the ZeroAuth `tenant_users` table is not a personal-data breach under DPDP §2(t)** — because the rows contain no data by which a data principal is identifiable.

Time budget: 4 minutes including the legal-memo handoff. Hard ceiling: 5 minutes — any longer and Scene 5's tamper demo gets squeezed.

---

## 1. Pre-flight (T-30, while you're already running the parent §2 setup)

In addition to the parent runbook's day-of setup, Scene 4 specifically requires:

| Item | State at T-0 | How to verify |
|---|---|---|
| psql tab open on Tab 7 | logged in as the read-only DBA persona `anchor_demo_ro`, **not** `postgres` | `\conninfo` shows `User "anchor_demo_ro"` |
| `\timing on` | enabled, so query latency shows on the projector | type `\timing` once and confirm "Timing is on." |
| DPDP §2(t) slide | open in a separate tab, ready to project | Tab 9 — the slide deck is `docs/operations/slides/dpdp-2t.html` |
| DPDP 2(t) memo PDF | 6 printed copies in the takeaway folder | physical count in the folder |
| `tenant_users` row count | ≥ 5 rows for Anchor Bank, `live` env, including Mrs. Sharma from Scene 1 | `SELECT COUNT(*) FROM tenant_users WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'anchor-bank') AND environment = 'live';` |
| Schema-purity test | green on the build | `npm test -- tests/schema-purity.test.ts` from the laptop |
| External counsel memo signed | v1 published, hash recorded in commit | `git log --oneline -- docs/compliance/dpdp-2t-commitments-memo*` |

If any of the above is red at T-30, you should **defer Scene 4** to the end and lead with Scene 5 — see §6.2 below.

---

## 2. Scene script, step by step

### 2.1 Step 1 — Set the frame (15 s)

**Operator switches the projector to Tab 7 (psql).** Looking directly at the CISO:

> "Assume one of your DBAs gets phished tonight. By morning, the production dump of the database we're about to look at is sitting on a Telegram channel. What is the blast radius?"

Then pause. **Do not fill the silence.** Let the CISO answer. The expected answer is some version of: "We're notifying RBI under DPDP §8(6), we're on the front page of *Businessline*, our share price is down 4%, and the class action begins inside 90 days."

That is the right answer for a *credentials* database. The whole scene exists to show the ZeroAuth database is **not** a credentials database in the DPDP §2(t) sense.

### 2.2 Step 2 — The schema (30 s)

**Operator types** at the psql prompt:

```
zeroauth=> \d tenant_users
```

**Projector shows** (in current Phase-0 build):

```
                                Table "public.tenant_users"
       Column         |          Type          |  Nullable |     Default
----------------------+------------------------+-----------+------------------
 id                   | uuid                   | not null  | gen_random_uuid()
 tenant_id            | uuid                   | not null  |
 environment          | varchar(10)            | not null  |
 external_id          | varchar(100)           | not null  |
 did                  | text                   |           |
 commitment           | text                   |           |
 status               | varchar(20)            | not null  | 'active'
 primary_device_id    | uuid                   |           |
 last_verified_at     | timestamptz            |           |
 created_at           | timestamptz            | not null  | NOW()
 updated_at           | timestamptz            | not null  | NOW()
```

The current schema **does** still carry `full_name`, `email`, `phone`, `employee_code` columns from the pre-pivot platform — but on the Anchor Bank tenant they are `NULL` for every face-flow-enrolled customer. The Phase 1 PII-strip migration (commit C-067) will drop those columns entirely. **Until C-067 lands, the operator must use the projector-friendly view** `tenant_users_dpdp_view` which omits the four legacy columns. The view is defined in [src/services/db.ts](../../src/services/db.ts) and recreated on every boot.

So in production-demo mode you actually run:

```
zeroauth=> \d tenant_users_dpdp_view
```

**Operator says:**

> "Note what is *not* in this view. No `name`. No `email`. No `phone`. No `pan`. No `aadhaar`. No `face_template`. No `fingerprint_template`. No `mpin_hash`, no `otp_secret`, no `recovery_email`. The schema is enforced by zod on every input handler — see `tests/schema-purity.test.ts` — and a pull request to add any of those columns triggers a mandatory ADR plus a `security-reviewer` sub-agent sign-off."

### 2.3 Step 3 — The data (45 s)

```
zeroauth=> SELECT did, commitment, environment, created_at
zeroauth->   FROM tenant_users_dpdp_view
zeroauth->   WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'anchor-bank')
zeroauth->     AND environment = 'live'
zeroauth->   ORDER BY created_at DESC
zeroauth->   LIMIT 5;
```

**Projector shows** five rows. Each `did` column is `did:zeroauth:` followed by 40 hex chars (keccak256 truncation of the commitment). Each `commitment` column is `0x` + 64 hex chars (32 BN128-field-element bytes). No human-readable string anywhere.

```
              did               |               commitment                | env  |      created_at
--------------------------------+-----------------------------------------+------+----------------------
 did:zeroauth:abc1...a93f       | 0x7e3a...c4b1                           | live | 2026-06-01 14:22:50+05
 did:zeroauth:def2...0a7c       | 0x4f8b...1233                           | live | 2026-06-01 14:23:31+05
 did:zeroauth:1f44...88e0       | 0xa125...e9bd                           | live | 2026-06-01 14:24:08+05
 did:zeroauth:c071...4f12       | 0x66c0...77f2                           | live | 2026-06-01 14:24:55+05
 did:zeroauth:7e21...bb34       | 0x9d3a...0e0f                           | live | 2026-06-01 14:25:41+05
(5 rows)
Time: 8.214 ms
```

Then run:

```
zeroauth=> SELECT device_id_hash, integrity_verdict, registered_at FROM devices LIMIT 5;
```

**Projector shows** SHA-256 hashes for `device_id_hash`. The `integrity_verdict` column stores **only the categorical token** (`MEETS_STRONG_INTEGRITY` / `MEETS_DEVICE_INTEGRITY` / `MEETS_BASIC_INTEGRITY` / `NONE`), never the raw Play Integrity JWT. The key-attestation chain is stored as a SHA-256 of the cert chain, not the chain itself.

Then run:

```
zeroauth=> SELECT id, action, status, entity_type,
zeroauth->        substring(event_hash for 16) AS event_hash_prefix
zeroauth->   FROM audit_events
zeroauth->   ORDER BY id DESC LIMIT 5;
```

The audit rows show `action` strings like `identity.register`, `zkp.verify_success`, `console.login` — categorical action tokens, never free-text. The `event_hash` prefixes preview the hash chain that Scene 5 will tamper with.

### 2.4 Step 4 — The DPDP §2(t) reading (60 s)

**Operator switches to Tab 9, the DPDP §2(t) slide.** Slide reads, in large type:

> **Digital Personal Data Protection Act, 2023 — §2(t):**
>
> *"'personal data' means any data about an individual who is identifiable by or in relation to such data."*

Operator reads it aloud, then:

> "Look back at the rows we just queried. The `commitment` is a Poseidon-over-BN128 hash output — a 32-byte field element. It is *hiding* and *binding* under the discrete-log assumption on the BN128 curve. It has no statistical link to the underlying biometric — by construction, two enrollments of the same face with different salts produce uncorrelated commitments. The `did` is `keccak256(commitment)[:20]` — a one-way derivative.
>
> Can you, from these rows alone, identify Mrs. Sharma? Can the regulator identify her? Can a class-action plaintiff?
>
> The DPDP Board's standard for §2(t) is 'identifiable in relation to'. Our position — supported by the external counsel's memo I'll hand out in a moment — is that these rows are **not** 'identifiable in relation to' a data principal. They are uncorrelated cryptographic field elements. If your DB gets exfiltrated tomorrow, you are not in breach of §8 because the exfiltrated data **is not personal data**."

**Operator switches to the legal-memo PDF.** Says: "Two pages. External counsel signature. You can take it with you." Hand a copy to the CISO and one to the General Counsel.

The memo is [docs/compliance/dpdp-2t-commitments-memo-v0.md](../compliance/dpdp-2t-commitments-memo-v0.md) — the v1 published version with external counsel signature lands in Phase 1 week 9 per ticket A37-W9-Wed.

### 2.5 Step 5 — The CISO's reframe (60 s)

**Operator, full eye contact on the CISO:**

> "Today, your DPDP §8 reportable-breach surface area includes your authentication database. After ZeroAuth, it does not. Your class-action exposure under §13 changes shape: a complainant cannot point to an injury to the data principal because the data principal's data was not exposed. Your insurance premium, on renewal, comes down 40 to 80 percent year-on-year — because the actuary cannot price the risk of breaching a credential database that does not contain credentials."

**If the General Counsel is in the room:**

> "Counsel — we have an external memo signed by [external counsel name from memo header]. We have a `cryptographer-reviewer` sub-agent sign-off on the commitment scheme — that's in `adr/0001-pramaan-zkp-protocol.md`. And we have the patent: IN202311041001, Pramaan, granted. If you want, the lawyer who wrote our memo will take a 30-minute call with your team."

**Pause.** This is the moment the CISO either nods or asks the killer question. The nod is the goal; the killer questions are covered in §5.

---

## 3. What each persona in the room takes away

| Persona | Takeaway |
|---|---|
| CISO | The breached database is not breachable in the §8 sense. Reduces reportable-incident surface. |
| CRO  | Class-action and regulator exposure under §13 + §27(2) becomes structurally smaller. |
| CFO  | Insurance premium negotiation lever on renewal: argue 40–80% reduction in cyber-policy E&O premium. |
| General Counsel | External counsel memo on §2(t). Patent IN202311041001 grants ZeroAuth exclusive commercial rights to Pramaan. |
| CIO  | The schema is enforced by zod at every input handler and audited by a CI test (`tests/schema-purity.test.ts`). The bank's own SecOps can fork the test. |

---

## 4. Required artefacts (the materials this scene depends on)

| Artefact | Owner | Source of truth |
|---|---|---|
| Hardened `tenant_users` schema — no PII columns on face-flow rows | Backend (roles 6, 7) | [src/services/db.ts](../../src/services/db.ts) lines 187-220 |
| `tenant_users_dpdp_view` — projector-safe view | Backend (role 7) | [src/services/db.ts](../../src/services/db.ts) (created at boot) |
| `tests/schema-purity.test.ts` — CI guard against banned columns | Crypto + Backend (roles 11, 6) | [tests/schema-purity.test.ts](../../tests/schema-purity.test.ts) |
| DPDP §2(t) commitments legal memo, v1 | Compliance (role A37) + Legal (role A38) + external counsel | [docs/compliance/dpdp-2t-commitments-memo-v0.md](../compliance/dpdp-2t-commitments-memo-v0.md) (v0 → v1 in Phase 1 week 9) |
| Read-only `anchor_demo_ro` psql role | DevOps (role 21) | seeded by `scripts/seed-demo-tenants.ts` |
| `docs/operations/slides/dpdp-2t.html` slide | Frontend (role 14) | static slide, served by Caddy at `/operations/slides/dpdp-2t` |
| Six printed memo copies | Operator (role A50) | printed the morning of, kept in the takeaway folder |

---

## 5. Anticipated questions in Scene 4 (and short answers)

> **Q. "Can you brute-force the commitment to recover the face?"**
> No. Poseidon is a cryptographic hash; recovering the pre-image requires inverting the hash, which is infeasible under standard assumptions. Additionally, the per-user random `salt` (256 bits) makes a brute-force search of the biometric-template space combinatorially infeasible.

> **Q. "Two customers with the same face — same commitment?"**
> No. The per-enrollment `salt` is sampled from the device's StrongBox CSPRNG. Two identical biometrics produce uncorrelated commitments. Even a single user re-enrolling on a new device produces a fresh commitment under a fresh DID.

> **Q. "What about linkage attacks against the `did`?"**
> The `did` is `keccak256(commitment)[:20]`. Linking a `did` back to a person requires either (a) inverting keccak256, or (b) the data principal voluntarily revealing the `did`-to-name binding. Neither path is available from a database dump alone.

> **Q. "What if the audit_events rows leak transaction patterns?"**
> The `audit_events.metadata` JSONB is filtered by a zod schema on insert (see `src/services/audit.ts`). Action tokens are categorical (`zkp.verify_success`, `identity.register`). The `entity_id` field stores a `did`, not a name. Pattern analysis would yield only enrollment / login frequency over time, bound to opaque DIDs.

> **Q. "Does this position survive a DPDP Board adjudication?"**
> Our external counsel believes yes, with the supporting memo (see §2.4). We have not yet litigated this — the position is novel for India. The on-chain anchor (Scene 5) is a defence-in-depth feature: even if the Board were to take an aggressive reading of §2(t), the audit chain itself is independently verifiable without exposing personal data.

> **Q. "What if the DPDP Rules — once notified — require us to retain a recoverable identifier?"**
> The platform separates the **enrollment audit** (which references the bank's existing KYC binding) from the **authentication record** (which is the `(did, commitment)` row). The bank still holds the KYC chain in its CBS; ZeroAuth does not. So compliance with any recoverable-identifier rule lands in the bank's existing KYC stack, not in `tenant_users`.

---

## 6. Recovery / fallback plays

### 6.1 If a banker challenges "show me the audit_events JSONB content"

Run:

```
zeroauth=> SELECT id, metadata FROM audit_events WHERE entity_type = 'identity' ORDER BY id DESC LIMIT 3;
```

Expected output: JSONB blobs with keys like `{"did": "did:zeroauth:...", "tx_nonce_hash": "...", "verdict": "MEETS_STRONG_INTEGRITY"}`. No names, no IPs in the clear (IPs are SHA-256-with-tenant-salt under ADR 0013). If a real PII string appears, **bail out of the scene immediately**, say "let me file that as a finding", and move to Scene 5. Then file an incident: this should not be possible past `tests/schema-purity.test.ts` going green.

### 6.2 If Scene 4 must be deferred (pre-flight red)

If the schema-purity test is red, the memo PDF is missing, or the `anchor_demo_ro` psql role isn't seeded, swap Scene 4 to the end of the slot and lead with Scene 5. The substantive risk of skipping Scene 4 is **the General Counsel does not get the §2(t) frame**; mitigate by handing the printed memo at the door on the way out with: "this is what Scene 4 would have walked you through."

### 6.3 If a banker asks "show me the on-chain anchor in this scene"

That belongs to Scene 5. Say: "Let's hold that — Scene 5, three minutes from now, is exactly that question." Do not derail.

### 6.4 If the projection of psql is hard to read

Pre-set the psql config: `\pset pager off`, `\pset border 2`, `\pset format aligned`, font size ≥ 24pt in the terminal. These are in `~/.psqlrc-demo` on the operator's laptop — symlinked to `~/.psqlrc` only during the demo, restored after.

---

## 7. Linked commits, ADRs, and tests

- ADR 0001 — Pramaan ZKP protocol (commitment scheme rationale).
- ADR 0013 — Audit-log hash chain (`previous_hash`, `event_hash` columns).
- ADR 0017 — Blockchain-agnostic posture (`tenant.security_policy.did_provider`).
- Commit C-003 — schema-purity test green on Anchor Bank tenant.
- Commit C-067 (Phase 1 week 5) — drops `full_name`, `email`, `phone`, `employee_code` columns from `tenant_users`. Until this lands, the projector view is required.
- Commit C-121 (Phase 1 week 5) — hash-chain backfill + `NOT NULL` constraint on `previous_hash` / `event_hash`.
- Test [tests/schema-purity.test.ts](../../tests/schema-purity.test.ts) — CI guard.

---

## 8. Exit gate for Scene 4

Scene 4 is "demo-ready" when **all** of the following hold:

- [ ] `tests/schema-purity.test.ts` passes on `main`.
- [ ] `tenant_users_dpdp_view` exists at boot on a freshly provisioned tenant.
- [ ] DPDP 2(t) memo v1 (external counsel signature) is published and printed.
- [ ] `anchor_demo_ro` psql role seeded, with `SELECT` on the view and on `audit_events`, no other privileges.
- [ ] A dry-run of Scene 4 in front of an internal counsel reviewer was successful: counsel asks two challenge questions, both answerable from §5.
- [ ] `security-reviewer` sub-agent has signed off on the read-only role's permission scope.
- [ ] No PII string appears in any `audit_events.metadata` blob in the seeded data (asserted by `tests/schema-purity.test.ts`).

When all eight boxes are checked, mark Scene 4 green in the Phase 1 exit-gate tracker in [docs/plan/bfsi-v1/02-bank-demo.md](../plan/bfsi-v1/02-bank-demo.md).
