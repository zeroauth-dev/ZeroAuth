# 07 — Accelerator pitch & demo blueprint

Audience (the panel):

| Panelist | What they care about | The hook that lands |
|---|---|---|
| **ISRO / SAC / IN-SPACe** | National deep-tech, sovereignty, secure access to critical systems | "A **sovereign** identity layer — not owned by Google or Apple. Built in India. Nothing to steal from a server." |
| **ICAI** (Chartered Accountants) | Audit, KYC, DPDP Act compliance, financial-data security | "**Tamper-evident** identity + KYC where the biometric is **never stored** — DPDP-clean by architecture. Every login is an audit row." |
| **KCCI** (Chamber of Commerce) | SME adoption, onboarding friction, fraud, support cost | "Any business adds **'Continue with ZeroAuth'** in an afternoon — zero password resets, zero breach liability, instant onboarding." |
| **Defence** | Credential theft, espionage, insider threat, air-gap | "Credentials are the #1 breach vector. ZeroAuth has **no password and no server-side biometric to steal** — and it works air-gapped." |
| **Investor** | Market size, moat, growth model, scale | "We're the **self-sovereign 'Sign in with Google'** — a developer-led SDK play into a $30B+ auth market, where no platform vendor owns the user." |

## The single spine of the pitch (memorize this)

> **Passwords are the problem the whole internet still hasn't fixed.** They get
> phished, reused, leaked, and breached — and every fix so far just moves the
> secret somewhere it can still be stolen. **ZeroAuth makes the person the
> credential.** You create one identity with your face — it lives on *your*
> phone, never on a server — and then "Continue with ZeroAuth" logs you into
> anything. Even if our entire database is stolen, attackers get **math, not
> faces.**

Three words to repeat: **No passwords. Breach-proof. Sovereign.**

## The 6-minute pitch arc

1. **The problem (60s) — make everyone in the room feel it.**
   - Open with a number they all know in their bones: *"81% of breaches start
     with a stolen or weak password. The average person has 100+ accounts and
     reuses the same handful of passwords across all of them."*
   - One line per panelist's world (don't name them — let them recognize
     themselves): a leaked credential is a national-security incident, a DPDP
     violation, a small business's worst day, an espionage vector, and a
     trillion-rupee tax on the economy.
   - Land it: *"Every 'password reset' email is the internet admitting defeat."*

2. **The shift (45s).** Passkeys, OTPs, SSO — all still custody a secret
   somewhere, and the big ones hand your identity to Apple and Google, who then
   see **every** site you touch. *"We asked a different question: what if the
   secret never exists on any server at all — and no company, including us,
   owns your identity?"*

3. **The solution (45s).** "Continue with ZeroAuth." One identity, your face,
   on your phone. Zero-knowledge proofs so the server verifies you **without
   ever seeing your face or a password.** Self-sovereign — we're a verifier,
   not an owner.

4. **THE DEMO (2.5 min) — the eyes-sparkle moment.** See below. This is the
   pitch. Everything before is setup; everything after is justification.

5. **The model + moat (45s).** Developer-led: an SDK + API key, exactly like
   Sign in with Google — a business integrates in an afternoon. Network effects:
   every app that adds the button makes the identity more valuable. The moat:
   the zero-knowledge + on-device-biometric architecture (and the cross-device
   "face is the key" research) that incumbents can't bolt on without rebuilding.

6. **The ask (15s).** What you want from the accelerator (capital, design
   partners in BFSI/gov, the network).

## THE DEMO — script (the centerpiece)

Run the polished web demo (`demo/continue-with-zeroauth.html`) on the
projector. It is a guided, always-works flow; the live phone version is the
optional encore.

**Beat 1 — "Here's a website. Like any website."**
Show the mock product ("Lumen") sign-in. Point at the password field, greyed
out with a line through it: *"We're going to never use this."* Below it, a
single glowing button: **Continue with ZeroAuth.**

**Beat 2 — "One tap."** Click it. The ZeroAuth auth layer rises — premium,
minimal, a QR and a clear consent line: *"Lumen will receive your name and
verified email."* Say: *"Notice what it's asking for — and what it isn't. No
password to create. And Lumen never sees my face."*

**Beat 3 — "My face, on my phone."** (Simulated, or live with the phone.) The
status moves to *Verifying…* with a subtle scan animation. Say: *"On my phone,
a zero-knowledge proof is being generated. My face never leaves the device.
The server is about to verify I'm me — without ever seeing me."*

**Beat 4 — THE WOW.** Success check: *"You're in. No password was created, no
password was typed, and nothing about my face is on any server."* Beat. Then
the kicker, slide to the breach panel: *"Now steal our entire database."* Show
the "breach view" — rows of commitments/hashes. *"This is what an attacker
gets. Math. No faces, no passwords, no way back to a person. We are breach-proof
by architecture, not by promise."*

**Beat 5 — "And it's the same everywhere."** Flash 3–4 other logos (a bank, a
gov portal, an e-commerce site) each with the same button. *"Create your
identity once. Continue with ZeroAuth everywhere. That's the whole internet,
without passwords."*

### The optional live encore (high-risk, high-reward)

If the room is hot and the wifi is good: do it for real on a phone against the
live `zeroauth.dev` backend. **Rehearse it; have the simulated version as the
guaranteed fallback** — never let a live-demo failure undercut the close.

## Panelist-specific one-liners (drop these in Q&A)

- **ISRO/IN-SPACe:** *"This is identity infrastructure India can own — no
  dependency on a foreign platform for who-is-who, and it runs air-gapped for
  classified systems."*
- **ICAI:** *"The biometric is never stored, so there's no honeypot and no DPDP
  liability — and every authentication is a tamper-evident audit row, which is
  exactly what an auditor wants."*
- **KCCI:** *"A shopkeeper with a website adds one button and never handles a
  password or a breach again. Onboarding goes from a form to a tap."*
- **Defence:** *"You can't phish what doesn't exist. There's no shared secret,
  no server-side biometric, and a stolen device can be revoked without
  re-issuing anyone's identity."*
- **Investor:** *"Auth is a $30B+ market growing double digits, and the
  incumbents (Okta, Auth0) still custody secrets. We're the self-sovereign
  layer with a developer-led, network-effect growth model — the 'Sign in with
  Google' that nobody owns."*

## What the demo must show (requirements for the build)

1. A believable third-party app with a **premium "Continue with ZeroAuth"**
   button (the Google-button parallel, but luxe).
2. The **ZeroAuth auth layer** — the account-chooser/consent moment, gorgeous
   and minimal, with the fingerprint mark.
3. The **"your face never left your phone"** verification beat.
4. The **breach-proof reveal** — the single most memorable image of the pitch.
5. The **"everywhere" montage** — same button across many apps.
6. Tone: modern, minimal, premium, luxury, effortless. Dark, lots of space,
   one accent, refined motion. No clutter.

## Positioning vs. the obvious objection

If someone says *"isn't this just Sign in with Google / passkeys?"* — the
prepared answer (full version in
[06-threat-model-and-positioning.md](06-threat-model-and-positioning.md)):
*"Google sees every site you log into and owns your identity; passkeys are a
per-site key with no portable identity and are synced by Apple/Google. We're
the only one where the identity is **yours**, the biometric **never leaves your
device**, and even we can't see your face or your list of accounts."*

---

LAST_UPDATED: 2026-06-05
