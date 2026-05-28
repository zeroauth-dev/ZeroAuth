/**
 * Cross-tenant rejection matrix (Phase 0 commit C-007).
 *
 * Goal: assert at the source level that every `/v1/*` endpoint is
 * gated by the tenant-auth middleware. The HTTP-level matrix
 * exercises that the middleware actually rejects fake keys; that
 * lives in `tests/central-api.test.ts` for the routes that already
 * have integration coverage.
 *
 * The source-level guard here is the **enforcement** layer: if a
 * future commit lands a new `/v1/*` handler without `requireApiKey`
 * (or its equivalents) the test fails before any HTTP behaviour
 * matters.
 *
 * Recognised middleware tokens — any of these on the `router.<verb>`
 * declaration line is accepted as a valid auth gate:
 *
 *   - requireApiKey
 *   - authenticateApiKey
 *   - tenantAuth
 *   - authenticate (legacy alias)
 *
 * The file-level `router.use(requireApiKey)` is also accepted: if the
 * router mounts an auth middleware globally at the top, every handler
 * in the file inherits it.
 *
 * The service-layer guarantee that every Postgres query carries
 * `WHERE tenant_id = $1 AND environment = $2` is separately pinned
 * by tests in `tests/platform.test.ts` (see "tenant scoping (A-01)").
 */

import * as fs from 'fs';
import * as path from 'path';

const V1_DIR = path.resolve(__dirname, '../src/routes/v1');

const AUTH_MIDDLEWARE_TOKENS = [
  // Current canonical name in src/middleware/tenant-auth.ts:
  'authenticateTenantApiKey',
  // Forward-compat aliases (renamings would re-trigger this guard
  // unless added here):
  'requireApiKey',
  'authenticateApiKey',
  'tenantAuth',
];

interface Route {
  file: string;
  method: string;
  routerPath: string;
  declarationLines: string;
  inheritsRouterUse: boolean;
}

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

function collectRoutes(file: string, src: string): Route[] {
  const cleaned = stripComments(src);
  const routes: Route[] = [];
  // File-level: does the router have a global `router.use(<authMw>)`?
  const routerUseAuth = AUTH_MIDDLEWARE_TOKENS.some(t =>
    new RegExp(`router\\.use\\(\\s*${t}\\b`).test(cleaned),
  );
  // Per-handler matches. The declaration line covers the call
  // signature up to the route handler — middlewares get listed
  // before the handler function. We accept declarations that span
  // multiple lines.
  const re = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"][\s\S]*?(?=router\.|export\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    routes.push({
      file,
      method: m[1],
      routerPath: m[2],
      declarationLines: m[0],
      inheritsRouterUse: routerUseAuth,
    });
  }
  return routes;
}

function hasAuthGate(route: Route): boolean {
  if (route.inheritsRouterUse) return true;
  return AUTH_MIDDLEWARE_TOKENS.some(t =>
    new RegExp(`\\b${t}\\b`).test(route.declarationLines),
  );
}

describe('tenant isolation — source-level cross-tenant guard', () => {
  const files = fs.readdirSync(V1_DIR)
    .filter(f => f.endsWith('.ts') && f !== 'index.ts');

  it('discovers at least 9 route files under src/routes/v1/', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it('every route file mounts in src/routes/v1/index.ts', () => {
    const index = fs.readFileSync(path.join(V1_DIR, 'index.ts'), 'utf8');
    const missing: string[] = [];
    for (const file of files) {
      const importName = file.replace(/\.ts$/, '');
      const re = new RegExp(`from\\s+['"]\\.\\/${importName}['"]`);
      if (!re.test(index)) missing.push(file);
    }
    expect(missing).toEqual([]);
  });

  // Public-by-design routes that intentionally do NOT carry a tenant
  // auth gate (anonymous identity/refresh, anonymous OIDC/SAML metadata,
  // pairing's public session-public endpoint that the kiosk reaches
  // without an API key). Each entry is justified by the threat model.
  const PUBLIC_ROUTE_EXCEPTIONS: { file: string; method: string; routerPath: string; reason: string }[] = [
    { file: 'oidc',          method: 'get',  routerPath: '/authorize', reason: 'Standard OIDC authorize endpoint — pre-auth by definition' },
    { file: 'oidc',          method: 'post', routerPath: '/callback',  reason: 'IdP callback — auth context is in the OIDC payload' },
    { file: 'saml',          method: 'get',  routerPath: '/login',     reason: 'Standard SAML login redirect' },
    { file: 'saml',          method: 'post', routerPath: '/callback',  reason: 'IdP callback — auth context is in the SAML assertion' },
    { file: 'saml',          method: 'get',  routerPath: '/metadata',  reason: 'SAML SP metadata — public by spec' },
    { file: 'proof-pairing', method: 'get',  routerPath: '/sessions/:id/public', reason: 'Kiosk-facing public view — no API key' },
    { file: 'proof-pairing', method: 'get',  routerPath: '/sessions/:id/submit', reason: 'Submit body carries the pairing session token' },
    { file: 'proof-pairing', method: 'post', routerPath: '/sessions/:id/submit', reason: 'Submit body carries the pairing session token' },
    { file: 'proof-pairing', method: 'get',  routerPath: '/sessions/:id/stream', reason: 'SSE stream auth is by session bind cookie' },
    { file: 'identity',      method: 'post', routerPath: '/refresh',   reason: 'Refresh token endpoint — auth is in the refresh token' },
    { file: 'identity',      method: 'post', routerPath: '/logout',    reason: 'Logout invalidates the bearer the caller presents' },
    { file: 'zkp',           method: 'post', routerPath: '/register',  reason: 'Pre-enrollment — no tenant context yet' },
    { file: 'zkp',           method: 'post', routerPath: '/verify',    reason: 'Public proof verification — body carries DID + commitment' },
    { file: 'zkp',           method: 'get',  routerPath: '/nonce',     reason: 'Anonymous challenge issuance' },
    { file: 'zkp',           method: 'get',  routerPath: '/circuit-info', reason: 'Public capability advertisement' },
    { file: 'devices',       method: 'post', routerPath: '/enroll',    reason: 'ADR 0022 device enrollment — code is the bearer credential' },
    { file: 'registrations', method: 'post', routerPath: '/pair-device', reason: 'ADR 0023 step 1 — pair_code from QR1 is the bearer credential' },
    { file: 'registrations', method: 'post', routerPath: '/submit-commitment', reason: 'ADR 0023 step 2 — enroll_code from QR2 is the bearer credential' },
    { file: 'registrations', method: 'post', routerPath: '/complete', reason: 'ADR 0023 step 3 — verify_code from QR3 is the bearer credential' },
  ];

  function isException(route: { file: string; method: string; routerPath: string }): boolean {
    return PUBLIC_ROUTE_EXCEPTIONS.some(e =>
      e.file === route.file &&
      e.method.toLowerCase() === route.method.toLowerCase() &&
      e.routerPath === route.routerPath,
    );
  }

  describe.each(files)('%s', (file) => {
    const src = fs.readFileSync(path.join(V1_DIR, file), 'utf8');
    const fileBase = file.replace(/\.ts$/, '');
    const routes = collectRoutes(fileBase, src);

    it('has at least one handler', () => {
      expect(routes.length).toBeGreaterThanOrEqual(1);
    });

    for (const route of routes) {
      const label = `${route.method.toUpperCase()} ${route.routerPath}`;
      if (isException({ file: fileBase, method: route.method, routerPath: route.routerPath })) {
        it.skip(`${label} (intentionally public, see PUBLIC_ROUTE_EXCEPTIONS)`, () => undefined);
        continue;
      }
      it(`${label} has a tenant-auth middleware on its declaration`, () => {
        expect({ file: fileBase, route: label, hasGate: hasAuthGate(route) }).toMatchObject({
          file: fileBase,
          route: label,
          hasGate: true,
        });
      });
    }
  });

  it('the exception list is reviewed; every entry has a reason', () => {
    for (const e of PUBLIC_ROUTE_EXCEPTIONS) {
      expect(e.reason).toBeTruthy();
      expect(e.reason.length).toBeGreaterThanOrEqual(20);
    }
  });
});
