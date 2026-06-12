/**
 * /api/hr/* — standalone attendance HR admin portal API.
 *
 * Auth: the `zeroauth-hr-admin` JWT (Bearer or HttpOnly `zeroauth_hr_jwt`
 * cookie). Each HR admin is bound to one tenant (= one customer company);
 * every query is tenant-scoped. Distinct from the developer console
 * (`/api/console`) and the platform API (`/v1`) — its JWT is never
 * accepted there and vice-versa.
 *
 * Surface:
 *   POST /signup   — create a company tenant + HR admin + default company
 *   POST /login    — authenticate, mint the HR session
 *   POST /logout   — clear the cookie
 *   GET  /account  — the admin + their company
 *   GET/POST /company    — read / update the WiFi presence anchor
 *   GET  /employees      — roster (invited/claimed/revoked)
 *   POST /employees      — provision (returns single-use invite + deeplink)
 *   PATCH /employees/:id — revoke / re-invite
 *   GET  /attendance        — attendance board (events joined to names)
 *   GET  /attendance/export — CSV
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { issueHrAdminToken } from '../services/jwt';
import {
  requireHrAdminAuth, setHrJwtCookie, clearHrJwtCookie, getHrAdmin,
} from '../middleware/hr-auth';
import {
  createHrAdmin, authenticateHrAdmin, getHrAdminById, getHrAdminByEmail, HrAdminExistsError,
} from '../services/hr-admins';
import {
  createCompany, getPrimaryCompanyForTenant, updateCompanyWifi,
  provisionMember, listMembers, setMemberStatus, AttendanceCompanyRow,
  AttendanceMembershipError,
} from '../services/attendance-membership';
import { createTenant } from '../services/tenants';
import crypto from 'crypto';

const router = Router();
const ENV = 'live' as const;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many attempts. Try again later.' },
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  // writeLimiter only runs after requireHrAdminAuth, so the admin id is
  // always present — keying on it (never the IP) avoids the v7 IPv6
  // keyGenerator validation and is the right per-tenant bucket anyway.
  keyGenerator: (req) => {
    const hr = (req as Request & { hrAdmin?: { hrAdminId?: string } }).hrAdmin;
    return hr?.hrAdminId ?? 'unauthenticated';
  },
  message: { error: 'too_many_requests', message: 'Slow down.' },
});

function isEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function publicCompany(c: AttendanceCompanyRow) {
  return { id: c.id, name: c.name, location: c.location, wifi: c.wifi, status: c.status };
}

async function resolvePrimaryCompany(tenantId: string): Promise<AttendanceCompanyRow | null> {
  return getPrimaryCompanyForTenant(tenantId, ENV);
}

// ─── Auth ────────────────────────────────────────────────────────────

router.post('/signup', authLimiter, async (req: Request, res: Response) => {
  // Track the tenant so we can roll it back if a later write fails — the
  // three creates below are not in one transaction (security review
  // Finding 3). DELETE on tenants cascades to hr_admins + attendance_*.
  let createdTenantId: string | null = null;
  try {
    const { email, password, companyName, location } = req.body ?? {};
    if (!isEmail(email)) { res.status(400).json({ error: 'invalid_email', message: 'A valid email is required.' }); return; }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }); return;
    }
    if (typeof companyName !== 'string' || !companyName.trim()) {
      res.status(400).json({ error: 'invalid_request', message: 'companyName is required.' }); return;
    }
    if (await getHrAdminByEmail(email)) {
      res.status(409).json({ error: 'email_taken', message: 'An admin with that email already exists.' }); return;
    }

    // The tenant is the company container; HR never logs in via the
    // console, so give it a synthetic, collision-free email.
    const tenantEmail = `company-${crypto.randomBytes(6).toString('hex')}@attendance.zeroauth.local`;
    const tenantPassword = crypto.randomBytes(24).toString('hex');
    const tenant = await createTenant(tenantEmail, tenantPassword, companyName.trim(), 'enterprise');
    createdTenantId = tenant.id;

    const admin = await createHrAdmin(tenant.id, email, password, null);
    const company = await createCompany(
      tenant.id, ENV,
      { name: companyName.trim(), location: typeof location === 'string' ? location : '' },
      { type: 'hr_admin', id: admin.id, email: admin.email },
    );

    const token = issueHrAdminToken(admin.id, tenant.id, admin.email);
    setHrJwtCookie(res, token);
    res.status(201).json({
      token,
      hrAdmin: { id: admin.id, email: admin.email, tenantId: tenant.id },
      company: publicCompany(company),
    });
  } catch (err) {
    // Best-effort rollback of the orphan tenant. Covers the same-email race
    // the pre-check misses (the loser fails createHrAdmin's UNIQUE), a
    // company-create failure, and an audit-write failure on either.
    if (createdTenantId) {
      await getPool().query('DELETE FROM tenants WHERE id = $1', [createdTenantId])
        .catch((e) => logger.warn('hr signup: orphan tenant cleanup failed', {
          tenantId: createdTenantId, error: (e as Error).message,
        }));
    }
    if (err instanceof HrAdminExistsError) {
      res.status(409).json({ error: 'email_taken', message: 'An admin with that email already exists.' }); return;
    }
    logger.error('hr signup failed', { error: (err as Error).message });
    res.status(500).json({ error: 'signup_failed', message: 'Could not create the account.' });
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'Email and password required.' }); return;
    }
    const admin = await authenticateHrAdmin(email, password);
    if (!admin) { res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' }); return; }
    const token = issueHrAdminToken(admin.id, admin.tenant_id, admin.email);
    setHrJwtCookie(res, token);
    res.status(200).json({ token, hrAdmin: { id: admin.id, email: admin.email, tenantId: admin.tenant_id } });
  } catch (err) {
    logger.error('hr login failed', { error: (err as Error).message });
    res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  clearHrJwtCookie(res);
  res.status(200).json({ ok: true });
});

// ─── Authed surface ──────────────────────────────────────────────────

router.get('/account', requireHrAdminAuth, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const admin = await getHrAdminById(hr.hrAdminId);
  if (!admin) { res.status(401).json({ error: 'unauthorized', message: 'Account not found.' }); return; }
  const company = await resolvePrimaryCompany(hr.tenantId);
  res.status(200).json({
    hrAdmin: { id: admin.id, email: admin.email, fullName: admin.full_name, tenantId: admin.tenant_id },
    company: company ? publicCompany(company) : null,
  });
});

router.get('/company', requireHrAdminAuth, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const company = await resolvePrimaryCompany(hr.tenantId);
  res.status(200).json({ company: company ? publicCompany(company) : null });
});

router.post('/company', requireHrAdminAuth, writeLimiter, async (req: Request, res: Response) => {
  try {
    const hr = getHrAdmin(req);
    const { ssidLabel, bssids, minSignalPercent, location } = req.body ?? {};
    const company = await resolvePrimaryCompany(hr.tenantId);
    if (!company) { res.status(404).json({ error: 'no_company', message: 'No company configured.' }); return; }
    const wifi = {
      ssidLabel: typeof ssidLabel === 'string' ? ssidLabel : company.wifi.ssidLabel,
      bssids: Array.isArray(bssids) ? bssids.filter((b) => typeof b === 'string') : company.wifi.bssids,
      minSignalPercent: typeof minSignalPercent === 'number' ? minSignalPercent : company.wifi.minSignalPercent,
    };
    const updated = await updateCompanyWifi(company.id, hr.tenantId, wifi, { type: 'hr_admin', id: hr.hrAdminId, email: hr.email });
    if (location !== undefined && typeof location === 'string') {
      await getPool().query(`UPDATE attendance_companies SET location = $2, updated_at = NOW() WHERE id = $1 AND tenant_id = $3`,
        [company.id, location, hr.tenantId]);
    }
    res.status(200).json({ company: updated ? publicCompany(updated) : null });
  } catch (err) {
    logger.error('hr company update failed', { error: (err as Error).message });
    res.status(500).json({ error: 'company_update_failed', message: 'Could not update the company.' });
  }
});

router.get('/employees', requireHrAdminAuth, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const company = await resolvePrimaryCompany(hr.tenantId);
  if (!company) { res.status(200).json({ employees: [] }); return; }
  const members = await listMembers(company.id);
  res.status(200).json({ employees: members });
});

router.post('/employees', requireHrAdminAuth, writeLimiter, async (req: Request, res: Response) => {
  try {
    const hr = getHrAdmin(req);
    const { employeeId, fullName, department, email } = req.body ?? {};
    if (typeof employeeId !== 'string' || !employeeId.trim()) {
      res.status(400).json({ error: 'invalid_request', message: 'employeeId is required.' }); return;
    }
    if (typeof fullName !== 'string' || !fullName.trim()) {
      res.status(400).json({ error: 'invalid_request', message: 'fullName is required.' }); return;
    }
    const company = await resolvePrimaryCompany(hr.tenantId);
    if (!company) { res.status(404).json({ error: 'no_company', message: 'No company configured.' }); return; }

    const { membership, inviteCode } = await provisionMember(
      hr.tenantId, ENV, company.id,
      { employeeId: employeeId.trim(), fullName: fullName.trim(),
        department: typeof department === 'string' ? department : undefined,
        email: typeof email === 'string' ? email : undefined },
      { type: 'hr_admin', id: hr.hrAdminId, email: hr.email },
    );
    res.status(201).json({
      employee: membership,
      invite: {
        code: inviteCode,
        deeplink: `zeroauth://emp-claim?company=${company.id}&code=${inviteCode}`,
        expiresAt: membership.invite_code_expires_at,
      },
    });
  } catch (err) {
    if (err instanceof AttendanceMembershipError) {
      res.status(409).json({ error: err.code, message: err.message }); return;
    }
    logger.error('hr provision failed', { error: (err as Error).message });
    res.status(500).json({ error: 'provision_failed', message: 'Could not provision the employee.' });
  }
});

router.patch('/employees/:id', requireHrAdminAuth, writeLimiter, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const status = req.body?.status;
  if (status !== 'revoked' && status !== 'invited') {
    res.status(400).json({ error: 'invalid_status', message: 'status must be revoked or invited.' }); return;
  }
  const updated = await setMemberStatus(String(req.params.id), hr.tenantId, status, { type: 'hr_admin', id: hr.hrAdminId, email: hr.email });
  if (!updated) { res.status(404).json({ error: 'not_found', message: 'Employee not found.' }); return; }
  res.status(200).json({ employee: updated });
});

// ─── Attendance board ────────────────────────────────────────────────

interface BoardRow {
  event_type: string; result: string; occurred_at: Date;
  full_name: string | null; employee_id: string | null; metadata: Record<string, unknown>;
}

async function loadBoard(tenantId: string, companyId: string, limit: number): Promise<BoardRow[]> {
  const r = await getPool().query<BoardRow>(
    `SELECT ae.event_type, ae.result, ae.occurred_at, ae.metadata,
            m.full_name, m.employee_id
       FROM attendance_events ae
       LEFT JOIN attendance_memberships m
         ON m.user_id = ae.user_id AND m.company_id = $2
      WHERE ae.tenant_id = $1 AND ae.environment = $3
      ORDER BY ae.occurred_at DESC LIMIT $4`,
    [tenantId, companyId, ENV, limit],
  );
  return r.rows;
}

router.get('/attendance', requireHrAdminAuth, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const company = await resolvePrimaryCompany(hr.tenantId);
  if (!company) { res.status(200).json({ events: [], summary: { total: 0, accepted: 0, rejected: 0 } }); return; }
  const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit ?? '200'), 10) || 200));
  const rows = await loadBoard(hr.tenantId, company.id, limit);
  const accepted = rows.filter((e) => e.result === 'accepted').length;
  res.status(200).json({
    events: rows,
    summary: { total: rows.length, accepted, rejected: rows.length - accepted },
  });
});

router.get('/attendance/export', requireHrAdminAuth, async (req: Request, res: Response) => {
  const hr = getHrAdmin(req);
  const company = await resolvePrimaryCompany(hr.tenantId);
  const rows = company ? await loadBoard(hr.tenantId, company.id, 5000) : [];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'employee_id,full_name,type,result,occurred_at\n';
  const body = rows.map((e) =>
    [esc(e.employee_id), esc(e.full_name), esc(e.event_type), esc(e.result), esc(new Date(e.occurred_at).toISOString())].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
  res.status(200).send(header + body + '\n');
});

export default router;
