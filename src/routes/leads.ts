import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { authenticateAdmin } from '../middleware/auth';
import { logger } from '../services/logger';
import { getPoolOrNull } from '../services/db';
import { sendMail } from '../services/email';
import { whitepaperEmail } from '../services/email-templates';

const router = Router();

/**
 * Resolve the whitepaper PDF path across environments. The Dockerfile builds
 * the docs site into website/build/, so production reads from there. In dev
 * we fall back to the source PDFs in website/static or docs/. Resolved once
 * at first use; null means no PDF is shipped with this build.
 */
let whitepaperPathCache: string | null | undefined;
function resolveWhitepaperPath(): string | null {
  if (whitepaperPathCache !== undefined) return whitepaperPathCache;
  const candidates = [
    path.resolve(__dirname, '..', '..', 'website', 'build', 'whitepaper.pdf'),
    path.resolve(__dirname, '..', '..', 'website', 'static', 'whitepaper.pdf'),
    path.resolve(__dirname, '..', '..', 'docs', 'whitepaper.pdf'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      whitepaperPathCache = p;
      return p;
    }
  }
  whitepaperPathCache = null;
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /api/leads/pilot
 * Accepts pilot access form submissions.
 */
router.post('/pilot', async (req: Request, res: Response) => {
  const { name, company, email, size } = req.body;

  if (!name || !company || !email || !size) {
    res.status(400).json({ error: 'All fields are required: name, company, email, size' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  const trimmedName = String(name).trim();
  const trimmedCompany = String(company).trim();
  const trimmedSize = String(size).trim();

  const pool = getPoolOrNull();
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO leads (type, name, company, email, size) VALUES ($1, $2, $3, $4, $5)',
        ['pilot', trimmedName, trimmedCompany, trimmedEmail, trimmedSize]
      );
    } catch (err) {
      logger.error('Failed to persist pilot lead', { error: (err as Error).message });
    }
  } else {
    logger.warn('PostgreSQL unavailable — pilot lead not persisted', { email: trimmedEmail });
  }

  logger.info('Pilot lead submitted', { company: trimmedCompany, email: trimmedEmail });
  res.status(201).json({ success: true, message: 'Pilot request received. We will contact you within one business day.' });
});

/**
 * POST /api/leads/whitepaper
 * Accepts whitepaper download requests.
 */
router.post('/whitepaper', async (req: Request, res: Response) => {
  const { email } = req.body;

  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Invalid email address' });
    return;
  }

  const trimmedEmail = String(email).trim().toLowerCase();

  const pool = getPoolOrNull();
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO leads (type, email) VALUES ($1, $2)',
        ['whitepaper', trimmedEmail]
      );
    } catch (err) {
      logger.error('Failed to persist whitepaper lead', { error: (err as Error).message });
    }
  } else {
    logger.warn('PostgreSQL unavailable — whitepaper lead not persisted', { email: trimmedEmail });
  }

  logger.info('Whitepaper lead submitted', { email: trimmedEmail });

  // Best-effort mail delivery — non-blocking for the response. If SMTP is
  // unconfigured (dev) the call no-ops; the downloadUrl in the response is
  // the fallback so the user can still read the paper.
  const pdfPath = resolveWhitepaperPath();
  if (pdfPath) {
    const { subject, html, text } = whitepaperEmail();
    void sendMail({
      to: trimmedEmail,
      subject,
      html,
      text,
      attachments: [
        {
          filename: 'ZeroAuth_Whitepaper.pdf',
          path: pdfPath,
          contentType: 'application/pdf',
        },
      ],
    }).then((result) => {
      if (!result.ok && !result.skipped) {
        logger.warn('Whitepaper email send failed', { error: result.error });
      }
    });
  } else {
    logger.warn('Whitepaper PDF not found on disk — email will not include attachment');
  }

  res.status(201).json({
    success: true,
    message: 'Whitepaper sent. Check your inbox in a minute.',
    downloadUrl: '/docs/whitepaper.pdf',
    filename: 'ZeroAuth_Whitepaper.pdf',
  });
});

/**
 * GET /api/leads
 * Admin-only: returns all collected leads.
 * Supports optional ?type=pilot|whitepaper filter.
 */
router.get('/', authenticateAdmin, async (_req: Request, res: Response) => {
  const pool = getPoolOrNull();
  if (!pool) {
    res.status(503).json({ error: 'Database unavailable' });
    return;
  }

  try {
    const typeFilter = _req.query.type as string | undefined;
    let query = 'SELECT * FROM leads';
    const params: string[] = [];

    if (typeFilter && ['pilot', 'whitepaper'].includes(typeFilter)) {
      query += ' WHERE type = $1';
      params.push(typeFilter);
    }
    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    const rows = result.rows;

    res.json({
      total: rows.length,
      pilot: rows.filter((l: { type: string }) => l.type === 'pilot').length,
      whitepaper: rows.filter((l: { type: string }) => l.type === 'whitepaper').length,
      leads: rows,
    });
  } catch (err) {
    logger.error('Failed to fetch leads', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

export default router;
