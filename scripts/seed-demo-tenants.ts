/**
 * scripts/seed-demo-tenants.ts — C-108
 *
 * Provisions the "Anchor Bank" demo tenant in both `live` and `test`
 * environments and prints one fresh API key per environment exactly once.
 *
 * Why a dedicated seed script (and not a migration):
 * - Migrations run inside CI / autodeploy and must be idempotent without
 *   side effects on stdout. This script is run **interactively** by an
 *   operator on a fresh VPS or staging DB, exactly once per environment;
 *   the API keys are printed to stdout and must be captured by hand
 *   because the server only stores their SHA-256 (see
 *   `src/services/api-keys.ts`).
 * - Re-running the script is safe — the idempotency check on the tenant
 *   email short-circuits before any INSERT. This is intentional: if an
 *   operator loses the keys, they cannot be recovered from the DB; they
 *   must be revoked from the dashboard and a new pair issued via the
 *   normal `/api/console/keys` flow.
 *
 * Bank-demo spec reference:
 * - docs/plan/bfsi-v1/02-bank-demo.md — "Anchor Bank" placeholder.
 * - docs/plan/bfsi-v1/04-commits.md C-108 — DoD.
 *
 * Run:
 *   tsx scripts/seed-demo-tenants.ts
 *
 * Exit codes:
 *   0 — success (tenant created, keys printed) OR tenant already present.
 *   1 — unexpected error (DB connectivity, constraint violation, etc.).
 */

import crypto from 'crypto';
import { initDb, getPool, closeDb } from '../src/services/db';
import { createTenant, getTenantByEmail } from '../src/services/tenants';
import { createApiKey } from '../src/services/api-keys';
import {
  ApiKeyCreateResult,
  ApiScope,
  TenantSecurityPolicy,
} from '../src/types';

const TENANT_EMAIL = 'anchor-bank-demo@zeroauth.dev';
const TENANT_COMPANY = 'Anchor Bank (Demo)';
const TENANT_PLAN = 'enterprise' as const;
const TENANT_STATUS = 'active' as const;

// BFSI pilot-grade limits. PLAN_LIMITS.enterprise gives 10_000 / -1
// (unlimited) by default; the demo tenant runs at 5_000 / 1_000_000 so
// we can demonstrate quota / rate-limit observability without the demo
// hitting any cap during a 30-minute on-stage run.
const TENANT_RATE_LIMIT = 5000;
const TENANT_MONTHLY_QUOTA = 1_000_000;

// Anchor Bank security policy. Real BFSI pilot configuration:
// - require_strong_integrity=true: every /v1/proof-pairing/submit must
//   carry a MEETS_STRONG_INTEGRITY Play Integrity verdict (rank ≥ 4).
// - allow_play_integrity_absent=false: a submit without any verdict is
//   rejected with `play_integrity_required` (no demo bypass).
// - allowed_origins: kiosk demo origin + admin dashboard origin. The
//   field is consulted by tenant-scoped browser surfaces; the platform
//   CORS allowlist at config.cors.origins still gates everything else.
const TENANT_SECURITY_POLICY: TenantSecurityPolicy = {
  require_strong_integrity: true,
  allow_play_integrity_absent: false,
  allowed_origins: [
    'https://kiosk.anchor-bank-demo.zeroauth.dev',
    'https://dashboard.anchor-bank-demo.zeroauth.dev',
  ],
};

// Full scope set — the demo tenant exercises every documented surface
// (identity register, proof pairing, devices, users, verifications,
// attendance, audit). Mirrors the default scope set in
// `src/services/api-keys.ts::createApiKey`.
const ANCHOR_BANK_SCOPES: ApiScope[] = [
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

function log(line: string): void {
  console.log(`[SEED] ${line}`);
}

function err(line: string): void {
  console.error(`[SEED] ${line}`);
}

/**
 * Override the rate_limit + monthly_quota + status set by createTenant
 * (which always uses PLAN_LIMITS) and stamp the tenant's security_policy
 * JSONB. Done in a single UPDATE so the row is never visible to other
 * callers in an inconsistent state.
 */
async function applyDemoTenantOverrides(tenantId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE tenants
       SET rate_limit = $2,
           monthly_quota = $3,
           status = $4,
           security_policy = $5::jsonb,
           updated_at = NOW()
     WHERE id = $1`,
    [
      tenantId,
      TENANT_RATE_LIMIT,
      TENANT_MONTHLY_QUOTA,
      TENANT_STATUS,
      JSON.stringify(TENANT_SECURITY_POLICY),
    ],
  );
}

/**
 * Idempotency contract: this function is what the test pins on.
 *
 * On first run:
 *   - inserts the tenant row with `createTenant`,
 *   - overrides limits + status + security_policy,
 *   - mints one `live` API key and one `test` API key,
 *   - prints both raw keys with the SAVE-THESE banner,
 *   - returns { created: true }.
 *
 * On any subsequent run (tenant email already present):
 *   - logs that the tenant exists,
 *   - DOES NOT call createTenant,
 *   - DOES NOT call createApiKey,
 *   - returns { created: false }.
 */
export async function seedAnchorBank(): Promise<{ created: boolean }> {
  log('Anchor Bank demo tenant seed starting');
  log(`Target email: ${TENANT_EMAIL}`);

  const existing = await getTenantByEmail(TENANT_EMAIL);
  if (existing) {
    log(`Tenant already exists (id=${existing.id}) — nothing to do.`);
    log('API keys cannot be re-issued from the seed script; the raw');
    log('values were printed only on the original run. If the keys are');
    log('lost, revoke them in /api/console/keys and mint replacements');
    log('via the dashboard.');
    return { created: false };
  }

  // We need a password to satisfy the NOT NULL hash column; the demo
  // tenant never logs into the developer console via email + password,
  // so the password is unguessable random bytes and discarded after
  // hashing. No path in the codebase can recover it.
  const randomPassword = crypto.randomBytes(48).toString('hex');

  log('Creating tenant row');
  const tenant = await createTenant(
    TENANT_EMAIL,
    randomPassword,
    TENANT_COMPANY,
    TENANT_PLAN,
  );
  log(`Tenant created (id=${tenant.id}, plan=${TENANT_PLAN})`);

  log('Applying demo-tenant overrides (rate_limit, monthly_quota, security_policy)');
  await applyDemoTenantOverrides(tenant.id);

  log('Minting live + test API keys');
  const liveKey: ApiKeyCreateResult = await createApiKey(
    tenant.id,
    'Anchor Bank Live Key',
    'live',
    ANCHOR_BANK_SCOPES,
  );
  const testKey: ApiKeyCreateResult = await createApiKey(
    tenant.id,
    'Anchor Bank Test Key',
    'test',
    ANCHOR_BANK_SCOPES,
  );

  // ───────────────────────────────────────────────────────────────────
  // Print the raw keys exactly once. Operator must capture these out
  // of stdout; the server stores only the SHA-256 hashes (see
  // src/services/api-keys.ts) and there is no path to recover them.
  // ───────────────────────────────────────────────────────────────────
  console.log('');
  console.log('============================================================');
  console.log('[OPERATOR: SAVE THESE — NOT RECOVERABLE]');
  console.log('============================================================');
  console.log(`Anchor Bank tenant_id : ${tenant.id}`);
  console.log(`Live API key (live)   : ${liveKey.key}`);
  console.log(`Test API key (test)   : ${testKey.key}`);
  console.log('============================================================');
  console.log('');

  log('Done. Tenant ready for the bank-demo runbook.');
  return { created: true };
}

async function main(): Promise<void> {
  await initDb();
  try {
    await seedAnchorBank();
  } finally {
    await closeDb();
  }
}

// Only run main() when the script is invoked directly (`tsx
// scripts/seed-demo-tenants.ts`). Importing the module from a test
// must not trigger the DB connection.
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      err(`Seed failed: ${e instanceof Error ? e.message : String(e)}`);
      if (e instanceof Error && e.stack) err(e.stack);
      process.exit(1);
    },
  );
}
