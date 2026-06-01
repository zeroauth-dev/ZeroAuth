# Bank demo — Scene 1: Customer enrollment

This is the operator-readable script for **Scene 1** of the Anchor Bank demo defined in [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md). It is the actionable elaboration of the five-minute "Mrs. Sharma walks into the branch" scene. Read the parent demo spec first; this file does not restate the narrative, only the operator actions.

Scene 1 is the opener. If it works, the rest of the demo lands. If it stalls, the room is lost. Treat the timings as hard budgets: an enrollment that runs over six minutes is a failed scene.

Cross-references:

- Demo runbook (umbrella for all six scenes): [`anchor-bank-demo-runbook.md`](anchor-bank-demo-runbook.md).
- Mobile enrollment pipeline source: [`mobile/biometric/`](../../mobile/biometric/), [`mobile/face/`](../../mobile/face/).
- Server endpoint: [`src/routes/v1/identity.ts`](../../src/routes/v1/identity.ts) — `POST /v1/identity/register`.
- ADR governing the off-chain default: [`adr/0017-blockchain-agnostic-posture.md`](../../adr/0017-blockchain-agnostic-posture.md).

---

## 1. Pre-conditions

The operator confirms each of these **before entering the room**. If any single item is red, Scene 1 will fail in front of the bankers — abort the day and reschedule.

### 1.1 Tenant state (run from operator laptop)

```bash
# 1. Anchor Bank live tenant exists and security_policy is on the demo profile
curl -s https://zeroauth.dev/api/admin/tenants/anchor-bank \
  -H "x-api-key: $ADMIN_API_KEY" | python3 -m json.tool
# Expect: tenant.id present; security_policy.did_provider in {"off-chain","base-sepolia"};
#         security_policy.verifier_provider="off-chain"; webhook_url set.

# 2. Empty users table for the anchor-bank tenant (clean slate)
curl -s "https://zeroauth.dev/v1/users?limit=5" \
  -H "x-api-key: $ANCHOR_BANK_LIVE_KEY" | python3 -m json.tool
# Expect: {"users": []}. If non-empty, run scripts/reset-demo-tenant.ts on the VPS.

# 3. Schema-purity invariant holds — no PII columns ever made it in
curl -s https://zeroauth.dev/api/admin/schema-purity \
  -H "x-api-key: $ADMIN_API_KEY"
# Expect: {"ok": true, "violations": []}.
```

### 1.2 Mobile device state

The customer phone (Pixel 7, "slot A") must boot into a known state. Run these checks via `adb` from the operator laptop the morning of:

```bash
# Phone reachable
adb devices | grep -v "List of"
# StrongBox advertised
adb -s <serial> shell dumpsys android.hardware.biometrics \
  | grep -iE 'strongbox|strongauth'
# ZeroAuth Banking app installed and on v1.0
adb -s <serial> shell dumpsys package dev.zeroauth.android \
  | grep versionName
# Camera + biometric permission granted (or "Not granted" — we grant on first launch)
adb -s <serial> shell dumpsys package dev.zeroauth.android | grep permission
# Wipe any stored DID from a previous run
adb -s <serial> shell pm clear dev.zeroauth.android
```

### 1.3 Network sanity (room Wi-Fi)

```bash
curl -s https://zeroauth.dev/api/health | python3 -m json.tool
# Expect: status=ok, db_ok=true. blockchain_ok may be false in off-chain default;
#         that is acceptable for Scene 1.
```

If conference Wi-Fi p50 latency to `zeroauth.dev/api/health` exceeds 200 ms, switch the laptop and the phone to the Jio MiFi before the demo starts. Brief the room in the opener.

### 1.4 Projection layout

| Window | Source | URL / command |
|---|---|---|
| Left (60 %) | Dashboard | `https://zeroauth.dev/dashboard/anchor-bank/tenant/users` |
| Right top | Live audit stream | `https://zeroauth.dev/dashboard/anchor-bank/tenant/audit` |
| Right bottom | Basescan DIDRegistry (only if `did_provider != off-chain`) | `https://sepolia.basescan.org/address/<DIDRegistry-address>` |
| Off-screen / cmd-tab | Operator terminal with `tail -f` on server logs (only if needed for Failure Recovery) | `ssh zeroauth-deploy@104.207.143.14 'sudo journalctl -fu zeroauth-api'` |

The phone screen is mirrored via scrcpy at 1080×2400:

```bash
scrcpy -s <serial> --max-size 1080 --window-title "Customer Phone" \
       --window-x 1280 --window-y 100
```

Place the scrcpy window on the right half of the projection during the face-capture step. **Move it off-screen during the secret/commitment computation** — the bankers should not see SHA-256 hex blobs scroll by.

### 1.5 Operator checklist (initial each line on the printed copy)

- [ ] Anchor Bank live key in clipboard manager, slot 1.
- [ ] Admin x-api-key in clipboard manager, slot 2.
- [ ] DEMO\_PIN sticky note removed from the laptop.
- [ ] Dashboard refreshed; the "Users" table shows zero rows for this tenant.
- [ ] Phone in airplane-mode-off, Wi-Fi on the demo SSID, battery > 80 %.
- [ ] Pretend customer briefed: "When the QR appears, scan it. Then look at the camera. Then touch the fingerprint sensor."

---

## 2. Step-by-step

Total budget: **300 seconds** (five minutes), from "Mrs. Sharma sits down" to "her row appears on the dashboard". Per-step budgets are conservative; the demo should run a minute under.

### Step 1 — Operator displays the onboarding QR (15 s)

**Operator says:** "Mrs. Sharma is opening a savings account. She has already cleared KYC in DigiLocker. Watch what the bank now asks her to do."

**Operator action:** On the projection, click *Dashboard → Demos → Onboarding kiosk* (or the deep link `https://zeroauth.dev/dashboard/anchor-bank/demos/onboarding`). A QR appears, encoding:

```json
{
  "tenant_id": "anchor_bank",
  "environment": "live",
  "enroll_session": "<random 32-byte nonce>",
  "expires_at": "2026-06-01T10:35:00Z"
}
```

**Screenshot label:** `S1-01-onboarding-qr.png` — QR in the centre of the projection, Anchor Bank logo above it, "Open your ZeroAuth Banking app and scan" caption.

### Step 2 — Customer scans the QR (15 s)

**Operator hands the phone to the pretend customer.** The customer taps the in-app **Enroll** button; the camera opens to a QR viewfinder. They aim at the projection. The app captures the QR, parses it, and shows a confirmation sheet: "Anchor Bank — enroll this device". The customer taps **Continue**.

**Screenshot label:** `S1-02-app-qr-confirmation.png` — phone screen showing the bank name and the masked enroll-session prefix.

### Step 3 — Face capture (CameraX + ML Kit on-device) (30 s)

**Operator says:** "Watch the phone screen. The camera is going to take a face image. The image never leaves the phone."

The app opens the front camera, draws an oval guide, waits for ML Kit face-detection to confirm a centred face with both eyes open, then takes the still. The still is converted to a 128-dim TFLite MobileFaceNet embedding in `FaceEmbedder.kt`; the image bytes are zeroed immediately after.

**Screenshot label:** `S1-03-face-capture.png` — phone screen with the oval guide and a green "Face captured" tick.

If the camera struggles (poor light, glasses glare), see [Failure Mode F2](#f2--face-capture-stalls).

### Step 4 — Fingerprint capture (BiometricPrompt or R307) (20 s)

**Operator decision:** if the R307 sensor is on the table, hand it to the customer on its mounting bracket. Otherwise the app falls back to Android **BiometricPrompt** and the device's own fingerprint sensor on the back of the Pixel.

The customer rests a finger on the sensor. The app reads the template (either R307 frame or BiometricPrompt result), hashes it on-device, and immediately zeroes the source buffer.

**Screenshot label:** `S1-04-fingerprint.png` — phone screen with a fingerprint icon mid-animation.

### Step 5 — On-device secret + commitment (5 s, no UI to point at)

This step is invisible to the room — point at the projector for the next ten seconds while it runs.

What happens inside the phone:

1. `Quantizer.kt` produces a deterministic 256-byte int16 BE buffer from the embedding.
2. `Sha256.kt` hashes that buffer to a 32-byte secret; the input buffer is zeroed.
3. `Poseidon.hash2(secret, salt)` produces the 32-byte commitment as a BN128 field element. Byte-identical to `circomlibjs.poseidon2`.
4. `Keccak256(commitment)[:20]` produces the DID suffix.
5. The DID `did:zeroauth:<40-hex>` is shown briefly on the phone for two seconds before the registration screen.

**Operator says (filler while step runs):** "The face embedding and the fingerprint template just became a 32-byte commitment. From this commitment, you cannot reconstruct the face or the fingerprint. The phone has not yet contacted our server."

### Step 6 — DID registration call (3 s)

The phone posts `{ did, commitment, attestation }` to the tenant's `/v1/identity/register`. The operator can side-show the equivalent curl on the dashboard's **Developer console** tab if the room is technical:

```bash
curl -X POST https://zeroauth.dev/v1/identity/register \
  -H "x-api-key: za_live_<redacted>" \
  -H "content-type: application/json" \
  -d '{
        "did": "did:zeroauth:8f2c19a0b8e74d4b1f9c0c6c0a1e3f1e8a9c2b7d",
        "commitment": "0x1c3e9b8a7f6d4e2c0b1a9f8e7d6c5b4a39281706f5e4d3c2b1a09817263544536",
        "externalId": "anchor-bank-cust-000001",
        "attestation": { "playIntegrity": "...", "keyAttestation": "..." }
      }'
```

Server response (status 201):

```json
{
  "userId": "01J5K9T9F8YQ2RZN8X3VWP4D7H",
  "did": "did:zeroauth:8f2c19a0b8e74d4b1f9c0c6c0a1e3f1e8a9c2b7d",
  "commitment": "0x1c3e9b8a7f6d4e2c0b1a9f8e7d6c5b4a39281706f5e4d3c2b1a09817263544536",
  "createdAt": "2026-06-01T10:35:43.214Z"
}
```

**Screenshot label:** `S1-05-registration-201.png` — terminal showing the 201 JSON; circle the `commitment` field.

If the tenant's `security_policy.did_provider` is `base-sepolia` (the operator may have chosen this profile for a CRO who wants on-chain proof), the server also broadcasts `DIDRegistry.register(did, commitment)` and returns the tx hash in `metadata.anchor_tx_hash`. If the tenant is `off-chain` (the default), no chain call happens — call this out to the room.

### Step 7 — Dashboard updates (5 s)

**Operator action:** switch focus to the dashboard "Users" view. A row appears at the top with four columns visible:

| Column | Example value |
|---|---|
| `did` | `did:zeroauth:8f2c19a0…b7d` |
| `commitment` | `0x1c3e9b8a…44536` |
| `created_at` | `2026-06-01 10:35:43` |
| `external_id` | `anchor-bank-cust-000001` |

**Screenshot label:** `S1-06-users-row.png` — the new row highlighted, dashboard right-rail showing "No PII columns in this table".

**Operator clicks the row.** A drawer opens showing the same four fields plus `enrollment_audit_id`. **No** name, **no** face image, **no** fingerprint, **no** email, **no** PAN, **no** Aadhaar. This is the moment the CISO leans forward — wait two beats before speaking.

**Operator says:** "That is everything our database knows about Mrs. Sharma. There is no name field. There is no biometric field. The 64-character commitment is a field element; you cannot work backward from it to her face."

### Step 8 — Audit stream confirmation (5 s)

**Operator points at the right-top window.** A new row has streamed in:

```json
{
  "id": 8421,
  "action": "identity.register",
  "target_type": "user",
  "summary": "Face-first identity registered for DID did:zeroauth:8f2c…",
  "previous_hash": "9c1b8a7f…",
  "event_hash": "4e2c0b1a…",
  "created_at": "2026-06-01T10:35:43.281Z"
}
```

**Operator says:** "The audit row is hash-chained. The `event_hash` here is the input to the next row's `previous_hash`. We will come back to that chain in Scene 5."

### Step 9 — On-chain anchor (optional, 10 s)

Only if `did_provider = base-sepolia`. **Operator switches to the Basescan tab.** The `DIDRegistry.register` transaction is confirmed (Base Sepolia ~2 s block time). **Operator clicks the tx hash.** Etherscan-style page shows the `(did, commitment)` arguments on chain.

**Screenshot label:** `S1-07-basescan-anchor.png` — Basescan tx confirmation page with the DID highlighted in the input data.

If `did_provider = off-chain`, skip this step. **Operator says instead:** "We default to the off-chain provider — no blockchain dependency. The tenant can switch to Base Sepolia or Base mainnet via `security_policy.did_provider` at any time, and re-anchor backfill kicks in. ADR 0017."

### Step 10 — Duplicate-enrollment rejection (15 s)

**Operator says, turning to the CRO:** "What if Mrs. Sharma is impersonated and someone tries to enroll her DID on a different phone?"

**Operator triggers (on the cold-spare Pixel "slot B"):** scan the same QR, run the same face + finger flow, attempt to post the same DID. The server returns:

```http
HTTP/1.1 409 Conflict
content-type: application/json

{
  "error": "did_already_registered",
  "message": "This DID is already registered for this tenant."
}
```

**Screenshot label:** `S1-08-409-conflict.png` — the 409 response, the phone showing "Enrollment rejected — DID already taken on this device".

**Operator says:** "The DID is bound to the first device. The duplicate is rejected at the API boundary, before any chain interaction. The audit row for the attempt is also written — it is the second-newest row in the audit stream now."

### Step 11 — Operator handoff (10 s)

**Operator hands the phone back to the customer, turns to the room.** "Enrollment is done. Total wall-clock: about ninety seconds of customer interaction, plus a few seconds of confirmation. That is the bank's last UIDAI hit for Mrs. Sharma until her next physical KYC refresh."

**Total Scene 1 elapsed time:** target 3:30, hard ceiling 5:00.

---

## 3. Failure modes

These are the failure modes observed during Phase 1 dress rehearsals. Each has a recovery in Section 4.

### F1 — QR not scanned

Symptom: in-app scanner does not lock within 10 s. Causes: projector glare, QR too small, camera permission denied, stale APK that cannot parse the v2 QR payload.

### F2 — Face capture stalls

Symptom: oval guide stays red; ML Kit returns no face. Causes: glasses + projector glare confuse ML Kit; camera permission silently denied; CameraX failed to bind the front camera after an earlier run.

### F3 — Fingerprint capture fails

Symptom: R307 dark, or BiometricPrompt returns `BIOMETRIC_ERROR_HW_UNAVAILABLE` / `NONE_ENROLLED`. Causes: USB-OTG cable seated half-way; no OS biometric enrolled after factory reset; R307 firmware locked.

### F4 — `/v1/identity/register` returns 5xx

Symptom: phone shows "Server error". Causes: DB pool saturated, Play Integrity upstream soft-failing, rate-limit bucket exhausted from a prior rehearsal.

### F5 — `/v1/identity/register` returns 401 / 403

Symptom: phone shows "Authentication failed". Cause: API key on the phone is revoked, wrong env (`test` vs `live`), or fingerprint-mismatched.

### F6 — `/v1/identity/register` returns 409 on the first attempt

Symptom: `did_already_registered` on Mrs. Sharma's first enrollment. Cause: a prior rehearsal left a row that the reset script did not clean, **or** the phone's cached salt collides with a previous run. Visible failure — the dashboard's users table is non-empty before Step 7.

### F7 — Anchor tx never confirms (only when `did_provider != off-chain`)

Symptom: 201 returned with `anchor_tx_hash` but Basescan shows "pending" > 30 s. Cause: Base Sepolia block delay, deployer out of testnet ETH, or stale gas oracle.

### F8 — Webhook for `user.enrolled` does not fire

Symptom: dashboard row appears but the bank's CRM listener (Scene 6 prop) gets no event. Cause: webhook URL misconfigured; secret rotated; outbound from VPS blocked by conference Wi-Fi.

### F9 — Phone runs out of battery mid-flow

Self-explanatory. The cold-spare Pixel is on the table for exactly this.

### F10 — Scrcpy window freezes

Symptom: the "Customer Phone" mirror window goes black or frozen. Cause: USB cable jiggled loose, `adb` daemon crashed, or scrcpy fps backed off under network contention.

---

## 4. Recovery

For each failure mode in Section 3, the operator has **one** recovery action they may take **inside the demo** without exiting the scene. If that fails, the operator switches to the fall-through script (Section 4.X) and recovers off-stage.

| Mode | First recovery (in-scene) | Fall-through | Time cost |
|---|---|---|---|
| F1 | Tilt phone, ask customer to step closer to the projection. Re-display QR at 2× size from the dashboard kebab menu → "Bigger QR". | Switch to the operator's own phone (slot B) with the QR cached. | +20 s |
| F2 | Operator asks the customer to remove glasses, switches the laptop projector to its highest brightness via Fn+F2. | Skip face, fall back to fingerprint-only enrollment (the app supports this for branch-assisted flows). | +30 s |
| F3 | Re-seat R307 USB-OTG cable; if that fails, tap **Use device sensor** on the in-app prompt to switch to BiometricPrompt. | Use BiometricPrompt. If the OS biometric is also empty: switch to slot B. | +30 s |
| F4 | Retry once. If the second attempt also 5xx's, switch to slot B with a fresh enrollment session (steps 1-2 again). | If both phones 5xx: end Scene 1 honestly — "we're seeing a backend hiccup, I'll show you the dashboard from a pre-recorded enrollment from this morning". Cut to the recorded screencap at `docs/operations/assets/scene-1-fallback.mp4`. | +45 s |
| F5 | Open dashboard → API keys → confirm the live key fingerprint matches the on-phone profile. If mismatch: re-paste the live key into the onboarding profile, redeploy via the in-app "Re-enroll device" button. | If mismatch persists: page the backend on-call. End scene with the recorded screencap. | +60 s |
| F6 | Run `curl -X POST https://zeroauth.dev/api/admin/tenants/anchor-bank/reset-demo-state -H "x-api-key: $ADMIN_API_KEY"` from the operator terminal. This deletes the Anchor Bank users + device_registrations rows (only for this demo tenant). Re-run from Step 1. | If reset endpoint is rate-limited: ssh into the VPS and run `tsx scripts/reset-demo-tenant.ts anchor_bank` directly. | +45 s |
| F7 | Note the pending tx on Basescan, then move on. The 201 has already returned to the phone; the dashboard row is already populated. Anchor confirmation happens in the background. | If room is watching the Basescan tab: switch the projection to the dashboard tab and continue. | +0 s |
| F8 | Webhook is a Scene 6 prop, not a Scene 1 prop. Note it for Scene 6 recovery. | n/a in Scene 1. | +0 s |
| F9 | Hand the customer slot B (already prepped) and continue from Step 2. | If slot B is also drained: use the operator's phone with the cached enrollment profile. | +20 s |
| F10 | Disconnect USB, reconnect, `scrcpy -s <serial>` again from the laptop terminal (Cmd-Shift-T to open a new tab). | If scrcpy persistently dies: rotate the phone toward the room so the customer's screen is directly visible. Slower, but works. | +20 s |

**Hard stop rule.** If two consecutive failures fire in Scene 1 (e.g. F4 then F6), **end Scene 1 immediately**, switch to the Scene 2 opener with the pre-enrolled Mrs. Sharma profile (`mrs-sharma-prebaked@anchorbank.in`), and continue. Do not burn more than seven minutes of room time on Scene 1.

---

## 5. Success criteria

Scene 1 is considered successful when **all** of the following are true at the end of Step 11:

- [ ] A new row exists in the Anchor Bank tenant's `users` table, exposing only `did`, `commitment`, `created_at`, `external_id`, `enrollment_audit_id`. No PII columns visible in the dashboard drawer.
- [ ] A new row exists in `audit_events` with `action='identity.register'`, valid `previous_hash` (matching the prior terminal hash for this tenant), and valid `event_hash`.
- [ ] The phone displays "Enrollment complete" and the in-app DID screen shows a `did:zeroauth:...` matching the dashboard row.
- [ ] If `did_provider = base-sepolia`: the Basescan tab shows the `DIDRegistry.register` tx confirmed within 30 s.
- [ ] If `did_provider = off-chain`: the dashboard row drawer notes "Off-chain DID provider — no chain anchor" and the operator has called this out to the room.
- [ ] The duplicate-enrollment 409 was observed by the room (Step 10).
- [ ] Total scene wall-clock from Step 1 to Step 11 ≤ 5:00.
- [ ] No 5xx error appeared in the projected terminal at any point.
- [ ] The operator did not say any of the banned phrases ("AI-powered", "deepfake-immune", "production stack", "Dr. Pulkit") at any point in Scene 1.
- [ ] At least one banker (target: CISO) has visibly leaned forward at Step 7 (the empty-PII drawer) — the operator notes this in the post-demo debrief.

If any of the first six items is false, Scene 1 is a **failed scene** and must be flagged in the post-demo debrief at [`docs/operations/anchor-bank-demo-runbook.md` §13](anchor-bank-demo-runbook.md). The flag triggers a regression test addition in `tests/scene-1-enrollment.test.ts` before the next demo.

---

LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek (engineering) + demo operator on rotation
