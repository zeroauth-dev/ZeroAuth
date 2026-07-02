/**
 * src/middleware/hr-auth.ts
 *
 * Authenticates the standalone attendance admin portal (`/api/hr/*`).
 * Mirrors `requireConsoleAuth` (src/routes/console.ts): reads the JWT from
 * `Authorization: Bearer …` or the HttpOnly `zeroauth_hr_jwt` cookie
 * (path-scoped to `/api/hr` so it never reaches `/v1` or `/api/console`),
 * and attaches `req.hrAdmin = { hrAdminId, tenantId, email }`.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyHrAdminToken, HrAdminTokenPayload } from '../services/jwt';

const HR_JWT_COOKIE = 'zeroauth_hr_jwt';

function isProductionEnv(): boolean {
  return (process.env.NODE_ENV ?? 'development') === 'production';
}

export function setHrJwtCookie(res: Response, token: string): void {
  res.cookie(HR_JWT_COOKIE, token, {
    httpOnly: true,
    secure: isProductionEnv(),
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/api/hr',
  });
}

export function clearHrJwtCookie(res: Response): void {
  res.clearCookie(HR_JWT_COOKIE, { path: '/api/hr' });
}

export function getHrAdmin(req: Request): HrAdminTokenPayload {
  return (req as Request & { hrAdmin: HrAdminTokenPayload }).hrAdmin;
}

export function requireHrAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    if (cookies && typeof cookies[HR_JWT_COOKIE] === 'string') {
      token = cookies[HR_JWT_COOKIE];
    }
  }

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'HR login required.' });
    return;
  }

  try {
    (req as Request & { hrAdmin: HrAdminTokenPayload }).hrAdmin = verifyHrAdminToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'session_expired', message: 'HR session expired. Please login again.' });
  }
}
