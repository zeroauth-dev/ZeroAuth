import { getPool } from './db';
import { logger } from './logger';
import { UsageSummary } from '../types';

/**
 * Log an API call (fire-and-forget — never blocks the request).
 */
export function logApiCall(
  tenantId: string,
  apiKeyId: string | null,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs: number,
  ipAddress: string | null,
  userAgent: string | null,
): void {
  const pool = getPool();
  pool.query(
    `INSERT INTO usage_logs (tenant_id, api_key_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress, userAgent],
  ).catch(err => {
    logger.warn('Failed to log API usage', { error: (err as Error).message });
  });

  // Also bump the monthly aggregate (upsert)
  const endpoint_lower = endpoint.toLowerCase();
  let column = 'total_requests';
  if (endpoint_lower.includes('/zkp/verify')) column = 'zkp_verifications';
  else if (endpoint_lower.includes('/zkp/register')) column = 'zkp_registrations';
  else if (endpoint_lower.includes('/saml/')) column = 'saml_auths';
  else if (endpoint_lower.includes('/oidc/')) column = 'oidc_auths';

  pool.query(
    `INSERT INTO usage_monthly (tenant_id, month, total_requests, ${column})
     VALUES ($1, date_trunc('month', NOW())::date, 1, 1)
     ON CONFLICT (tenant_id, month)
     DO UPDATE SET total_requests = usage_monthly.total_requests + 1,
                   ${column} = usage_monthly.${column} + 1`,
    [tenantId],
  ).catch(() => { /* swallow */ });
}

/**
 * Get usage count for current month.
 */
export async function getCurrentMonthUsage(tenantId: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT total_requests FROM usage_monthly
     WHERE tenant_id = $1 AND month = date_trunc('month', NOW())::date`,
    [tenantId],
  );
  return result.rows[0]?.total_requests || 0;
}

/**
 * Get usage summary for last N months.
 */
export async function getUsageSummary(tenantId: string, months: number = 6): Promise<UsageSummary[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
       to_char(month, 'YYYY-MM') as period,
       total_requests,
       zkp_verifications,
       zkp_registrations,
       saml_auths,
       oidc_auths
     FROM usage_monthly
     WHERE tenant_id = $1
       AND month >= date_trunc('month', NOW() - interval '${months} months')::date
     ORDER BY month DESC`,
    [tenantId],
  );
  return result.rows;
}

/**
 * Get recent API calls for a tenant (last 100).
 */
export async function getRecentCalls(tenantId: string, limit: number = 100): Promise<any[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT endpoint, method, status_code, response_time_ms, created_at
     FROM usage_logs
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows;
}

/**
 * Check if a tenant has exceeded their monthly quota.
 * Returns { allowed: boolean, used: number, limit: number }
 */
export async function checkQuota(tenantId: string, monthlyQuota: number): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  if (monthlyQuota === -1) return { allowed: true, used: 0, limit: -1 }; // unlimited

  const used = await getCurrentMonthUsage(tenantId);
  return {
    allowed: used < monthlyQuota,
    used,
    limit: monthlyQuota,
  };
}
