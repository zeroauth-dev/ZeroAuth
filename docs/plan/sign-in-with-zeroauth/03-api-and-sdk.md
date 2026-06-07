# 03 — API surface & relying-party SDK

Goal: a developer adds "Sign in with ZeroAuth" in an afternoon. Two
integration tiers — **native SDK** (richest) and **OIDC bridge** (zero new
concepts). All new endpoints live under `/v1/idp/*` and reuse the existing
tenant-API-key auth + scope model.

> Contract discipline: every endpoint here must be added to
> [docs/api_contract.md](../../api_contract.md) before implementation, with a
> request-level test written first (per the repo CLAUDE.md standing rules).

---

## New API endpoints (`/v1/idp/*`)

All RP-facing endpoints are authed with the RP's `za_live_…` / `za_test_…`
API key and gated by new scopes: `idp:session:create`, `idp:session:read`,
`idp:attributes:verify`.

### Sessions

```
POST /v1/idp/sessions
  auth:  Bearer za_live_…   scope: idp:session:create
  body:  { purpose: "signup"|"signin",
           attributes_requested?: ["email","name","phone", ...],
           assurance: "presence"|"liveness"|"liveness+attribute"|"bound",
           redirect_uri?: string,            // for OIDC/web redirect flows
           webhook?: { url, secret } }       // optional push delivery
  200:   { session_id, rp_id, qr_payload, deeplink, expires_at }

GET  /v1/idp/sessions/:id            scope: idp:session:read
  200:   { state: "pending"|"presented"|"verified"|"expired"|"failed",
           assertion?: { did_rp, assurance, claims } }   // claims only when verified

GET  /v1/idp/sessions/:id/events     // SSE result stream (mirrors demo-portal SSE)
```

### Phone-side present (holder; no RP API key — proof is the credential)

```
POST /v1/idp/sessions/:id/present
  body:  { proof, public_signals, did_rp, disclosures?: [{ type, value, vc }] }
  200:   { ok: true }                  // verified server-side; RP notified via SSE/webhook
  4xx:   { error: "proof_invalid" | "nonce_mismatch" | "assurance_unmet" | ... }
```

### Attribute verification (holder)

```
POST /v1/idp/attributes/verify/start     { type: "email"|"phone", value }
  200: { challenge_id, expires_at }
POST /v1/idp/attributes/verify/complete   { challenge_id, otp }
  200: { vc }                              // signed verifiable credential
```

### Recovery (holder)

```
POST /v1/idp/recovery/rebind             // re-attest attributes to a recovered secret
  body: { recovery_proof, new_device_pubkey }
  200:  { ok, reissued_vcs: [...] }
```

> Note what is **absent by design**: there is no `GET /v1/idp/users` that maps a
> DID to relying parties, and no "which sites does DID X use" endpoint. That
> data does not exist server-side (Principle 2 / Decision 1).

---

## Relying-party SDK

### Browser (drop-in button)

```html
<script src="https://cdn.zeroauth.dev/idp.js"></script>
<div id="za-signin"></div>
<script>
  ZeroAuth.mount('#za-signin', {
    publishableKey: 'za_pub_…',          // safe for the browser; create-session is server-side
    purpose: 'signin',
    assurance: 'liveness',
    onResult: (r) => { /* r = { sessionId } — your server polls/receives the assertion */ },
  });
</script>
```

The browser SDK renders the QR + live status. It never holds the secret API
key — it calls the RP's *own* backend, which calls `POST /v1/idp/sessions`.

### Server (verify the assertion)

```ts
import { ZeroAuth } from '@zeroauth/server';
const za = new ZeroAuth(process.env.ZEROAUTH_SECRET_KEY);

// 1. start a session for the browser
app.post('/auth/start', async (req, res) => {
  const s = await za.sessions.create({ purpose: 'signin', assurance: 'liveness' });
  res.json({ sessionId: s.session_id, qr: s.qr_payload });
});

// 2. receive the verified assertion (webhook OR poll)
za.webhooks.on('session.verified', async ({ did_rp, claims, assurance }) => {
  const user = await db.users.findByZeroAuthDid(did_rp);   // RP owns existence
  if (user) return signIn(user);                           // "already exists"
  return createAccount({ zeroAuthDid: did_rp, ...claims }); // new account, no password
});
```

The two load-bearing SDK ideas: **the RP stores `did_rp`** in its own user
table, and **the RP branches on its own lookup** — the SDK never asks ZeroAuth
"does this user exist."

### Webhook security

- Signed with the per-session `webhook.secret` (HMAC), replay-protected with a
  timestamp + nonce, mirroring the bank demo's cookie-HMAC discipline.
- Webhook is optional; polling `GET /v1/idp/sessions/:id` or the SSE stream are
  alternatives.

---

## OIDC bridge ("Sign in with ZeroAuth" as a standard IdP)

For the long tail of apps that already speak OpenID Connect, ZeroAuth exposes a
standard OIDC provider so the integration is a button, not a project.

```
GET  /.well-known/openid-configuration
GET  /oidc/authorize     // renders the QR / proof-pairing handshake
POST /oidc/token         // returns id_token { sub: did_rp, email?, name?, ... }
GET  /oidc/userinfo
GET  /oidc/jwks          // RS256 — note: platform JWTs move to RS256 (roadmap)
```

- `sub` = the **pairwise DID** for that OIDC client (the client_id maps to an
  `rp_id`), preserving unlinkability.
- Claims are the disclosed, VC-backed attributes.
- `acr`/`amr` carry the **assurance level** so OIDC RPs can require liveness.

This rides existing infra: the QR + proof-pairing + phone-push are the
authentication "inner loop"; OIDC is the standard wrapper around it.

---

## Console / developer-portal additions (P3)

- Self-serve **RP onboarding**: create an RP, get `rp_id` + keys + a
  publishable key, set allowed `redirect_uri`s and requested-attribute policy.
- Per-RP **assurance policy** + quotas + analytics (counts only — never the
  user graph).
- A test harness ("try Sign in with ZeroAuth against your localhost").

---

## Reuse map (what already exists vs net-new)

| Capability | Status |
|---|---|
| QR session + proof-pairing | **exists** (`proof-pairing.ts`) → generalize to `/v1/idp/*` |
| Phone-push present | **exists** (demo `submit-proof`) → generalize |
| Desktop-bind claim cookie | **exists** (`/claim` hardening) → generalize per RP |
| SSE result stream | **exists** (demo SSE) → generalize |
| Pairwise DID derivation | **net-new** (circuit + mobile) |
| Attribute VCs + email/phone OTP | **net-new** |
| Recovery endpoints | **net-new** |
| Browser + server SDK packages | **net-new** |
| OIDC bridge | **net-new** (P3) |

---

LAST_UPDATED: 2026-06-05
