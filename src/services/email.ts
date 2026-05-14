import nodemailer, { Transporter } from 'nodemailer';
import { createHash } from 'crypto';
import { config } from '../config';
import { logger } from './logger';

/**
 * Transactional email service (ADR-0005).
 *
 * Wraps nodemailer behind a generic interface so call sites don't depend
 * on the transport choice. Today: SMTP via Brevo (smtp-relay.brevo.com:587).
 * Tomorrow: could swap to Postmark / Resend / SES by replacing the
 * `createTransport` body.
 *
 * Module-level singleton. Built at startup if SMTP_HOST is configured;
 * if not, `sendMail` no-ops with a warn log instead of failing requests.
 * That's the right shape for transactional email — never block a user
 * flow on a transient SMTP outage.
 *
 * For mission-critical mail (breach notification per
 * `governance: docs/shared/breach-notification.md`), use `sendCriticalMail`
 * instead — it retries 3x with exponential backoff and alerts on final
 * failure. Not yet implemented; tracked.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!config.email.smtpHost || !config.email.smtpUser || !config.email.smtpPassword) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: false, // STARTTLS upgrade on port 587
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPassword,
    },
  });
  return transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback. If omitted, recipients with HTML-disabled clients see nothing useful. */
  text: string;
  /** Optional Reply-To override. Defaults to EMAIL_FROM. */
  replyTo?: string;
}

export interface SendMailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  /** True when the transport is unconfigured (dev env, no SMTP_HOST) — call was a no-op. */
  skipped?: boolean;
}

/**
 * Send a transactional email. Fire-and-forget at call sites — never throws.
 * Logs success / failure but returns a structured result for callers that
 * want to act on it (e.g. surface a "we couldn't email you" banner).
 *
 * **Never** include the recipient's email in log lines unless the recipient
 * is the tenant operator (an internal email is fine to log; an end-user
 * email is not — DPDP §8 considers it personal data).
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const t = getTransporter();
  if (!t) {
    logger.warn('Email: SMTP not configured — sendMail() is a no-op', {
      to: hashRecipient(input.to),
      subject: input.subject,
    });
    return { ok: false, skipped: true };
  }

  try {
    const info = await t.sendMail({
      from: `"${config.email.fromName}" <${config.email.fromAddress}>`,
      to: input.to,
      replyTo: input.replyTo ?? config.email.fromAddress,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    logger.info('Email: sent', {
      messageId: info.messageId,
      to: hashRecipient(input.to),
      subject: input.subject,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    const error = (err as Error).message;
    logger.error('Email: send failed', {
      to: hashRecipient(input.to),
      subject: input.subject,
      error,
    });
    return { ok: false, error };
  }
}

/**
 * Hash the recipient address before logging so the log stream is safe to
 * ship to an external aggregator without leaking PII per DPDP §8.
 *
 * Uses a length-truncated SHA-256 of the lowercased trimmed address.
 * Reversible by lookup but not by inference. Same input always produces
 * the same hash, which lets us correlate failures for a single recipient
 * without storing the email itself.
 */
function hashRecipient(to: string): string {
  return createHash('sha256')
    .update(to.trim().toLowerCase())
    .digest('hex')
    .slice(0, 12);
}

/**
 * Probe the SMTP connection. Used by the startup health check.
 * Returns true if the transport accepts a NOOP, false otherwise.
 */
export async function verifySmtp(): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.verify();
    logger.info('Email: SMTP transport verified', {
      host: config.email.smtpHost,
      port: config.email.smtpPort,
    });
    return true;
  } catch (err) {
    logger.warn('Email: SMTP verify failed', {
      host: config.email.smtpHost,
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Reset the transporter — only intended for tests. Production code never
 * calls this; the module-level singleton is the deliberate shape.
 */
export function _resetTransporterForTests(): void {
  transporter = null;
}
