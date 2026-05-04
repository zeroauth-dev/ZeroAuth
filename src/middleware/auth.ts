import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/jwt';
import { config } from '../config';
import { logger } from '../services/logger';

export function authenticateJWT(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    (req as any).user = payload;
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: (err as Error).message });
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey || apiKey !== config.admin.apiKey) {
    res.status(403).json({ error: 'Invalid admin API key' });
    return;
  }

  next();
}
