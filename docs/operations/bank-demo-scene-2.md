# Anchor Bank demo — Scene 2: Login at a kiosk

This is the operator's deep-dive runbook for **Scene 2** of the 22-minute Anchor Bank demo defined in [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § *Scene 2 — Login at a kiosk (1 minute)*. It is paired with the parent [`anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md), expanding § 5 of that runbook into a stand-alone document the operator can rehearse the night before. Read this **after** [`bank-demo-scene-1.md`](bank-demo-scene-1.md) — Scene 2 assumes Mrs. Sharma is already enrolled, the kiosk tab is loaded, and the dashboard's Audit Events SSE stream is live.

If you are picking up this file cold: [`02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) is the script source-of-truth, [`01-pain-points.md`](../plan/bfsi-v1/01-pain-points.md) is the pain-point map, and [`05-agents.md`](../plan/bfsi-v1/05-agents.md) names the engineering owners.

---

## 1. Scene goal

Show the room a working passwordless login at a public-facing kiosk that:

- completes in **under 1.5 seconds** from QR scan to net-banking landing,
- emits **zero SMS / PSTN traffic**,
- writes a tamper-evident `auth.verify_success` audit row chained to the previous row,
- proves to the CISO that the verification path is purely cryptographic (no shared secret, no second factor at the wire),
- proves to the CFO that an entire OTP cost line is structurally removable.

Pain points referenced (do not name them in the room — the leave-behind PDF cross-references them):

- **P3 — SMS gateway cost.** ₹0.20 × 6 OTPs/customer/month × 12 months × 30 M customers ≈ ₹43 crore/year.
- **P6 — SIM-swap / device theft.** No cellular-bound secret to swap.
- **P9 — Drop-off at the OTP step.** 8 – 12 % OTP delivery failure cleared.

Total budget: **60 seconds of stage time**. Cumulative clock at end of scene: **6:30** of the 22-minute demo.

---

## 2. Pre-conditions (verified at end of Scene 1)

Before stepping into Scene 2, the operator confirms:

| Pre-condition | Check |
|---|---|
| Mrs. Sharma is enrolled on Pixel 7 slot A. | Tab 2 (Users) shows the row written 4-5 minutes ago. |
| Dashboard Audit Events SSE stream is live. | Tab 3 shows rows updating; the latest is `user.enrolled` from Scene 1. |
| Anchor Bank live API key is in the operator's left jacket pocket. | Visual confirmation. |
| The kiosk URL `https://kiosk.anchor-bank-demo.zeroauth.dev` is bookmarked but **not** open. | Opening the tab live is part of the scene. |
| Phone screen brightness is at full, screen lock is **off** for the demo duration. | Settings → Display → Sleep: 30 minutes. |
| FCM push to the phone is **disabled** for this scene — push is a Scene 3 surprise. | Settings → ZeroAuth Banking → Notifications: off. |

If any pre-condition fails, the operator resolves it during the brief pause between Scenes 1 and 2. The clock between scenes is the operator's friend — the room expects a pause.

---

## 3. Step-by-step

### 3.1 Step 1 — Open the kiosk (10 s)

**Operator does.** Cmd-T opens a new Chrome tab. Types `kiosk.anchor-bank-demo.zeroauth.dev`. Press Enter. The kiosk web app — built by Role 15, see [`docs/plan/bfsi-v1/agents/agent-15-fe-console.md`](../plan/bfsi-v1/agents/agent-15-fe-console.md) — loads inside one second.

**Projector shows.** A clean kiosk landing page in Anchor Bank's brand colours: a centred QR code about 40 % of the screen width, a small "awaiting authentication" spinner under it, a footer that reads "Powered by ZeroAuth — Pramaan Protocol v1.2 — `cct-v1.2`".

The QR encodes:

```
{
  "session_nonce": "<32 random bytes, base64url>",
  "tenant_id": "<anchor-bank uuid>",
  "environment": "live",
  "expires_at": "<T + 90s, RFC 3339>"
}
```

The pairing session is created server-side via `POST /v1/proof-pairing/sessions` ([source](../../src/routes/v1/proof-pairing.ts)). The kiosk holds the long-poll / SSE channel open on `GET /v1/proof-pairing/sessions/:id/events`.

**Operator says.**

> "Mrs. Sharma walks up to a self-service kiosk in the branch lobby. This is the same surface you have today for cardless cash, statement download, cheque book request. The kiosk shows a QR; the QR carries a one-shot session nonce that expires in 90 seconds."

### 3.2 Step 2 — Customer scans QR (10 s)

**Operator does.** Hands Pixel 7 (slot A) to the pretend customer — typically the CRO from Scene 1. Says: "Open ZeroAuth Banking. Tap 'Scan to log in'. Point at the projector."

**Customer does.** Scans the QR. The app's session-confirmation sheet opens with the line "Confirm login to **Anchor Bank** net banking". The kiosk identity (tenant name + the operator's seeded "Andheri East" branch label) is rendered from the public session payload — see [`docs/api_contract.md`](../api_contract.md) § *Proof pairing* for the response shape.

**Projector shows.** The kiosk page still shows the QR plus spinner. The phone screen mirrors via `scrcpy` if the operator pre-launched it in § 2.2 of the parent runbook. If `scrcpy` is not available, the customer holds the phone toward the room.

### 3.3 Step 3 — Biometric unlock (10 s)

**Customer does.** Taps **Confirm**. Android `BiometricPrompt` fires — face on the front camera if face enrolment is the primary, fingerprint otherwise. The StrongBox-wrapped key unlocks; the wrapped `secret` is decrypted into a transient in-process buffer.

**Operator says (during the half-second the prover is warming up).**

> "The phone's StrongBox just released a secret that was never on our servers. The next thing happens entirely on the phone."

The biometric source is the same one used at enrolment (Scene 1). The fuzzy extractor input is regenerated from the live capture; any drift inside the 8 % Hamming tolerance lands the same secret as enrolment. Drift outside tolerance fails locally without ever reaching the server.

### 3.4 Step 4 — Proof generation (300 – 600 ms)

The Pramaan prover runs on-device. The WebView prover bridge — see [`android/app/src/main/assets/prover/prover.html`](../../android/app/src/main/assets/prover/prover.html) and [`android/.../RealRegistrationProver.kt`](../../android/app/src/main/java/dev/zeroauth/android/ui/reg/RealRegistrationProver.kt) — loads `identity_proof.circom` v1.2 and runs `snarkjs.groth16.fullProve`.

Public inputs:

- `commitment` — the Poseidon hash stored at enrolment.
- `session_nonce` — from the kiosk QR.
- `tenant_id_hash` — keccak256 of the tenant UUID, pinned at app build time per [`adr/0015-circuit-version-pinning.md`](../../adr/0015-circuit-version-pinning.md).

Private inputs:

- `secret` — the fuzzy-extractor output, decrypted from StrongBox.
- `salt` — the per-DID salt, written into app-private storage at enrolment.

The proof object posted to the server is approximately 256 bytes. The full request body — proof + public signals + `did` + `session_id` — is on the order of 1 KB.

**Operator says.**

> "On the phone right now: the Groth16 prover is solving the witness for circuit `cct-v1.2`. Public inputs are the commitment, the session nonce, and a hash of the tenant ID. Private inputs are the secret and the salt — neither of which has ever crossed the wire. The proof itself is 256 bytes."

### 3.5 Step 5 — Server verify + session (200 – 400 ms)

The app posts to `POST /v1/zkp/verify` ([source](../../src/routes/v1/zkp.ts)) with the live API key. The handler:

1. Looks up the user by `did`.
2. Asserts `publicSignals[0]` equals the stored `commitment`.
3. Runs `snarkjs.groth16.verify(vkey, publicSignals, proof)` against the boot-pinned vkey.
4. On success, mints a session via `src/services/session-store.ts`.
5. Appends an `auth.verify_success` row via `appendAuditEvent(...)` in [`src/services/audit.ts`](../../src/services/audit.ts) — the chained hash is computed in this call.
6. Publishes an SSE frame on the kiosk's pairing channel: `event: session.minted\ndata: {session_token, expires_at}\n\n`.

The kiosk's `EventSource` receives the frame, calls its `onSessionMinted` callback, and redirects to `/dashboard/anchor-bank/net-banking/` with the session token.

**Projector shows.** The kiosk page transitions to Mrs. Sharma's net-banking landing. Wall-clock latency from QR scan to landing: **1.0 – 1.5 seconds** on a healthy conference Wi-Fi; up to **2.5 s** on the Jio MiFi fallback.

### 3.6 Step 6 — The audit row (15 s)

**Operator switches to Tab 3 (Audit Events live).** A new row has just scrolled in:

```
event_type           : auth.verify_success
did                  : did:zeroauth:abc1...ef07
session_id           : sess_a1b2c3d4e5f6
proof_hash           : 0x7e3a...4f02
tenant_id            : <anchor-bank uuid>
environment          : live
previous_audit_hash  : 0x4f8b...c233
current_audit_hash   : 0x9e21...0f7a
created_at           : 2026-05-28T14:23:01.412Z
```

**Operator says (to the CISO directly).**

> "Look at the row. No SMS. No OTP. No PSTN traffic. The proof hash is bound to this specific session. The `previous_audit_hash` is the chain link — Scene 5 will show what happens when somebody tries to break the chain."

---

## 4. Audience-specific moments

### 4.1 What the CISO sees

The CISO's takeaway is not "fast login". It is: *no shared secret crossed the wire, and the audit row is cryptographically anchored to the previous row*. Operator stops at the audit row for **two beats** so the CISO can read it.

If the CISO asks where the verifier key came from: it is loaded at server boot from [`circuits/identity_proof_v1.2.vkey.json`](../../circuits/), pinned by SHA-256 in `src/config/`, and was generated by the multi-party trusted-setup ceremony documented in [`docs/cryptography/trusted-setup-ceremony.md`](../cryptography/trusted-setup-ceremony.md). If the binary changes between boots, the boot-time integrity check fails and the process refuses to start — see ADR 0007 vkey integrity (Phase 0 finding C-7).

### 4.2 What the CFO sees

Operator pivots to the CFO after the audit row is on screen.

> "For your retail book: 30 million active customers, average six OTPs per month, ₹0.20 per SMS. That's ₹43 crore per year in SMS gateway spend. The day this is in production for the customer cohort scoped in the pilot, that line item starts to zero out. The OTP delivery-failure rate — your call-centre's leading driver of inbound 'I didn't get the OTP' tickets — also goes to zero for this cohort."

If the CFO asks about Aadhaar fees, the operator references Scene 1 § 4.5 and does not re-litigate the arithmetic.

### 4.3 What the CRO sees

The CRO's moment is implicit in the no-SMS observation. The operator names it once:

> "SIM-swap as an attack vector against this customer's net-banking session is gone. There is no SMS, so there is nothing to intercept. The credential is the StrongBox-bound key on Mrs. Sharma's phone, gated by her biometric. To impersonate her, an attacker needs the phone *and* the biometric, simultaneously, in front of the kiosk."

Do not promise the CRO that all ATO is eliminated. Promise that the SIM-swap class is structurally removed.

### 4.4 What the CIO sees

The CIO's moment lands later in Scene 6 (teller workflow). In Scene 2, the operator only nods at infrastructure: no SMS gateway integration is needed for this customer surface — the kiosk integrates over HTTPS + SSE to the ZeroAuth tenant. No PSTN dependency, no telco MSA to renegotiate.

---

## 5. Required artefacts and owners

From [`02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § *Scene 2 — Required artefacts*:

| Artefact | Owner | Required by |
|---|---|---|
| Android app v1.0 — QR scan, rapidsnark / snarkjs WebView prover, BiometricPrompt-gated StrongBox key wrap. | Mobile (roles 17, 18, 19). | Phase 1 week 8. |
| `/v1/zkp/verify` endpoint — proof verification, session creation, audit row, SSE event. | Backend (roles 6, 8). | Phase 1 week 7. |
| Kiosk web app — QR generator + `EventSource` consumer + session-token landing. | Frontend (role 15). | Phase 1 week 7. |
| Hash-chained `audit_events` write path — `appendAuditEvent` in `src/services/audit.ts`. | Crypto + backend (roles 11, 8). | Phase 1 week 6. |
| Production-quality `Groth16Verifier` contract on Base Sepolia (used opt-in per ADR 0017). | Blockchain (role 25). | Phase 0 week 2. |
| `identity_proof.circom` v1.2 with completed trusted-setup ceremony. | Crypto (roles 11, 12). | Phase 1 week 10. |
| Boot-time vkey integrity guard. | Backend + crypto (roles 8, 11). | Phase 0 week 2 (closed by C-7). |

The pairing surface (`POST /v1/proof-pairing/sessions`, `GET /v1/proof-pairing/sessions/:id/events`, the `qr-proof-login` demo at `/dashboard/demos/qr-proof-login`) shipped in Wave-1 of Phase 1 — see commits referenced in [`docs/plan/bfsi-v1/04-commits.md`](../plan/bfsi-v1/04-commits.md).

---

## 6. Failure modes specific to Scene 2

The parent runbook covers generic failures in [`anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md) § 11. Scene 2's failure surface is narrower; the three modes below are the ones the operator drills the night before.

### 6.1 Kiosk SSE channel wedges

**Symptom.** The phone completes BiometricPrompt; the kiosk tab still spins on "awaiting authentication" for > 5 seconds.

**Diagnosis.** The server has already minted the session and written the audit row (Tab 3 will show the row inside a second). Only the kiosk's `EventSource` is wedged — usually a Caddy / reverse-proxy buffering issue on the conference Wi-Fi.

**Recovery.** Operator says: "While the SSE channel catches up, let me show you the audit row we already wrote on the server side." Switch to Tab 3, point to the new row. The verification is done; only the kiosk visual is stale. Then open a fresh kiosk tab and have the customer rescan; the second attempt usually completes inside 2 seconds.

### 6.2 Phone clock skew

**Symptom.** Server returns `proof_invalid` with `reason: expires_at_in_past` or `reason: session_nonce_expired`.

**Diagnosis.** The phone's clock is > 90 s out of sync. The session nonce includes `expires_at`; the prover binds it; the server rejects on stale.

**Recovery.** Settings → Date & time → toggle Automatic off and on. Re-attempt. If still skewed, swap to Pixel 7 slot B (which was time-synced during § 1.3 of the parent runbook).

### 6.3 Audit row not appearing in Tab 3

**Symptom.** Kiosk transitions to net-banking landing. Tab 3 (Audit Events) does not show a new row.

**Diagnosis.** The dashboard's own SSE stream on `/api/admin/audit-stream` is wedged. The row is in the database. Refresh Tab 3 with Cmd-R; the latest row will paginate in.

**Recovery.** Do not say "the audit row is missing". Say: "Let me refresh the audit view — production polls once per second, the conference network sometimes drops the stream." Cmd-R. The row appears.

---

## 7. Operator script — verbatim

The full Scene 2 script the operator memorises. Roughly 90 spoken words, plus the pause for the audit row. At a normal speaking pace this lands in 45 – 50 seconds, leaving 10 seconds of buffer in the 60-second budget.

> *(open kiosk tab)* "Mrs. Sharma walks up to a self-service kiosk in the branch lobby. The kiosk shows a QR with a one-shot session nonce — it expires in 90 seconds."
>
> *(hand phone to customer)* "Open ZeroAuth Banking. Tap Scan to log in. Point at the projector."
>
> *(during prove)* "On the phone right now: the Groth16 prover is solving the witness for circuit `cct-v1.2`. Public inputs are the commitment, the session nonce, and a hash of the tenant ID. Private inputs are the secret and the salt. The proof is 256 bytes."
>
> *(kiosk transitions, switch to Tab 3)* "No SMS. No OTP. No PSTN traffic. The audit row has a `previous_audit_hash` — that's the chain. Scene 5 demonstrates what happens when somebody tries to break it."
>
> *(pivot to CFO)* "For your retail book — 30 million active customers, six OTPs per month, ₹0.20 per SMS — that's ₹43 crore per year in SMS gateway spend. The day this is in production for the pilot cohort, that line item starts to zero."

Move directly into Scene 3 once the CFO has had two beats to read the audit row.

---

## 8. Exit gate

Scene 2 is considered exit-gate-ready when:

- [ ] A fresh kiosk QR is scanned, biometric unlocks, and the kiosk transitions to the net-banking landing in **≤ 1.5 s p95** on the demo network.
- [ ] The `auth.verify_success` row appears in Tab 3 within **≤ 1 s** of the kiosk transition.
- [ ] `previous_audit_hash` is non-null and matches the prior row's `current_audit_hash`. Verified by re-running `/api/admin/audit-integrity` between Scenes 2 and 3 during dry-run.
- [ ] Zero SMS gateway calls observed in the application logs for the duration of the scene.
- [ ] The Anchor Bank tenant's `verifier_provider` is `off-chain` per ADR 0017 — the on-chain re-verification is not on the Scene 2 critical path.
- [ ] `security-reviewer` has signed off on the pairing surface and the `/v1/zkp/verify` handler.
- [ ] The operator has rehearsed Scene 2 standing, on the demo network, with the demo phones, at least **three times** in the 48 hours before the demo.

---

LAST_UPDATED: 2026-06-01
OWNER: Agent #35 (writer-compliance) + Agent #45 (solutions architect)
