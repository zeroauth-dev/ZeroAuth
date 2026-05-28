# ADR 0023 — Three-QR end-user signup ceremony

- **Status:** Accepted
- **Date:** 2026-05-28
- **Phase:** Phase 1 sprint 2 (the "user creates an account" half of the BFSI demo)
- **Related:** ADR 0017 (face-first identity surface), ADR 0018 (mobile face embedding pipeline), ADR 0021 (RS256 JWT), ADR 0022 (production device-enrollment flow)

## Context

ADR 0022 gave us a way for an *operator* to register a *device* (kiosk, IoT bridge, phone) into a tenant's fleet. That's the right primitive for fleet onboarding but it's the wrong shape for the actual onboarding scene: an *end user* creating *their own account* on the *org's website* by *using their phone* as the credential carrier.

The end-user flow that the BFSI demo (and any post-Auth0 SaaS integration) actually needs:

1. Org has implemented ZeroAuth instead of Google Sign-In on their signup page.
2. End user fills in name + email + whatever the org wants (just like a Google Sign-In flow).
3. The signup page asks for a biometric. The user doesn't have a webcam-grade face capture, and the org doesn't want to ship a depth-camera-required SDK. The user's *phone* is the biometric capture device — but the org's server must never see the raw biometric.
4. After the user does the biometric on the phone, the signup page must somehow get *proof of biometric possession* tied to *this user's new account on this org's site* — without the phone ever talking directly to the org's site (different origins, different sessions, often different networks).

This is exactly the problem the [WebAuthn registration ceremony](https://www.w3.org/TR/webauthn-2/#sctn-registering-a-new-credential) solves for hardware security keys, except (a) the credential is a *biometric*, not a key, so the phone produces a *zero-knowledge proof* of biometric possession instead of a signature; (b) the phone has no Bluetooth pairing channel to the laptop; (c) we don't want a custom SDK on the laptop. The side channel that solves all three: QR codes on the laptop screen, scanned by the phone's camera.

The user described the flow exactly:

> "They'll register a device, by scanning a qr on their phone. Then enroll their biometrics on the phone and proof is getting generated. Then after biometric setup they'll scan the another qr on the platform that'll compare the device ids and the proof also get's transferred. Now after final confirmation when the user verifies their biometric on the phone and generates proof and by scanning a qr on the console the account finally get's created."

So: **three QRs**, one ceremony, biometric stays on the phone, server only ever sees the commitment and the proof. Same threat model as WebAuthn registration; same UX shape as Slack's "approve sign-in from a desktop" flow.

## Decision

Adopt the three-QR ceremony as the canonical end-user signup flow. Schema, service module, and a 7-endpoint API surface. The biometric pipeline (FaceEmbedder → Quantizer → SHA-256 → Poseidon → DID) already lives on-device per ADR 0018; this ADR is the *coordination protocol* that ties three on-device steps to one server-side account-creation transaction.

### State machine

`registration_sessions.state`:

| State                  | Meaning                                                                    |
|------------------------|----------------------------------------------------------------------------|
| awaiting_device        | Session opened by tenant SDK; `pair_code` outstanding; QR1 is on screen.  |
| awaiting_commitment    | Phone paired the device; `enroll_code` outstanding; QR2 is on screen.     |
| awaiting_verification  | Commitment received; `verify_code` + `challenge_nonce` outstanding; QR3.  |
| completed              | Proof verified; `tenant_user` row created; ceremony done.                  |
| abandoned              | Tenant called DELETE or whole-session TTL elapsed.                         |

Whole-session TTL is **30 minutes**. Each step's bearer code TTL is **15 minutes** (matches ADR 0022 device enrollment). The whole session can outlive a single code's TTL — if the operator stalls between scans, the next code is re-issued by the tenant SDK calling the start endpoint again on the same session row (Phase 1 Sprint 3 follow-on — V1 makes the operator restart).

### Codes

Three independent codes, each in its own row column:

- `pair_code_hash` — consumed at step 1
- `enroll_code_hash` — consumed at step 2
- `verify_code_hash` — consumed at step 3

Each is `ZA-XXXX-XXXX` (the same format as ADR 0022, reused via `src/services/device-enrollment.ts::generateEnrollmentCode`). Each is stored as SHA-256, returned in plaintext exactly once. Each step's handler reads only its own column — a captured `pair_code` cannot satisfy the `submit-commitment` handler, and so on. This blocks the confused-deputy class of attack where someone replays an old QR into a later step.

### Challenge nonce (replay defence)

After step 2, the server mints `verify_challenge_nonce` (128 bits hex, single-use, scoped to this row) and bakes it into QR3's deeplink. The phone echoes the nonce back with the proof in step 3; the server checks it matches what it issued.

**V1 limitation:** the challenge_nonce is bound to the *request*, not to the *proof itself*. The existing identity_proof.circom (v1.2) doesn't yet have a public-input slot for a session challenge — `publicSignals[0]` is the commitment and that's it. Replay across sessions is therefore prevented by:

- The single-use `verify_code` (an old proof can't be submitted into a fresh session because the fresh session has a different `verify_code_hash`).
- The 15-minute TTL on `verify_code_expires_at`.
- The per-IP rate-limit (20 req/min on the phone-side endpoints).

**Phase 1 Sprint 4 follow-on:** circuit v1.3 adds a public-input slot for the challenge nonce; the route handler then asserts `publicSignals[1] === verify_challenge_nonce` *and* the proof verifies — closing the proof-replay surface entirely. The deeplink format and route surface stay stable; only the circuit upgrades.

### Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/v1/registrations` | tenant API key (users:write) | Start session; returns `pair` envelope for QR1. |
| GET | `/v1/registrations/:id` | tenant API key (users:read) | Poll state (redacts code hashes + challenge nonce). |
| DELETE | `/v1/registrations/:id` | tenant API key (users:write) | Abandon session; idempotent on completed rows. |
| POST | `/v1/registrations/pair-device` | **none — `pair_code` is bearer** | Step 1: phone claims a device. |
| POST | `/v1/registrations/submit-commitment` | **none — `enroll_code` is bearer** | Step 2: phone uploads (did, commitment). |
| POST | `/v1/registrations/complete` | **none — `verify_code` is bearer** | Step 3: phone uploads proof; tenant_user is created. |

The three phone-side endpoints are listed in `tests/tenant-isolation.test.ts::PUBLIC_ROUTE_EXCEPTIONS` for the same reason `/v1/devices/enroll`, `/v1/zkp/verify`, and the proof-pairing public endpoints are: the QR-supplied code is the bearer credential and there is no tenant API key available on the phone side.

### What the phone sends, what the server sees

| Step | Phone sends | Server sees | What's NOT sent |
|------|-------------|-------------|-----------------|
| 1 | `pair_code`, `fingerprint` (≥16 chars, opaque), `attestation_kind?` | SHA-256(fingerprint); attestation kind string | the biometric, the secret, the commitment |
| 2 | `enroll_code`, `did` (`did:zeroauth:<method>:<hex>`), `commitment` (hex) | the DID + commitment as strings | the secret, any biometric data |
| 3 | `verify_code`, `challenge_nonce`, `proof` (Groth16), `public_signals` | the proof + the commitment in `publicSignals[0]` | the secret, the embedding |

The biometric NEVER touches a network wire. Source-grep guard `tests/biometric-rejection.test.ts` continues to block any handler reading `req.body.image/template/pixel/depth/frame/raw_face/raw_finger/biometric_data/photo`; the registration ingress is also defended at the JSON-body layer by `sanitizeProfile` (regex-stripped before insert) so a buggy tenant SDK that *does* pass one of those keys gets the key dropped, with a warn log, rather than committed to the row.

### Audit-log surface

Six new actions, all routed through `appendAuditEvent` so they land in the ADR 0013 hash chain:

- `registration.started` — tenant SDK opened a session
- `registration.device_paired` — actor_type='device', step 1 completed
- `registration.commitment_submitted` — actor_type='device', step 2 completed
- `registration.completed` — actor_type='device', step 3 completed, tenant_user created
- `registration.abandoned` — tenant SDK or admin cancelled

The plaintext codes and the challenge_nonce never appear in audit metadata. Step-2 metadata records `commitmentPrefix` (first 16 chars) but not the full commitment — sufficient to forensically correlate without leaking the value into a log retention window broader than the tenant_users row.

### Backwards compatibility

This is purely additive — no existing route, no existing column, no existing test breaks. The new `registration_sessions` table is independent of `devices` and `tenant_users` apart from FK relationships (`device_id`, `tenant_user_id`) that are nullable until the relevant step lands. The existing `/v1/identity/register` and `/v1/identity/verify` continue to work for non-ceremony integrations (an SDK that wants to do its own session orchestration can call them directly).

## Alternatives considered

1. **One QR with embedded state machine** — the user's phone scans one QR, opens a websocket-like channel, and the server pushes step transitions over SSE. Drops 2 QR scans but loses the explicit "I agree to this step" UX moment + lets a stale phone hold an open session indefinitely. Rejected.

2. **WebSocket from phone to server** — strictly stronger than QR2 + QR3 (server pushes everything once paired). Requires the phone app to be persistently connected; doesn't degrade if the phone goes offline mid-ceremony; requires SSL termination on the load balancer for ws://. Defer until we have a measured pain point.

3. **Server-side biometric verification (skip the phone)** — abandons the privacy guarantee that makes ZeroAuth different from every legacy product. Out of scope.

4. **Native deep-link callback (universal links / app links)** — the phone opens a `https://zeroauth.dev/reg/...` URL that triggers the companion app and embeds session state in the URL. Strictly an *additional* surface on top of QR — useful when the operator is on the same device as the user (rare for this BFSI flow) but doesn't replace QR for the cross-device case. Add later as an alternate scheme.

5. **Single shared "registration_token" instead of three codes** — collapses the three SHA-256 columns into one. Loses the per-step confused-deputy defence. Rejected.

## Out of scope (deferred)

- **QR rendering in the dashboard.** Server returns the deeplink; the SDK / dashboard renders it as a QR. V1 ships the deeplink alone (no `qrcode` dep, matching ADR 0022's deferral). A follow-up commit adds the dep with its own ADR.
- **Circuit-bound challenge nonce.** Phase 1 Sprint 4 circuit upgrade adds `publicSignals[1]` for the session challenge. The deeplink already carries the nonce; the route handler will assert circuit-side binding when the new circuit ships.
- **Per-device token after enrollment.** Step 1 binds a `fingerprint_hash` to a device row; step 3 binds the device to a tenant_user. The device gets no long-lived bearer credential yet — that lands with the heartbeat protocol in Phase 1 Sprint 4 (same path as the ADR 0022 follow-on).
- **Real-time SSE stream for the platform.** V1 has the tenant SDK poll `GET /v1/registrations/:id` every 2–3 seconds. SSE is a clean upgrade (the proof-pairing flow already does it) — defer until the BFSI demo reveals latency complaints.
- **Per-tenant profile schema validation.** V1 accepts an opaque `profile` blob with biometric-key sanitisation only. Tenant-specific schemas (e.g., bank-onboarding requires PAN + Aadhaar masked digits + employee_code) come with the per-tenant `tenant.security_policy.registration_schema` JSON Schema validator in Phase 2.
- **End-user-facing demo UI** in the dashboard. V1 ships backend only — the dashboard `Devices.tsx` redesign from ADR 0022 is the operator-facing surface. The 3-QR demo page (mirroring the existing `demo/QrProofLogin` route shape) lands in a follow-up commit.

## Verification

- `tests/registration-flow.test.ts` — 19 tests across the four service-layer entry points and their failure modes; mocked pg pool so no Postgres is required.
- `tests/tenant-isolation.test.ts` — three new PUBLIC_ROUTE_EXCEPTIONS entries with reason strings ≥ 20 chars.
- `tests/schema-purity.test.ts` — `registration_sessions` added to both TENANT_SCOPED_TABLES (biometric-name guard applies) and KNOWN_TABLES (new-table guard satisfied).
- `npm test` — 524/524 across 44 suites.
- `npx tsc --noEmit` — clean.

## Threat model deltas

New rows added to `docs/threat_model.md` (Phase 1 sprint 2 update batch):

- **A-30** — Captured QR1 / QR2 / QR3 replay. Mitigation: per-step single-use SHA-256-hashed code, 15-min TTL, per-IP rate-limit, three separate code columns block cross-step reuse.
- **A-31** — Hostile phone enrolls into another user's session by guessing the pair_code. Mitigation: 38-bit code entropy × 15-min TTL × 20 req/min/IP rate-limit ≈ 225,000× window-length brute-force cost. Same calibration as ADR 0022.
- **A-32** — Replayed proof from another session. V1 mitigation: single-use verify_code chain + 15-min TTL. Phase 1 Sprint 4 closure: circuit-bound challenge nonce in `publicSignals[1]`.
- **A-33** — Tenant SDK passes a raw biometric in the `profile` blob. Mitigation: `sanitizeProfile` strips any field name containing image/template/pixel/depth/frame/raw_face/raw_finger/biometric/photo (with word-boundary matching) at ingest; warn-logged.

The full threat-model table is updated alongside this commit's API contract changes; this ADR captures the four deltas.
