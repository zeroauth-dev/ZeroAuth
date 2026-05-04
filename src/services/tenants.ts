import crypto from 'crypto';
import { getPool } from './db';
import { logger } from './logger';
import { Tenant, PlanTier, PLAN_LIMITS } from '../types';

/**
 * Hash a password using scrypt (no bcrypt dependency needed).
 * Format: salt:hash (both hex-encoded)
 */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey));
    });
  });
}

/**
 * Create a new tenant (developer account).
 */
export async function createTenant(
  email: string,
  password: string,
  companyName?: string,
  plan: PlanTier = 'free',
): Promise<Tenant> {
  const pool = getPool();
  const passwordHash = await hashPassword(password);
  const limits = PLAN_LIMITS[plan];

  const result = await pool.query(
    `INSERT INTO tenants (email, password_hash, company_name, plan, rate_limit, monthly_quota)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email.trim().toLowerCase(), passwordHash, companyName?.trim() || null, plan, limits.rateLimit, limits.monthlyQuota],
  );

  const tenant = result.rows[0] as Tenant;
  logger.info('Tenant created', { tenantId: tenant.id, email: tenant.email, plan });
  return tenant;
}

/**
 * Authenticate a tenant by email + password.
 */
export async function authenticateTenant(
  email: string,
  password: string,
): Promise<Tenant | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM tenants WHERE email = $1 AND status = 'active'`,
    [email.trim().toLowerCase()],
  );

  if (result.rows.length === 0) return null;

  const tenant = result.rows[0] as Tenant;
  const valid = await verifyPassword(password, tenant.password_hash);
  if (!valid) return null;

  return tenant;
}

/**
 * Get a tenant by ID.
 */
export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return result.rows[0] as Tenant || null;
}

/**
 * Get a tenant by email.
 */
export async function getTenantByEmail(email: string): Promise<Tenant | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM tenants WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  return result.rows[0] as Tenant || null;
}

/**
 * Update a tenant's plan and adjust limits accordingly.
 */
export async function updateTenantPlan(tenantId: string, plan: PlanTier): Promise<Tenant | null> {
  const pool = getPool();
  const limits = PLAN_LIMITS[plan];

  const result = await pool.query(
    `UPDATE tenants
     SET plan = $1, rate_limit = $2, monthly_quota = $3, updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [plan, limits.rateLimit, limits.monthlyQuota, tenantId],
  );

  if (result.rows.length === 0) return null;
  return result.rows[0] as Tenant;
}
