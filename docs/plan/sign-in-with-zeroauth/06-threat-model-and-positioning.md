# 06 — Threat model deltas & competitive positioning

Two jobs: (1) enumerate the *new* attack surface this initiative opens beyond
the platform's existing threat model, with mitigations; (2) be brutally honest
about where this sits versus what already exists, so the pitch survives a
sophisticated room.

---

## Part 1 — New threat-model entries

These extend [docs/threat_model.md](../../threat_model.md). Each becomes a real
`A-NN` entry with a required test before its phase ships.

### A-IDP-1 — Cross-site correlation of a user

- **Class:** Information disclosure / privacy.
- **Description:** Two RPs (or a passive observer) try to determine that the
  same human is behind accounts at both — defeating the privacy promise.
- **Mitigation:** Pairwise DIDs (Decision 2) — different DID per RP, derived
  with an `rp_id`-scoped salt. No global identifier crosses RP boundaries. The
  audit log is RP-scoped so it can't be joined into a graph (A-IDP-6).
- **Residual:** Attribute *values* can correlate (same email at two RPs). Hence
  selective disclosure + (future) per-RP relayed/aliased email. Document that
  disclosing the same raw email to two RPs is inherently linkable.
- **Test:** two RP registrations from one phone yield distinct, non-correlatable
  DIDs.

### A-IDP-2 — Relying-party impersonation / namespace hijack

- **Class:** Spoofing / EoP.
- **Description:** A malicious RP claims another RP's `rp_id` (or a phishing
  site mimics a real RP's QR) to harvest a victim's DID or a sign-in.
- **Mitigation:** `rp_id` is **ZeroAuth-issued**, never user/RP-asserted in the
  derivation. The phone's consent screen shows a verified RP label + origin.
  Session nonce binding prevents proof replay across RPs. Redirect-URI
  allowlists for the OIDC/web flows.
- **Test:** a proof minted for `rp_a` is rejected at `rp_b`; an unregistered
  `rp_id` cannot open a session.

### A-IDP-3 — Attribute forgery / over-disclosure

- **Class:** Tampering / privacy.
- **Description:** (a) A holder presents a fake "verified email" VC; (b) an RP
  requests far more attributes than it needs.
- **Mitigation:** VCs are signed by ZeroAuth (or a delegated verifier); the RP
  verifies the signature. The phone's consent screen enumerates exactly what's
  requested and the user must approve; requested-attribute policy is registered
  per RP and rate-reviewed. Predicate proofs let the RP get a boolean instead
  of a value where possible.
- **Test:** a tampered VC fails verification; disclosure is exactly the
  requested set, no more.

### A-IDP-4 — Mass QR phishing ("scan to verify your KYC")

- **Class:** Social engineering (extends A-13/A-23 from the base model).
- **Description:** Attacker shows the victim a ZeroAuth QR for a session the
  *attacker* opened, hoping the victim authorizes it → attacker's browser is
  signed in as the victim.
- **Mitigation:** The desktop-bind claim cookie (generalized from the bank
  demo's `/claim` hardening) — the browser that *opened* the session is the only
  one that can complete it; a relayed QR doesn't carry the attacker's claim
  cookie. Phone consent shows the RP + purpose. Short TTL + visible countdown.
- **Test:** the A-13/A-23 suite, re-run against `/v1/idp/*`.

### A-IDP-5 — Recovery abuse (A-R1..A-R4)

- Phrase phishing, social-recovery coercion/collusion, re-bind replay,
  old-device resurrection. Mitigations detailed in
  [04-recovery.md](04-recovery.md): phrase never leaves device + app
  attestation; N-of-M quorum + notify + time-delay + cancel; nonce-bound +
  rate-limited + audited rebind; device-key revocation allowlist.

### A-IDP-6 — Audit log as a correlation oracle

- **Class:** Information disclosure.
- **Description:** A verbose central audit ("DID X authenticated at RP Y at
  time T") *recreates* the site graph we worked to deny (Principle 2).
- **Mitigation:** Audit rows are RP-scoped and stored so they can't be trivially
  joined across RPs on `DID` (e.g. log the pairwise DID, never a global one; keep
  cross-RP joins out of any single query path). The desktop-claim audit
  precedent (`pairing.desktop_claimed`) already follows scoped logging.
- **Test:** no query path returns "all RPs for a given human."

### A-IDP-7 — Spoofing the human (photo / video / deepfake)

- **Class:** Spoofing — the root of *presence* assurance.
- **Description:** Defeat the face gate with a printed photo, replayed video, or
  deepfake, producing a false `liveness` claim that every trusting RP inherits.
- **Mitigation:** Blink/active liveness today; passive liveness + screen-replay
  + deepfake detection + optional depth in P4 (ADR-0019 class). Assurance is
  never over-claimed (Decision 5) — if liveness wasn't run, the assertion says
  `presence`, and a bank-grade RP refuses it.
- **Test:** a defined photo/video/replay battery is blocked at the `liveness`
  bar.

### A-IDP-8 — Phone compromise / secret extraction

- **Class:** EoP. **Description:** rooted device extracts the master secret →
  full identity takeover across all RPs.
- **Mitigation:** StrongBox/Keystore hardware binding; app integrity attestation
  (Play Integrity); the secret is gated by liveness, not at-rest readable;
  device-key revocation on recovery. Honest residual: a fully compromised device
  is game-over for that device's identity — same as any wallet. This is why
  recovery + revocation matter.

---

## Part 2 — Honest competitive positioning

A sophisticated reviewer *will* ask "isn't this just X?" Pre-empt each.

### vs. Passkeys / FIDO2 / WebAuthn (the big one)

- **What they are:** a W3C standard for passwordless, phishing-resistant login
  with a device-bound key pair, already shipping in every major browser/OS,
  pushed by Apple/Google/Microsoft. Per-site credential, synced via the
  platform's password manager.
- **Where ZeroAuth overlaps:** passwordless, device-held key, no shared secret.
  If we pitch only "passwordless device key," the answer is "that's passkeys,
  and they have a billion-device head start."
- **Where ZeroAuth is genuinely different — lead with these:**
  1. **A portable *identity*, not per-site keys.** Passkeys give each site an
     unrelated keypair and carry **no attributes**. ZeroAuth carries verified
     name/email/phone the user can present anywhere with consent.
  2. **No platform vendor in the middle.** Passkeys are custodied/synced by
     Apple/Google. ZeroAuth's identity is self-sovereign — the user, not a
     platform, holds it.
  3. **The human, not just the device.** Passkeys authenticate a *device + a
     local unlock*; a borrowed-unlocked phone is the device owner. ZeroAuth's
     `liveness` assurance binds to the *live face*, which a regulated RP may
     require.
  4. **ZK selective disclosure.** Prove "verified email" / "over 18" without
     handing over more.
- **Don't fight, interoperate:** P4 can register a passkey as one of the
  holder's authenticators for low-friction returning sign-in — passkeys for
  convenience, ZeroAuth for identity + attributes + recovery portability.

### vs. Sign in with Apple / Google (federated OIDC)

- **Them:** one-click federated login; the IdP (Apple/Google) sees *every* RP
  you log into and can de-platform you. Apple's "Hide My Email" relays addresses.
- **ZeroAuth's edge:** **we deny ourselves the site graph by architecture**
  (Principle 2 / Decision 1), so we *can't* surveil or de-platform; self-
  sovereign vs vendor-custodied. The OIDC bridge (03) lets us *be* a "Sign in
  with…" button while keeping that property.

### vs. SSI / Verifiable Credentials / DID ecosystems (Sovrin, ION, EUDI Wallet)

- **Them:** the W3C DID + VC standards this plan deliberately aligns to;
  ecosystems exist but adoption + UX are the perennial hard part.
- **ZeroAuth's edge:** a *concrete, working* biometric-bound holder + a verifier
  network + a turnkey RP SDK — i.e. productized SSI with a face as the
  authenticator and a real recovery story, rather than a spec + a wallet shell.
  We should *use* VC/DID standards (interop), not reinvent them.

### vs. Aadhaar / India Stack / national eID

- **Them:** government-issued, centralized identity; powerful for KYC but a
  privacy/centralization concern; server-side biometric matching (not ZK).
- **ZeroAuth's edge:** privacy-preserving (biometric never leaves the device;
  ZK proofs), works across private RPs without a government dependency, and can
  *consume* a national eID as a high-assurance attribute source rather than
  replace it.

### The one-sentence positioning

> ZeroAuth is a **self-sovereign, face-bound identity** that logs you into any
> site **and** proves your verified attributes — passkey-grade convenience
> without a platform vendor owning your identity, and without any server (ours
> included) learning which sites you use.

### The honest risks to call out to investors (don't hide these)

1. **Recovery + adoption are the hard parts**, not the crypto. (P2 + the SDK.)
2. **Passkeys have enormous momentum**; the wedge is *portable verified
   identity + self-sovereignty*, a narrower but real claim.
3. **Anti-spoofing at scale** is an arms race that the `liveness` assurance bar
   depends on.
4. **Network effects** — value grows with RP count; needs a beachhead vertical
   (the BFSI/bank demo is a credible first one).

---

LAST_UPDATED: 2026-06-05
