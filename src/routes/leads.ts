import { Router, Request, Response } from 'express';
import { authenticateAdmin } from '../middleware/auth';
import { logger } from '../services/logger';
import { getPoolOrNull } from '../services/db';

const router = Router();

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
  res.status(201).json({ success: true, message: 'Whitepaper access granted.' });
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
