import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

/**
 * Gate for the legacy SAML and OIDC routes that do NOT perform real protocol
 * validation (no SAML signature verification, no OIDC code exchange against
 * the IdP). They simulate the happy path and mint session JWTs from the
 * request body, which is unsafe to expose to the public internet.
 *
 * Without `ENABLE_DEMO_AUTH=true`, every protected endpoint here returns
 * 503 with a clear pointer to /v1 + the docs. Production deployments leave
 * the flag off; local development and integration tests opt in via .env.
 */
export function demoAuthOnly(req: Request, res: Response, next: NextFunction): void {
  if (config.enableDemoAuth) {
    next();
    return;
  }
  res.status(503).json({
    error: 'demo_auth_disabled',
    message:
      'This endpoint is a demo stub that does not validate real SAML / OIDC ' +
      'assertions and is disabled in production. Use /v1/auth/saml or ' +
      '/v1/auth/oidc with a tenant API key, or set ENABLE_DEMO_AUTH=true ' +
      'in non-production environments.',
    docs: '/docs/integrations/saml-sso',
  });
}
