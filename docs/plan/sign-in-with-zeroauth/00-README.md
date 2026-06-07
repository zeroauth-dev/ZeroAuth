# Sign in with ZeroAuth — universal passwordless identity

> **Status:** Plan / pre-implementation. This is a planning document set, not
> shipped architecture. Where it says "today" it describes the current
> codebase; everything else is proposed.
>
> **One-liner:** Turn ZeroAuth from a per-customer biometric auth layer into a
> portable, self-sovereign identity that replaces passwords across every
> website — "Sign in with ZeroAuth."

---

## The idea

Every consumer installs the ZeroAuth app once and enrolls **one identity**:
their face (held on-device as a secret) plus basic verified attributes (name,
email, phone). From then on:

- **Create an account anywhere** (YouTube, a bank, a store): the website asks
  for whatever it needs, the user fills the required fields — auto-filled from
  their on-phone identity where possible — then scans a QR and confirms with
  their face on the phone. Account created. No password ever set.
- **Sign in anywhere:** the user enters their email/handle, the site shows a
  QR, the user confirms on the phone. Signed in. No password ever typed.
- **"Already exists / doesn't exist"** is answered by the *website*, not by
  ZeroAuth — the site checks whether the presented identity is already in its
  own users table and routes the user to sign-in vs sign-up accordingly.

The person is the credential. Passwords disappear.

## How this differs from what exists today

Today ZeroAuth is a **per-tenant** biometric auth product: each customer
(e.g. the Anchor Bank / NeoBank demo) is a tenant, and a user registers
*separately* per tenant. The hosted bank demo
([docs/plan/bfsi-v1](../bfsi-v1/00-README.md)) is, in effect, a single-site
instance of this larger idea.

"Sign in with ZeroAuth" generalizes that to a **multi–relying-party identity
network**: one on-phone identity, reused across many independent websites,
with cross-site privacy by construction.

| | Bank demo (today) | Sign in with ZeroAuth (this plan) |
|---|---|---|
| Identity scope | Per tenant | One identity, many relying parties |
| DID | Global (same on every site) | **Pairwise** (unlinkable per site) |
| Attributes | None | Verified name/email/phone, selectively disclosed |
| "Account exists?" | N/A | Relying party checks its own table |
| Recovery | Deferred TODO | **First-class, load-bearing** |
| Integration | Hardcoded demo bridge | Public SDK + OIDC bridge |

## Scope

**In scope (this plan):**

1. A **relying-party (RP) model** — any website integrates "Sign in with
   ZeroAuth" with a console-minted API key + a drop-in SDK.
2. **Pairwise DIDs** so a user is consistent within a site but unlinkable
   across sites.
3. **Verifiable attributes** — name/email/phone enrolled + verified once,
   then selectively disclosed to RPs at signup.
4. **Account-existence routing** owned by the RP ("already exists → sign in").
5. **Recovery** — lost phone / new phone must not mean losing every account.
6. **Developer surface** — SDK, OIDC bridge, self-serve onboarding, docs.

**Out of scope (explicit non-goals):**

- ZeroAuth becoming a data broker. We never build a profile of which sites a
  user belongs to. (See Principle 2.)
- Replacing the RP's own authorization/session logic. We assert *identity*;
  the RP still owns roles, sessions, and access control.
- Custodying user funds, documents, or government-ID issuance. ZeroAuth
  verifies presence + attribute possession, not statehood.
- Inventing new cryptography where a reviewed standard exists. Prefer
  Groth16/Poseidon (already in use), BIP39, BBS+/AnonCreds, OIDC, FIDO2.

## Guiding principles (the standing constraints)

These are load-bearing. Every design decision and PR in this initiative must
hold all of them.

1. **The biometric never leaves the device.** Unchanged from the platform
   non-goals — the wire carries proofs + commitments + signatures only.
2. **ZeroAuth never learns the user's site graph.** No server-side mapping of
   "DID → which relying parties." Account existence is the RP's question,
   answered against the RP's own data. A ZeroAuth breach must not reveal who
   uses what.
3. **Pairwise by default.** A user presents a *different* DID to every RP.
   Cross-site linkage is opt-in (e.g. the user explicitly links two accounts),
   never the default.
4. **The relying party owns the account.** ZeroAuth provides a verified
   identity assertion; the RP decides what to do with it (create, match, deny).
5. **Recovery is a feature, not an afterthought.** No flow ships until its
   recovery path ships. Losing a phone cannot mean losing one's digital life.
6. **Attributes are verifiable and minimal.** RPs receive the least they need,
   with proof of verification, never raw ZeroAuth-held PII dumps.
7. **No vendor in the middle.** Unlike platform passkeys, the identity is not
   custodied by Apple/Google. ZeroAuth is a verifier/coordinator, not an owner.
8. **Standards-aligned at the edges.** Offer an OIDC "Sign in with ZeroAuth"
   button so RPs integrate with zero new concepts; interoperate with FIDO2
   where it helps rather than competing head-on.
9. **Assurance is explicit.** Every assertion carries an assurance level
   (presence-only vs liveness-verified vs attribute-verified), so RPs choose
   the bar they need (cf. NIST IAL/AAL).
10. **Every RP/identity action is audited** in a tamper-evident log, scoped so
    the audit itself doesn't become a cross-site correlation oracle.

## Phase map

Detailed in [05-roadmap.md](05-roadmap.md). At a glance:

- **P0 — Foundations.** Generalize the tenant model into relying parties;
  pairwise DIDs; SDK MVP; the generalized register/sign-in flow (closes the
  demo-only "peek" gap from the bank demo).
- **P1 — Verified attributes.** Email/phone OTP at enrollment; verifiable
  credential issuance; selective disclosure to RPs at signup.
- **P2 — Recovery.** Recovery phrase + multi-device enrollment; the
  "new phone, same identity" path.
- **P3 — Developer platform.** OIDC bridge; self-serve RP onboarding in the
  console; quotas, analytics, docs.
- **P4 — Advanced.** Fuzzy-extractor (face-as-key cross-device), social /
  guardian recovery, scale + assurance-level certification.

## Document map

| Doc | What it covers |
|---|---|
| [01-architecture.md](01-architecture.md) | The load-bearing decisions + actors + trust model |
| [02-flows.md](02-flows.md) | Every user journey as a concrete protocol flow |
| [03-api-and-sdk.md](03-api-and-sdk.md) | Endpoints, the RP SDK, the OIDC bridge |
| [04-recovery.md](04-recovery.md) | The recovery model in depth (the make-or-break) |
| [05-roadmap.md](05-roadmap.md) | Phased milestones, exit gates, code mapping |
| [06-threat-model-and-positioning.md](06-threat-model-and-positioning.md) | New threats + honest competitive positioning |

## Glossary

- **Holder** — the user + their phone, which holds the master secret and
  attributes.
- **Relying Party (RP)** — a website/app that integrates "Sign in with
  ZeroAuth" to authenticate its users. Each RP is a ZeroAuth tenant.
- **Verifier / Coordinator** — the ZeroAuth backend: mints session
  challenges, verifies ZK proofs, anchors RP-scoped commitments, attests
  attributes. It is *not* an identity owner.
- **DID** — decentralized identifier. Today `did:zeroauth:face:<suffix>`.
- **Pairwise DID** — a per-RP DID derived deterministically from the master
  secret + the RP's identifier, so the same person is unlinkable across RPs.
- **Master secret** — the on-device root secret (today derived from the face
  template) from which pairwise DIDs and commitments are derived.
- **Verifiable Credential (VC)** — a signed attribute the holder can present +
  prove without the verifier re-checking the source (e.g. "email verified").
- **Selective disclosure** — revealing only the attributes an RP needs (and
  sometimes only a predicate, e.g. "over 18") rather than the full set.
- **Assurance level** — how strongly an assertion is backed (presence,
  liveness, attribute-verified). Mirrors NIST 800-63 IAL/AAL.

---

LAST_UPDATED: 2026-06-05
OWNER: Pulkit Pareek (engineering) + Amit Dua (product)
STATUS: Draft plan — pending review + ADR ratification of the core decisions in 01-architecture.md
