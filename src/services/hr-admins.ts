/**
 * src/services/hr-admins.ts
 *
 * HR admin accounts for the standalone attendance admin portal. An HR
 * admin belongs to exactly one tenant (= one customer company) and
 * authenticates with the `zeroauth-hr-admin` JWT (src/services/jwt.ts).
 * Reuses the scrypt password hashing from `tenants.ts`.
 */

import { getPool } from './db';
import { logger } from './logger';
import { hashPassword, verifyPassword } from './tenants';

export interface HrAdmin {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'inactive';
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export class HrAdminExistsError extends Error {
  constructor(public email: string) {
    super(`HR admin ${email} already exists`);
    this.name = 'HrAdminExistsError';
  }
}

export async function createHrAdmin(
  tenantId: string,
  email: string,
  password: string,
  fullName?: string | null,
): Promise<HrAdmin> {
  const passwordHash = await hashPassword(password);
  const pool = getPool();
  try {
    const r = await pool.query<HrAdmin>(
      `INSERT INTO hr_admins (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, email.trim().toLowerCase(), passwordHash, fullName ?? null],
    );
    logger.info('HR admin created', { hrAdminId: r.rows[0].id, tenantId });
    return r.rows[0];
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HrAdminExistsError(email);
    }
    throw err;
  }
}

export async function authenticateHrAdmin(email: string, password: string): Promise<HrAdmin | null> {
  const pool = getPool();
  const r = await pool.query<HrAdmin>(
    `SELECT * FROM hr_admins WHERE email = $1 AND status = 'active'`,
    [email.trim().toLowerCase()],
  );
  const admin = r.rows[0];
  if (!admin) return null;
  const ok = await verifyPassword(password, admin.password_hash);
  return ok ? admin : null;
}

export async function getHrAdminById(id: string): Promise<HrAdmin | null> {
  const pool = getPool();
  const r = await pool.query<HrAdmin>(`SELECT * FROM hr_admins WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getHrAdminByEmail(email: string): Promise<HrAdmin | null> {
  const pool = getPool();
  const r = await pool.query<HrAdmin>(
    `SELECT * FROM hr_admins WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  return r.rows[0] ?? null;
}
