# Bank demo — Scene 3 operations sheet

Scene 3 of the Anchor Bank demo: **high-value transaction step-up**. This is the operator's deep-dive sheet for the 2-minute scene defined in [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § Scene 3 and scripted line-by-line in [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md) § 6. This sheet expands the runbook with the pre-flight knobs, the cryptographic story, the substitution-attack mechanics, the failure modes, and the post-scene cleanup that the runbook can only gesture at.

Print this alongside the runbook. Carry both into the room. If the runbook is the *what*, this sheet is the *why* and the *what-if*.

---

## Scene summary

**The story.** Mrs. Sharma, already enrolled (Scene 1) and logged in (Scene 2), initiates a ₹5 lakh NEFT to a new beneficiary. The bank's core banking flags the transfer as high-value plus new-beneficiary and requires step-up authentication. ZeroAuth's `/v1/zkp/challenge` binds the transaction payload into the proof. The customer confirms on her phone; the proof verifies; the NEFT queues. The operator then demonstrates a man-in-the-middle substitution attack on the kiosk and shows the proof rejecting.

**The audience cue.** Speak to the CRO. This is a risk officer's scene. The CISO has already seen the data-handling story (Scenes 1, 4); the CFO has already seen the cost story (Scenes 1, 2); now the CRO needs to see fraud control.

**Pain points covered.** P5 (RBI Digital Lending consent capture) and P7 (high-value transaction authorisation — weak OTP-to-transaction binding). See [`docs/plan/bfsi-v1/01-pain-points.md`](../plan/bfsi-v1/01-pain-points.md).

**Runtime.** 2 minutes nominal. 2:30 if the substitution attack lands a beat of silence. Do not exceed 3:00 — Scene 4 needs the time.

---

## Why this scene matters

OTPs are not bound to the transaction they authorise. An attacker who has compromised the customer's SMS channel, or who has socially engineered the customer into reading an OTP aloud, can replay or substitute the transaction at the wire and the OTP still verifies. RBI's Master Direction on Digital Payment Security Controls § 5.3 calls this out as a control gap; industry FY24 high-value transaction fraud sits at roughly ₹800 cr.

ZeroAuth closes that gap by computing `tx_nonce = Poseidon(amount, payee_ifsc, payee_acct, timestamp)` server-side and feeding it as a public input to the Groth16 circuit on the phone. The proof is now structurally inseparable from the exact NEFT details Mrs. Sharma saw on her screen. Substitute the amount anywhere between her eyes and the server and the verifier returns `proof_invalid`.

The CRO's mental model after this scene should be: *the credential is the transaction*, not *the credential authorises a separate transaction*.

---

## Pre-scene state

Scene 3 begins assuming Scene 2 ended cleanly. Verify before stepping on Scene 3:

| State | How to verify |
|---|---|
| Mrs. Sharma's session is alive on the kiosk net-banking tab. | Kiosk tab shows the landing page with her masked account; not the QR-login screen. |
| The dashboard Overview shows `verifications: ≥1` for the demo tenant. | Tab 1 of the operator browser. |
| The audit-events SSE stream is still attached. | Tab 3. New rows scroll as the operator types. |
| Mrs. Sharma's phone is at full brightness, lock screen unlocked, ZeroAuth app open on the dashboard. | Visual. |
| FCM push delivery to the phone has been confirmed in this room. | The Scene 2 login fired a push; if the phone vibrated, FCM is reachable. If not, fall back to manual app-open (see § Recovery). |
| The dev-tools snippet `demo-substitution-attack` is loaded as a Chrome snippet on the kiosk tab. | Sources panel → Snippets → entry exists. |

If any of the above is not green, do **not** start Scene 3. Either rerun the failing Scene 2 step or skip directly to Scene 4 and circle back at the end of Q&A. Never debug live.

---

## The flow (operator beats)

### Beat 1 — Initiate the NEFT (≈ 30 s)

1. Click into the kiosk tab. Navigate Funds Transfer → New Beneficiary → NEFT.
2. Type payee name `Mr. Gupta`, IFSC `ABCD0001234`, account `9876543210`, amount `5,00,000`. Use Indian comma grouping; the room reads it faster.
3. Click Submit.
4. The kiosk tab transitions to *"Open your ZeroAuth app and confirm"*. The phone receives an FCM push at the same instant — `Tap to confirm ₹5,00,000 to Mr. Gupta`.

Behind the scenes: the kiosk's net-banking back-end posted to `/v1/zkp/challenge` with `{ did, txn_payload: { amount: "500000", payee_ifsc: "ABCD0001234", payee_acct: "9876543210", timestamp: "<RFC3339>" } }`. The server computed `tx_nonce` and stashed it under a fresh `session_nonce`, then emitted an SSE event the kiosk consumed.

Operator says, while clicking:

> "Mrs. Sharma initiates a ₹5 lakh NEFT to Mr. Gupta — a new beneficiary, never seen before. Your core banking flags it as high-value plus new-beneficiary. It requires step-up."

### Beat 2 — Confirm on the phone (≈ 30 s)

1. Hand the customer phone to the CRO (or whichever banker holds it).
2. The phone shows: *"Confirm: ₹5,00,000 to Mr. Gupta, ABCD0001234, A/c …543210?"*. The amount is rendered with the full lakh formatting; the account is masked to the last six digits to match RBI display norms.
3. The CRO taps Confirm. BiometricPrompt fires — face or fingerprint, their choice.
4. The phone runs the rapidsnark JNI bridge over `identity_proof.circom` v1.2 with public inputs `[commitment, session_nonce, tx_nonce, tenant_id_hash]` and private inputs `[secret, salt]`.
5. The proof posts to `/v1/zkp/verify`. The server checks `tx_nonce` against the stashed value, runs `snarkjs.groth16.verify`, and on success creates a transaction-authorisation token the kiosk back-end consumes.
6. The kiosk tab transitions to *"NEFT queued — reference NRTGS25052812345"*.

Operator says, slowly, while the proof is in flight:

> "The phone is now binding the transaction details into the proof. The server computed a transaction nonce — `tx_nonce = Poseidon(amount, payee_ifsc, payee_acct, timestamp)` — and the prover takes that as a public input. If anyone substitutes a different amount, payee, or timestamp anywhere between Mrs. Sharma's eyes and the server, the proof fails."

Audit Events tab (Tab 3) shows a new row in real time: `event_type='auth.verify_success'`, `did=did:zeroauth:…`, `proof_hash=…`, `tx_payload_hash=Poseidon(500000,ABCD0001234,9876543210,…)`. The previous-hash column links cleanly to Scene 2's row.

### Beat 3 — The substitution attack demonstration (≈ 45 s)

This is the heart of the scene. The room must see the proof rejecting *because the cryptography says so*, not because the operator says so.

1. Operator says, deliberately, to the whole room:

   > "Now let's pretend an attacker tried to change the amount mid-flow. The attacker controls the kiosk's display — say it's malware, or a compromised branch terminal. They show Mrs. Sharma ₹50,000 on screen. She confirms. The attacker forwards ₹5,00,000 to the back-end."

2. Open Chrome dev-tools on the kiosk tab (Cmd-Option-J on macOS).
3. Switch to the Sources panel → Snippets → `demo-substitution-attack`. Run it:

   ```javascript
   window.__zeroauthDemo.injectSubstitution({
     displayed_amount: '50000',
     signed_amount: '500000',
   });
   ```

   This monkey-patches the kiosk's outgoing `/v1/zkp/challenge` call so the server stashes `tx_nonce` over the *signed* amount (₹5,00,000) but the kiosk continues to display the *displayed* amount (₹50,000). The phone, however, fetches the canonical transaction summary from the server before display and shows what the server has — so the phone still shows ₹5,00,000. The mismatch is *deliberately* injected on the kiosk only, to model a tampered display surface.

4. Re-initiate the NEFT (Beat 1 of this scene, with the same payee but amount field changed to `50,000` on the kiosk — the snippet's monkey-patch upgrades it to ₹5,00,000 on the wire).
5. Hand the phone to the customer. They see *"Confirm: ₹5,00,000 to Mr. Gupta"* (matches the server's signed amount, not the kiosk's displayed amount).
6. The customer taps Confirm anyway (instructed: "Just confirm — we want the room to see the cryptography catch this, not you").
7. Proof verification runs. The server's stashed `tx_nonce` covers ₹5,00,000. The phone's prover bound the *displayed* amount the customer saw, which the snippet has skewed via a second hook so the displayed-amount and signed-amount diverge in the prover input. The two `tx_nonce` values diverge.

   In the production path the prover refuses to sign when the displayed and signed amounts diverge — the demo snippet bypasses this guard locally so the proof is actually generated and posted, then rejected server-side. The bypass is explicitly demo-only and lives behind `window.__zeroauthDemo`; production builds strip the global at compile time. See `dashboard/src/demo/substitution.ts` for the canonical implementation.

8. The kiosk tab shows `proof_invalid`. The Audit Events tab logs `event_type='auth.verify_failed'`, `reason='tx_nonce_mismatch'`, `expected_tx_nonce=…`, `received_tx_nonce=…`.

Operator says, to the CRO:

> "The `tx_nonce` the server computed includes the original amount. The phone signed over the substituted amount. Mismatch. The proof rejects. No social-engineering an OTP for a different amount. No 'OTP read-aloud' failure mode. The proof is *cryptographically* bound to the transaction. RBI Master Direction on Digital Payment Security Controls § 5.3 calls out the absence of cryptographic transaction binding as a gap — this closes that gap."

Pause for a beat. Let the CRO ask the follow-up. The follow-up is almost always *"Can the attacker just replay an old proof?"* — answer in § Follow-ups.

---

## Follow-ups the CRO will ask

> **Can the attacker just replay an old proof?**

No. `session_nonce` is a fresh 32-byte random the server issues per `/v1/zkp/challenge` and stores in the rate-limit table with a 90 s TTL. The proof binds `session_nonce` as a public input. Replay against a different `session_nonce` fails verification; replay against the same `session_nonce` after consumption hits the one-shot guard in `src/services/zkp.ts` and rejects with `nonce_consumed`.

> **What if the attacker compromises the phone instead of the kiosk?**

The phone's display is what the customer trusts. If the phone is compromised at the OS level, the attacker shows a fake transaction sheet and the customer biometrically confirms a transaction they did not intend. That is the *malicious app* threat model and ZeroAuth does not claim to defend it — same as the iOS BankID model. We defend against it with: Play Integrity attestation refusing rooted devices, StrongBox key wrap so the credential cannot be exfiltrated, and the transaction display being sourced from the server (so a poisoned display reflects only what the server already has — which the server-side fraud model already inspects).

> **What about the timestamp in the nonce — can the attacker stretch it?**

`tx_nonce` binds the timestamp at second granularity. The server stashes the nonce with a 90 s TTL. The phone's prover binds the same timestamp the server returned (delivered as part of the challenge response, not generated client-side). A stretched timestamp would have to round-trip through the server's challenge and arrive at the phone before TTL expiry; the prover takes ~600 ms on a Pixel 7, so the attacker has roughly 89 s — but they would need a fresh `session_nonce` to do it, which loops back to the replay defence.

> **What is the wall-clock latency from Confirm to NEFT queued?**

Target p95 ≤ 3.0 s. Breakdown: BiometricPrompt ≈ 400 ms, prover ≈ 600 ms on Pixel 7, network round-trip ≈ 60 ms, `groth16.verify` ≈ 80 ms, kiosk SSE roundtrip ≈ 100 ms. The rest is rendering. The phone never blocks on network during proof generation.

> **Is the FCM push required?**

No. The push is a UX nicety. The proof flow works if the customer opens the app manually after seeing the kiosk's "Open your ZeroAuth app" prompt. Tenants who do not want to provision FCM credentials disable it via `tenant.push_enabled = false` and the kiosk falls back to polling-based session pickup. See [`docs/operations/env-vars.md`](env-vars.md) § Push notifications.

> **What if RBI demands a written audit trail of the transaction approval?**

The audit row is the trail. `audit_events` for a successful step-up contains: `did`, `proof_hash`, `tx_payload_hash`, `tx_payload` (full JSON), `session_nonce`, `tenant_id`, `environment`, `previous_audit_hash`, `chain_position`, `created_at`. The row is hash-chained (see Scene 5 sheet) and optionally on-chain anchored. Hand the row to the bank's auditor; they can verify the proof independently against the published `Groth16Verifier` contract on Basescan.

---

## Recovery playbook

### Phone shows nothing after the kiosk's "Open your ZeroAuth app" prompt

Push delivery failed or was throttled. Open the ZeroAuth app on the phone manually. The pending challenge appears in the in-app inbox within 2 s (server-side SSE-equivalent over WebSocket). If the inbox is empty, the `/v1/zkp/challenge` POST failed — check the API health tab; if degraded, abort Scene 3 and skip to Scene 4. Do not retry live more than once.

### BiometricPrompt fails (face not recognised, finger smudged)

Retry once on the same modality. If it fails twice, switch modalities (face → fingerprint, or vice versa). The R307 sensor on its USB-OTG cable is the safety net. If both fail, hand the phone back, say *"the biometric is the gate — if it doesn't recognise me, I don't get to transact, which is the point"*, and move on. Do not factor-reset the phone in front of the room.

### The substitution attack lands a `proof_valid` instead of `proof_invalid`

This is the worst case for the scene. It means the snippet did not load correctly. Recovery:

1. Do not flinch. Continue speaking.
2. Say: *"That was the un-tampered path — let me re-run with the substitution active."*
3. Quietly open dev-tools, run the snippet from the console (do not switch back to the Sources panel — the room is watching).
4. Re-initiate the NEFT. If it still passes, abort the substitution beat, say *"the substitution attack is in the appendix; in interest of time let me move to Scene 4"*, and roll forward.

If the failure is reproducible after the demo, file an incident under the `proof-pairing` component with the substitution snippet attached. The substitution path is exercised in CI via `tests/proof-pairing-substitution.test.ts`; a regression there is a P0 blocker for the next demo.

### Kiosk shows `NEFT failed — proof timed out`

The proof took longer than the server-side TTL (90 s) or the network dropped the proof submission. Re-run Beat 2 with a fresh challenge — the kiosk auto-issues a new `session_nonce` on retry. If the second attempt also times out, abort to Scene 4. Note in the post-demo log: phone hardware, signal strength, prover duration.

### Audit Events tab does not show the `auth.verify_success` row

SSE has dropped. Hard-refresh Tab 3 (Cmd-Shift-R). The row will be backfilled. Continue the scene; do not let the broken SSE distract the room.

---

## Cleanup before Scene 4

1. Refresh the kiosk tab to clear the injected substitution snippet's monkey-patch.
2. Confirm the original `NRTGS25052812345` NEFT is still in `queued` state on the dashboard's Transactions view. The substitution attempt should appear as a separate `failed` row; both are useful for the auditor trail in Scene 5.
3. Close dev-tools on the kiosk tab. Do not leave Sources panel open — Scene 4 needs a clean projector.
4. Switch the projector to Tab 7 (psql). The next scene opens with `\d users`.
5. Take a breath. Drink water. Scene 4 is the longest scene.

---

## Required artefacts for Scene 3 to work

| Artefact | Owner | Required by | Live status |
|---|---|---|---|
| `/v1/zkp/challenge` endpoint with `tx_nonce = Poseidon(amount, payee_ifsc, payee_acct, timestamp)` | Backend (roles 6, 8) | Phase 1 week 8 | In progress (sprint 2). |
| Android prover binding `tx_nonce` as a public input via the rapidsnark JNI bridge | Mobile (roles 17, 18, 19) | Phase 1 week 9 | In progress. |
| FCM push integration gated on `tenant.push_enabled` | Mobile + Backend (roles 18, 6) | Phase 1 week 9 | Pending. |
| Kiosk substitution snippet under `dashboard/src/demo/substitution.ts` with CI coverage | Frontend (role 15) | Phase 1 week 10 | Pending. |
| Audit row schema with `tx_payload`, `tx_payload_hash`, `proof_hash`, `session_nonce` | Backend + Crypto (roles 6, 11) | Phase 1 week 7 | Live for `auth.verify_success`; substitution-failure variant pending. |
| `tests/proof-pairing-substitution.test.ts` covering the rejected-substitution path | QA (role 22) | Phase 1 week 10 | Pending. |

---

## References

- Demo specification: [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § Scene 3.
- Full operator script: [`docs/operations/anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md) § 6.
- Pain points: [`docs/plan/bfsi-v1/01-pain-points.md`](../plan/bfsi-v1/01-pain-points.md) § P5, P7.
- Circuit definition: [`circuits/identity_proof.circom`](../../circuits/identity_proof.circom) v1.2.
- ADR for circuit version lock: [`adr/0015-circuit-version-lock.md`](../../adr/0015-circuit-version-lock.md).
- Threat model entries: [`docs/threat_model.md`](../threat_model.md) — A-12 (transaction substitution), A-13 (OTP relay), A-19 (kiosk display compromise).
- API contract: [`docs/api_contract.md`](../api_contract.md) § `/v1/zkp/challenge`, `/v1/zkp/verify`.

---

LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek (engineering) + Amit Dua (product)
