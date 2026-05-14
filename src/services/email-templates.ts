/**
 * Email body templates.
 *
 * Plain-string templates today; can move to mjml / handlebars / a real
 * template engine when complexity warrants. Each export returns
 * `{ subject, html, text }` — html is for clients that render it, text
 * is the fallback. Both must contain the same information.
 *
 * Per `governance: docs/shared/security-policy.md` §10, **never** include:
 * - API keys (plaintext) in any email
 * - Password hashes
 * - Biometric-derived data
 * - Cross-tenant identifiers
 *
 * Per DPDP §8, the email content is logged at the message-id level but the
 * recipient address is hashed (see services/email.ts:hashRecipient).
 */

const FOOTER_HTML = `
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:12px;color:#6b7280;line-height:1.6;">
    Sent by ZeroAuth, the developer-facing API for Pramaan&trade; &mdash; the
    patented zero-knowledge biometric identity protocol.<br/>
    Yushu Excellence Technologies Pvt. Ltd. &middot; Indian Patent
    IN202311041001.<br/>
    Questions? Reply to this email or open an issue at
    <a href="https://github.com/pulkitpareek18/ZeroAuth/issues" style="color:#4285F4;">github.com/pulkitpareek18/ZeroAuth/issues</a>.
  </p>
`;

const FOOTER_TEXT = `
---
Sent by ZeroAuth, the developer-facing API for Pramaan(TM) — the patented
zero-knowledge biometric identity protocol. Yushu Excellence Technologies
Pvt. Ltd. — Indian Patent IN202311041001.
Questions? Reply to this email or open an issue at
https://github.com/pulkitpareek18/ZeroAuth/issues
`;

/**
 * Sent immediately after a successful tenant signup. Confirms the account
 * exists, gives the operator a Quickstart pointer, and reminds them their
 * first API key was already revealed in the dashboard (not in this email —
 * we never email plaintext keys).
 */
export function welcomeEmail(input: {
  email: string;
  companyName: string | null;
  tenantId: string;
}): { subject: string; html: string; text: string } {
  const companyOrAccount = input.companyName?.trim() || 'your account';
  const subject = `Welcome to ZeroAuth — ${companyOrAccount} is live`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933; line-height: 1.55;">
      <h2 style="color:#1f2933;font-size:20px;margin-bottom:8px;">Welcome to ZeroAuth.</h2>
      <p style="font-size:15px;">
        Your developer account <strong>${input.email}</strong> is active${input.companyName ? ` and linked to <strong>${escapeHtml(input.companyName)}</strong>` : ''}.
      </p>
      <p style="font-size:15px;">
        Your first API key was revealed once in the dashboard — copy it to your password manager
        if you haven't yet. <strong>We never email plaintext API keys</strong>, by design (per our security policy).
        If you lost it, mint a new one from <a href="https://zeroauth.dev/dashboard/api-keys" style="color:#4285F4;">the API Keys page</a>.
      </p>
      <p style="font-size:15px;">
        Next steps:
      </p>
      <ul style="font-size:15px;line-height:1.7;">
        <li>Read the <a href="https://zeroauth.dev/docs/getting-started/quickstart/" style="color:#4285F4;">Quickstart</a></li>
        <li>Verify your first proof: <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:13px;">curl https://zeroauth.dev/v1/auth/zkp/verify</code></li>
        <li>Skim the <a href="https://zeroauth.dev/docs/whitepaper.pdf" style="color:#4285F4;">Pramaan whitepaper</a> (25 pages, technical)</li>
      </ul>
      ${FOOTER_HTML}
    </div>
  `;

  const text = `Welcome to ZeroAuth.

Your developer account ${input.email} is active${input.companyName ? ` and linked to ${input.companyName}` : ''}.

Your first API key was revealed once in the dashboard — copy it to your password manager if you haven't yet. We never email plaintext API keys, by design (per our security policy). If you lost it, mint a new one from https://zeroauth.dev/dashboard/api-keys

Next steps:
- Read the Quickstart: https://zeroauth.dev/docs/getting-started/quickstart/
- Verify your first proof: curl https://zeroauth.dev/v1/auth/zkp/verify
- Skim the Pramaan whitepaper: https://zeroauth.dev/docs/whitepaper.pdf
${FOOTER_TEXT}`;

  return { subject, html, text };
}

/**
 * Sent to a legitimate account holder when a signup is attempted on
 * their already-registered email. Partial mitigation for F-2 (the
 * enumeration finding) — gives the real user a security signal AND
 * prevents the email-was-taken response from being free intel for
 * an attacker.
 */
export function signupAttemptedNoticeEmail(input: {
  email: string;
  attemptIp: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Someone tried to sign up with your ZeroAuth email`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1f2933; line-height: 1.55;">
      <h2 style="color:#1f2933;font-size:20px;margin-bottom:8px;">Heads up.</h2>
      <p style="font-size:15px;">
        Someone just tried to create a new ZeroAuth account with <strong>${input.email}</strong>.
        Your account already exists, so the signup was rejected.
      </p>
      <p style="font-size:15px;">
        <strong>If this was you</strong> (you forgot you had an account), sign in at
        <a href="https://zeroauth.dev/dashboard/login" style="color:#4285F4;">zeroauth.dev/dashboard/login</a>.
      </p>
      <p style="font-size:15px;">
        <strong>If this wasn't you</strong>, your account is unaffected — no password attempt was made.
        Consider rotating your password as a precaution:
        <a href="https://zeroauth.dev/dashboard/login" style="color:#4285F4;">dashboard/login</a> → forgot password.
      </p>
      ${input.attemptIp ? `<p style="font-size:13px;color:#6b7280;">Attempt source IP: <code>${escapeHtml(input.attemptIp)}</code></p>` : ''}
      ${FOOTER_HTML}
    </div>
  `;

  const text = `Heads up.

Someone just tried to create a new ZeroAuth account with ${input.email}.
Your account already exists, so the signup was rejected.

If this was you (you forgot you had an account), sign in at https://zeroauth.dev/dashboard/login

If this wasn't you, your account is unaffected — no password attempt was made. Consider rotating your password as a precaution: dashboard/login → forgot password.
${input.attemptIp ? `\nAttempt source IP: ${input.attemptIp}\n` : ''}${FOOTER_TEXT}`;

  return { subject, html, text };
}

/**
 * Minimal HTML escape for user-supplied strings landing in templates.
 * Don't use a full library for this — the surface is tiny (operator email
 * + company name) and a 4-line escape is cheaper to audit.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
