# Security policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in ZeroAuth, please
report it privately. **Do not** open a public GitHub issue.

- **Email:** `security@zeroauth.dev`
- **PGP / Signal:** request a key in your initial email and we will move the
  conversation off-channel.

We aim to respond within **48 hours** with an initial assessment, and to
ship a fix within **14 days** for confirmed high-severity issues.

When reporting, please include:

- a description of the issue and its impact,
- reproduction steps or a proof-of-concept,
- any suggested mitigation you have in mind,
- whether you wish to be credited in the fix's release notes.

We will not pursue legal action against researchers who:

- act in good faith,
- avoid privacy violations, data destruction, and service disruption,
- give us a reasonable window to remediate before public disclosure.

## Supported versions

| Version | Supported          |
|---------|--------------------|
| `2.x`   | ✅ active           |
| `1.x`   | ❌ end-of-life      |

## Known design decisions (not vulnerabilities)

- ZKP verification key is loaded into memory at startup. If the host is
  compromised, an attacker could swap the key — defense is host hardening, not
  in-process.
- Session tokens are JWTs signed with a single symmetric key. Rotating
  `JWT_SECRET` invalidates all sessions; this is intentional.
- The Base Sepolia `DIDRegistry` contract has a single owner who can
  `registerIdentity` / `revokeIdentity`. Multi-sig is on the roadmap; this is
  documented in
  [docs/concepts/privacy-and-security.md](docs/concepts/privacy-and-security.md).
