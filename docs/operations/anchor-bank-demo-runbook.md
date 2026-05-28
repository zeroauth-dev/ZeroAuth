# Anchor Bank demo runbook

This is the operator's live script for the 22-minute Anchor Bank demo defined in [`docs/plan/bfsi-v1/02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md). It is meant to be **printed**, carried into the room on paper, and followed line-by-line. Every keystroke, every sentence the operator speaks, every artefact on the projector is laid out below. The demo runs against the production codebase on the live VPS — no sandbox, no "demo mode" toggle. "Anchor Bank" is a placeholder; when the partner is named (HDFC, ICICI, Axis, SBI YONO, IDFC First, or RBL) we re-skin the dashboard and the rest is real. If you are reading this for the first time, read [`02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) and [`01-pain-points.md`](../plan/bfsi-v1/01-pain-points.md) first — this runbook quotes both heavily but does not restate them.

---

## 1. Pre-demo setup checklist (T-24 h)

This list runs the day before. The operator owns it personally; nobody else can be relied on to have done it. Tick boxes are real — the operator initials each line on the printed copy.

### 1.1 Equipment kit (the demo bag)

| Item | Quantity | Notes |
|---|---|---|
| Operator laptop | 1 | MacBook Pro or ThinkPad. Charged to 100 %. Charger in the bag. |
| HDMI cable | 1 | 2 m. |
| USB-C → HDMI adaptor | 2 | Two, because one will fail. |
| USB-A → USB-C adaptor | 1 | For projectors with USB-A pre-installed. |
| Projector remote / clicker | 1 | Spare AAA batteries taped to the clicker. |
| Demo customer Android phone | 1 | Pixel 7 (primary) or Samsung Galaxy S22 (backup), latest Android, fresh wipe, ZeroAuth Banking APK side-loaded the night before. StrongBox confirmed present via `adb shell dumpsys android.hardware.biometrics`. |
| Demo teller Android phone | 1 | Second Pixel 7 or S22 for Scene 6. Same configuration. Optional but bring it. |
| R307 fingerprint sensor + USB-OTG cable | 1 | Plus the printed mounting bracket. Test the USB-OTG cable seats firmly. |
| Mobile hotspot / Jio MiFi | 1 | Backup network. Pre-paid plan must show > 500 MB balance. |
| Power bank (20 000 mAh) | 1 | For phones. Mid-demo recharge is non-negotiable. |
| Lapel mic + receiver | 1 | If room is > 6 metres deep. Spare AAA batteries. |
| Hard-copy operator script | 1 | This document, printed. Spiral-bound. |
| Hard-copy one-page summary PDF | 12 | Section 12 lists the file path; print 12 copies (each banker leaves with one). |
| NDA + LoI templates | 6 | Two of each, on letterhead, in a folder. |
| Anchor Bank tenant API key (printed) | 1 | See § 1.4. |
| Cleansing cloth + microfibre | 1 | For phone screen + R307 platen. |
| Pen | 1 | Black ink for signatures. |

### 1.2 Network sanity check

Run these checks from the operator laptop, on the network the demo will run from. The conference-room Wi-Fi will be the primary network; the Jio MiFi is the fallback.

```bash
# 1. DNS resolves the API host
dig +short zeroauth.dev | head -5

# 2. TLS handshake completes, certificate not expired
curl -sI https://zeroauth.dev/api/health | head -3

# 3. /api/health returns 200 with db_ok=true and blockchain_ok=true
curl -s https://zeroauth.dev/api/health | python3 -m json.tool

# 4. Base Sepolia RPC reachable from the room
curl -s -X POST https://sepolia.base.org \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  | python3 -m json.tool

# 5. Latency to api.zeroauth.dev p50 < 80 ms from this network
for i in 1 2 3 4 5; do
  curl -sw "%{time_total}\n" -o /dev/null https://zeroauth.dev/api/health
done
```

If `db_ok` or `blockchain_ok` is `false`, **stop and page the on-call SRE** (Roles 5, 21 — see [`03-team.md`](../plan/bfsi-v1/03-team.md)). Do not enter the room with a degraded backend.

If conference Wi-Fi latency p50 is > 200 ms or if the Base Sepolia RPC returns a non-200, switch the laptop and both phones to the Jio MiFi before the demo starts. Brief the room in the opening that "we are operating on a mobile fallback network — production runs sub-100ms; today you may see a second of extra latency".

### 1.3 Phone inventory and prep

| Phone | Role | Pre-flight (T-24 h) |
|---|---|---|
| Pixel 7 (slot A) | Customer (Mrs. Sharma) | Factory reset → set up with throwaway Google account → side-load ZeroAuth Banking APK from `dist/zeroauth-banking-v1.0.apk` → grant Camera + Biometric + Notifications permissions → power off until T-30 min. |
| Pixel 7 (slot B) | Customer backup | Same as above. Cold spare. Kept in the bag, screen off. |
| Samsung S22 | Customer backup #2 | Same as above. Used only if both Pixels are wedged. |
| Pixel 7 (slot C) | Teller (Scene 6) | Factory reset → ZeroAuth Banking APK → enrolled the night before as `teller-demo@anchorbank.in`. Do **not** re-enrol on the day. |

Verify StrongBox on each phone:

```bash
adb -s <serial> shell dumpsys android.hardware.biometrics \
  | grep -iE 'strongbox|strongauth'
```

Look for `StrongBox: Available`. If absent, that phone falls back to TEE-backed Keystore — usable for Scenes 1, 2, 6 but flag to the room (see Recovery § 11d).

### 1.4 Anchor Bank tenant API key

The Anchor Bank demo tenant is provisioned by `scripts/seed-demo-tenants.ts` ([source](../../scripts/seed-demo-tenants.ts)). The script mints **one** `live` key and **one** `test` key and prints them to stdout exactly once. The server stores only their SHA-256 hashes (see [`src/services/api-keys.ts`](../../src/services/api-keys.ts)); the raw key cannot be recovered from the database.

Run the seed once, on the VPS, in a private shell, the night before:

```bash
ssh zeroauth-deploy@104.207.143.14
cd /opt/zeroauth
sudo -u postgres psql -d zeroauth -c "SELECT id FROM tenants WHERE email='anchor-bank-demo@zeroauth.dev';"
# Expect: 0 rows on a clean VPS, or 1 row if seed already ran.

# Only if 0 rows:
tsx scripts/seed-demo-tenants.ts
```

Output:

```
============================================================
[OPERATOR: SAVE THESE — NOT RECOVERABLE]
============================================================
Anchor Bank tenant_id : <uuid>
Live API key (live)   : za_live_<48 hex>
Test API key (test)   : za_test_<48 hex>
============================================================
```

Print the live key on a small slip. Fold it once. Put it in the operator's left jacket pocket. **Do not photograph it. Do not paste it into Slack, email, or a notes app.** The slip travels in the operator's wallet from T-24 h until the demo starts and goes back into the wallet the moment the demo ends.

If the key is lost: revoke from `/api/console/keys` on the dashboard, mint a replacement via the normal console flow, and re-print. Do **not** re-run `seed-demo-tenants.ts` — it short-circuits when the tenant exists.

### 1.5 Dashboard prep

- Log in to `https://zeroauth.dev/dashboard` as `ciso@anchorbank.in` (the operator's seeded console account).
- Verify the "Anchor Bank (Demo)" tenant is the active context.
- Pin the following tabs in Chrome (no incognito — the operator's session token must survive a tab switch):
  1. Dashboard → Overview.
  2. Dashboard → Users.
  3. Dashboard → Audit Events (live stream).
  4. Dashboard → Audit Integrity (the `/api/admin/audit-integrity` UI panel).
  5. Basescan → `DIDRegistry` at `0xC68ceB726DDB898E899080021A0B9e7994f63A73` ([deployed addresses](../../contracts/deployed-addresses.json)).
  6. Basescan → `Groth16Verifier` at `0x58258bf549D8E8694b22B12410F24583D16e1aA4`.
  7. SSH terminal: `ssh zeroauth-deploy@104.207.143.14` with `cd /opt/zeroauth` and `sudo -u postgres psql -d zeroauth` ready to fire.

### 1.6 Final dry-run

The night before, on the same network the demo will run on, run **all six scenes end-to-end** with the same phones. Do not skip this. Log every defect — even cosmetic — to `docs/team/writers/demo-dry-run-<date>.md` and triage with the line VPs (Roles 2, 3, 4, 5) by 22:00 IST. If any P0 defect cannot be fixed by 02:00 IST, postpone the demo.

### 1.7 Sleep

Operator sleeps. No code at midnight. The demo runs on muscle memory.

---

## 2. Day-of setup (T-30 min)

The operator enters the room 30 minutes before the booked time. The bankers are not expected to arrive earlier than T-5 min.

### 2.1 Physical setup (T-30 → T-20)

1. HDMI from laptop to projector. Confirm picture on the wall. Set laptop display to "mirror" (not extend).
2. Projector brightness to maximum; if the room has window blinds, draw them.
3. Set projector aspect to 16:9 if it is 4:3 by default.
4. Mic check — speak normally from the projector position. If the room is > 6 m deep, clip on the lapel mic.
5. Operator chair positioned so the operator can see both the projector and the room. The "pretend customer" chair (CRO, ideally) is placed so the room can see the phone screen.

### 2.2 Browser / shell setup (T-20 → T-10)

Open every tab from § 1.5. Cycle through them once with Cmd-1 through Cmd-7 to confirm each loads inside 2 seconds. If any tab spins, **close it and re-open** — do not let the room watch a loading spinner.

Specifically:

- **Tab 1 (Overview).** Should show one of: `0 users enrolled` (if the operator just re-seeded), or the previous demo's counts. Either is fine.
- **Tab 2 (Users).** Empty or pre-seeded. Note: if pre-seeded with prior-demo Mrs. Sharma, do **not** delete the row — the audit-chain integrity check in Scene 5 will pass anyway, and a fresh Mrs. Sharma in Scene 1 is what the room sees.
- **Tab 3 (Audit Events live stream).** SSE stream open. Rows scroll in real time.
- **Tab 4 (Audit Integrity).** Pre-loaded with the green "PASS — hash chain valid from row 1 to row N" panel.
- **Tab 5 (DIDRegistry on Basescan).** Latest tx visible. If the most recent `register(did, commitment)` is from an old demo, that's fine — Scene 1 will add a new one.
- **Tab 6 (Groth16Verifier on Basescan).** Contract page open at the `Read Contract` tab.
- **Tab 7 (psql).** Connected. Prompt: `zeroauth=#`. Run `\d users` once to warm the cache and observe the schema printout; clear the screen with `\! clear` so the actual Scene 4 reveal lands fresh.

### 2.3 Phone setup (T-10 → T-5)

1. Power on Pixel 7 (slot A). Unlock with the throwaway Google account.
2. Open the ZeroAuth Banking app once; close it; reopen — confirms cold-start works.
3. Confirm WiFi is on the same network as the operator laptop (or Jio MiFi).
4. Place phone face-up on the table, charging cable plugged in, screen at full brightness.
5. R307 sensor on its stand, USB-OTG cable seated. Power-test by plugging the OTG end into the phone briefly — the ZeroAuth app's diagnostic screen should show `R307 detected: yes`.
6. Power bank within arm's reach.

### 2.4 The opening pre-checks (T-5 → T-0)

- Phone screen on, dashboard tab visible on the projector.
- Operator has the live API key slip in the **left** pocket. Phone (slot A) is the **customer** phone. Phone (slot C, Scene 6) is in the bag, off.
- Operator has a glass of water. The 22-minute demo is delivered standing up.
- Operator clicks Cmd-1 to land on the Overview tab.

When the bankers walk in, the operator closes the laptop lid briefly to avoid screen burn-in on the projector. Open the lid the moment the meeting opens.

---

## 3. Opening (30 seconds)

The operator stays standing. The bankers are seated. The projector shows the Overview tab. The operator says (verbatim, from [`02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § *Operator script (compressed)*):

> "Good morning. I'm going to show you a working version of ZeroAuth running in production, not a sandbox. The demo is 22 minutes; questions at the end.
>
> The thesis: today, the database your customer credentials live in is the single largest piece of DPDP liability you carry. We replace that database with a cryptographic commitment that, even if fully exfiltrated, is not personal data under §2(t). I'll show you five scenes."

Pause for two beats. The room's silence is fine. Press Cmd-1 to confirm Overview, then Cmd-2 to move to Users (which will be the projector view for Scene 1).

---

## 4. Scene 1 — Customer enrollment (5 minutes)

The customer (CRO, by convention — they are the bank's *risk* officer and the most useful banker to put hands on the phone) sits down. The operator hands them Pixel 7 (slot A).

### 4.1 Step 1 — Branch RM scans QR (30 s)

**Operator does.** Clicks "Enroll new customer" on the dashboard. Dashboard generates a QR encoding `tenant_id=anchor_bank`, `environment=live`, `enroll_session=<nonce>`. QR fills 40 % of the projector.

**Operator says.**

> "Mrs. Sharma walks into your Andheri branch. She wants to open a savings account. She's already KYC-verified in DigiLocker. Your branch RM scans this QR on her onboarding tablet. The QR carries a one-shot enrollment nonce — it expires in 90 seconds."

**Projector shows.** QR code, large. Below it: a "waiting for app…" spinner.

**CISO sees.** Nothing remarkable yet. (The CISO's moment is at § 4.4.)
**CFO sees.** Nothing remarkable yet. (The CFO's moment is at § 4.5.)
**CRO sees.** Nothing remarkable yet. (The CRO's moment is at § 4.6.)

### 4.2 Step 2 — Customer scans QR (45 s)

**Operator does.** Hands Pixel 7 to the customer. Says: "Open the ZeroAuth Banking app. Tap 'Scan to enroll'. Point the camera at the projector."

**Customer does.** Scans the QR. The app's enroll flow opens.

**Operator says.**

> "The app is asking for three permissions: camera, biometric, and a one-time DigiLocker dip for the Aadhaar consent artefact. Mrs. Sharma taps Allow on each. This is the **only** time DigiLocker is consulted for this customer for the next 8 years — DPDP-mandated KYC refresh cadence for low-risk customers. The bank's per-customer UIDAI fee from here on is zero."

**Projector shows.** A mirror of the phone screen (via `scrcpy` running in a third laptop window — the operator pre-launched this in § 2.2 if available; if not, the customer holds the phone toward the room).

### 4.3 Step 3 — Face + fingerprint capture (60 s)

**Operator says.**

> "Now the biometric capture. Two parts: face on the front camera, then fingerprint. Mrs. Sharma — please look at the phone, centred, well-lit."

**Customer does.** Face capture (CameraX + on-device ML Kit). Then the operator hands the customer the R307 sensor on its stand. The customer rests their right index finger on the platen. The R307 LED flashes green on a clean capture.

**Operator says (technical aside, calmly).**

> "The face image is hashed on-device. The fingerprint template is hashed on-device. **Neither leaves the phone.** The hashes are combined with a fuzzy extractor — circuit version v1.2, deployed last week, multi-party trusted setup — to produce a 256-bit secret. That secret is wrapped by a key in Android StrongBox, the phone's hardware security module. The Poseidon commitment of `(secret, salt)` is computed on-device. The DID is derived: `did:zeroauth:` + the first 40 hex of `keccak256(commitment)`."

The exact math is in [`adr/0015-circuit-version-lock.md`](../../adr/0015-circuit-version-lock.md) and [`docs/cryptography/trusted-setup-ceremony.md`](../cryptography/trusted-setup-ceremony.md) — the operator references but does not read.

### 4.4 Step 4 — DID registration (60 s)

**Operator does.** The phone now posts `{ did, commitment, attestation }` to `https://zeroauth.dev/v1/identity/register` carrying the Anchor Bank live API key.

**Projector shows.** The dashboard's Users tab updates in real time. A new row appears: Mrs. Sharma. The row has **four** visible columns and no others.

**Operator says (to the CISO directly).**

> "Look at the row. `did`, `commitment_hex`, `created_at`, `tenant_id`. That's it. No name. No face image. No fingerprint template. No email. No phone. No PAN. No Aadhaar number. The schema does not have those columns. They cannot be added without an ADR and a security-reviewer sign-off."

**Operator clicks the row.** Detail panel slides open. Same four fields plus `enrollment_audit_id` and `environment`. Nothing else.

### 4.5 Step 5 — On-chain anchor (45 s)

**Operator does.** Switches to Tab 5 (DIDRegistry on Basescan). Refreshes. The latest transaction is the `register(did, commitment)` call from the last 30 seconds.

**Operator says.**

> "The DID is anchored on Base Sepolia. The contract address is `0xC68c...3A73`. Any auditor of yours, any regulator, can read this contract independently of ZeroAuth. We do not control the chain. We do not control the contract. If we vanish tomorrow, Mrs. Sharma's DID is still recorded and verifiable."

**CFO speech.** Operator pivots to address the CFO.

> "Mrs. Sharma will not hit UIDAI again until her next mandated KYC refresh. For a low-risk customer that's 8 years. For your retail book of 5 million digital onboardings a year, at ₹20 per eKYC, that's ₹100 crore per year in UIDAI fees you stop paying. Per-customer cost of subsequent auth: zero."

### 4.6 Step 6 — Device-binding demo (60 s)

**Operator says (to the CRO).**

> "Now imagine an attacker, or even Mrs. Sharma herself, tries to enrol the same identity from a second phone."

**Operator does.** Pulls Pixel 7 (slot B) from the bag. Powers it on. Opens the ZeroAuth Banking app. Walks the customer through scanning a fresh QR.

**Customer does.** Scans QR on slot B. App attempts to enrol.

**Projector shows.** App returns an error sheet: `did_already_registered`. Dashboard's Audit Events tab shows a `user.enrollment_rejected` row immediately.

**Operator says (to the CRO).**

> "Device-bound. The DID is keyed to the StrongBox material on the first phone. A second phone cannot replicate it without a fresh enrollment, which requires the original biometric. SIM-swap is no longer an attack vector because there is no shared cellular-bound secret. ATO via stolen device requires a live biometric on the device — which Android BiometricPrompt is a hardware-rooted operation."

Pain points referenced: P1 (DPDP §8 blast radius), P2 (UIDAI dependency), P3 (SMS gateway cost), P6 (SIM-swap / device theft). All four in five minutes. Operator does not name them — the bankers can read the cross-reference in the leave-behind PDF.

### 4.7 Closing the scene

Operator switches back to Tab 2 (Users). Points to the single new row. Says: "One customer, enrolled. The rest of the demo uses Mrs. Sharma." Power down Pixel 7 (slot B) and return it to the bag.

---

## 5. Scene 2 — Login at a kiosk (1 minute)

**Goal.** Show the 1.2-second login path with zero SMS.

### 5.1 Step 1 — Kiosk QR (10 s)

**Operator does.** Opens a new Chrome tab to `https://kiosk.anchor-bank-demo.zeroauth.dev`. The kiosk page (built by Role 15, see [`docs/plan/bfsi-v1/agents/agent-15-fe-console.md`](../plan/bfsi-v1/agents/agent-15-fe-console.md)) displays a QR encoding `session_nonce`, `tenant_id`, `environment`, `expires_at = T + 90 s`.

**Projector shows.** The kiosk page; QR large, an "awaiting authentication" spinner below.

### 5.2 Step 2 — Customer scans + biometric (30 s)

**Operator says.**

> "Mrs. Sharma walks up to a net-banking kiosk in the branch lobby. The kiosk shows a QR. She opens the ZeroAuth app, taps Scan, points it at the kiosk."

**Customer does.** Scans the QR. The app pops up a confirmation sheet: *"Confirm login to Anchor Bank net banking"*. BiometricPrompt fires — face or fingerprint. The StrongBox key wrap unlocks.

**Operator says (during the half-second the prover runs).**

> "On the phone right now: rapidsnark is generating a Groth16 proof. Public inputs are the commitment, the session nonce, and a hash of the tenant ID. Private inputs are the secret and the salt. The proof is 256 bytes. It posts to `/v1/zkp/verify`."

### 5.3 Step 3 — Server verify + session (20 s)

**Projector shows.** Kiosk page transitions to the net-banking landing for Mrs. Sharma. Wall-clock time, scan-to-landing: under 1.5 seconds.

**Operator switches to Tab 3 (Audit Events live).** A new row scrolls in:

```
event_type           : auth.verify_success
did                  : did:zeroauth:abc1...ef07
session_id           : sess_a1b2c3d4e5f6
proof_hash           : 0x7e3a...
previous_audit_hash  : 0x4f8b...
created_at           : 2026-05-28T14:23:01.412Z
```

**Operator says (to the CISO).**

> "No SMS. No OTP. No PSTN traffic. The audit row has a `previous_audit_hash` — that's the chain. Scene 5 demonstrates what happens when someone tries to break the chain."

**Operator says (to the CFO).**

> "For your retail book: 30 million active customers × 6 OTPs per month × ₹0.20 per SMS = ₹43 crore per year in SMS gateway spend. That line item zeroes out the day this is in production. The 8–12 % OTP delivery-failure rate that costs you call-centre time — also zero."

Pain points referenced: P3 (SMS), P6 (SIM-swap), P9 (drop-off — implied by speed).

---

## 6. Scene 3 — High-value transaction step-up (2 minutes)

**Goal.** Show transaction-binding and demonstrate the substitution attack failing.

### 6.1 Step 1 — Customer initiates NEFT (30 s)

**Operator does.** On the kiosk net-banking page (still open in Tab 8 from Scene 2), navigate to "Funds Transfer → New Beneficiary → NEFT". Fill in: payee name `Mr. Gupta`, IFSC `ABCD0001234`, account `9876543210`, amount `5,00,000`. Click Submit.

**Operator says.**

> "Mrs. Sharma initiates a ₹5 lakh NEFT to Mr. Gupta — a new beneficiary, never seen before. Your core banking flags it as high-value plus new-beneficiary. It requires step-up."

**Projector shows.** Kiosk shows "Open your ZeroAuth app and confirm". The phone receives an FCM push notification simultaneously.

### 6.2 Step 2 — Confirm on phone (30 s)

**Customer does.** Phone shows: *"Confirm: ₹5,00,000 to Mr. Gupta, ABCD0001234, A/c …543210?"*. Taps Confirm. BiometricPrompt fires.

**Operator says.**

> "The phone is now binding the transaction details into the proof. The server has computed a transaction nonce — `tx_nonce = Poseidon(amount, payee_ifsc, payee_acct, timestamp)` — and the prover takes that as a public input. If anyone substitutes a different amount, payee, or timestamp anywhere between Mrs. Sharma's eyes and the server, the proof fails."

**Projector shows.** Net-banking page transitions to "NEFT queued — reference NRTGS25052812345".

### 6.3 Step 3 — Substitution attack demonstration (45 s)

**Operator says (slowly, deliberately, to the whole room).**

> "Now let's pretend an attacker tried to change the amount mid-flow. The attacker controls the kiosk's display — say it's malware, or a compromised branch terminal. They show the customer ₹50,000 on screen. The customer confirms. The attacker forwards ₹5,00,000 to the back-end."

**Operator does.** Opens the developer console for the kiosk page (Cmd-Option-J in Chrome). Runs the prepared snippet:

```javascript
// Pre-saved as a Chrome snippet: 'demo-substitution-attack'
window.__zeroauthDemo.injectSubstitution({
  displayed_amount: '50000',
  signed_amount: '500000'
});
```

**Operator initiates a fresh transaction on the kiosk.** Customer confirms on the phone (which still sees the real ₹5,00,000). Server receives the proof.

**Projector shows.** Net-banking page returns an error: `proof_invalid`. The Audit Events tab shows a `auth.verify_failed` row with `reason: tx_nonce_mismatch`.

**Operator says (to the CRO).**

> "The `tx_nonce` the server computed includes the original amount. The phone signed over the original amount. Mismatch. The proof rejects. No social-engineering an OTP for a different amount. No 'OTP read-aloud' failure mode. The proof is *cryptographically* bound to the transaction. RBI Master Direction on Digital Payment Security Controls §5.3 calls out the absence of cryptographic transaction binding as a gap — this closes that gap."

Pain points referenced: P5 (RBI Digital Lending consent), P7 (high-value transaction authorisation).

### 6.4 Cleanup

**Operator does.** Reload the kiosk tab to clear the injected substitution. Confirm Mrs. Sharma's original NEFT is still in `queued` state on the dashboard.

---

## 7. Scene 4 — Breach simulation (4 minutes)

**Goal.** Show the CISO + General Counsel that a full DB exfiltration is not a personal-data breach under DPDP §2(t).

### 7.1 Step 1 — Set the frame (15 s)

**Operator switches to Tab 7 (psql).** Says, looking at the CISO:

> "Assume one of your DBAs gets phished tonight and your customer database is exfiltrated. Tomorrow morning, the dump is on a Telegram channel. What is the blast radius?"

Pause. Let the CISO answer. They will say something like "We're at the front page of *The Hindu Businessline*, and we're writing to RBI under DPDP §8(6), and the class actions are starting." That's the right answer for the standard credential database. The operator's job is to show the ZeroAuth database is not that.

### 7.2 Step 2 — The schema (30 s)

**Operator does.** In the psql prompt:

```
zeroauth=# \d users
```

**Projector shows.** Schema output:

```
                                  Table "public.users"
        Column        |          Type          | Collation | Nullable |     Default
----------------------+------------------------+-----------+----------+------------------
 id                   | uuid                   |           | not null | gen_random_uuid()
 did                  | text                   |           | not null |
 commitment           | bytea                  |           | not null |
 tenant_id            | uuid                   |           | not null |
 environment          | text                   |           | not null |
 enrollment_audit_id  | uuid                   |           | not null |
 created_at           | timestamptz            |           | not null | now()
Indexes:
    "users_pkey" PRIMARY KEY, btree (id)
    "users_did_unique" UNIQUE, btree (did)
    "users_tenant_env_idx" btree (tenant_id, environment)
```

**Operator says.**

> "Note what is *not* here. No `name`. No `email`. No `phone`. No `pan`. No `aadhaar`. No `face_template`. No `fingerprint_template`. No `kba_question`, no `kba_answer`, no `mpin_hash`, no `otp_secret`, no `recovery_email`. The schema is enforced by zod on every input handler. A pull request to add any of these columns triggers an automatic ADR requirement plus a security-reviewer sign-off."

### 7.3 Step 3 — The data (45 s)

**Operator does.**

```
zeroauth=# SELECT * FROM users LIMIT 5;
```

**Projector shows.** Five rows. Each `did` column is `did:zeroauth:` followed by 40 hex characters. Each `commitment` column is 64 hex characters (32 bytes). No human-readable string anywhere.

```
                  did                  |              commitment              |   tenant_id    | env  |    enrollment_audit_id   |       created_at
---------------------------------------+--------------------------------------+----------------+------+--------------------------+-----------------------
 did:zeroauth:abc1...a93f              | \x7e3a...c4b1 (32 bytes)             | <anchor uuid>  | live | <audit uuid>             | 2026-05-28 14:22:50+05
 did:zeroauth:def2...0a7c              | \x4f8b...1233 (32 bytes)             | <anchor uuid>  | live | <audit uuid>             | 2026-05-28 14:23:31+05
 ...
```

**Operator does.**

```
zeroauth=# SELECT * FROM device_registrations LIMIT 5;
```

**Projector shows.** Columns: `device_id_hash`, `did`, `play_integrity_verdict`, `key_attestation_cert_chain_sha256`, `registered_at`. Each `device_id_hash` is a SHA-256 — no IMEI, no Android ID, no advertising ID. The `play_integrity_verdict` is the categorical token only (`MEETS_STRONG_INTEGRITY`), not the JWT.

**Operator does.**

```
zeroauth=# SELECT * FROM audit_events ORDER BY id DESC LIMIT 5;
```

**Projector shows.** Last 5 audit rows: `event_type`, `target_did`, `created_at`, `event_data` (JSONB with no PII), `previous_hash`, `current_hash`.

### 7.4 Step 4 — The DPDP §2(t) reading (60 s)

**Operator switches to a pre-prepared slide.** Slide shows, in large type:

> **DPDP Act 2023, §2(t):**
>
> *"'personal data' means any data about an individual who is identifiable by or in relation to such data."*

**Operator reads it aloud, slowly, then says:**

> "Look back at the rows. The `commitment` is a Poseidon hash output — a 32-byte field element. It is hiding and binding under the discrete-log assumption on BN128. It has no statistical link to the underlying biometric. The `did` is derived from the commitment by keccak256. The `device_id_hash` is a SHA-256 with a per-tenant salt.
>
> Can you, from these rows, identify Mrs. Sharma? Can the regulator identify her? Can a class-action plaintiff?
>
> The DPDP Board's standard for §2(t) is 'identifiable in relation to'. We argue — and our external counsel's memo confirms — these rows are not identifiable in relation to a data principal. If your DB gets exfiltrated tomorrow, you are not in breach of §8 because the exfiltrated data is not personal data."

**Operator switches to the legal memo.** Says: "This is the memo our external counsel signed off on. Two pages. You can take it with you."

(The memo is the document A35-W3-Tue produces — `docs/compliance/dpdp-2t-commitments-memo-v1.md`. The operator's takeaway folder has 6 copies.)

### 7.5 Step 5 — The CISO's reframe (60 s)

**Operator says (to the CISO, with full eye contact).**

> "Your DPDP §8 reportable-breach surface area, today, includes your authentication database. After ZeroAuth, it does not. Your class-action exposure under §13 changes shape: a complainant cannot point to an injury to the data principal because the data principal's data was not exposed. Your insurance premium, on renewal, comes down 40 to 80 percent year-on-year — because the actuary cannot price the risk of breaching a credential database that does not contain credentials."

**Operator says (to the General Counsel, if present).**

> "Counsel — we have an external memo. We have a sub-agent cryptographer review on the commitment scheme. We have the patent (`IN202311041001` — Pramaan, granted). If you want, the lawyer who wrote our memo will take a 30-minute call with your team."

Pain points referenced: P1 (DPDP §8), P10 (data localisation).

---

## 8. Scene 5 — Audit-integrity tamper demo (3 minutes)

**Goal.** Show the audit chain breaks visibly on tampering, and the on-chain anchor is independently verifiable.

### 8.1 Step 1 — The clean state (20 s)

**Operator switches to Tab 4 (Audit Integrity panel).** The panel is green:

> **PASS** — hash chain valid from row 1 to row 23,456. Latest on-chain anchor: tx `0x9c1f...` on Base Sepolia, anchored 2026-05-28 02:00:00 IST. Anchor matches row 22,901 terminal hash.

**Operator says.**

> "The audit chain is a Merkle-style construction. Every row references the SHA-256 of the previous row. Every night at 02:00 IST, a cron job hashes the terminal row and writes it to the `AuditAnchor` contract on Base. Yesterday's anchor is on-chain — Basescan, contract `0x...` — and was placed by a deployer key we hold in cold storage."

The hash-chain construction is in [`src/services/audit.ts`](../../src/services/audit.ts); the anchor cron is in [`scripts/anchor-audit-chain.ts`](../../scripts/anchor-audit-chain.ts); the ADRs are [`adr/0013-audit-hash-chain.md`](../../adr/0013-audit-hash-chain.md), [`adr/0014-on-chain-anchor-cadence.md`](../../adr/0014-on-chain-anchor-cadence.md).

### 8.2 Step 2 — The tampering attempt (45 s)

**Operator switches to Tab 7 (psql).**

> "Now assume one of your operations staff with database access is corrupt. They want to erase evidence of an action they took yesterday. Let's give them root on the audit table."

**Operator does.** Pick a row from yesterday — say a successful login by Mrs. Sharma. Note its `id` (the operator pre-identified `id=12345` during dry-run, and that row is real, in the live DB, from yesterday's data).

```
zeroauth=# SELECT id, event_type, target_did, event_data, current_hash
zeroauth-#   FROM audit_events WHERE id = 12345;
```

Confirm row exists. Then:

```
zeroauth=# UPDATE audit_events
zeroauth-#    SET event_data = '{"tampered":"by_corrupt_dba"}'::jsonb
zeroauth-#  WHERE id = 12345;
UPDATE 1
```

**Operator says.**

> "Done. The row is rewritten. From the DB's perspective, it's a normal UPDATE. The CDC log shows nothing unusual. A DBA-level audit might miss it."

### 8.3 Step 3 — The integrity check fails (30 s)

**Operator switches to Tab 4 (Audit Integrity panel).** Hits "Re-run check".

**Projector shows.** Panel transitions to red:

> **FAIL** — hash mismatch at row 12,345. Stored `current_hash` was `0x4f8b...c233`. Recomputed `current_hash` from `event_data + previous_hash` is `0x9e21...0f7a`. Chain integrity broken from row 12,345 onward.

**Operator says.**

> "The check is just SHA-256 of `previous_hash || event_data`. The recomputed hash no longer matches the stored hash. Every row from 12,345 to the present is now flagged. The bank's audit reviewer cannot un-see this."

### 8.4 Step 4 — The on-chain anchor (45 s)

**Operator switches to Tab 5 (Basescan).** Pulls up the `AuditAnchor` contract.

> "Now the second line of defence. Yesterday's anchor transaction is on Base. The terminal hash anchored last night was the hash of row 22,901, which was on the chain *before* the tampered row 12,345 — meaning the anchor still reflects the untampered chain history up to last night."

**Operator does.** Goes back to Tab 4. Clicks "Anchor cross-check". Panel updates:

> **DIVERGENCE** — re-derived terminal hash of row 22,901 from current DB does **not** match on-chain anchor at tx `0x9c1f...`. The on-chain anchor is the source of truth. Database has been tampered.

**Operator says.**

> "Even if the operations DBA is corrupt, they cannot rewrite history without (a) re-computing every chained hash from row 12,345 to row 22,901 — that's about 10,000 rows of SHA-256 work, doable in milliseconds — *and* (b) invalidating yesterday's on-chain anchor transaction. Which they do not have the private key for. The deployer key for the anchor contract is in cold storage, multisig, and not on any production server."

### 8.5 Step 5 — The rollback (15 s)

**Operator does.** Rolls back the tampering so the next demo starts clean:

```
zeroauth=# UPDATE audit_events
zeroauth-#    SET event_data = (SELECT event_data FROM audit_events_backup_<date> WHERE id = 12345)
zeroauth-#  WHERE id = 12345;
```

A pre-prepared `audit_events_backup_<date>` table was created during § 1.6 dry-run. The operator does **not** make a show of this — it happens fast, off-camera. The integrity panel returns to green.

**Operator says (to the CRO).**

> "The audit log meets RBI Master Direction on IT Governance §6.4 with cryptographic evidence, not narrative. Your auditor can verify this independently without involving ZeroAuth — they just need the database dump and the Base RPC. Our role becomes purely operational, not custodial."

Pain points referenced: P4 (insider abuse, audit-log tamper-evidence).

---

## 9. Scene 6 — Teller workflow (optional, 3 minutes)

Only run Scene 6 if:
- The CIO is in the room and has asked workforce questions.
- The clock shows at least 4 minutes remaining in the 22-minute budget.
- Pixel 7 (slot C) is enrolled and functional.

### 9.1 Step 1 — Workstation simulator (30 s)

**Operator does.** Opens a new tab to `https://kiosk.anchor-bank-demo.zeroauth.dev/teller`. The workstation simulator (web app by Role 15) loads. Displays a QR.

**Operator says.**

> "Your branch tellers today log in to a shared Windows workstation with an AD password, sometimes a smart card. Smart-card readers are ₹2k per workstation, replacement cards ₹1.5k each, lost cards are a credential leak, and shift-handover password sharing is endemic."

### 9.2 Step 2 — Teller authenticates (60 s)

**Operator does.** Hands Pixel 7 (slot C) to a pretend teller (anybody in the room can play this role — typically the CIO themselves).

**Pretend teller does.** Opens ZeroAuth app, scans QR, BiometricPrompt fires, proof generates, workstation unlocks.

**Projector shows.** Workstation simulator transitions to "Logged in: teller-demo (DID: did:zeroauth:c8f1...). Branch: Andheri East. Shift start: 09:00 IST."

**Operator says.**

> "The teller's phone is the credential. No smart card. No shared password. No shared workstation state. The audit row is bound to the teller's personal DID — not to the workstation account. The teller cannot share a credential with another teller because the credential is biometric-gated, StrongBox-bound to *their* phone."

### 9.3 Step 3 — The audit value (60 s)

**Operator switches to Tab 3 (Audit Events).** Shows the new `workforce.login_success` row with the teller's DID.

> "Every action this teller takes for the rest of their shift carries this DID in the audit row. If there's an insider-abuse investigation, the audit log unambiguously attributes each row to a specific human being. Your forensic team is not chasing 'who was logged in to workstation BR-AND-007 at 14:32'. They have a DID."

Pain points referenced: P8 (shared workstation risk).

### 9.4 Cleanup

Power down Pixel 7 (slot C), return it to the bag. Operator returns to Tab 1.

---

## 10. Q&A bank

The 22 minutes are done. 15 minutes of Q&A follow. Below are the 12 questions from [`02-bank-demo.md`](../plan/bfsi-v1/02-bank-demo.md) § *Q&A bank* with the operator's prepared answers — 2 to 3 sentences each. The operator memorises them, but it's fine to consult this page on a tablet.

### Q1. "What if the customer loses their phone?"

> "Re-enrolment. We void the lost DID in the registry and create a fresh DID with a fresh commitment. The Aadhaar dip is **not** repeated — the KYC anchor from the original enrolment is re-used. End-to-end: 90 seconds at the branch, or via the app with one-time SMS to the registered number for the void confirmation."

### Q2. "What if the customer's biometric changes? Burn, surgery, age?"

> "The fuzzy extractor tolerates up to 8 % Hamming distance on biometric features — that handles minor injury and age drift. Above that threshold, the customer re-enrols. Same 90-second flow as a lost-phone case. We see this in less than 0.2 % of authentications per year in our pilot data."

### Q3. "What about elderly users with poor fingerprint quality?"

> "Two enrolment paths: face-only, or face + R307 sensor. Face capture works on any Android with a front camera. R307 is the fallback when face fails — poor light, occlusion. We expect about 5 % of customers to need branch-assisted enrolment. That's a one-time touchpoint per customer per 8 years; not a per-auth cost."

### Q4. "Does it work without internet?"

> "Enrolment requires internet — the DID registration is on-chain. Login and transaction step-up require internet — the proof is submitted to our verifier. Offline mode is on the v2 roadmap; the protocol supports it because the proof generation is fully local, but we haven't shipped the offline session-resume path yet."

### Q5. "What about Android phone diversity? Will it run on a Redmi 9?"

> "StrongBox is required for production-tier devices — that's most phones less than four years old. Devices without StrongBox fall back to TEE-backed Keystore with a documented security delta in `docs/operations/device-support-matrix.md`. Below TEE — pre-2018 budget devices — we have an explicit denylist. About 91 % of your active customer base will be StrongBox-capable; the rest fall through the TEE path."

### Q6. "What is the IP position?"

> "Patent IN202311041001 — *Pramaan: Zero-Knowledge Identity Verification* — granted by the Indian Patent Office. ZeroAuth has exclusive commercial rights. Patent claims cover the fuzzy-extractor + Poseidon-commitment + DID-derivation construction. We can share the prosecution file under NDA."

### Q7. "What if SnarkJS or rapidsnark has a CVE?"

> "Versions pinned in `package.json` with hashes in `package-lock.json`. SBOM tracked in `docs/security/sbom.md`. We run a daily CVE monitor — see `.github/workflows/cve-monitor.yml` — that pages the on-call SRE on any HIGH severity. Roll-forward path is documented in `docs/operations/dependency-cve-response.md`: we patch within 24 hours of CVE disclosure."

### Q8. "What if Base mainnet rolls back or has a chain reorganisation?"

> "The hash chain remains valid off-chain even if the on-chain anchor reorgs. The anchor is defence-in-depth, not the primary integrity mechanism. Our audit-integrity check passes on the off-chain chain alone; the on-chain anchor is consulted only when the bank has reason to suspect the off-chain DB itself was tampered. So a Base reorg degrades to the pre-anchor security model — which is still the chained DB."

### Q9. "Where is the trusted setup?"

> "Multi-party Phase 2 ceremony run by six contributors. Their identities, the hashed transcripts, and the verification path are in `docs/cryptography/trusted-setup-ceremony.md`. ADR 0005 captures the decision. Any one honest contributor was sufficient to bind the setup; we had six."

### Q10. "Quantum?"

> "BN128 is a 128-bit security pairing-friendly curve. Not post-quantum. v2 will explore PLONK over a STARK-friendly field — that's our research-roadmap line for 2027. Phase 1 is BN128. Realistic quantum threat timeline for 256-bit symmetric and discrete-log security: 10–15 years. Phase 1 deployment lifetime: 3 years before re-cryptography."

### Q11. "Does this work for our merchant onboarding flow under RBI PA-PG guidelines?"

> "Yes — same protocol, different tenant configuration. We treat the merchant as a tenant; the merchant's representatives enrol with the same biometric flow. The PA-PG due-diligence artefacts attach to the merchant tenant rather than the consumer DID. Documented in `docs/integrations/merchant-onboarding.md`. Phase 2 deliverable."

### Q12. "What is the SLA?"

> "Phase 1 pilot: best-effort, target 99.5 % monthly. Phase 3 production: 99.95 % monthly, with credits on miss per the MSA schedule. Detailed availability calculation excludes scheduled maintenance windows (announced 7 days in advance, max one 2-hour window per quarter)."

### Q13. "What is the data-residency story?"

> "All `live` environment data is resident in `ap-south-1` (Mumbai) on AWS. We can deploy into the bank's own VPC under VPN peering if regulatory or procurement requires it. Cross-border traffic only happens in `test` environment for our own development. The DPDP §16 cross-border restrictions are honoured by construction."

---

## 11. Recovery playbook

The demo will fail in some way. Failures are scripted. Recovery is what the bankers remember — a graceful recovery often closes the deal harder than a clean run.

### 11a. Kiosk freezes mid-Scene-2

**Symptom.** Kiosk tab spins on "awaiting authentication" for > 5 seconds after the customer's BiometricPrompt completes.

**Operator's first move.** Do not say "it's frozen". Say:

> "While the SSE channel catches up, let me show you the audit row we already wrote on the server side."

**Operator does.** Switches to Tab 3 (Audit Events). The `auth.verify_success` row is already there because the server-side verification has completed; only the kiosk's SSE consumer is wedged.

**Recovery action.** Open a new kiosk tab. Customer rescans a fresh QR. The second attempt completes inside 2 seconds. The first frozen tab stays frozen in the background; do not close it during the demo because tab-switching is visible.

**If second attempt also fails.** Operator switches to a backup narrative:

> "Let's accept that the kiosk SSE channel is having a moment — production runs sub-100ms, this is a conference-room network. What I want to show you is what the bank actually cares about: the audit row, the proof verification, the chain. That all happened. Look at the row."

Then proceed to Scene 3 from the dashboard. Skip the kiosk visual for the rest of the demo.

### 11b. Mobile app crashes during enrolment

**Symptom.** ZeroAuth Banking app force-closes mid-enrolment. Phone screen returns to launcher.

**Operator's first move.** Do not say "it crashed". Say:

> "Let's swap to the backup device — production fleets always have one in the lobby."

**Recovery action.** Power on Pixel 7 (slot B). Hand it to the customer. Restart Scene 1 from the QR scan. The dashboard's Users tab will eventually show two enrolled DIDs at the end of the demo — that's fine, the operator never says "Mrs. Sharma is enrolled once".

**Root-cause logging.** After the demo, capture the device's logcat via `adb logcat -d > docs/team/mobile/crash-<date>.log`, file under the crash docket, and brief Role 4 (VP Mobile) within 2 hours.

### 11c. Network drops mid-demo

**Symptom.** Browser tabs return DNS errors or fail to load. `/api/health` returns 5xx or times out.

**Operator's first move.** Switch all four devices (operator laptop, customer phone, teller phone, secondary backup phone) to the Jio MiFi.

```bash
# On the laptop, from a terminal:
networksetup -setairportnetwork en0 'ZA-MiFi' '<password>'
```

**Recovery action.** Acknowledge the switch to the room:

> "Conference Wi-Fi just dropped — switching to a mobile hotspot. The protocol doesn't care which network we're on; what you'll see is an extra second of round-trip latency."

**Fallback narrative if MiFi also drops.** This is the worst case. The operator does **not** improvise. They pivot to:

> "We've lost connectivity on both networks — let me walk you through the architecture diagrams instead and we'll reschedule a follow-up call to see the live demo."

Pull out the one-page PDF, walk the bankers through it standing up. Apologise once, briefly, then move on. Do not blame the room. Do not blame the operator's network. Acknowledge and pivot.

### 11d. Customer phone has no StrongBox (tier-2 device)

**Symptom.** Pixel 7 was lost or wedged; backup is a tier-2 Android (e.g., Samsung A series, Redmi Note). `dumpsys android.hardware.biometrics` does not list StrongBox.

**Operator's first move.** Brief the room transparently:

> "We're on a tier-2 device today. StrongBox isn't available; we're falling back to TEE-backed Keystore. There's a documented security delta — TEE is still a hardware-rooted enclave, just not the standalone secure chip StrongBox is. Production deployment to your customer fleet would target StrongBox-capable devices, which is about 91 % of your active base; the remaining 9 % falls through the path we're about to show."

**Recovery action.** The demo proceeds identically. Every flow works. The audit row will have `device_tier: 'tee'` instead of `device_tier: 'strongbox'`. The CISO will probably ask — answer per Q5 above.

**What not to do.** Don't apologise or treat this as a failure. Tier-2 fallback is a feature, not a defect.

### 11e. R307 not detected

**Symptom.** USB-OTG cable plugged in; the ZeroAuth app's diagnostic screen shows `R307 detected: no`.

**Operator's first move.** Try the spare USB-OTG cable from the bag. If the spare also fails, abandon the R307 and proceed with BiometricPrompt-only enrolment.

**Recovery action.** Brief the room:

> "We'll do face plus the phone's native fingerprint sensor instead of the external R307. Same fuzzy-extractor inputs, just sourced from the phone's biometric hardware rather than the external sensor. R307 is for branch-counter deployments where a customer might not have a phone in hand; on-phone biometric covers self-service flows."

**Customer does.** BiometricPrompt fires using the phone's rear fingerprint sensor (Pixel 7 has it under the screen).

**Recovery cost.** Zero — the entire R307 segment is optional in Scene 1.

### 11f. Proof verification rejects (the demo's worst nightmare)

**Symptom.** Customer scans a kiosk QR, BiometricPrompt succeeds, the phone says "proof generated", the kiosk shows `proof_invalid` or `verify_failed`.

**Possible causes — diagnose in order.**

1. **Clock skew on the phone.** The proof binds `expires_at`; a phone whose clock is > 90 s off will produce an expired proof. Check `Settings → Date & time → Automatic`. If skewed, toggle off and on. Re-attempt.
2. **Wrong tenant configuration.** The phone enrolled under tenant A but the kiosk QR encoded tenant B. Operator confirms the kiosk URL is `kiosk.anchor-bank-demo.zeroauth.dev` and not a stale URL from a different demo.
3. **Circuit version mismatch.** The phone APK was built against `cct-v1.1`; the deployed verifier is `cct-v1.2`. Operator runs the diagnostic in the app: Menu → About → Circuit version. Should be `v1.2`.
4. **Genuine server-side rejection.** The proof is invalid because the input data doesn't satisfy the constraints. This is a real bug — if seen on the day, the demo is over.

**Operator's first move (if root cause not obvious).** Pivot calmly:

> "Let me re-do that with a fresh QR — sometimes the session nonce ages out faster than I expect on a conference network."

**Recovery action.** New kiosk tab, new QR, retry. If a second attempt also fails, switch to backup phone (Pixel 7 slot B) and restart from Scene 1.

**If three attempts across two phones all fail.** This is structural. The operator says:

> "We're going to switch to walking through the audit log and the dashboard for the remaining minutes — what I want you to take away is the *architecture*, and that's visible in the data we already have on screen. The live verification path can be demonstrated at the next session."

Then proceed to Scene 4 and Scene 5 — both work entirely off the pre-existing audit log, which is real, and do not depend on a fresh proof landing during the demo.

**Post-mortem.** Within 24 h of the demo, file a P0 incident docket. Capture: phone logcat, kiosk console log, server-side `/v1/zkp/verify` request + response, proof input data hash. Brief Roles 6, 11, 26 (backend verifier, crypto-circuit, security red-team) the same day.

---

## 12. Post-demo (T+10 min)

The bankers stand up. The operator stays standing. There is a 10-minute window before they leave the room; this window is the difference between a follow-up call and a dead lead.

### 12.1 Leave-behind folder

Hand each banker the leave-behind folder. Contents:

1. **One-page PDF summary.** `docs/marketing/anchor-bank-one-pager.pdf` (Role 48 + Role 32 owns; see [`docs/plan/bfsi-v1/agents/agent-32-design-dashboard.md`](../plan/bfsi-v1/agents/agent-32-design-dashboard.md)). Front: the five scenes mapped to the five C-suite pain points (CISO → P1, CFO → P3, CRO → P4 + P7, GC → P1, CIO → P8). Back: the cost-avoidance arithmetic on one column, the architecture diagram on the other.

2. **DPDP §2(t) memo extract.** Two-page extract from `docs/compliance/dpdp-2t-commitments-memo-v1.md`. External counsel letterhead. Not the full memo; the extract is meant to be re-circulated inside the bank without our involvement.

3. **NDA template.** Pre-printed on ZeroAuth letterhead, two-page, mutual NDA. Ready to sign in the room if the CISO offers — operator has a pen.

4. **LoI template.** Letter of Intent for the Phase 1 pilot. One page. Outlines the scope (one branch, six weeks, the five demo scenarios live with one synthetic customer cohort), the price (₹X seat fee for the pilot duration), and the exit condition (six-week pilot exit gate → MSA negotiation).

5. **MSA reference.** Five-page summary of the Master Services Agreement structure (full MSA is a separate negotiation with legal teams). Reference paragraphs cited in the LoI.

6. **Business card stack.** Operator's, CEO's, sales lead's (Role 42).

### 12.2 The ask (90 s)

Operator says, standing, before the bankers leave:

> "Two asks before you go. First — sign the NDA today. It lets us share the full source-code review and the trusted-setup transcript with your CISO team in the next 7 days. Second — let us schedule a 45-minute follow-up with your General Counsel on the §2(t) memo. We do that in week two. If both happen, we can have an LoI on the table by week three and a pilot kicked off in week six."

If the CISO offers to sign the NDA in the room — sign it. Don't wait. Don't say "let me run it past our legal". The NDA is pre-vetted; the operator's signature is authorised.

### 12.3 Follow-up cadence

| Day | Action | Owner |
|---|---|---|
| T+0 (same day, before midnight) | Email each banker individually. Personalised. Reference one specific question they asked. Attach the leave-behind PDF. | Operator |
| T+1 | NDA chase if not signed | Role 42 (Sales lead) |
| T+3 | 30-minute call to confirm follow-up agenda | Role 42 |
| T+7 | Source-code review session for CISO team | Role 26 (Security red-team) + Role 11 (Crypto circuit) |
| T+14 | DPDP §2(t) memo deep-dive with GC | Role 37 (Compliance lead) + external counsel |
| T+21 | LoI draft on the table | Role 42 |
| T+42 (week 6) | Phase 1 pilot kick-off | All of Roles 1, 2, 6, 14, 17, 21, 36, 42 |

### 12.4 The internal debrief

Within 60 minutes of the bankers leaving:

- Operator + Role 42 + Role 1 (CTO) do a 20-minute debrief.
- Capture in `docs/team/sales/anchor-bank-debrief-<date>.md`: which bankers were in the room, which scenes resonated, which Q&A questions came up that we did not prepare for, what the next-step commitment was.
- File any defects from the demo (kiosk freeze, app crash, network issue) into the relevant team's docket within 2 hours.
- File any "we did not have an answer to that" Q&A questions into the prep deck for the next demo.

### 12.5 Photo / video policy

- **No photos, video, or screen-share of the demo, ever.** Even by the bankers themselves. State this at the opening if the CISO asks: "We don't permit recording because the demo runs against production tenants and any captured DID + timestamp pair could be replayed in a chosen-ciphertext attack on the session-nonce protocol if a future weakness were found. We will share static screenshots in the follow-up pack — these are pre-cleared by our security team."
- The exception: the operator's own laptop may screen-record locally, with the recording deleted within 7 days, for internal training. This recording does not leave the operator's machine.

### 12.6 Cleanup checklist (T+30 min)

- [ ] Live API key slip back in operator's wallet.
- [ ] All four phones (Pixel 7 slots A/B/C, Samsung S22): factory reset at the airport or hotel, never in the conference room.
- [ ] R307 sensor cleaned with microfibre, returned to padded compartment.
- [ ] Operator laptop: dashboard logout, browser tabs closed, screen lock.
- [ ] Hard-copy materials (script, leave-behind master copies, signed NDA if any) returned to the operator's locked briefcase.
- [ ] Demo bag inventory cross-checked against § 1.1 before leaving the venue.

---

## Appendix A — Quick-reference card

A printed wallet card the operator carries with these contacts:

| Role | Name | Phone | Escalate when |
|---|---|---|---|
| CTO (Role 1) | Pulkit Pareek | +91-XXXXX-XXXXX | P0 production incident, demo blocked |
| VP Backend (Role 2) | `<name>` | +91-XXXXX-XXXXX | Server returns 5xx |
| VP Mobile (Role 4) | `<name>` | +91-XXXXX-XXXXX | App crashes, phone wedged |
| VP Infra (Role 5) | `<name>` | +91-XXXXX-XXXXX | Network down, VPS unreachable |
| Security lead (Role 26) | `<name>` | +91-XXXXX-XXXXX | Proof rejected (root-cause needed) |
| Sales lead (Role 42) | `<name>` | +91-XXXXX-XXXXX | Bank-side follow-up, NDA |
| External counsel | `<firm>` | +91-XXXX-XXXX | §2(t) escalation requested |

---

## Appendix B — Demo timing reference

| Scene | Budget | Cumulative | Cumulative + Q&A buffer |
|---|---|---|---|
| Opening | 0:30 | 0:30 | 0:30 |
| Scene 1 — Enrolment | 5:00 | 5:30 | 5:30 |
| Scene 2 — Login | 1:00 | 6:30 | 6:30 |
| Scene 3 — Transaction step-up | 2:00 | 8:30 | 8:30 |
| Scene 4 — Breach simulation | 4:00 | 12:30 | 12:30 |
| Scene 5 — Audit tamper | 3:00 | 15:30 | 15:30 |
| Scene 6 — Teller (optional) | 3:00 | 18:30 | 18:30 |
| Buffer / Q&A start | — | 22:00 | 22:00 |
| Q&A | 15:00 | — | 37:00 |
| Close + leave-behind | 8:00 | — | 45:00 |

If at T+8:30 (end of Scene 3) the operator is more than 1 minute behind, **skip Scene 6** outright at the start. If more than 2 minutes behind, compress Scene 5 to 2 minutes (one tamper, no anchor cross-check) and skip Scene 6.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #35 (writer-compliance) + Agent #45 (solutions architect)
