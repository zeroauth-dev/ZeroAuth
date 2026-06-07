# 01 — Architecture & load-bearing decisions

This document pins the decisions that everything else depends on. Each one
that is hard to reverse should graduate into a numbered ADR under `/adr/`
before P0 implementation (the ADR column flags which).

## Actors & trust boundaries

```
            ┌────────────────────────────────────────────────────────────┐
            │                      HOLDER (the user)                      │
            │  ZeroAuth app on the phone:                                 │
            │   • master secret (StrongBox/Keystore-bound)               │
            │   • face template (never leaves device)                    │
            │   • verified attributes (name/email/phone) as VCs          │
            │   • recovery material                                       │
            └───────────────┬───────────────────────────┬────────────────┘
                            │ scans QR / pushes proof    │ holds, discloses
                            ▼                            ▼
   ┌────────────────────────────────┐      ┌────────────────────────────────┐
   │   RELYING PARTY (a website)    │◀────▶│   ZEROAUTH (verifier/coord.)   │
   │   • owns its own user table    │ SDK  │   • mints session challenges   │
   │   • decides create vs sign-in  │ +    │   • verifies ZK proofs         │
   │   • stores the pairwise DID     │ API  │   • attests attributes (VCs)   │
   │   • never sees the biometric    │      │   • NEVER stores RP↔user graph │
   └────────────────────────────────┘      └────────────────────────────────┘
```

**Trust assumptions:**

- The holder's phone is the root of trust for *presence* (the right person is
  here, now). StrongBox/Keystore + liveness back this.
- ZeroAuth is trusted to *verify* correctly (run the Groth16 check, attest
  attributes honestly) but is **not** trusted with the user's privacy graph —
  the architecture denies it that data rather than relying on policy.
- The RP is trusted to store the pairwise DID it receives and make its own
  account decision. The RP is *not* trusted with the biometric (never sees it).

---

## Decision 1 — The relying party owns account existence

**Decision.** "Does this person already have an account here?" is answered by
the **RP against its own user table**, keyed by the pairwise DID. ZeroAuth
never maintains a `DID → which RPs` mapping.

**Why.** This is the difference between ZeroAuth and a surveillance company. If
our servers knew "DID X has YouTube + a bank + a dating app," a breach (or a
subpoena) exposes everyone's web footprint — the exact opposite of the
breach-proof / zero-knowledge pitch. Denying ourselves that data by
architecture (not policy) is the moat *and* the ethic.

**Mechanics.**
- At sign-up/sign-in, the holder proves control of `DID_rp` (the pairwise DID
  for that RP — Decision 2).
- ZeroAuth returns to the RP a verified assertion: `{ did_rp, attributes?,
  assurance }`. ZeroAuth does **not** record that this RP saw this DID beyond
  the minimal, RP-scoped audit row (Decision 8).
- The RP looks up `did_rp` in *its* `users` table:
  - found → route to **sign-in**, bind the session.
  - not found → route to **sign-up**, create the row with `did_rp` + disclosed
    attributes.
- The "already exists, sign in instead" UX is therefore an RP-side branch on
  its own data, not a ZeroAuth lookup.

**ADR:** `ADR-00XX — relying party owns account existence` (ratify in P0).

---

## Decision 2 — Pairwise DIDs (per-RP, unlinkable)

**Decision.** The holder derives a **different DID per relying party**,
deterministically from the master secret and the RP's stable identifier:

```
DID_rp = derive(master_secret, rp_id)
```

where `rp_id` is a stable, ZeroAuth-issued RP identifier (NOT a user-supplied
domain, to prevent an RP from impersonating another's namespace).

**Why.** Today the DID is *global* — `did:zeroauth:face:<suffix>` is identical
on every site, because it's `sha256(commitment)[:20]` and the commitment is the
same everywhere. A global DID is a cross-site supercookie: two RPs (or a
network observer) can correlate the same user. Pairwise DIDs make the user
*consistent within an RP* (so "already exists" works) but *unlinkable across
RPs*. This is the standard SSI / Sign-in-with-Apple-"Hide-My-Email" posture.

**Derivation (proposed, to be pinned by cryptographer-reviewer).**

```
salt_rp        = HKDF(master_secret, info = "zeroauth/pairwise/" || rp_id)
commitment_rp  = Poseidon(biometric_secret, salt_rp)
DID_rp         = "did:zeroauth:" || base32(  keccak256(commitment_rp)[:16]  )
```

- `biometric_secret` stays the same root; only the **salt** is RP-scoped, so
  the same face yields the same `DID_rp` for a given RP forever, but unrelated
  values across RPs.
- The ZK circuit proves knowledge of `biometric_secret` such that
  `Poseidon(biometric_secret, salt_rp) == commitment_rp` *and* binds the RP
  session nonce — so a proof for `RP_a` cannot be replayed at `RP_b`.

**Interactions.**
- **Recovery** (04): recovering the master secret regenerates *every*
  pairwise DID deterministically — so one recovery restores all accounts.
- **Linking** (optional, future): a user who *wants* two RPs to share an
  identity can present a linking proof; opt-in only.

**Open question for the circuit team.** Whether `salt_rp` is a public input
(RP-known) or blinded. Leaning public-but-RP-scoped: the RP knows its own
`salt_rp`/`rp_id`, which is fine; the unlinkability comes from RPs not sharing.
For stronger guarantees, a blinded variant + BBS+ presentation is a P4 option.

**ADR:** `ADR-00XX — pairwise DID derivation` (ratify in P0; cryptographer-
reviewer sign-off required).

---

## Decision 3 — Verified attributes as selectively-disclosed credentials

**Decision.** Name/email/phone (and later: DOB, address, KYC tier) are held on
the phone as **verifiable credentials**. At signup the holder discloses the
subset an RP requests, with proof of verification, and ZeroAuth never re-sees
the raw value at disclosure time.

**The attestation problem.** A self-typed email is worthless to an RP. So
attributes have a lifecycle:

1. **Enrolled** — user types name/email/phone in the app.
2. **Verified** — a one-time challenge proves control: email OTP, phone OTP.
   The verifier (ZeroAuth, or a delegated verifier) signs a credential:
   `VC = sign_zeroauth({ attr: "email", value_hash, verified_at, method })`.
   The *value* is hashed/committed; ZeroAuth need not retain the plaintext
   after issuing the VC (privacy).
3. **Presented** — at signup the holder shows the RP the attribute value +
   the VC proving "ZeroAuth verified this email on <date>". The RP checks the
   VC signature; it does **not** need to re-verify the email.

**Selective disclosure & predicates.** The holder reveals only what's asked:
- "Give me your verified email" → value + VC.
- "Are you over 18?" → a ZK predicate proof over a DOB credential, revealing
  *only the boolean*, not the DOB. (BBS+/AnonCreds-style; P1+ for predicates.)

**Why VCs and not "ZeroAuth has your profile, RP queries it."** The latter
makes ZeroAuth a PII honeypot and a per-request tracker of who-asked-what
(violates Principle 2). VCs put the data on the phone; ZeroAuth only signs,
once, at verification time.

**ADR:** `ADR-00XX — attribute credential model + email/phone verification`.

---

## Decision 4 — Recovery model (summary; full design in 04)

**Decision.** Recovery is layered and shipped before the dependent flow:

1. **Recovery phrase (BIP39)** at enrollment — the cryptographic root of
   recovery. Restores the master secret on a new device → regenerates all
   pairwise DIDs.
2. **Multi-device enrollment** — the same identity on a second device (tablet,
   backup phone) as a redundancy + a recovery channel.
3. **Social / guardian recovery** (P4) — N-of-M trusted contacts can authorize
   a re-bind.
4. **Fuzzy extractor** (P4) — "your face *is* the key on any device," removing
   the need to carry a phrase. Research-grade; the aspirational endpoint.

**Why layered.** The phrase is mature and ships first; it is the safety net.
The fuzzy extractor is the dream but is months of cryptographer-grade work and
must not block launch. See [04-recovery.md](04-recovery.md).

**ADR:** `ADR-00XX — identity recovery model`.

---

## Decision 5 — Trust & assurance model

**Decision.** Every assertion ZeroAuth returns to an RP carries an **assurance
level**, and the RP chooses the minimum it requires (cf. NIST 800-63
IAL/AAL).

| Level | Means | Backed by |
|---|---|---|
| `presence` | "A ZeroAuth device authorized this" | device-bound key + session nonce |
| `liveness` | "A live human, not a photo" | blink/active liveness at capture |
| `attribute` | "+ verified email/phone/etc." | the relevant VC(s) |
| `bound` | "+ this is the same person who registered here" | pairwise-DID match at the RP |

- The RP states its bar in the SDK call (e.g. a comment site needs
  `presence`; a bank needs `liveness + attribute + bound`).
- ZeroAuth refuses to *over-claim*: if liveness wasn't run, the assertion says
  `presence` only. The RP decides whether that's enough.

**Liability.** ZeroAuth attests *what it verified*. The RP remains responsible
for its own authorization decisions. This boundary must be explicit in the
terms + the docs, and is why assurance levels are first-class.

**ADR:** `ADR-00XX — assurance levels`.

---

## Decision 6 — ZeroAuth's role: verifier/coordinator, not identity owner

**Decision.** ZeroAuth is a **network service** that (a) brokers the
QR/proof-pairing handshake, (b) verifies ZK proofs, (c) issues attribute VCs,
and (d) anchors RP-scoped commitments. It is explicitly **not**:

- a place the identity "lives" (the identity lives on the phone),
- a custodian of the user's site graph (Decision 1),
- a holder of raw biometrics (Principle 1).

This keeps the breach-proof story intact: a full compromise of ZeroAuth's
database yields RP-scoped commitments + DIDs + VCs-issued metadata, but not
biometrics, not secrets, not "who uses what."

**Blockchain.** Per [ADR-0017](../../../adr/0017-blockchain-agnostic-posture.md)
the on-chain anchor remains *opt-in*. Pairwise-DID commitments and the audit
chain work off-chain by default; an RP that wants on-chain anchoring of its
DIDs can opt in via `security_policy`. This plan does not require a chain.

---

## Decision 7 — Interop: an OIDC "Sign in with ZeroAuth" bridge

**Decision.** Ship a standards bridge so an RP can integrate via **OpenID
Connect** — the same way they'd add "Sign in with Google" — without learning
ZeroAuth-specific concepts.

- ZeroAuth exposes an OIDC provider surface: `/.well-known/openid-configuration`,
  an authorization endpoint that renders the QR/proof-pairing handshake, a token
  endpoint that returns an ID token whose `sub` is the **pairwise DID** and
  whose claims are the disclosed attributes.
- This makes "Sign in with ZeroAuth" a drop-in button for the millions of apps
  that already speak OIDC. The native SDK (03) remains available for richer
  flows (predicates, custom assurance).

**Relationship to FIDO2/Passkeys.** We do not fight WebAuthn; we offer what it
lacks — a *portable identity with verified attributes*, not a per-site keypair.
A later option is to *wrap* a passkey as one of the holder's authenticators.
See [06](06-threat-model-and-positioning.md).

**ADR:** `ADR-00XX — OIDC bridge` (P3).

---

## What changes in the current codebase (orientation for implementers)

| Area | Today | Becomes |
|---|---|---|
| `tenants` | A customer org | A **relying party**; same table, new semantics + `rp_id` |
| DID derivation (`src/services/identity.ts`, `mobile/biometric/`) | Global DID | **Pairwise** — salt scoped by `rp_id` |
| `tenant_users` | Per-tenant user | Per-RP account row, keyed by `did_rp` |
| Registration peek cache (`registration.ts`) | Demo-only shortcut | Replaced by a real RP-driven QR2/QR3 relay (closes the bank-demo gap) |
| Proof-pairing (`proof-pairing.ts`) | Per-tenant login | Per-RP login with pairwise-DID + assurance |
| (new) attribute service | — | VC issuance + email/phone verification |
| (new) recovery service | — | phrase + multi-device |
| (new) RP SDK + OIDC bridge | demo bridge only | public developer surface |

---

LAST_UPDATED: 2026-06-05
