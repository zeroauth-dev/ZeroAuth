# Anchor Bank demo specification

This document defines the **first** customer-facing artefact ZeroAuth will ship: a live demo, delivered to the CISO + CFO + CRO + CIO of an Indian scheduled commercial bank, that runs against the production codebase (not a sandbox), uses real biometrics on a real Android phone, and verifies real Groth16 proofs against the deployed on-chain verifier.

The demo is the unit of feature acceptance for Phase 1. A feature ships only if it makes one of these scenes work end-to-end.

---

## Cast and props

**"Anchor Bank"** — placeholder name for the bank in the room. In the actual demo it will be branded as the partner bank (HDFC, ICICI, Axis, SBI YONO, IDFC First, RBL — the six we will brief in Phase 1).

**The room:**
- Conference table with HDMI projection.
- Demo workstation (operator's laptop) on the projection.
- Customer Android phone — fresh, not the operator's. Pixel 7 or Samsung S23 with USB-OTG-capable port. Latest Android.
- Optional: R307 fingerprint sensor on a USB-OTG cable, propped at the kiosk position.
- Optional: a second Android phone playing the role of "teller's phone" for Scene 6.

**The cast:**
- **Operator** (one of us). Drives the demo. Speaks. Triggers actions.
- **Pretend customer** (one of the bankers in the room, ideally the CRO). Holds the phone. Does the biometrics. Confirms transactions.
- **Pretend teller** (Scene 6, optional). Holds the second phone.

**The artefacts on screen:**
- `https://zeroauth.dev/dashboard/anchor-bank/` — the Anchor Bank tenant dashboard, logged in as `ciso@anchorbank.in`.
- The `audit_events` table view, live-streaming new rows.
- A Basescan tab pointed at the deployed `DIDRegistry` contract on Base Sepolia (Phase 1) / Base mainnet (Phase 4).
- A second Basescan tab pointed at the deployed `Groth16Verifier` contract.
- A psql/admin panel showing the `users` table, for Scene 4.

**Total demo runtime:** 22 minutes. Q&A buffer 15 minutes. Total room time: 45 minutes.

---

## Scene 1 — Customer enrollment (5 minutes)

**The story.** Mrs. Sharma walks into Anchor Bank's branch to open a savings account. She is already KYC-verified in DigiLocker. The bank wants her to be able to log in, transact, and authorise without ever using an SMS OTP again.

**The flow.**

1. The branch RM scans a QR on her customer-onboarding tablet. The QR encodes `tenant_id=anchor_bank`, `environment=live`, `enroll_session=<nonce>`.
2. Mrs. Sharma installs the **ZeroAuth Banking** Android app from a one-time-install link displayed on the tablet (in production: Play Store; in pilot: APK over MDM).
3. App opens, asks for camera permission, asks for biometric permission, asks for Aadhaar consent (single dip).
4. **Face capture (CameraX + on-device ML Kit face detection).** App shows a viewfinder, waits for a centred, well-lit face, takes the capture entirely on-device. The face image never leaves the device. SHA-256 of the face descriptor is computed.
5. **Fingerprint capture (R307 via USB-OTG OR Android BiometricPrompt fallback).** If R307 is in the kit, the operator hands Mrs. Sharma the sensor on a stand. If not, the app falls back to BiometricPrompt and the device's native fingerprint sensor. Either way, the template descriptor is hashed on-device.
6. **Fuzzy extractor** (deployed circuit version `cct-v1.2`). On-device, the SHA-256 hashes are combined with stable helper data to produce a 256-bit secret. The helper data is bound to the device's StrongBox-backed key wrap.
7. **Poseidon commitment.** `commitment = Poseidon(2)([secret, salt])` is computed on-device.
8. **DID generation.** `did = "did:zeroauth:" + keccak256(commitment).hex()[:40]`. Generated client-side.
9. **DID registration.** App posts `{ did, commitment, attestation }` to `/v1/identity/register` on Anchor Bank's tenant API. Server validates the attestation (Play Integrity verdict + StrongBox key attestation), writes the DID and commitment to `users` and `device_registrations`, anchors the DID on Base via the `DIDRegistry` contract.
10. **Bank dashboard receives a webhook event** `user.enrolled` and a fresh row appears on the operator's screen.

**What the CISO sees.**
- The `users` table on screen now has Mrs. Sharma's row.
- Operator clicks the row: only `did`, `commitment_hex`, `created_at`, `tenant_id`, `enrollment_audit_id`. No name, no face image, no fingerprint, no email, no PAN, no Aadhaar number.
- Operator opens Basescan tab: the `DIDRegistry.register(did, commitment)` transaction is confirmed.

**What the CFO sees.**
- Operator points out: this is the bank's last UIDAI hit for Mrs. Sharma until her next physical KYC refresh (mandated cadence: every 8 years for low-risk, 2 years for high-risk). For 5 M customers × 8 years × ₹20 per eKYC = ₹100 cr cost avoidance vs. the bank's current per-auth eKYC pattern.

**What the CRO sees.**
- Operator triggers Mrs. Sharma's app to attempt a second enrollment with a different phone. Server rejects with `did_already_registered`. The DID is bound to the original device.

**Required artefacts for this scene to work.**

| Artefact | Owner | Required by |
|---|---|---|
| Android app v1.0 — enrollment flow, CameraX face, BiometricPrompt fallback, R307 USB-OTG driver, StrongBox key wrap, Play Integrity attestation. | Mobile team (roles 17, 18, 19). | Phase 1 week 6. |
| `/v1/identity/register` endpoint — Play Integrity verdict validation, key attestation chain validation, DID uniqueness check, on-chain anchor. | Backend team (roles 6, 7, 8). | Phase 1 week 4. |
| `DIDRegistry` contract on Base Sepolia with mainnet-ready bytecode. | Blockchain team (role 25). | Phase 0 week 2. |
| Anchor Bank tenant provisioned in `live` environment with rate-limit, sub-tenant audit, webhook secrets rotated. | Backend team + DevOps (roles 6, 21). | Phase 1 week 5. |
| Dashboard "Users" view that shows only the four allowed fields. | Frontend team (role 14). | Phase 1 week 5. |

---

## Scene 2 — Login at a kiosk (1 minute)

**The story.** Mrs. Sharma is now an enrolled customer. She walks up to the bank's net-banking kiosk. She wants to log in to her account.

**The flow.**

1. The kiosk displays a QR encoding `session_nonce = <random 32 bytes>`, `tenant_id`, `environment`, `expires_at = T + 90s`.
2. Mrs. Sharma's phone scans the QR with the in-app scanner.
3. App shows a "Confirm login to Anchor Bank net banking" sheet.
4. **BiometricPrompt fires.** Mrs. Sharma's face or fingerprint unlocks the StrongBox key wrap.
5. **rapidsnark JNI bridge** generates the Groth16 proof using `identity_proof.circom` v1.2:
   - public inputs: `commitment`, `session_nonce`, `tenant_id_hash`
   - private inputs: `secret`, `salt`
6. App posts the proof to `/v1/zkp/verify`.
7. Server runs `snarkjs.groth16.verify(vkey, publicSignals, proof)`. If valid, server creates a session and emits an SSE event to the kiosk.
8. Kiosk redirects to Mrs. Sharma's net banking landing.

**What the CISO sees.**
- Wall-clock latency: 1.0–1.5 s from QR scan to net-banking landing.
- Audit row appears in the dashboard: `event_type='auth.verify_success'`, `did=did:zeroauth:abc…`, `proof_hash=…`, `session_id=…`, `previous_audit_hash=…`.
- No SMS. No OTP. No PSTN traffic.

**What the CFO sees.**
- Operator points to the SMS gateway billing dashboard: zero events for this customer. Annualised projection: ₹0.20 × 6 OTPs/month × 12 months = ₹14.40/customer × 30 M customers = ₹43 cr/year cost line zeroed.

**Required artefacts.**

| Artefact | Owner | Required by |
|---|---|---|
| Android app v1.0 — QR scan, rapidsnark JNI bridge, BiometricPrompt-gated key wrap. | Mobile team (roles 17, 18, 19). | Phase 1 week 8. |
| `/v1/zkp/verify` endpoint — proof verification, session creation, audit row, SSE event. | Backend (roles 6, 8). | Phase 1 week 7. |
| Kiosk web app (SSE consumer + QR generator). | Frontend (role 15). | Phase 1 week 7. |
| Hash-chained `audit_events` write path. | Crypto + backend (roles 11, 8). | Phase 1 week 6. |
| Production-quality `Groth16Verifier` contract on Base Sepolia. | Blockchain (role 25). | Phase 0 week 2. |
| `identity_proof.circom` v1.2 with full trusted-setup ceremony. | Crypto (roles 11, 12). | Phase 1 week 10. |

---

## Scene 3 — High-value transaction step-up (2 minutes)

**The story.** Mrs. Sharma initiates a ₹5 lakh NEFT to a new beneficiary (Mr. Gupta, ABCD0001234, account 9876543210). The bank's existing core banking flags it as high-value + new-beneficiary, requiring step-up.

**The flow.**

1. Mrs. Sharma submits the transaction form on net banking.
2. The bank's core banking calls ZeroAuth's `/v1/zkp/challenge` with:
   - `did`
   - `txn_payload = { amount: "500000", payee_ifsc: "ABCD0001234", payee_acct: "9876543210", timestamp: "2026-05-27T14:30:00Z" }`
3. Server computes `tx_nonce = Poseidon(amount, payee_ifsc, payee_acct, timestamp)` and returns it alongside a session_nonce.
4. Net banking displays "Open your ZeroAuth app and confirm". Optionally push notification fires to the phone.
5. App pops up: "Confirm: ₹5,00,000 to Mr. Gupta, ABCD0001234, A/c …543210?". Mrs. Sharma reads, taps Confirm.
6. **BiometricPrompt fires.** Same flow as Scene 2 but the prover now binds `tx_nonce` as an additional public input.
7. Server verifies. Audit row contains the full `txn_payload` and the `proof_hash`.
8. Net banking unlocks, NEFT is queued.

**The substitution attack demonstration.**
- Operator intervenes: "Let's pretend an attacker tried to change the amount mid-flow."
- Operator opens the developer console and modifies the displayed transaction in the kiosk (does not affect the phone's signed amount).
- Operator triggers verification with a substituted amount.
- Server responds `proof_invalid` because the `tx_nonce` computed at the server includes the original amount; the phone signed over the original amount; mismatch.

**What the CRO sees.**
- The proof is cryptographically bound to the transaction. No "OTP read-aloud" failure mode. No social-engineering an OTP for a different amount.
- The audit row contains the full transaction payload alongside the proof; one row is enough for regulator reconstruction.

**Required artefacts.**

| Artefact | Owner | Required by |
|---|---|---|
| `/v1/zkp/challenge` endpoint — `tx_nonce` computation, audit row, optional push. | Backend (roles 6, 8). | Phase 1 week 8. |
| Android app — transaction display sheet, tx_nonce binding in prover input. | Mobile (roles 17, 18, 19). | Phase 1 week 9. |
| FCM push integration (`tenant.push_enabled = true` toggle). | Mobile + Backend (roles 18, 6). | Phase 1 week 9. |
| Demo substitution helper in operator console — toggle for "Inject attack". | Frontend (role 15). | Phase 1 week 10. |

---

## Scene 4 — Breach simulation (4 minutes)

**The story.** The operator turns to the CISO: "Assume one of your DBAs gets phished tonight and your customer database is exfiltrated. What is the blast radius?"

**The flow.**

1. Operator opens the psql admin panel.
2. Operator runs `\d users` to show the schema. Columns: `did`, `commitment`, `created_at`, `tenant_id`, `environment`, `enrollment_audit_id`. No `name`, no `email`, no `phone`, no `face_template`, no `fingerprint_template`, no `aadhaar`, no `pan`.
3. Operator runs `SELECT * FROM users LIMIT 5;`. The output is five rows of opaque field elements.
4. Operator runs `SELECT * FROM device_registrations LIMIT 5;`. Output: `device_id_hash`, `did`, `play_integrity_verdict`, `key_attestation_cert_chain_sha256`, `registered_at`. No device identifiers.
5. Operator runs `SELECT * FROM audit_events ORDER BY id DESC LIMIT 5;`. Output shows action-type, target-did, timestamp, hash-chain entries. Tampering with one row breaks the chain (Scene 5 will show this).
6. Operator pulls up the DPDP §2(t) text on the projector and reads: **"'personal data' means any data about an individual who is identifiable by or in relation to such data"**. Operator then asks: "Can you, from these rows, identify Mrs. Sharma?"
7. Pause. The answer is no — the commitment is a field element with no statistical link to the underlying biometric; the DID is opaque.

**What the CISO sees.**
- **There is nothing in the database to breach.**
- The bank's DPDP §8 reportable-breach surface area is reduced to: audit metadata (timestamps, action types). No personal data exfiltration.
- The bank's CISO-CRO position with the regulator becomes: "the database that was exfiltrated does not contain personal data under DPDP §2(t)".

**What the General Counsel sees.**
- Class-action exposure under DPDP §13 fundamentally changes. The complainant cannot point to an injury to the data principal because the data principal's data was not exposed.

**Required artefacts.**

| Artefact | Owner | Required by |
|---|---|---|
| Hardened `users` table — no PII columns, schema enforced by zod on input. | Backend (roles 6, 7). | Phase 1 week 5. |
| Read-only "DPDP audit view" in the admin dashboard. | Frontend + Backend (roles 14, 6). | Phase 1 week 10. |
| Legal memo: "ZeroAuth commitments under DPDP §2(t)" — co-authored with external counsel. | Compliance + Legal (roles 37, 38). | Phase 1 week 9. |
| Demo psql admin shell with a curated DBA account. | DevOps (role 21). | Phase 1 week 11. |

---

## Scene 5 — Audit-log integrity demonstration (3 minutes)

**The story.** "Assume one of your operations staff with database access is corrupt. Can they erase evidence of their own actions?"

**The flow.**

1. Operator opens the dashboard's audit-events view. Five hundred rows scroll past at 5/sec; latest pinned at top.
2. Operator picks a row from yesterday — say a successful login by Mrs. Sharma — and runs an integrity check via the admin endpoint `/api/admin/audit-integrity`. Output: "PASS — hash chain valid from row 1 to row 23456".
3. Operator opens psql and runs `UPDATE audit_events SET event_data = 'tampered' WHERE id = 12345;`.
4. Operator triggers the integrity check again. Output: "FAIL — hash mismatch at row 12345. Chain integrity broken from row 12345 onward."
5. Operator pulls up Basescan: yesterday's chain anchor transaction is visible. Operator runs the verifier off a fresh database dump: the anchor still references yesterday's untampered terminal hash. The tampered row is now distinguishable from the on-chain truth.
6. Operator: "Even if the operations DBA is corrupt, they cannot rewrite history without (a) re-computing every chained hash from the tampered row onward, AND (b) invalidating yesterday's on-chain anchor transaction, which they do not have the private key for."

**What the CRO sees.**
- The audit log meets RBI Master Direction on IT Governance §6.4 with cryptographic evidence, not narrative.
- The on-chain anchor is independently verifiable by the bank's own auditor without involving ZeroAuth.

**Required artefacts.**

| Artefact | Owner | Required by |
|---|---|---|
| Hash-chain implementation in `src/services/audit.ts` (new). | Crypto (roles 11, 13). | Phase 0 week 2. |
| On-chain anchor cron — daily, Base L2. | Blockchain + DevOps (roles 25, 21). | Phase 1 week 9. |
| `/api/admin/audit-integrity` endpoint. | Backend (role 9). | Phase 1 week 9. |
| Audit-integrity dashboard view. | Frontend (role 14). | Phase 1 week 11. |
| ADR `0010-audit-log-hash-chain.md` and `0011-on-chain-anchor-cadence.md`. | Crypto + Backend (roles 11, 6). | Phase 0 week 2. |

---

## Scene 6 (optional) — Teller workflow (3 minutes)

**The story.** "Let's show one more scenario at the cost of three minutes — how a branch teller logs in."

**The flow.**

1. Operator opens the branch workstation simulator. Workstation displays a QR.
2. Pretend teller picks up the "teller phone" (second Android in the kit).
3. Same flow as Scene 2 — scan, biometric, proof, session.
4. Operator points out: the teller's audit row is bound to their **personal DID**, not to the workstation's AD account. The teller cannot share a credential with another teller because the credential is a biometric-gated, StrongBox-bound key on their phone.
5. Operator: "Replaces the smart-card reader at every workstation. Replaces the shared-workstation password risk. Each row in the audit log is attributable to a specific human."

**What the CIO sees.**
- Hardware spend on smart-card readers + replacement cards becomes a phone-based credential at zero hardware cost.
- Insider-abuse incident class becomes structurally harder.

**Required artefacts.**

| Artefact | Owner | Required by |
|---|---|---|
| "Workforce" tenant configuration in the dashboard. | Backend + Frontend (roles 7, 14). | Phase 1 week 12. |
| Workstation simulator (web). | Frontend (role 15). | Phase 1 week 12. |

---

## Q&A bank — pre-emptive answers we will be asked

> **"What if the customer loses their phone?"**
Re-enrollment. The DID is voided in the registry; a new DID with a fresh commitment is created. KYC anchor (Aadhaar dip + video KYC artefact reference) is re-used. 90-second flow at the branch or via the app.

> **"What if the customer's biometric changes? Burn, surgery?"**
The fuzzy extractor tolerates up to 8 % Hamming distance on biometric features. Above that, re-enrollment. Same flow as phone loss.

> **"What about elderly users with poor fingerprint quality?"**
Two enrollment paths: face-only or face + R307 sensor. Face capture works on any Android with a front camera. R307 is the fallback when face fails (poor light, occlusion). Up to 5 % of customers may need branch-assisted enrollment.

> **"Does it work without internet?"**
Enrollment requires internet (one-time, for DID registration on-chain). Login/transaction require internet (for proof submission). Offline mode is on the v2 roadmap.

> **"What about Android phone diversity? Will it run on a Redmi 9?"**
StrongBox is required for production. Devices without StrongBox (mostly < 4-year-old budget devices) fall back to TEE-backed Keystore with a known security delta documented in `docs/operations/device-support-matrix.md`. Below TEE: explicit denylist.

> **"What is the IP position?"**
Patent IN202311041001 — Pramaan. Granted. ZeroAuth has exclusive commercial rights.

> **"What if SnarkJS / rapidsnark has a CVE?"**
Pinned versions. SBOM tracked. CVE monitor running daily. Roll-forward path documented in `docs/operations/dependency-cve-response.md`.

> **"What if Base mainnet rolls back / has a chain issue?"**
The hash chain remains valid off-chain. The on-chain anchor is a defence-in-depth; the bank's integrity check does not strictly require the anchor to pass. The on-chain anchor exists for the case where the off-chain database is also compromised.

> **"Where is the trusted setup?"**
Multi-party Phase 2 ceremony. Six contributors named in `docs/cryptography/trusted-setup-ceremony.md`. Transcripts hashed and published. ADR 0005.

> **"Quantum?"**
BN128 is a 128-bit security pairing-friendly curve. Not post-quantum. v2 will explore Plonk-over-PLONK + FRI for post-quantum. Roadmap, not Phase 1.

> **"Does this work for our merchant onboarding flow (RBI PA-PG guidelines)?"**
Yes — same protocol, different tenant configuration. Documented in `docs/integrations/merchant-onboarding.md`. Phase 2 deliverable.

> **"What is the SLA?"**
- Phase 1 (pilot): best-effort, target 99.5 %.
- Phase 3 (production): 99.95 % monthly, with credits on miss. Schedule in the MSA.

> **"What is the data-residency story?"**
All `live` environment data resident in `ap-south-1` (Mumbai) on AWS or in the bank's own VPC under VPN peering. Cross-border only for `test` environment.

---

## Operator script (compressed, for the day-of)

> "Good morning. I'm going to show you a working version of ZeroAuth running in production, not a sandbox. The demo is 22 minutes; questions at the end.
>
> The thesis: today, the database your customer credentials live in is the single largest piece of DPDP liability you carry. We replace that database with a cryptographic commitment that, even if fully exfiltrated, is not personal data under §2(t). I'll show you five scenes.
>
> **Scene one** — Mrs. Sharma enrolls in 90 seconds.
> *[run Scene 1, point to Basescan, point to the empty PII columns]*
>
> **Scene two** — she logs in to net banking. No SMS.
> *[run Scene 2, point to the SMS gateway billing dashboard at zero]*
>
> **Scene three** — she authorises a five-lakh NEFT. The proof is bound to the amount and the payee. Tampering at the wire fails.
> *[run Scene 3, do the substitution attack]*
>
> **Scene four** — assume your DBA gets phished tonight. What gets out?
> *[run Scene 4, walk through the empty users table, read §2(t)]*
>
> **Scene five** — assume one of your ops staff is corrupt and rewrites the audit log.
> *[run Scene 5, show the integrity break + on-chain anchor]*
>
> **Optional scene six** — your branch tellers, on their personal phones.
> *[run Scene 6 if time permits]*
>
> That's the protocol. Questions?"

---

## What "demo-ready" means as a phase 1 exit gate

The demo is considered exit-gate-ready when:

- [ ] All six scenes run end-to-end with no operator intervention beyond what is in the script.
- [ ] All six scenes run on a freshly provisioned Anchor-Bank tenant, not on a developer's dev environment.
- [ ] All scenes use real biometrics (CameraX face + R307 finger + BiometricPrompt) on a real consumer Android phone, not an emulator.
- [ ] All scenes verify real Groth16 proofs against the deployed `Groth16Verifier` on Base Sepolia.
- [ ] All scenes write rows to the production `audit_events` table with a verifiable hash chain.
- [ ] The audit-integrity check passes on a fresh database dump prior to the demo.
- [ ] The latency budget is met: enrollment ≤ 5 min, login ≤ 2 s p95, transaction step-up ≤ 3 s p95.
- [ ] The dashboard "Users" view exposes only the four allowed fields.
- [ ] No demo bypass exists in the codebase. `tests/proof-pairing.test.ts` asserts demo-DID rejection.
- [ ] `security-reviewer` and `cryptographer-reviewer` sub-agents have signed off on the demo path.
- [ ] The Anchor Bank operator runbook (`docs/operations/anchor-bank-demo-runbook.md`) is complete with screenshots.
- [ ] An incident-response dry run was successful: a deliberately bad proof is rejected, an alert fires, the operator can recover from a kiosk freeze without losing the demo.

---

LAST_UPDATED: 2026-05-27
