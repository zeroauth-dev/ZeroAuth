import crypto from 'crypto';
import { getPool } from './db';
import { logger } from './logger';
import {
  ApiKey,
  ApiKeyCreateResult,
  ApiKeyEnvironment,
  ApiScope,
} from '../types';

/**
 * Generate a cryptographically random API key.
 * Format: za_{env}_{32 random hex chars}
 * Example: za_live_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
 */
function generateRawKey(environment: ApiKeyEnvironment): string {
  const random = crypto.randomBytes(24).toString('hex');
  return `za_${environment}_${random}`;
}

/** SHA-256 hash of the raw key (what we store in the DB) */
function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/** Extract the prefix for identification (first 14 chars) */
function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, 14);
}

// ─── CRUD Operations ─────────────────────────────────────────────

/**
 * Create a new API key for a tenant.
 * Returns the full raw key ONCE — it's never stored or retrievable again.
 */
export async function createApiKey(
  tenantId: string,
  name: string = 'Default',
  environment: ApiKeyEnvironment = 'live',
  scopes: ApiScope[] = ['zkp:verify', 'zkp:register', 'identity:read', 'nonce:create'],
): Promise<ApiKeyCreateResult> {
  const pool = getPool();
  const rawKey = generateRawKey(environment);
  const keyHash = hashKey(rawKey);
  const keyPrefix = extractPrefix(rawKey);

  const result = await pool.query(
    `INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, environment)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, key_prefix, scopes, environment, created_at`,
    [tenantId, name, keyPrefix, keyHash, scopes, environment],
  );

  const row = result.rows[0];
  logger.info('API key created', { tenantId, keyPrefix, environment });

  return {
    key: rawKey,
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: row.scopes,
    environment: row.environment,
    created_at: row.created_at,
  };
}

/**
 * Authenticate an API key.
 * Returns the ApiKey row + tenant info if valid, null otherwise.
 */
export async function authenticateApiKey(
  rawKey: string,
): Promise<ApiKey | null> {
  const pool = getPool();
  const keyHash = hashKey(rawKey);

  const result = await pool.query(
    `SELECT * FROM api_keys WHERE key_hash = $1 AND status = 'active'`,
    [keyHash],
  );

  if (result.rows.length === 0) return null;

  const apiKey = result.rows[0] as ApiKey;

  // Check expiry
  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return null;
  }

  // Update last_used_at (fire-and-forget, don't block the request)
  pool.query(
    `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
    [apiKey.id],
  ).catch(() => { /* swallow */ });

  return apiKey;
}

/**
 * List all API keys for a tenant (without hashes).
 */
export async function listApiKeys(tenantId: string): Promise<Omit<ApiKey, 'key_hash'>[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tenant_id, name, key_prefix, scopes, environment, status,
            last_used_at, expires_at, created_at, revoked_at
     FROM api_keys
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId],
  );
  return result.rows;
}

/**
 * Revoke an API key. Irreversible.
 */
export async function revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE api_keys
     SET status = 'revoked', revoked_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND status = 'active'
     RETURNING id`,
    [keyId, tenantId],
  );

  if (result.rowCount === 0) return false;

  logger.info('API key revoked', { tenantId, keyId });
  return true;
}

/**
 * Count active API keys for a tenant.
 */
export async function countActiveKeys(tenantId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT COUNT(*) FROM api_keys WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );
  return parseInt(result.rows[0].count, 10);
}
