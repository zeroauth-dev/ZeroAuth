# Anchor Bank demo — Scene 5 operations sheet (Audit-integrity tamper demo)

The standalone runbook for **Scene 5** of the Anchor Bank demo — the audit-log integrity
demonstration. The full 22-minute show is captured in
[`anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md); this file zooms in on the
single most cryptographically dense scene so the operator can rehearse it without scrolling
the umbrella runbook.

**Time budget.** 3 minutes (00:00–03:00 within Scene 5). Compressed variant is 2 minutes
(skip the on-chain anchor cross-check) — see § 7.

**Pain points addressed.** P4 (insider abuse, audit-log tamper-evidence) — and partially
P10 (DPDP §8 reasonable security practices), since the chain is the "reasonable security
practice" we point at.

**Audience.** The Chief Risk Officer (CRO) is the primary spectator. The CIO is secondary.
Compliance Head will follow up in Q&A.

## 1. What the operator is showing

> "Assume one of your operations staff with database access goes bad tonight. Can they
> erase evidence of what they did? Watch."

Three claims are made on stage, in order:

1. The audit log is **hash-chained** — every row references SHA-256 of the previous row's
   canonical bytes, so any UPDATE breaks downstream verification.
2. The chain is **independently auditable** — `/api/admin/audit-integrity` recomputes
   the chain over the live DB and produces a single pass/fail with the broken row id, with
   no help from ZeroAuth staff.
3. The chain is **anchored on-chain** for tenants whose `audit_anchor_provider` is set —
   so even total DB compromise (including the chain bytes themselves) is distinguishable
   from the on-chain truth.

The full ADR set:
[`adr/0013-audit-log-hash-chain.md`](../../adr/0013-audit-log-hash-chain.md),
[`adr/0014-on-chain-anchor-cadence.md`](../../adr/0014-on-chain-anchor-cadence.md),
[`adr/0017-blockchain-agnostic-posture.md`](../../adr/0017-blockchain-agnostic-posture.md).
The chain itself lives in [`src/services/audit.ts`](../../src/services/audit.ts); the
anchor cron in [`src/services/anchor-job.ts`](../../src/services/anchor-job.ts); the
verify endpoint in [`src/routes/admin.ts`](../../src/routes/admin.ts).

## 2. Pre-flight (T-30 min before the meeting)

Run these before the audience arrives. Every step is idempotent.

1. **Confirm hash-chain depth.** The chain needs ≥ 5,000 rows for the on-stage row pick to
   look real. If a fresh tenant, run the seed script:

   ```bash
   ssh zeroauth-deploy@104.207.143.14
   cd /opt/zeroauth
   ANCHOR_BANK_TENANT_ID=$(jq -r .tenant_id /opt/zeroauth/anchor-bank-demo.json)
   docker compose --profile prod exec zeroauth-api \
     node dist/scripts/seed-audit-events.js \
       --tenant "$ANCHOR_BANK_TENANT_ID" --env live --count 6000
   ```

2. **Snapshot the row you'll tamper with.** Pick a row from yesterday's data — ideally a
   `verification.success` row whose `target_did` corresponds to demo persona "Mrs. Sharma"
   so the on-stage narrative is consistent. Record the `id`:

   ```bash
   docker compose --profile prod exec zeroauth-db psql -U zeroauth -d zeroauth -c \
     "SELECT id, action, entity_id, created_at FROM audit_events \
      WHERE tenant_id = '$ANCHOR_BANK_TENANT_ID' \
        AND environment = 'live' \
        AND action = 'verification.success' \
        AND created_at > now() - interval '36 hours' \
      ORDER BY id ASC LIMIT 1;"
   ```

   Write the `id` into `/opt/zeroauth/scene-5-target-row.txt`. The demo wallclock script
   reads from this file — do not skip.

3. **Take a backup of the target row's `event_data`.** This is what the rollback step
   restores at the end of the scene.

   ```bash
   docker compose --profile prod exec zeroauth-db psql -U zeroauth -d zeroauth -c \
     "CREATE TABLE IF NOT EXISTS audit_events_backup_$(date +%Y%m%d) AS \
      SELECT * FROM audit_events WHERE id = $(cat /opt/zeroauth/scene-5-target-row.txt);"
   ```

4. **Confirm the integrity endpoint is reachable.** Returns `{"status":"pass",...}`:

   ```bash
   curl -fsS "https://zeroauth.dev/api/admin/audit-integrity?tenant_id=$ANCHOR_BANK_TENANT_ID&environment=live&limit=100000" \
     -H "x-api-key: $ZEROAUTH_ADMIN_API_KEY" | jq .
   ```

   If `{"status":"fail"}` comes back during pre-flight, **abort the demo** — the chain is
   already broken from some previous rehearsal that didn't roll back. Page the on-call
   per [`docs/shared/incident-response.md`](https://github.com/zeroauth-dev/ZeroAuth-Governance/blob/main/docs/shared/incident-response.md).

5. **Confirm the on-chain anchor exists.** Tenants on `audit_anchor_provider=none` skip
   this; Anchor Bank's pilot uses `base-sepolia` per their `security_policy`. Pull last
   night's anchor tx hash:

   ```bash
   docker compose --profile prod exec zeroauth-api \
     node dist/scripts/last-anchor.js --tenant "$ANCHOR_BANK_TENANT_ID" --env live
   # → 0x9c1f7e... at block 18,234,567 on base-sepolia, anchored row 22,901
   ```

   Open Basescan to that tx in **Tab 5** of the demo browser stack and leave it loaded.

## 3. Browser-tab layout (the operator drives only these)

| Tab | URL | Used in step |
|---|---|---|
| 4 | `https://zeroauth.dev/dashboard/audit-integrity?tenantId=…` | 4.1, 4.3, 4.4 |
| 5 | `https://basescan.org/tx/0x9c1f7e…` | 4.4 |
| 7 | A `psql` window (terminal app pinned over the browser) | 4.2, 4.5 |

The audit-integrity dashboard panel is the route shipped under C-123 (Wave-3 frontend);
see [`dashboard/src/routes/tenant/audit-integrity.tsx`](../../dashboard/src/routes/tenant/audit-integrity.tsx).

## 4. The 3-minute beat sheet

### 4.1 Beat 1 — Clean state (00:00–00:20)

**Operator switches to Tab 4.** Hits "Run check". The panel turns green:

> **PASS** — hash chain valid from row 1 to row 23,456. Latest on-chain anchor:
> `0x9c1f7e…` on Base Sepolia, anchored 2026-05-31 02:00:00 IST. Anchor matches row
> 22,901 terminal hash.

**Operator says.**

> "Every row in this log carries `previous_audit_hash` and `current_audit_hash`. The chain
> is Merkle-style. Last night at 02:00, a cron published the terminal hash of row 22,901
> to a contract on Base Sepolia — the transaction is public, sitting in tab five. The
> chain is yours to verify; you do not need us."

### 4.2 Beat 2 — The tamper (00:20–01:05)

**Operator switches to Tab 7 (psql).** Reads the target row id off
`/opt/zeroauth/scene-5-target-row.txt`. Substitute below.

```sql
zeroauth=# SELECT id, action, entity_id, status,
zeroauth-#        event_data->>'method' AS method, current_audit_hash
zeroauth-#   FROM audit_events WHERE id = 12345;
```

Confirm the row is real and looks like a normal login success. Then:

```sql
zeroauth=# UPDATE audit_events
zeroauth-#    SET event_data = jsonb_set(event_data, '{tampered}', '"by_corrupt_dba"')
zeroauth-#  WHERE id = 12345;
UPDATE 1
```

**Operator says.**

> "Done. From the DB's perspective that's an unremarkable UPDATE — `event_data` is a JSON
> column, an INSERT trigger doesn't fire, the CDC stream sees it as routine. A
> DBA-level audit might never catch it. The corrupt operator goes home and sleeps."

### 4.3 Beat 3 — Integrity check fails (01:05–01:35)

**Operator switches to Tab 4.** Clicks "Re-run check".

The panel transitions red:

> **FAIL** — hash mismatch at row 12,345. Stored `current_audit_hash` was `0x4f8b…c233`.
> Recomputed `current_audit_hash` from `previous_audit_hash || canonical(event_data)` is
> `0x9e21…0f7a`. Every row 12,345 → 23,456 is now flagged as un-verifiable.

**Operator says.**

> "The check is just SHA-256 of `previous_hash || canonical_event_bytes`. Recomputed
> hash no longer matches the stored hash. Every row after 12,345 inherits the failure —
> the chain is honest about how far the damage propagates. Your auditor cannot un-see
> this row in their next quarterly review."

This is the moment the CRO writes something down. Pause two beats before continuing.

### 4.4 Beat 4 — On-chain anchor cross-check (01:35–02:30)

**Operator switches to Tab 5 (Basescan).** Points at the anchored tx.

> "Now the second layer. Last night's anchor is on a public chain. The terminal hash we
> anchored was the hash of row 22,901 — anchored *before* the tampering happened. So the
> on-chain bytes still encode the un-tampered state up to 02:00 last night."

**Operator switches back to Tab 4** and clicks "Anchor cross-check":

> **DIVERGENCE** — re-derived terminal hash of row 22,901 from current DB does **not**
> match anchored hash at tx `0x9c1f7e…`. On-chain anchor is the source of truth. Database
> state is inconsistent with anchored history.

**Operator says.**

> "Even if the corrupt operator owns the database — even if they rewrote every chained
> hash from row 12,345 forward — they would also need to invalidate last night's on-chain
> transaction. They do not have the key. Our anchor deployer key is in cold storage,
> multisig, never on the production server. The chain forces them to choose between (a)
> a visibly broken DB chain and (b) committing a second crime against a public ledger."

### 4.5 Beat 5 — Silent rollback + closing line (02:30–03:00)

**Operator switches to Tab 7.** This restoration is fast and unannounced:

```sql
zeroauth=# UPDATE audit_events
zeroauth-#    SET event_data = (SELECT event_data
zeroauth-#                        FROM audit_events_backup_<YYYYMMDD>
zeroauth-#                       WHERE id = 12345)
zeroauth-#  WHERE id = 12345;
```

Switch back to Tab 4, hit "Run check" — panel returns to green. Do **not** call attention
to the rollback; the audience's eyes are on the green panel.

**Operator says (turning to the CRO).**

> "The audit log meets RBI Master Direction on IT Governance §6.4 — but with cryptographic
> evidence, not narrative. Your auditor verifies this themselves. Our role becomes purely
> operational. We do not hold the truth, we publish it."

## 5. Required artefacts (verify each is shipped before the demo)

| Artefact | Source-of-truth file | Owner |
|---|---|---|
| Hash-chain implementation | [`src/services/audit.ts`](../../src/services/audit.ts) | Role 11 (Cryptographer) |
| Audit-integrity endpoint | [`src/routes/admin.ts`](../../src/routes/admin.ts) GET `/api/admin/audit-integrity` | Role 9 (Backend) |
| Audit-integrity dashboard view | [`dashboard/src/routes/tenant/audit-integrity.tsx`](../../dashboard/src/routes/tenant/audit-integrity.tsx) | Role 14 (Frontend) |
| On-chain anchor cron | [`src/services/anchor-job.ts`](../../src/services/anchor-job.ts) | Roles 25 + 21 (Blockchain + DevOps) |
| Anchor cold-key procedure | [`docs/security/anchor-key-custody.md`](../security/anchor-key-custody.md) | Role 27 (Security) |
| Scene-5 seed script | `scripts/seed-audit-events.ts` | Role 22 (QA) |
| Backup table convention | This file § 2 step 3 | Role 50 (Operations) |
| ADRs 0013 / 0014 / 0017 | [`adr/`](../../adr/) | Roles 11 + 6 + 4 |

## 6. Recovery playbook (what to do when it goes wrong)

### 6a. The chain is already broken at pre-flight

**Symptom.** Step 2.4 returns `status: "fail"`.

**Cause.** A previous rehearsal didn't roll back, or `appendAuditEvent` has a real bug.

**Recovery.** Do **not** demo. Page on-call. The chain is the artefact — running Scene 5
on a broken chain is worse than skipping it.

### 6b. The UPDATE in Beat 2 errors

**Symptom.** psql returns `ERROR: column "event_data" is of type jsonb`.

**Cause.** A prior schema migration changed the column type.

**Recovery.** Use the fallback UPDATE:

```sql
UPDATE audit_events SET event_data = '{"tampered":"by_corrupt_dba"}'::jsonb WHERE id = 12345;
```

If still failing, **skip ahead to Beat 3** — the chain breaks regardless of which column
is touched as long as the canonical bytes change. Recompute will still fail.

### 6c. The dashboard panel never turns red

**Symptom.** "Run check" returns green after the UPDATE.

**Cause.** Most likely: target row id mismatch between psql window and dashboard query
parameters.

**Recovery.** Without breaking the narrative, switch to Tab 7 and run:

```bash
curl -s "https://zeroauth.dev/api/admin/audit-integrity?tenant_id=$ANCHOR_BANK_TENANT_ID&environment=live&limit=100000" \
  -H "x-api-key: $ZEROAUTH_ADMIN_API_KEY"
```

Read the JSON aloud — `{"status":"fail","brokenAt": 12345, ...}`. Pivot:

> "The dashboard is just a wrapper around this endpoint. Some of you may want to read it
> directly. Here it is."

### 6d. Basescan is down

**Symptom.** Tab 5 won't load.

**Recovery.** Skip Beat 4. Substitute narrative:

> "I'll send you the anchor transaction hash after this meeting; you can verify
> independently. The DB chain alone — Beat 3 — already gave you the integrity signal."

The pre-flight `last-anchor.js` output (in your terminal scrollback) contains the tx
hash and block number. Read those numbers aloud while the audience's network catches up,
or skip Beat 4 outright if more than 30 seconds behind. Defer the visual proof to the
post-demo follow-up.

## 7. Compressed variant (when behind schedule)

If the runbook's `T+8:30` checkpoint shows Scene 3 ran long, Scene 5 compresses to **2:00**:

| Beat | Compressed action |
|---|---|
| 1 | Show green panel only (00:00–00:15) |
| 2 | Tamper exactly as written (00:15–00:50) |
| 3 | Show red panel (00:50–01:30) |
| 4 | **Skip** — say one sentence: "And we also anchor this to Base Sepolia nightly; the tx hash is in your follow-up packet." |
| 5 | Silent rollback (01:30–02:00) |

This keeps the integrity signal intact and shaves 60 seconds.

## 8. What this scene proves vs what it does not

**Proves.**

- The chain breaks on a one-row UPDATE.
- The break is detectable by anyone with admin API access — no ZeroAuth involvement.
- An attacker who owns the DB still cannot rewrite the on-chain anchor.

**Does not prove (be honest in Q&A).**

- Real-time tamper alerting — the check is on-demand today; cron-driven alerting is
  Phase 1 week 11 (see [`docs/plan/bfsi-v1/04-commits.md`](../plan/bfsi-v1/04-commits.md)
  commit C-167).
- Defence against an attacker who controls both the DB **and** the anchor deployer key.
  The cold-storage multisig in [`docs/security/anchor-key-custody.md`](../security/anchor-key-custody.md)
  makes this strictly harder than DB-only compromise, but is not proved on stage.
- Defence against a logic bug in `verifyAuditChain` itself. External cryptographer
  sign-off scheduled for Phase 1 week 10.

If asked any of these, answer honestly and point at the roadmap line.

## 9. Post-demo

After the meeting, before leaving the venue:

1. Re-run the integrity check (Tab 4) — confirm green. The rollback in Beat 5 sometimes
   races with another writer; if red, run the rollback again.
2. Drop the `audit_events_backup_<YYYYMMDD>` table once the chain is confirmed green for
   24 hours. Do **not** drop it before the next demo if same-week.
3. File a Scene-5 outcome row in [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md)
   § 13 "Demo log" — one line: date, audience, outcome, anomalies.

---

LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek (engineering) — operator: rotates per demo, named in the demo log
