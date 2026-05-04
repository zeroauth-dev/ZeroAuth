# DNS records for zeroauth.dev (Hostinger)

VPS public IP: **`104.207.143.14`**

Open Hostinger → **Domains → zeroauth.dev → DNS / Nameservers → Manage DNS records**, then add the records below. Hostinger's UI has separate fields per record — values are filled in exactly as shown.

> **Important:** if Hostinger pre-populated `parking` A records or default `@` records pointing somewhere else, **delete those first** so the new ones win.

---

## Required records

These are the only records you need to bring `https://zeroauth.dev` and `https://www.zeroauth.dev` online.

| Type  | Name (Host) | Value / Points to        | TTL   | Priority | Purpose                                     |
|-------|-------------|--------------------------|-------|----------|---------------------------------------------|
| A     | `@`         | `104.207.143.14`         | 14400 | —        | Apex `zeroauth.dev` → VPS                   |
| A     | `www`       | `104.207.143.14`         | 14400 | —        | `www.zeroauth.dev` → VPS                    |
| CAA   | `@`         | `0 issue "letsencrypt.org"` | 14400 | —      | Lets only Let's Encrypt issue TLS certs     |

> Hostinger's `Name` field uses `@` for the apex (the bare domain). Some Hostinger UIs auto-append the domain — if it shows "@.zeroauth.dev" preview, that is wrong; clear and re-enter `@`.

> If your Hostinger account does not expose CAA records, skip the third row — it is a hardening nice-to-have, not a launch blocker.

---

## Optional records (skip at launch — add later if needed)

| Type  | Name | Value                                            | Why                                       |
|-------|------|--------------------------------------------------|-------------------------------------------|
| AAAA  | `@`  | (your VPS IPv6 address)                          | Only if your VPS has a public IPv6        |
| AAAA  | `www`| (your VPS IPv6 address)                          | Only if your VPS has a public IPv6        |
| TXT   | `@`  | `v=spf1 -all`                                    | Block spoofed email until you wire SMTP   |
| TXT   | `_dmarc` | `v=DMARC1; p=reject; rua=mailto:you@zeroauth.dev` | Stop spoofing                       |

---

## BIND zone file (paste into a "Bulk import" field if Hostinger supports it)

```bind
$ORIGIN zeroauth.dev.
$TTL 14400

@   IN  A     104.207.143.14
www IN  A     104.207.143.14
@   IN  CAA   0 issue "letsencrypt.org"
```

---

## After you save the records

1. Wait 1–10 minutes for propagation. Verify with:

   ```bash
   dig +short zeroauth.dev
   dig +short www.zeroauth.dev
   # should print: 104.207.143.14
   ```

2. Once both resolve to `104.207.143.14`, hit `https://zeroauth.dev` — Caddy on the VPS will obtain the Let's Encrypt cert automatically on the first request. The first hit may take 5–15 seconds while the cert is issued; subsequent requests are fast.

3. Sanity check:

   ```bash
   curl https://zeroauth.dev/api/health
   ```

   Should return `{"status":"healthy", ...}` with `blockchain.status: "connected"`.

---

## Notes for Hostinger

- Hostinger's nameservers are typically `ns1.dns-parking.com` / `ns2.dns-parking.com` for parked domains. If `zeroauth.dev` is using Hostinger's nameservers (default for domains bought through them), edit DNS records directly in the **DNS Zone Editor**.
- If you've moved nameservers to Cloudflare or similar, add the records there instead — the table above applies the same way.
- Do **not** enable Hostinger's "website builder" or "redirects" for `zeroauth.dev` — those override DNS and break the deploy.
