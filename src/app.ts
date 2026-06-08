import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { hostRouter } from './middleware/host-router';
import { logger } from './services/logger';

// Legacy API routes (internal / backward compatible)
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import samlRoutes from './routes/saml';
import oidcRoutes from './routes/oidc';
import zkpRoutes from './routes/zkp';
import adminRoutes from './routes/admin';
import adminLogsRoutes from './routes/admin-logs';
import leadsRoutes from './routes/leads';
import demoPortalRoutes from './routes/demo-portal';

// Side-effect import: wires an in-memory ring buffer into Winston so
// the /api/admin/logs/stream SSE route has something to replay + tail.
// Attaching here (at the app-module level, not inside createApp())
// ensures we only ever add the transport once even if multiple
// test suites build fresh apps against the shared logger singleton.
import { attachRingBufferTransport } from './services/log-ring-buffer';
attachRingBufferTransport(logger);

// Hosted Platform routes
import v1Routes from './routes/v1';
import consoleRoutes from './routes/console';
import consoleSecurityPolicyRoutes from './routes/console-security-policy';
import consoleWebhooksRoutes from './routes/console-webhooks';
import consoleComplianceRoutes from './routes/console-compliance';

export function createApp() {
  const app = express();

  // Behind reverse proxy (Caddy/Nginx/Cloudflare) in production
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  // Security middleware
  // connect-src has to enumerate every cross-host fetch the page makes.
  // After the subdomain split:
  //   - landing (zeroauth.dev) POSTs to api.zeroauth.dev for the lead forms
  //   - docs (docs.zeroauth.dev) playground fetches api.zeroauth.dev
  //   - dashboard (console.zeroauth.dev) is same-origin, already covered by 'self'
  // 'self' alone falls back to default-src 'self' and Chromium blocks the
  // cross-subdomain XHR. Listing the four production hosts plus localhost
  // is the smallest allow-list that covers prod + dev without going wild
  // with wildcards.
  const connectSources = [
    "'self'",
    'https://api.zeroauth.dev',
    'https://console.zeroauth.dev',
    'https://docs.zeroauth.dev',
    'https://zeroauth.dev',
    'https://www.zeroauth.dev',
    'http://localhost:*',
    'http://127.0.0.1:*',
  ];
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        // QR images for the W3 QR-proof sign-in demo come from
        // api.qrserver.com (no extra JS dependency in the dashboard
        // bundle, see dashboard/src/routes/demo/QrProofLogin.tsx).
        // Strictly limited to that one host so the imgSrc relaxation
        // doesn't accumulate.
        imgSrc: ["'self'", 'data:', 'https://api.qrserver.com'],
        connectSrc: connectSources,
      },
    },
  }));

  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
  }));

  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Request logging
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // ═══════════════════════════════════════════════════════════
  // Hosted API — versioned, API-key authenticated
  // ═══════════════════════════════════════════════════════════
  app.use('/v1', v1Routes);

  // Developer Console — account management, API keys, usage
  app.use('/api/console', consoleRoutes);

  // Console: per-tenant security_policy management (ADR 0017).
  // Mounted at `/api/console` alongside `consoleRoutes` so the
  // `requireConsoleAuth` middleware sees the same cookie path
  // (`/api/console`). Mount order doesn't matter — the two routers
  // expose disjoint paths.
  app.use('/api/console', consoleSecurityPolicyRoutes);

  // Console: tenant webhook CRUD (GET/POST/DELETE /api/console/webhooks).
  // Same mount strategy as `consoleSecurityPolicyRoutes` above — sibling
  // router under `/api/console` so the JWT cookie path is unchanged.
  // Paths inside the router are namespaced (`/webhooks`, `/webhooks/:id`)
  // so there is no collision with `consoleRoutes`.
  app.use('/api/console', consoleWebhooksRoutes);

  // Console: per-tenant compliance evidence pack
  // (GET /api/console/compliance/evidence-pack). Sibling router under
  // `/api/console` so the JWT cookie path is unchanged. Render service
  // composes the markdown cover letter, hash-chain snapshot,
  // audit-integrity verdict, and verbatim DPDP §2(t) memo into one
  // self-contained JSON bundle the bank's GRC tool can consume.
  app.use('/api/console', consoleComplianceRoutes);

  // ═══════════════════════════════════════════════════════════
  // Legacy API routes (backward-compatible, internal use)
  // ═══════════════════════════════════════════════════════════
  app.use('/api/health', healthRoutes);

  // ADR 0021: JWKS endpoints for external RS256-token verifiers.
  // Both endpoints are unauthenticated by design — JWKS is public.
  //   - `/.well-known/jwks.json` (RFC 8615): always 200, returns
  //     `{ keys: [] }` when RS256 is not configured.
  //   - `/api/jwks.json`: 200 + JWKS under RS256, 404 under HS256.
  //     Used by the bank's IdP runbook to detect whether the
  //     deployment publishes keys with a single HTTP call.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const jwksRoutes = require('./routes/jwks');
  app.use('/.well-known', jwksRoutes.default);
  app.use('/api', jwksRoutes.apiJwksRouter);

  app.use('/api/auth', authRoutes);
  app.use('/api/auth/saml', samlRoutes);
  app.use('/api/auth/oidc', oidcRoutes);
  app.use('/api/auth/zkp', zkpRoutes);
  app.use('/api/admin', adminRoutes);
  // Mounted as a sibling of /api/admin so the `authenticateAdmin`
  // gate stays inside admin-logs.ts (matching the pattern in
  // admin.ts: `router.use(authenticateAdmin)` at the top of the
  // file). The Express path becomes `/api/admin/logs/stream`.
  app.use('/api/admin/logs', adminLogsRoutes);
  app.use('/api/leads', leadsRoutes);

  // Demo-portal bridge — wires the static SPA at /demo-portal/* to the
  // production /v1/proof-pairing/* service via a cookie-authed shim.
  // Mounted after /api/leads so the host-aware gate below still catches
  // anything that didn't match an /api/* prefix.
  app.use('/api/demo-portal', demoPortalRoutes);

  // Host-aware gate. Anything on api.zeroauth.dev that didn't match an
  // API route stops here (JSON 404) instead of being served the
  // landing-page index.html by the static handlers below.
  app.use(hostRouter);

  // Serve React dashboard in production
  const dashboardPath = path.join(__dirname, '..', 'dashboard', 'dist');
  app.use('/dashboard', express.static(dashboardPath));
  app.get('/dashboard*', (_req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });

  // Serve demo-portal — the public NeoBank "bank demo" — at /bank-demo
  // (mirrors the /dashboard mount pattern). The SPA's Vite `base` and
  // react-router `basename` are both pinned to `/bank-demo/` to match.
  app.use('/bank-demo', express.static(path.join(__dirname, '../demo-portal/dist'), { fallthrough: true }));
  app.get('/bank-demo/*', (req, res) => {
    res.sendFile(path.join(__dirname, '../demo-portal/dist/index.html'));
  });
  // Back-compat: the demo used to live at /demo-portal. Permanent-redirect
  // the old path (and any sub-path) to /bank-demo so existing links/QRs
  // and muscle memory keep working.
  app.get(['/demo-portal', '/demo-portal/*'], (req, res) => {
    const suffix = req.originalUrl.slice('/demo-portal'.length);
    res.redirect(301, `/bank-demo${suffix}`);
  });

  // Serve Docusaurus documentation
  const docsPath = path.join(__dirname, '..', 'website', 'build');
  app.use('/docs', express.static(docsPath));
  app.get('/docs/*', (_req, res) => {
    res.sendFile(path.join(docsPath, 'index.html'));
  });

  // Serve landing page and static assets
  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
