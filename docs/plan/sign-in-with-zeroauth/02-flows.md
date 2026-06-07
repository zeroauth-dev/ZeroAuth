# 02 — Protocol flows (user journeys)

Each flow below is the concrete handshake. They reuse the proven primitives
from the bank demo (three-QR registration, proof-pairing login, phone-push
authorize, the `/claim` desktop-bind) and generalize them to pairwise DIDs +
attributes + recovery.

Notation: **H** = holder (phone), **RP** = relying-party web/app, **Z** =
ZeroAuth backend.

---

## Flow A — One-time identity enrollment (happens once, ever)

The user installs the app and creates their root identity. No RP involved yet.

1. **Capture.** H runs the multi-step face ceremony (front/left/right/blink —
   already built) → derives the **master `biometric_secret`** on-device.
2. **Master secret bind.** H wraps the secret in StrongBox/Keystore.
3. **Recovery setup (mandatory, not skippable).** H generates a BIP39 phrase
   from the secret (or a separate seed HKDF-stretched into it), shows it once,
   requires the user to acknowledge. (See [04-recovery.md](04-recovery.md).)
4. **Attributes.** H collects name/email/phone. Email + phone get a one-time
   OTP verification (Flow E) → Z issues VCs. Name is self-asserted (flagged as
   such in its assurance).
5. **Done.** The phone now holds: master secret, recovery material, and a small
   set of attribute VCs. **Nothing identity-specific is on any RP yet, and Z
   holds no site graph.**

> Z's footprint after enrollment: the attribute VCs it *issued* (so it can be
> asked to revoke), plus the verification events. No face, no secret, no list
> of "accounts."

---

## Flow B — Create an account on a new site ("Sign up with ZeroAuth")

User is on `youtube.example`'s signup page.

1. **RP starts a session.** RP backend → `POST /v1/idp/sessions`
   (API-key-authed) with `{ purpose: "signup", attributes_requested:
   ["email","name"], assurance: "liveness+attribute" }`. Z returns
   `{ session_id, rp_id, qr_payload, expires_at }`.
2. **RP renders the QR** (and subscribes to the result stream — SSE or webhook).
3. **H scans the QR.** The payload carries `{ session_id, rp_id, rp_label,
   nonce, attributes_requested }`. H shows the user: *"youtube.example wants:
   your name + verified email. Continue?"*
4. **H derives the pairwise DID** `DID_rp = derive(master_secret, rp_id)` and
   confirms presence with a **face match + liveness** (the gate that unlocks
   the secret — already built).
5. **H builds the proof.** A Groth16 proof that binds: knowledge of the
   biometric secret, `commitment_rp`, and the session `nonce`. Plus the
   requested attribute disclosures (value + VC) for `email`, `name`.
6. **H pushes the result** → `POST /v1/idp/sessions/:id/present` (phone-push,
   no laptop camera — the model already shipped). Z verifies the proof +
   the VCs + the nonce binding.
7. **Z notifies the RP** (SSE/webhook) with the **verified assertion**:
   `{ did_rp, assurance: "liveness+attribute", claims: { email, name,
   email_verified: true } }`.
8. **RP decides (Decision 1).** RP looks up `did_rp` in *its* users table:
   - **not found** → create the account row with `did_rp` + claims. Show
     "Welcome!". **No password set, ever.**
   - **found** → this person already has an account → respond
     *"You already have an account — signing you in instead"* and bind the
     session (this is the "already exists" UX, decided by the RP).

```
H ──scan──► (QR) ◄──render── RP ──POST /sessions──► Z
H ──face+liveness──► unlock secret, derive DID_rp
H ──POST /present {proof, disclosures}──► Z ──verify──► assertion
Z ──webhook/SSE {did_rp, claims, assurance}──► RP
RP ──lookup did_rp in OWN db──► create | sign-in
```

---

## Flow C — Sign in to a site ("Sign in with ZeroAuth")

User returns to `youtube.example` and clicks "Sign in with ZeroAuth" (optionally
types their email/handle first to pre-route).

1. RP → `POST /v1/idp/sessions` `{ purpose: "signin", assurance: "liveness" }`.
2. RP renders QR + waits.
3. H scans → sees *"Sign in to youtube.example?"* → face match + liveness →
   derives `DID_rp` → builds proof bound to the nonce → phone-push present.
4. Z verifies → assertion `{ did_rp, assurance }` (no attributes needed for
   a returning sign-in unless the RP asks).
5. RP looks up `did_rp`:
   - **found** → sign in, mint the RP's own session. Done.
   - **not found** → *"No account here yet — want to sign up?"* (the inverse
     "doesn't exist" UX, again RP-decided).

This is the bank-demo login flow, generalized: pairwise DID instead of global,
RP instead of the hardcoded demo tenant.

---

## Flow D — New phone / lost phone (recovery)

The make-or-break flow. Full design in [04-recovery.md](04-recovery.md);
the user-visible shape:

1. User installs the app on a new phone → chooses **"Recover my identity."**
2. Enters the **BIP39 recovery phrase** → reconstructs the master secret.
3. **Re-enrols the face on the new device** (new camera → new template, but
   the *secret* is the recovered one, so all pairwise DIDs regenerate
   identically).
4. From here every site works again — because `DID_rp =
   derive(master_secret, rp_id)` reproduces the same DID the RP already stored.
   **No per-site re-registration; no RP involvement in recovery.**
5. The old device is implicitly de-authorized (presence moves to the new
   device); optionally the user revokes the old device's keys.

> Critical property: recovery touches **only the holder + Z's attribute
> re-binding**, never the RPs. Z still doesn't learn which RPs exist — the user
> simply regains the ability to reproduce each `DID_rp`.

---

## Flow E — Attribute verification (email / phone)

Runs during enrollment (Flow A step 4) or later when adding/refreshing an
attribute.

1. H → `POST /v1/idp/attributes/verify/start` `{ type: "email", value }`.
2. Z sends an OTP to the email/phone, stores only `{ challenge_id,
   value_commitment, expiry }` (not necessarily the plaintext beyond send).
3. User enters the OTP in the app → H → `.../verify/complete {challenge_id,
   otp}`.
4. Z checks the OTP → issues a signed VC: `sign_Z({ type:"email",
   value_commitment, verified_at, method:"otp" })` → returns it to H.
5. H stores the VC alongside the attribute. Z may now discard the plaintext;
   it retains issuance metadata so it can **revoke** if needed.

Predicate credentials (e.g. age-over-18 from a DOB or a KYC source) follow the
same issue-then-present pattern with a ZK predicate at presentation (P1+).

---

## Flow F — De-link / delete account at a site

1. User, in the app, chooses *"Remove my identity from youtube.example."*
2. H → the RP's own account-deletion endpoint (the RP owns the account, so
   deletion is the RP's action), optionally accompanied by a fresh proof of
   `DID_rp` to authorize it.
3. RP deletes its row. Z is not involved (it never had the mapping). The
   pairwise DID still *exists* derivably on the phone, but no RP holds it.

---

## Cross-cutting: the desktop-vs-phone channel

All web flows reuse the bank demo's hardened pattern:

- **Phone-push present** (the phone POSTs the proof) so no laptop camera is
  required.
- **Desktop-bind claim** (the `demo_portal_claim`-style cookie, now
  generalized per RP session) so the browser that started the session is the
  one that gets logged in — closing the session-fixation gap (threat A-13).
- **SSE / webhook** result delivery to the RP.

These already exist for the demo; P0 generalizes them from the demo tenant to
arbitrary RP sessions.

---

LAST_UPDATED: 2026-06-05
