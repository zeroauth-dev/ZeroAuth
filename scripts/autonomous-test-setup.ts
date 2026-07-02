/**
 * scripts/autonomous-test-setup.ts — one-shot bootstrap for autonomous
 * mobile testing against the NeoBank demo-portal tenant.
 *
 * Why this exists:
 *   The mobile app's `PerInstallStableSecret` lazily generates a fresh
 *   32-byte secret on first launch and persists it in SharedPreferences
 *   at `zeroauth_reg_secret / secret_hex`. For autonomous emulator-
 *   driven tests we need:
 *     1. a DETERMINISTIC secret so registration + login agree on the
 *        same commitment across runs,
 *     2. the same secret pre-registered SERVER-SIDE so the phone can
 *        "skip" the three-QR ceremony and behave like a known user from
 *        the very first launch,
 *     3. tenant_users.metadata backfilled with { did, did_hash,
 *        commitment } so proof-pairing login can resolve the user via
 *        findUserByDid (see src/services/proof-pairing.ts ~L340).
 *
 * This script handles (1) + (2) + (3) in one shot. The emulator-side
 * injection (writing `secret_hex` into SharedPreferences via
 * `adb shell run-as`) is done by the parent task — this script's job is
 * to put the server in a state that AGREES with whatever the emulator
 * is going to claim its secret is.
 *
 * Deterministic seed:
 *   const seed = "zeroauth-autonomous-face-v1";
 *   const secret = sha256(seed);
 * Stand-in for a face-derived secret. Production path is FaceEmbedder
 * -> Quantizer -> SHA-256; the seed string here gives us byte-equivalent
 * determinism without a camera + face in the loop.
 *
 * Usage:
 *   npx tsx scripts/autonomous-test-setup.ts
 *
 * Environment:
 *   ZEROAUTH_BASE_URL — defaults to http://localhost:3000.
 *
 * Output (structured + human):
 *   - Prints did, secret_hex, commitment_hex, tenant_user_id to stdout
 *     in a JSON block prefixed with `AUTONOMOUS_SETUP_RESULT=`.
 *   - Exit code 0 on success, non-zero with diagnostic line otherwise.
 *
 * Idempotency note:
 *   This script does NOT delete existing rows for the demo-portal
 *   tenant. The caller is expected to have already run the cleanup
 *   query for predictable behaviour:
 *     DELETE FROM registration_sessions WHERE tenant_id='<demo-portal>';
 *     DELETE FROM tenant_users          WHERE tenant_id='<demo-portal>';
 *     DELETE FROM devices               WHERE tenant_id='<demo-portal>';
 *     DELETE FROM proof_pairing_sessions WHERE tenant_id='<demo-portal>';
 *   If a tenant_user with the same DID already exists, the
 *   /v1/registrations/complete call will fail with a duplicate-key
 *   error (tenant_id, environment, external_id) — the cleanup above
 *   makes this script re-runnable.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import {
  buildProof,
  computeDidHashRaw,
  deriveDidAndCommitment,
  haveCeremonyArtefacts,
  terminateSnarkjs,
} from '../tests/helpers/ceremony-client';
import {
  DEMO_PORTAL_API_KEY,
  DEMO_PORTAL_TENANT_ID,
} from '../src/services/demo-portal-seed';
import { config } from '../src/config';

const BASE = process.env.ZEROAUTH_BASE_URL ?? 'http://localhost:3000';

/** Fixed seed → SAME 32-byte secret across every run. */
const DETERMINISTIC_SEED = 'zeroauth-autonomous-face-v1';

interface ApiResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<ApiResponse> {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

function deriveDeterministicSecret(seed: string): Buffer {
  return createHash('sha256').update(seed, 'utf8').digest();
}

async function main(): Promise<void> {
  if (!haveCeremonyArtefacts()) {
    throw new Error(
      'Circuit artefacts missing under /circuits/build/. Run scripts/setup-zkp.sh first.',
    );
  }

  // ─── Step 1: derive the deterministic secret + DID + commitment ───
  const secret = deriveDeterministicSecret(DETERMINISTIC_SEED);
  const secretHex = secret.toString('hex');
  const {
    did,
    commitmentHex,
    commitmentBigInt,
  } = deriveDidAndCommitment(secret);

  console.error('▶ Derived deterministic identity:');
  console.error(`  seed:        ${DETERMINISTIC_SEED}`);
  console.error(`  secret_hex:  ${secretHex}`);
  console.error(`  did:         ${did}`);
  console.error(`  commit_hex:  ${commitmentHex}`);

  // ─── Step 2: drive the three-QR registration ceremony ─────────────
  console.error('\n▶ Step 1/3: /v1/registrations (start session)...');
  const startRes = await api(
    'POST',
    '/v1/registrations',
    {
      profile: {
        name: 'Autonomous Test User',
        email: 'autonomous-test@neobank.example',
      },
    },
    { 'x-api-key': DEMO_PORTAL_API_KEY },
  );
  if (startRes.status !== 201) {
    throw new Error(
      `start failed: HTTP ${startRes.status} ${JSON.stringify(startRes.body)}`,
    );
  }
  const sessionId = startRes.body.session.id as string;
  const pairCode = startRes.body.pair.code as string;
  console.error(`  session=${sessionId}, pair_code=${pairCode}`);

  console.error('\n▶ Step 2/3: /v1/registrations/pair-device...');
  const pairRes = await api(
    'POST',
    '/v1/registrations/pair-device',
    {
      pair_code: pairCode,
      // 32-hex-char random fingerprint — distinct from the device the
      // emulator will report on its own zkp register flow (this script
      // does not touch the emulator).
      fingerprint: randomBytes(16).toString('hex'),
      attestation_kind: 'none',
    },
    { 'x-api-key': DEMO_PORTAL_API_KEY },
  );
  if (pairRes.status !== 200) {
    throw new Error(
      `pair-device failed: HTTP ${pairRes.status} ${JSON.stringify(pairRes.body)}`,
    );
  }
  const enrollCode = pairRes.body.next.code as string;
  console.error(`  enroll_code=${enrollCode}`);

  console.error('\n▶ Step 3a/3: /v1/registrations/submit-commitment...');
  const submitRes = await api(
    'POST',
    '/v1/registrations/submit-commitment',
    {
      enroll_code: enrollCode,
      did,
      commitment: commitmentHex,
    },
    { 'x-api-key': DEMO_PORTAL_API_KEY },
  );
  if (submitRes.status !== 200) {
    throw new Error(
      `submit-commitment failed: HTTP ${submitRes.status} ${JSON.stringify(submitRes.body)}`,
    );
  }
  const verifyCode = submitRes.body.next.code as string;
  const challengeNonce = submitRes.body.next.challenge_nonce as string;
  console.error(
    `  verify_code=${verifyCode}, challenge=${challengeNonce.slice(0, 16)}...`,
  );

  console.error('\n▶ Step 3b/3: building Groth16 proof + /v1/registrations/complete...');
  const t0 = Date.now();
  const { proof, publicSignals } = await buildProof(secret, challengeNonce);
  console.error(`  proof generated in ${Date.now() - t0}ms`);

  const completeRes = await api(
    'POST',
    '/v1/registrations/complete',
    {
      verify_code: verifyCode,
      challenge_nonce: challengeNonce,
      proof,
      public_signals: publicSignals,
    },
    { 'x-api-key': DEMO_PORTAL_API_KEY },
  );
  if (completeRes.status !== 200) {
    throw new Error(
      `complete failed: HTTP ${completeRes.status} ${JSON.stringify(completeRes.body)}`,
    );
  }
  const tenantUserId = completeRes.body.tenant_user.id as string;
  console.error(`  tenant_user.id=${tenantUserId}`);

  // ─── Step 3: backfill tenant_users.metadata with did/did_hash/commitment ─
  // The registration flow today writes only { via: 'registration',
  // sessionId } into tenant_users.metadata (see
  // src/services/registration.ts ~L696). The proof-pairing service's
  // findUserByDid (src/services/proof-pairing.ts ~L340) keys on
  // metadata->>'did' AND requires metadata->>'did_hash' +
  // metadata->>'commitment' to be present as DECIMAL bigint strings.
  // The Phase 1 Sprint 4 "register-on-tenant" flow will write those
  // three fields server-side; until then we backfill here so the
  // autonomous test can drive proof-pairing login immediately.
  console.error('\n▶ Backfilling tenant_users.metadata.{did, did_hash, commitment}...');
  const didHashRaw = computeDidHashRaw(commitmentBigInt);
  const didHashDec = didHashRaw.toString(10);
  const commitmentDec = commitmentBigInt.toString(10);

  // Direct DB connection — same params src/services/db.ts uses.
  const pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
  });
  try {
    const updateRes = await pool.query<{ metadata: Record<string, unknown> }>(
      `UPDATE tenant_users
         SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object(
                            'did', $2::text,
                            'did_hash', $3::text,
                            'commitment', $4::text
                          ),
             updated_at = NOW()
       WHERE id = $1
       RETURNING metadata`,
      [tenantUserId, did, didHashDec, commitmentDec],
    );
    if (updateRes.rowCount !== 1) {
      throw new Error(
        `metadata backfill failed: rowCount=${updateRes.rowCount}`,
      );
    }
    console.error(`  metadata updated: ${JSON.stringify(updateRes.rows[0].metadata)}`);
  } finally {
    await pool.end();
  }

  // ─── Step 4: emit the structured result + a parseable single line ───
  const result = {
    ok: true,
    did,
    secret_hex: secretHex,
    commitment_hex: commitmentHex,
    commitment_dec: commitmentDec,
    did_hash_dec: didHashDec,
    tenant_user_id: tenantUserId,
    tenant_id: DEMO_PORTAL_TENANT_ID,
    seed: DETERMINISTIC_SEED,
  };
  console.error('\n✅ Autonomous setup complete.');
  console.error(`  did:            ${did}`);
  console.error(`  secret_hex:     ${secretHex}`);
  console.error(`  commitment_hex: ${commitmentHex}`);
  console.error(`  tenant_user_id: ${tenantUserId}`);

  // Single machine-parseable line — the caller (a wrapper or this
  // script's invoking agent) reads `AUTONOMOUS_SETUP_RESULT=…` to
  // pluck the values without parsing the human log.
  process.stdout.write('AUTONOMOUS_SETUP_RESULT=' + JSON.stringify(result) + '\n');
}

main()
  .then(async () => {
    await terminateSnarkjs();
    process.exit(0);
  })
  .catch(async (err: Error) => {
    console.error('\n❌ autonomous-test-setup failed:', err.message);
    process.stdout.write(
      'AUTONOMOUS_SETUP_RESULT=' +
        JSON.stringify({ ok: false, failure: err.message }) +
        '\n',
    );
    await terminateSnarkjs().catch(() => undefined);
    process.exit(1);
  });
