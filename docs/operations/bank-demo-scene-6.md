# Anchor Bank demo — Scene 6 (on-chain anchor variant)

This document is the operator's runbook for the **optional Scene 6** on the on-chain-anchor variant of the Anchor Bank demo. It is structured to match [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md) — preconditions, setup, line-by-line script, projector cues, recovery — and is meant to be **printed**, carried into the room on paper, and followed verbatim only when the on-chain layer is in scope for the bank we are pitching to.

Scene 6 is **always optional**. The default Anchor Bank demo (Scenes 1–5 in `anchor-bank-demo-runbook.md`) is fully off-chain per [ADR 0017](../../adr/0017-blockchain-agnostic-posture.md): hash-chained audit + signed daily transcript, no Base RPC dependency. Scene 6 layers the on-chain anchor + on-chain DID registry + on-chain Groth16 reverification on top of the existing five scenes for tenants that have explicitly asked about chain anchoring, defence-in-depth verification, or "Web3-ready" posture.

Read [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md), [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md), and [ADR 0017](../../adr/0017-blockchain-agnostic-posture.md) before this one.

---

## 1. When to run Scene 6

Run only if **all** of these hold:

- A C-suite or risk-committee member in the room has explicitly raised one of: "Web3 posture", "on-chain audit", "blockchain anchoring", "independent chain verification", "third-party chain witness", or has cited a competitor pitch that named a chain.
- The clock at end-of-Scene-5 (T+15:30) shows at least 5 minutes of demo budget remaining before the Q&A window.
- The Anchor Bank demo tenant has its `security_policy` set to `did_provider = "base-sepolia"`, `verifier_provider = "on-chain"`, `audit_anchor_provider = "base-sepolia"` — verified by the operator pre-demo via the `/api/console/security-policy` view (see § 2.3).
- The two Basescan tabs from § 1.5 of the parent runbook (DIDRegistry + Groth16Verifier) are open and the contract pages have loaded within the last 60 seconds.
- The Anchor Bank deployer key for the `AuditAnchor` contract has paid the previous night's anchor transaction — verified via the dashboard's **Anchor Health** panel.

If any condition is false, **skip Scene 6 outright**. Do not improvise an on-chain segment without these preconditions; a failed anchor demo in front of a CISO is worse than no anchor demo at all.

---

## 2. Pre-demo prep specific to Scene 6 (T-24 h)

Everything in `anchor-bank-demo-runbook.md` § 1 still applies. The lines below are additive.

### 2.1 Tenant security-policy verification

The on-chain variant requires the Anchor Bank demo tenant to be in the non-default provider configuration. Log in to the dashboard the night before:

```bash
# From the operator laptop, after dashboard login:
curl -s -H "Authorization: Bearer $CONSOLE_JWT" \
  https://zeroauth.dev/api/console/security-policy \
  | python3 -m json.tool
```

Expected output:

```json
{
  "did_provider": "base-sepolia",
  "verifier_provider": "on-chain",
  "audit_anchor_provider": "base-sepolia",
  "base_rpc_url": "https://sepolia.base.org",
  "did_registry_address": "0xC68ceB726DDB898E899080021A0B9e7994f63A73",
  "groth16_verifier_address": "0x58258bf549D8E8694b22B12410F24583D16e1aA4",
  "audit_anchor_contract_address": "0x...",
  "audit_anchor_signing_key_id": "anchor-bank-demo-key-v1"
}
```

If any of `did_provider`, `verifier_provider`, `audit_anchor_provider` does not match the above, flip the toggles in the **Security policy** view (`/dashboard/security-policy`) and wait 10 minutes for the boot-time blockchain init in `src/services/blockchain.ts` to pick up the new policy on the next worker restart.

### 2.2 Base Sepolia RPC sanity

In addition to the network checks in the parent runbook § 1.2, confirm two things from the same conference-room network:

```bash
# Base Sepolia RPC reachable, latest block within 30 s of now
curl -s -X POST https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | python3 -m json.tool

# DIDRegistry has the expected bytecode hash
curl -s -X POST https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getCode","params":["0xC68ceB726DDB898E899080021A0B9e7994f63A73","latest"],"id":1}' \
  | python3 -c 'import sys, json, hashlib; r=json.load(sys.stdin); print(hashlib.sha256(bytes.fromhex(r["result"][2:])).hexdigest())'
```

The bytecode SHA-256 must match the hash recorded in [`contracts/deployed-addresses.json`](../../contracts/deployed-addresses.json). A mismatch means somebody redeployed the contract under the operator since last demo — **page the blockchain lead (Role 25)** and skip Scene 6.

### 2.3 Last-night anchor confirmation

The Anchor Bank tenant runs the 02:00 IST anchor cron (`src/services/anchor-job.ts`) only because its `audit_anchor_provider` is non-default. Confirm that **last night's anchor landed**:

```bash
curl -s -H "Authorization: Bearer $CONSOLE_JWT" \
  https://zeroauth.dev/api/console/anchor-health \
  | python3 -m json.tool
```

Expected fields: `last_anchor_at` within 24 h, `last_anchor_tx` populated, `chain_confirmation_count >= 3`. If any of these are missing, the on-chain anchor variant **cannot be demonstrated faithfully**; revert to Scene 5 off-chain only.

### 2.4 Pre-warm Basescan

Conference Wi-Fi often throttles Basescan's tracker bundles. Twenty minutes before the demo, open both Basescan tabs (DIDRegistry + Groth16Verifier + AuditAnchor), hard-refresh each, and let them fully render. If Basescan shows the rate-limit banner, switch to the Jio MiFi for the demo network up front rather than discovering the throttle mid-pitch.

---

## 3. Scene 6 narrative arc (3 minutes)

Scene 6 has three beats. Each beat targets one in-room stakeholder.

| Beat | Target | Duration | Projector |
|---|---|---|---|
| Beat A — DID registry on-chain | CISO (audit independence) | 60 s | Basescan DIDRegistry tx |
| Beat B — On-chain reverify | Crypto / risk reviewer | 60 s | Basescan Groth16Verifier read tab |
| Beat C — Anchor cross-check | Auditor / GC | 60 s | Anchor Health panel + Basescan AuditAnchor |

If the operator falls behind by 30 s entering Scene 6, compress Beat B to a 20 s mention. If behind by 60 s, run only Beat A and B; do not start Beat C.

---

## 4. Beat A — DID registry on-chain (60 s)

**Goal.** Show that Mrs. Sharma's DID — already on screen from Scene 1 — has been independently registered on Base Sepolia and is verifiable without any ZeroAuth involvement.

### 4.1 Operator switches projector

Cmd-5 to the **DIDRegistry on Basescan** tab. Find the transaction whose `to` is `0xC68c...3A73` and timestamp matches Scene 1's enrollment (about 15 minutes ago). The latest tx on the contract is almost certainly Scene 1.

### 4.2 Operator says (verbatim)

> "In the default Anchor Bank tenant, the DID lives in our Postgres only — that's our blockchain-agnostic posture per ADR 0017. The bank can ship without any chain dependency. But some of you in the risk committee asked about on-chain anchoring. So we configured this demo tenant with the on-chain DID provider switched on. Here's what that buys you."

Pause. Click into the transaction.

> "This is Mrs. Sharma's enrollment transaction on Base Sepolia. The contract is `DIDRegistry.sol`, source under our repo's `contracts/` directory, audited by Trail of Bits in February. The transaction calls `register(did, commitment)` — those are the same two values you saw in our Postgres in Scene 1. The transaction was paid for by our deployer key, not yours. Your bank holds no chain key, no chain wallet, no chain operational burden."

### 4.3 Operator says (continued)

> "What this gives you: an independently verifiable record of Mrs. Sharma's enrollment that does not depend on us. If ZeroAuth disappears tomorrow, your auditor can confirm Mrs. Sharma's commitment was registered at this block height by querying Basescan directly. No SaaS subscription. No API key. Just a public chain."

**CISO reaction expected.** "What stops you from replaying the same DID for a different commitment?" — **answer:** the contract enforces `did → commitment` uniqueness; a re-registration with a different commitment reverts. Operator pulls up the contract's `Write` tab on Basescan and points to the `require(commitments[did] == 0, "did_already_registered")` clause in the source view.

### 4.4 Pitfall guard

If Basescan shows a "pending" pill on the transaction (block confirmation count < 3), do **not** point to the tx. Pivot to:

> "The transaction is mid-confirmation right now — Base L2 finality is ~3 seconds but Basescan's UI sometimes lags. The block is here..."

and walk to the next-most-recent confirmed `register()` call from earlier in the day's dry-run.

---

## 5. Beat B — On-chain Groth16 reverification (60 s)

**Goal.** Show that the verification path that ran in Scene 2 (snarkjs in-process) can be **re-run** on-chain by anyone, against the deployed `Groth16Verifier.sol`, with the same public inputs and the same proof.

### 5.1 Operator switches projector

Cmd-6 to **Groth16Verifier on Basescan**, then click the **Read Contract** tab.

### 5.2 Operator says (verbatim)

> "Same idea as the DID registry, applied to the proof itself. In our default deployment, proofs are verified by snarkjs in our verifier service — that's what ran in Scene 2 with a 1.2-second total latency. For tenants that want defence-in-depth, the same proof can be re-verified on Base. Different code path, different runtime, same constraint system. If snarkjs ever has a bug, the on-chain verifier catches it."

### 5.3 Operator runs the on-chain verify (manually)

Operator has a pre-saved Chrome snippet that pulls the most recent proof from Scene 2's audit row, formats the calldata, and submits a read-only `eth_call` to the Groth16Verifier:

```javascript
// Pre-saved as Chrome snippet 'on-chain-reverify-scene-6'
window.__zeroauthDemo.reverifyOnChain({
  audit_row_id: window.__zeroauthDemo.lastSceneTwoAuditId,
  rpc_url: 'https://sepolia.base.org',
  verifier_address: '0x58258bf549D8E8694b22B12410F24583D16e1aA4'
}).then(r => console.log('on-chain verify:', r));
```

Console output:

```
on-chain verify: { result: true, block: 14872013, gas_estimate: 287442 }
```

### 5.4 Operator says

> "Result `true`. Same proof. Different verifier. Independently verifiable. The on-chain reverify is gated per tenant — most banks won't enable it because it adds about 10 seconds of wall-clock per verify, and the security delta over snarkjs-in-process is marginal. But it's there. For an RBI auditor doing a deep dive on the cryptographic primitives, this is a `Read Contract → verifyProof()` call away."

### 5.5 Crypto reviewer follow-up

A bank-side cryptographer may ask: "What if the on-chain verifier has been redeployed with a backdoored key?" — **answer:** the `Groth16Verifier` is `immutable` after deploy; the verification key is hard-coded in bytecode and matches the same vkey loaded into snarkjs per ADR 0015. Operator points to the bytecode SHA-256 check from § 2.2: any change to the contract changes the bytecode hash and breaks the integrity check.

---

## 6. Beat C — Anchor cross-check (60 s)

**Goal.** Close the loop on Scene 5. The hash chain we showed in Scene 5 has its terminal hash anchored on-chain nightly; demonstrate the cross-check passing.

### 6.1 Operator switches projector

Cmd-Tab back to the dashboard, navigate to **Audit Integrity → Anchor Health**.

### 6.2 Operator says (verbatim)

> "Back to the audit chain from Scene 5. The default Anchor Bank tenant gets the off-chain hash chain plus a daily signed transcript. This demo tenant additionally anchors on Base every night at 02:00 IST."

Click the **Anchor Health** card. Panel shows:

```
Last anchor:        2026-05-28 02:00:14 IST
Anchor tx:          0x9c1f...e74a  (3 confirmations)
Anchored terminal:  row 22,901
Terminal hash:      0x4f8b...c233
Anchor matches DB:  PASS
```

### 6.3 Operator says

> "The anchor transaction at the top is yesterday's. Three confirmations on Base. The terminal hash anchored matches the hash of row 22,901 in our Postgres. If somebody tampered with any row between 1 and 22,901, the recomputed terminal hash would not match the on-chain value, and we'd see a `DIVERGENCE` flag here."

### 6.4 Operator triggers a brief tamper-then-rollback

This is the same `audit_events` row 12,345 trick from Scene 5 § 8.2, but the projector audience is now watching the cross-check panel rather than the integrity panel:

```sql
UPDATE audit_events SET event_data = '{"tampered":"again"}'::jsonb WHERE id = 12345;
```

Click "Re-run cross-check" on the **Anchor Health** card. Panel flips:

```
Anchor matches DB:  DIVERGENCE
Cause:              row 12,345 hash mismatch
On-chain truth:     0x4f8b...c233 (anchored 2026-05-28 02:00:14 IST)
Database now:       0x9e21...0f7a
```

Operator says:

> "On-chain says `0x4f8b...`. Our DB now says `0x9e21...`. The chain is the source of truth. Yesterday's anchor was paid for by a deployer key in our cold storage — a corrupt DBA in your bank cannot retroactively change the on-chain value because they don't have that key. Roll the tamper back."

Roll back via the pre-prepared backup row (same trick as parent runbook § 8.5).

### 6.5 Operator says (close)

> "Two layers: signed daily transcript for the default tenant, on-chain anchor for tenants who want a public chain witness. Both are independently verifiable without us. You pick which one fits your auditor relationship. Most Indian banks we've spoken to take the signed transcript; two of you in the room have asked about the chain path. That's why we built both."

---

## 7. What each stakeholder sees in Scene 6

| Stakeholder | Takeaway from Scene 6 |
|---|---|
| CISO | Independent verifiability of enrollment + verification + audit, no ZeroAuth involvement required in any of the three. |
| CRO | The corrupt-DBA scenario from Scene 5 is hardened further — they would now also need a private key under our cold storage to forge history. |
| CFO | No additional cost for the bank; the on-chain layer is paid by ZeroAuth's deployer key. Gas spend is in our P&L, not the bank's. |
| GC | Two independent third parties can attest to history: ZeroAuth's signed transcript, and the Base L2 chain. Subpoena surface broadens — useful in litigation. |
| CIO | Zero on-call burden — the chain is best-effort; if Base reorgs or has an outage, enrollment and verification continue to work uninterrupted. |
| Crypto reviewer | The vkey on-chain matches the vkey in snarkjs (bytecode SHA-256 check); the contract is immutable; the trusted-setup transcript is published. |

Pain points referenced in Scene 6 (all already covered in Scenes 1–5; Scene 6 amplifies them): P1 (DPDP §8 blast radius), P4 (insider abuse on audit log), P7 (high-value transaction authorisation), P10 (data residency — chain is permissionless).

---

## 8. Recovery — Scene 6 failure modes

Scene 6 has three new failure modes beyond those in `anchor-bank-demo-runbook.md` § 11.

### 8.a — Basescan rate-limits the operator IP

**Symptom.** Basescan shows a "Too many requests" banner; transactions fail to load.

**First move.** Pivot:

> "Basescan's free tier is rate-limiting us on the conference Wi-Fi — let me read the transaction directly off the chain RPC."

Switch to the SSH tab and run:

```bash
curl -s -X POST https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["0x<tx-hash>"],"id":1}' \
  | python3 -m json.tool
```

Project the JSON output. Less visually polished than Basescan but it makes the point that the chain itself is the source of truth, not Basescan's UI.

### 8.b — Base Sepolia RPC times out mid-Beat-A

**Symptom.** The Basescan tab spins; the `eth_call` in Beat B hangs for > 5 s.

**First move.** Acknowledge transparently:

> "Base Sepolia's public RPC is having a moment — it's a testnet, finality is fine but the public endpoint can throttle. In production this is a paid RPC provider with SLAs, but for the demo we're on the free tier. Let me show you the cached anchor proof instead."

Navigate to the dashboard's **Anchor Health → History** view, which renders the last 30 nightly anchors from our DB cache (signed by the chain at the time, not re-fetched live). The chain-side truth is still validated; we just don't replay the RPC call live.

### 8.c — The Anchor Health panel reports DIVERGENCE before the operator tampers

**Symptom.** Operator opens Anchor Health in Beat C and the cross-check is already red. This means yesterday's anchor did not land, **or** someone else tampered with the audit log.

**First move.** Do **not** demonstrate the tamper. The demo of "DIVERGENCE on tamper" is meaningless if DIVERGENCE was already on. Pivot:

> "I'm seeing an interesting state on the cross-check panel — let me flag this with our SRE rather than improvise. Scene 5 already covered the hash-chain integrity check from yesterday's known-good database dump, so the cryptographic point lands without this beat."

Skip Beat C entirely. Note the divergence in the post-demo debrief and page Role 11 (Crypto) + Role 25 (Blockchain) inside 2 hours. This is a real incident, not a demo glitch.

### 8.d — Operator forgot to opt the tenant into on-chain providers

**Symptom.** Beat A's Basescan tab shows no recent transaction matching the Scene 1 timestamp. The tenant is still on `did_provider = "off-chain"`.

**First move.** Do not flip the provider live during the demo — boot-time blockchain init takes 10 minutes and the room will not wait. Pivot:

> "We're showing the off-chain default today — the on-chain layer can be enabled with a config flip on the security policy and we'd be happy to schedule a focused 30-minute follow-up on the chain story. Pulling up the architecture diagram instead."

Open the architecture one-pager from the leave-behind folder. Walk through the three-provider model from ADR 0017 verbally. Continue to the Q&A.

---

## 9. Anti-script — what the operator must not say in Scene 6

- ~~"Our blockchain is..."~~ — ZeroAuth's blockchain is **a Base contract**, not our chain. Phrase it as "an Ethereum-L2 contract we deploy".
- ~~"We use blockchain because..."~~ — the platform does **not** require a blockchain. Phrase it as "for tenants who opt in to on-chain anchoring, we provide..."
- ~~"On-chain is more secure than off-chain"~~ — the off-chain hash chain is the security primitive; the on-chain anchor is defence-in-depth. Conflating the two oversells the chain layer and undersells the default.
- ~~"Web3"~~ — never. The word damages credibility with a CRO. If a banker uses it first, you may match their register, but do not initiate.
- ~~"We mint tokens"~~ — we register DIDs and commit hashes. There is no token. Never imply there is one.
- ~~"Smart contract"~~ in CFO-facing language — say "contract on Base" or "on-chain registry". The phrase "smart contract" triggers a learned skepticism in Indian BFSI buyers from the 2017-2018 crypto cycle.
- ~~"Decentralised"~~ — the verifier is centralised in our SaaS; the anchor is on a chain. Say "independently verifiable" instead.

---

## 10. Post-Scene-6 transition

If Scene 6 ran, the operator transitions back to the **Q&A bank** from the parent runbook § 10. Do **not** linger on chain content; the demo's centre of gravity is the off-chain protocol, and a long chain segment undermines the ADR 0017 positioning.

Operator says, closing Scene 6:

> "That's the on-chain optional layer. Most pilots run without it. The default Anchor Bank deployment ships as off-chain hash chain plus signed daily transcript. Chain anchoring is a flag you flip when the regulator or your internal auditor asks for it. Questions?"

---

## 11. Cross-references

- [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md) — the off-chain default runbook this document extends.
- [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) — bank demo specification (note: the "Scene 6" in that doc is the **teller workflow**, not this on-chain variant — the two are independent optional scenes and one or the other should be selected per-room, never both).
- [ADR 0017 — Blockchain-agnostic posture](../../adr/0017-blockchain-agnostic-posture.md) — the controlling decision behind why this scene is optional.
- [ADR 0013 — Audit log hash chain](../../adr/0013-audit-log-hash-chain.md) — the off-chain integrity primitive.
- [ADR 0014 — On-chain anchor cadence](../../adr/0014-on-chain-anchor-cadence.md) — superseded by 0017 for the default, retained as the provider implementation for opt-in tenants.
- [ADR 0015 — Circuit version pinning](../../adr/0015-circuit-version-pinning.md) — vkey hash that both snarkjs and the on-chain Groth16Verifier must match.
- [`contracts/deployed-addresses.json`](../../contracts/deployed-addresses.json) — DIDRegistry, Groth16Verifier, AuditAnchor addresses + bytecode hashes.
- [`src/services/anchor-job.ts`](../../src/services/anchor-job.ts) — the nightly anchor cron, only runs for tenants where `audit_anchor_provider != "none"`.
- [`src/services/tenant-providers.ts`](../../src/services/tenant-providers.ts) — provider helper used by identity / zkp / anchor paths.

---

LAST_UPDATED: 2026-06-01
OWNER: Agent #35 (writer-compliance) + Agent #25 (blockchain lead)
