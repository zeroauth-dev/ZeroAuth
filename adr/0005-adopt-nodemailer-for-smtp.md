# ADR-0005 — Adopt `nodemailer` for transactional SMTP

## Status

Accepted

## Context

[Issue #27](https://github.com/pulkitpareek18/ZeroAuth/issues/27) (F-2 from PR #22 security review) needs email infrastructure to close the email-enumeration finding properly. Beyond that single fix, several pending workstreams converge on "we need transactional email":

- **Breach-notification procedure** in `pulkitpareek18/ZeroAuth-Governance: docs/shared/breach-notification.md` step §3 requires emailing every affected tenant within 6 hours of confirmation — currently has no implementation
- **Password reset flow** — entirely missing today; we ship console accounts with no recovery path
- **Welcome email on signup** — minor UX win, plus a server-side signal that the address is real
- **"Someone tried to sign up with your email" notice** — security signal for legitimate account holders, partial mitigation for F-2 enumeration
- **Pilot SOW workflows** — future need; sending NDAs / DPAs / evidence packs

The user provided Brevo SMTP credentials on 2026-05-14, unblocking this work. We need a Node SMTP client.

## Decision

Adopt **`nodemailer` v8.x** (latest stable, MIT-0 licensed) as the SMTP transport library for the API repo. Wrap it behind `src/services/email.ts` so the rest of the codebase imports a generic `sendMail(opts)` function, not nodemailer directly. This keeps the option open to swap to Postmark / Resend / SES later without touching call sites.

## Consequences

- **Positive — battle-tested SMTP.** Nodemailer has been the de-facto Node SMTP library since 2010. 4M+ weekly downloads. No known critical CVEs in the v8.x line. The API is stable across major versions.
- **Positive — provider-agnostic.** Brevo (today) → SES / Postmark / Mailgun (future) is a config change, not a code change. No SDK lock-in.
- **Positive — TLS + DKIM signing support.** Nodemailer handles `STARTTLS` on port 587 (what Brevo uses) and supports per-message DKIM signing if we want it later.
- **Negative — Bayesian transitive surface.** Nodemailer pulls a small graph (mostly its own author's packages: `nodemailer-shared`, etc.). Acceptable for a 4M-DL library.
- **Negative — SMTP not HTTPS.** SMTP authentication via plaintext credentials over STARTTLS works but lacks the per-request auth tokens that an HTTP API like SES / Postmark / Resend provide. Mitigated by SMTP creds living in `/opt/zeroauth/.env` only (never in code) and being rotatable on the Brevo dashboard.
- **Neutral — zero existing email infra.** This is the first email-sending dep; no replacement.

## Alternatives considered

- **`emailjs` (`emailjs` package, v5.x)** — alternative SMTP client. Smaller user base, smaller community. Less defensive against TLS edge cases. Rejected because nodemailer is the industry standard and our blast radius from picking the niche library isn't worth the marginal dep-tree saving.
- **Postmark SDK (`postmark` package)** — provider-specific HTTP API, very developer-friendly. **Rejected for now** because (a) the user picked Brevo, not Postmark, (b) we want provider-agnosticism for future swaps, (c) the SDK adds provider lock-in for a function we can wrap in 30 lines of nodemailer.
- **`@sendgrid/mail`** — SendGrid SDK. Same rejection reasoning as Postmark.
- **AWS SES SDK (`@aws-sdk/client-sesv2`)** — heavy AWS SDK transitively. Cheaper send cost in volume but requires AWS account + IAM setup. Provider-specific. **Deferred** — could be the next provider swap when we outgrow Brevo's free tier (300 sends/day).
- **Roll our own SMTP via `net` / `tls`** — no.

## Configuration

- Provider: **Brevo** (formerly SendInBlue)
- SMTP host: `smtp-relay.brevo.com`
- Port: `587` (STARTTLS)
- From address: `noreply@zeroauth.dev`
- Credentials: live in `/opt/zeroauth/.env` on the VPS; in `.env` locally (gitignored). `.env.example` documents the variable names without real values.

**Operational pre-requisites that must be satisfied before this works in production:**

1. Brevo dashboard → Settings → SMTP & API → Authorized IPs → add `104.207.143.14` (VPS public IP). Without this, every SMTP login fails with `5.7.1 Unauthorized IP address`.
2. DNS records on `zeroauth.dev` (Hostinger panel):
   - **SPF** `TXT @ "v=spf1 include:spf.brevo.com ~all"`
   - **DKIM** `TXT mail._domainkey` — value provided by Brevo dashboard
   - **DMARC** `TXT _dmarc @ "v=DMARC1; p=quarantine; rua=mailto:dmarc@zeroauth.dev"`
   Without these, Brevo-sent mail lands in spam or gets rejected outright by recipient servers.
3. Brevo account quota: free tier = 300 emails/day. Pilot phase is well under that; revisit when public traffic ramps.

## Threat model delta

- New egress to `smtp-relay.brevo.com:587` from the API process. Update `pulkitpareek18/ZeroAuth-Governance: docs/threat-model/canonical.md` to add A-V06 (SMTP credential exfiltration / Brevo account takeover risk) — tracked as a follow-up.

## Operational notes

- The `email` service exposes a single function: `sendMail({ to, subject, html, text }): Promise<{ messageId, accepted }>`. Errors are logged + swallowed (not thrown to callers) for fire-and-forget transactional emails.
- For mission-critical mail (breach notification per `breach-notification.md`), a separate `sendCritical()` function is on the roadmap that retries 3x with exponential backoff and alerts on final failure.
- Email templates live in `src/services/email-templates/` as functions that return `{ subject, html, text }`. Plain-string templates initially; can move to mjml / handlebars when complexity warrants.

## References

- nodemailer package: <https://www.npmjs.com/package/nodemailer>
- nodemailer source: <https://github.com/nodemailer/nodemailer>
- nodemailer license (MIT-0): <https://github.com/nodemailer/nodemailer/blob/master/LICENSE>
- Brevo SMTP docs: <https://developers.brevo.com/docs/smtp-integration>
- DPDP §8(7) breach-notification procedure that depends on this: `pulkitpareek18/ZeroAuth-Governance: docs/shared/breach-notification.md`
- Issue this unblocks: <https://github.com/pulkitpareek18/ZeroAuth/issues/27>

---

LAST_UPDATED: 2026-05-14
OWNER: Pulkit Pareek
