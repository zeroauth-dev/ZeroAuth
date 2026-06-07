# 05 — Roadmap, milestones & exit gates

Phased so each phase is independently demoable and each ships with its
recovery + tests + threat-model updates (no phase is "done" until those land).
Durations are rough order-of-magnitude for a small team; treat as relative
sizing, not commitments.

Legend: **[exists]** reuse current code · **[extend]** modify · **[new]** net-new.

---

## P0 — Foundations: from one tenant to many relying parties (~4–6 wks)

**Goal.** Any RP can integrate sign-up + sign-in with pairwise DIDs. Closes the
demo-only shortcuts.

- ADRs ratified: *RP-owns-existence*, *pairwise-DID derivation* (cryptographer-
  reviewer sign-off). **[new]**
- Pairwise DID: salt-by-`rp_id` derivation in the circuit + `mobile/biometric`
  + `src/services/identity.ts`. Update the Groth16 circuit to bind `salt_rp`
  and the RP session nonce. **[extend]** — circuit change ⇒ `cryptographer-
  reviewer` + `circuit-review`.
- `/v1/idp/sessions` + `/present` + SSE, generalized from the demo bridge.
  **[extend]** of `proof-pairing.ts`.
- Generalize the **desktop-bind claim** + **phone-push present** from the demo
  tenant to arbitrary RP sessions. **[extend]**
- Replace the registration **peek-cache shortcut** with a real RP-driven QR2/QR3
  relay so registration works for any RP, not just the demo tenant. **[extend]**
  (This retires the prod-only gap fixed reactively in the bank demo.)
- Browser + server **SDK MVP** (button + verify). **[new]**
- Request-level tests for every endpoint; `security-reviewer` on the new auth
  surface; threat-model entries for cross-site correlation. **[new]**

**Exit gate.** Two *independent* demo RPs (e.g. `demo-bank` + `demo-video`)
each register + sign-in the *same* phone, and the two `DID_rp` values are
provably different (unlinkable), with all gates green and a security review
passed.

---

## P1 — Verified attributes (~3–5 wks)

**Goal.** RPs receive verified email/phone/name with selective disclosure.

- Email/phone **OTP verification** (Flow E) + VC issuance/signing service.
  **[new]**
- VC storage on-device + **selective disclosure** at present-time. **[extend]**
  of the mobile present path.
- `attributes_requested` + consent screen on the phone ("RP wants X, Y"). **[new]**
- Assurance levels wired end-to-end (`presence`/`liveness`/`+attribute`). **[extend]**
- First **predicate** proof (age-over-N) as a stretch. **[new]**
- `cryptographer-reviewer` on the VC scheme; `security-reviewer` on the
  consent + disclosure path; threat-model: attribute forgery, over-disclosure.

**Exit gate.** An RP requests "verified email + name," the phone shows a consent
screen, discloses exactly those, and the RP verifies the VC without contacting
the email provider. ZeroAuth retains no plaintext beyond issuance metadata.

---

## P2 — Recovery (~4–6 wks) — gating for consumer launch

**Goal.** Lose/replace the phone without losing accounts. **No consumer launch
before this.**

- BIP39 **recovery phrase** at enrollment (mandatory ack). **[new]**
- **"Recover my identity"** flow: phrase → secret → re-enrol face → DIDs
  regenerate (Flow D). **[new]**
- **Multi-device** enrollment + device-to-device secret transport (QR + ECDH).
  **[new]**
- `recovery/rebind` for attribute VC re-issuance. **[new]**
- Old-device **revocation** allowlist checked by the prover. **[extend]**
- Threat model A-R1..A-R4 (recovery abuse) + `security-reviewer`.

**Exit gate.** A user enrols on phone A, registers at 2 RPs, "loses" phone A,
recovers on phone B via phrase (and separately via multi-device), and signs in
to **both** RPs with the same DIDs — with the recovery paths rate-limited,
audited, and security-reviewed.

---

## P3 — Developer platform & OIDC (~4–6 wks)

**Goal.** Self-serve onboarding; "Sign in with ZeroAuth" as a standard OIDC
button; RS256/JWKS.

- **OIDC bridge** (`/.well-known`, authorize/token/userinfo/jwks) with `sub =
  did_rp`, attribute claims, `acr/amr` assurance. **[new]**
- Move platform JWTs to **RS256** + publish a real **JWKS** (already on the
  platform roadmap). **[extend]**
- Console: self-serve **RP onboarding**, redirect-URI allowlists,
  requested-attribute policy, publishable keys, quotas, count-only analytics.
  **[extend]** of `/api/console/*`.
- Docs site: "Add Sign in with ZeroAuth in 10 minutes" + OIDC + SDK reference.
  **[new]** under `docs/integrations`.

**Exit gate.** A third-party app integrates via the OIDC button against a
self-created RP, end-to-end, using only public docs — no ZeroAuth-team help.

---

## P4 — Advanced: face-as-key + social recovery + scale (research-paced)

**Goal.** The differentiating moat + resilience + scale.

- **Fuzzy extractor** (cross-device face-as-key) — the D-2 item from
  [bfsi-v1/todo-deferred.md](../bfsi-v1/todo-deferred.md). Device-fleet noise
  characterization → ECC tuning → entropy proof → external cryptographer review
  → superseding ADR. **[new, research]**
- **Social / guardian recovery** (Shamir N-of-M). **[new]**
- **Anti-spoofing** hardening: passive liveness, screen-replay + deepfake
  detection, optional depth (ADR-0019 class of work). **[new]**
- **Redis-backed** sessions/rate-limits for multi-instance scale-out (already a
  known platform gap). **[extend]**
- Assurance-level **certification** (align to NIST 800-63 / eIDAS where a
  regulated RP needs it). **[new]**
- Optional: **passkey interop** — register a FIDO2 passkey as one of the
  holder's authenticators for low-friction returning sign-in.

**Exit gate.** Same face recovers an identity on a *different* device with no
phrase, validated across a multi-device fleet, with external cryptographer
sign-off — and the anti-spoofing suite blocks a defined photo/video/replay test
battery.

---

## Dependency graph (what blocks what)

```
P0 pairwise-DID ──► P1 attributes ──► P3 OIDC/platform
       │                                  
       └────────► P2 recovery ──► (consumer launch gate)
                       │
                       └────► P4 fuzzy extractor / social recovery
P4 anti-spoofing strengthens every "liveness" assurance claim from P1 onward.
```

- **P2 recovery gates any consumer launch** (Principle 5).
- **P0 pairwise DID is the keystone** — attributes, recovery, and OIDC all
  assume it.
- P4 is parallelizable research; it does not block GA, it deepens the moat.

## Reviews & artifacts required per phase (non-negotiable, per CLAUDE.md)

- `cryptographer-reviewer` on every circuit / commitment / VC / recovery change.
- `security-reviewer` on every auth / tenant-boundary / recovery change.
- An ADR for each load-bearing decision *before* its phase implements.
- `docs/api_contract.md` updated before any endpoint lands; request-level test
  written first.
- `docs/threat_model.md` updated with each phase's new attack entries.

## Team mapping

This plan is sized for the existing roster shape in
[bfsi-v1/03-team.md](../bfsi-v1/03-team.md): a circuits/crypto pair (pairwise
DID, VCs, fuzzy extractor), a backend pair (`/v1/idp/*`, OIDC, recovery), a
mobile pair (pairwise derivation, disclosure UI, recovery UX), an SDK/DevRel
owner (SDK, docs, onboarding), and security/compliance review throughout.

---

LAST_UPDATED: 2026-06-05
