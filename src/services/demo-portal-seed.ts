/**
 * src/services/demo-portal-seed.ts
 *
 * Provisions the **NeoBank Demo Portal** tenant + API key on a fresh
 * database. This module is the in-process seed used by the dev-mode
 * boot path in `src/server.ts`; `scripts/seed-demo-portal.ts` is a
 * thin CLI wrapper around `seedDemoPortal` for operator-driven runs.
 *
 * Why this lives under `src/services/` (and not under `scripts/`):
 *  - `src/server.ts` boots in `development` mode and calls
 *    `seedDemoPortalIfDev` directly. tsconfig.json restricts rootDir to
 *    `src/`, so the boot import must resolve inside that tree.
 *  - The CLI entry (`scripts/seed-demo-portal.ts`) re-exports
 *    `seedDemoPortal` from here so a single source-of-truth defines
 *    the tenant ID, API key, and security policy.
 *
 * Determinism contract:
 *  - Tenant id   : stable UUID derived from sha256("zeroauth-demo-portal-tenant-v1")
 *  - API key     : "za_live_" + sha256("zeroauth-demo-portal-live-key-v1")[:48]
 *  Bumping either domain-separator string rolls the corresponding value
 *  (and breaks every committed demo-portal config), so leave them
 *  pinned unless you are intentionally rotating.
 *
 * Security posture (POC stage, ADR 0017 default tenant):
 *    did_provider          = 'off-chain'
 *    verifier_provider     = 'off-chain'
 *    audit_anchor_provider = 'none'
 *  The demo-portal boots with zero blockchain dependency and zero
 *  external RPC requirement. Production deploys never run the seed —
 *  `seedDemoPortalIfDev` no-ops when NODE_ENV=production.
 */

import crypto from 'crypto';
import { getPool } from './db';
import { logger } from './logger';
import {
  ApiScope,
  TenantSecurityPolicy,
} from '../types';

// ─── Deterministic identifiers ──────────────────────────────────────

/** Domain-separator → 32 hex chars folded into a v4-shaped UUID. */
function deterministicTenantId(): string {
  const h = crypto
    .createHash('sha256')
    .update('zeroauth-demo-portal-tenant-v1')
    .digest('hex');
  // Shape the first 32 hex chars as a UUID. We pin the v4 nibble + a
  // valid variant nibble so Postgres' UUID type accepts the literal.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

/** Domain-separator → 48 hex chars → `za_live_…` (48-char body). */
function deterministicLiveKey(): string {
  const h = crypto
    .createHash('sha256')
    .update('zeroauth-demo-portal-live-key-v1')
    .digest('hex');
  return `za_live_${h.slice(0, 48)}`;
}

// Public so other modules + tests can reference the exact same values
// without re-deriving them. DO NOT edit either constant without bumping
// the version suffix above.
export const DEMO_PORTAL_TENANT_ID = deterministicTenantId();
export const DEMO_PORTAL_API_KEY = deterministicLiveKey();
export const DEMO_PORTAL_TENANT_EMAIL = 'demo-portal@zeroauth.dev';
export const DEMO_PORTAL_TENANT_COMPANY = 'NeoBank Demo Portal';

// ─── Tenant configuration ───────────────────────────────────────────

// POC stage: every provider slot is off. The demo-portal demonstrates
// the Pramaan ZK pipeline + hash-chained audit log without any chain
// dependency, matching the default tenant posture from ADR 0017.
export const DEMO_PORTAL_SECURITY_POLICY: TenantSecurityPolicy = {
  did_provider: 'off-chain',
  verifier_provider: 'off-chain',
  audit_anchor_provider: 'none',
  // The demo-portal is an investor showcase; we relax the Play Integrity
  // gate so the deck can run in a kiosk browser AND a side-loaded
  // (non-Play-Store-signed) demo APK can register/login against it.
  allow_play_integrity_absent: true,
  allowed_origins: [
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:3030',
    // Hosted bank demo (zeroauth.dev/bank-demo) + the API host the
    // phone app talks to directly.
    'https://zeroauth.dev',
    'https://www.zeroauth.dev',
    'https://api.zeroauth.dev',
  ],
};

// Same scope set the dashboard hands out on signup. Demo-portal exercises
// identity register/verify + the proof-pairing pipeline; the extra scopes
// are forward-compatible if the demo grows.
const DEMO_PORTAL_SCOPES: ApiScope[] = [
  'zkp:verify',
  'zkp:register',
  'identity:read',
  'nonce:create',
  'devices:read',
  'devices:write',
  'users:read',
  'users:write',
  'verifications:read',
  'verifications:write',
  'attendance:read',
  'attendance:write',
  'audit:read',
  'proof_pairing:create',
  'proof_pairing:claim',
];

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Idempotent seed.
 *
 * Either the tenant + key both exist (no-op) or both are inserted.
 * Insertion uses `ON CONFLICT DO NOTHING` against the unique columns so
 * partial state (tenant present, key missing) is repaired on the next
 * call instead of erroring out.
 *
 * Returns `{ created: true }` when this call inserted at least one row;
 * `{ created: false }` when everything was already in place.
 */
export async function seedDemoPortal(): Promise<{ created: boolean }> {
  const pool = getPool();
  const tenantId = DEMO_PORTAL_TENANT_ID;
  const rawKey = DEMO_PORTAL_API_KEY;
  const keyHash = sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 14);

  // We never need to authenticate the demo-portal tenant via password —
  // it has no developer-console login. Park a single-use scrypt-shaped
  // string so the NOT NULL constraint is satisfied; the column has no
  // path that would unlock it.
  const unguessable = crypto.randomBytes(48).toString('hex');
  const passwordHash = `seed:${unguessable}`;

  // Single transaction so a crash between the two INSERTs cannot leave
  // a half-seeded tenant.
  const client = await pool.connect();
  let inserted = false;
  try {
    await client.query('BEGIN');

    // Tenant row. The id is forced to the deterministic UUID so the API
    // key's foreign-key target stays stable across DB resets.
    const tenantInsert = await client.query(
      `INSERT INTO tenants (
         id, email, password_hash, company_name, plan, status,
         rate_limit, monthly_quota, security_policy
       )
       VALUES ($1, $2, $3, $4, 'enterprise', 'active', $5, $6, $7::jsonb)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        DEMO_PORTAL_TENANT_EMAIL,
        passwordHash,
        DEMO_PORTAL_TENANT_COMPANY,
        5000,
        -1, // unlimited — demo budget is irrelevant
        JSON.stringify(DEMO_PORTAL_SECURITY_POLICY),
      ],
    );
    if ((tenantInsert.rowCount ?? 0) > 0) inserted = true;

    // API key row. Keyed on the SHA-256 hash (UNIQUE) so re-runs are a
    // no-op. We insert directly rather than calling
    // `src/services/api-keys.ts::createApiKey` because that helper
    // *generates* the raw key with crypto.randomBytes — using it would
    // produce a different key on every boot, which defeats the purpose.
    const keyInsert = await client.query(
      `INSERT INTO api_keys (
         tenant_id, name, key_prefix, key_hash, scopes, environment, status
       )
       VALUES ($1, $2, $3, $4, $5, 'live', 'active')
       ON CONFLICT (key_hash) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        'Demo Portal Static Key',
        keyPrefix,
        keyHash,
        DEMO_PORTAL_SCOPES,
      ],
    );
    if ((keyInsert.rowCount ?? 0) > 0) inserted = true;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (inserted) {
    logger.info('demo-portal tenant + API key seeded', {
      tenantId,
      keyPrefix,
      providers: {
        did_provider: DEMO_PORTAL_SECURITY_POLICY.did_provider,
        verifier_provider: DEMO_PORTAL_SECURITY_POLICY.verifier_provider,
        audit_anchor_provider: DEMO_PORTAL_SECURITY_POLICY.audit_anchor_provider,
      },
    });
  } else {
    logger.debug('demo-portal tenant + API key already present, no-op', { tenantId });
  }

  return { created: inserted };
}

/**
 * Boot hook used by `src/server.ts`.
 *
 * Seeds the demo-portal tenant (deterministic `za_live_` key + permissive
 * security policy) so the hosted bank demo at zeroauth.dev/bank-demo works.
 *
 * Gating:
 *   - `SEED_DEMO_PORTAL=false` → always skip (even in dev).
 *   - `SEED_DEMO_PORTAL=true`  → always seed (explicit prod opt-in; this is
 *     how the hosted demo gets its tenant on a `NODE_ENV=production` box).
 *   - unset → seed in development only (a vanilla production deploy never
 *     gets the deterministic key unless the operator opts in).
 *
 * The seeded tenant is a zeroauth-owned sandbox showcase tenant with no
 * real customer data; the deterministic key is acceptable for that scope.
 */
export async function seedDemoPortalIfDev(): Promise<void> {
  const flag = process.env.SEED_DEMO_PORTAL;
  if (flag === 'false') return;
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
  if (isProd && flag !== 'true') return;
  try {
    await seedDemoPortal();
  } catch (err) {
    logger.warn('demo-portal seed failed — demo-portal will be unavailable', {
      error: (err as Error).message,
    });
  }
}
