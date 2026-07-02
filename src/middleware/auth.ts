import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string;

  if (!apiKey || apiKey !== config.admin.apiKey) {
    res.status(403).json({ error: 'Invalid admin API key' });
    return;
  }

  next();
}
