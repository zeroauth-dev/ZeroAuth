#!/usr/bin/env tsx
/**
 * scripts/seed-demo-portal.ts
 *
 * CLI entry point for the NeoBank Demo Portal tenant + API key seed.
 *
 * All of the actual seeding logic — tenant ID derivation, API key
 * derivation, ON CONFLICT DO NOTHING semantics, ADR 0017 provider
 * triple — lives in `src/services/demo-portal-seed.ts`. This file is
 * intentionally thin so the same in-process seed used by the dev-mode
 * boot path (`src/server.ts` → `seedDemoPortalIfDev`) is byte-identical
 * to what an operator runs by hand on a non-dev environment.
 *
 * Run:
 *   npx tsx scripts/seed-demo-portal.ts
 *   npm run seed:demo-portal
 *
 * Exit codes:
 *   0 — success (tenant created OR already present)
 *   1 — unexpected error (DB unavailable, constraint violation, etc.)
 *
 * The deterministic ZEROAUTH_API_KEY is committed into
 * `demo-portal/.env.example` and documented in `demo-portal/README.md`,
 * so a fresh `docker compose --profile dev up` boots with the demo-portal
 * tenant ready and zero operator copy-paste steps.
 */

import { initDb, closeDb } from '../src/services/db';
import {
  seedDemoPortal,
  DEMO_PORTAL_TENANT_ID,
  DEMO_PORTAL_API_KEY,
} from '../src/services/demo-portal-seed';

async function main(): Promise<void> {
  await initDb();
  try {
    const { created } = await seedDemoPortal();
    if (created) {
      console.log('');
      console.log('============================================================');
      console.log('[demo-portal seed] tenant + API key inserted');
      console.log('============================================================');
      console.log(`tenant_id : ${DEMO_PORTAL_TENANT_ID}`);
      console.log(`api_key   : ${DEMO_PORTAL_API_KEY}`);
      console.log('============================================================');
      console.log('');
    } else {
      console.log('[demo-portal seed] tenant + API key already present, no-op');
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(
        `[demo-portal seed] failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      if (e instanceof Error && e.stack) console.error(e.stack);
      process.exit(1);
    },
  );
}
