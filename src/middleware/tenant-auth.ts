import { Request, Response, NextFunction } from 'express';
import { authenticateApiKey } from '../services/api-keys';
import { getTenantById } from '../services/tenants';
import { checkQuota } from '../services/usage';
import { logApiCall } from '../services/usage';
import { logger } from '../services/logger';
import { TenantContext, ApiScope } from '../types';

// In-memory sliding window rate limiter per tenant
const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Authenticate a request via API key (Authorization: Bearer za_live_xxx)
 * and attach the TenantContext to the request.
 */
export function authenticateTenantApiKey(requiredScopes: ApiScope[] = []) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();

    // Extract API key from Authorization header or x-api-key header
    let rawKey: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer za_')) {
      rawKey = authHeader.slice(7);
    } else if (typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].startsWith('za_')) {
      rawKey = req.headers['x-api-key'];
    }

    if (!rawKey) {
      res.status(401).json({
        error: 'missing_api_key',
        message: 'Provide your API key via Authorization: Bearer za_live_xxx or X-API-Key header.',
        docs: '/docs/getting-started/quickstart',
      });
      return;
    }

    // Validate key format
    if (!/^za_(live|test)_[a-f0-9]{48}$/.test(rawKey)) {
      res.status(401).json({
        error: 'invalid_api_key_format',
        message: 'API key must match format: za_{live|test}_{48 hex chars}',
      });
      return;
    }

    // Authenticate
    const apiKey = await authenticateApiKey(rawKey);
    if (!apiKey) {
      res.status(401).json({
        error: 'invalid_api_key',
        message: 'API key is invalid, expired, or revoked.',
      });
      return;
    }

    // Check required scopes
    if (requiredScopes.length > 0) {
      const hasScopes = requiredScopes.every(s => apiKey.scopes.includes(s));
      if (!hasScopes) {
        res.status(403).json({
          error: 'insufficient_scopes',
          message: `This key lacks required scopes: ${requiredScopes.join(', ')}`,
          currentScopes: apiKey.scopes,
        });
        return;
      }
    }

    // Load tenant
    const tenant = await getTenantById(apiKey.tenant_id);
    if (!tenant || tenant.status !== 'active') {
      res.status(403).json({
        error: 'tenant_inactive',
        message: 'Your account is suspended or deactivated. Contact support.',
      });
      return;
    }

    // Rate limiting (sliding window per tenant)
    const now = Date.now();
    let window = rateLimitWindows.get(tenant.id);
    if (!window || (now - window.windowStart) > WINDOW_MS) {
      window = { count: 0, windowStart: now };
      rateLimitWindows.set(tenant.id, window);
    }
    window.count++;

    if (window.count > tenant.rate_limit) {
      const retryAfterSec = Math.ceil((window.windowStart + WINDOW_MS - now) / 1000);
      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: `Rate limit of ${tenant.rate_limit} requests per 15 minutes exceeded.`,
        plan: tenant.plan,
        retryAfterSeconds: retryAfterSec,
        upgradeUrl: '/docs/getting-started/quickstart#plans',
      });
      return;
    }

    // Monthly quota check
    const quota = await checkQuota(tenant.id, tenant.monthly_quota);
    if (!quota.allowed) {
      res.status(429).json({
        error: 'monthly_quota_exceeded',
        message: `Monthly quota of ${quota.limit} requests exceeded (${quota.used} used).`,
        plan: tenant.plan,
        used: quota.used,
        limit: quota.limit,
        upgradeUrl: '/docs/getting-started/quickstart#plans',
      });
      return;
    }

    // Attach context
    const ctx: TenantContext = { tenant, apiKey };
    (req as any).tenantContext = ctx;

    // Log usage after response completes (fire-and-forget)
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      logApiCall(
        tenant.id,
        apiKey.id,
        req.originalUrl,
        req.method,
        res.statusCode,
        responseTime,
        req.ip || null,
        req.headers['user-agent'] || null,
      );
    });

    // Set rate limit headers
    res.set('X-RateLimit-Limit', String(tenant.rate_limit));
    res.set('X-RateLimit-Remaining', String(Math.max(0, tenant.rate_limit - window.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil((window.windowStart + WINDOW_MS) / 1000)));
    res.set('X-ZeroAuth-Tenant', tenant.id);
    res.set('X-ZeroAuth-Plan', tenant.plan);

    next();
  };
}

/**
 * Helper to extract TenantContext from request.
 */
export function getTenantContext(req: Request): TenantContext {
  const ctx = (req as any).tenantContext as TenantContext | undefined;
  if (!ctx) throw new Error('TenantContext not found — is authenticateTenantApiKey middleware applied?');
  return ctx;
}
