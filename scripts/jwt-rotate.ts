#!/usr/bin/env tsx
/**
 * RS256 JWT key rotation helper (ADR 0021).
 *
 * Generates a fresh 2048-bit RSA keypair and prints:
 *   - JWT_RS256_PRIVATE_KEY (PEM, PKCS#8) — set on the API process
 *   - JWT_RS256_PUBLIC_KEY  (PEM, SPKI)   — set on the API + on any
 *                                          external verifier
 *   - JWT_RS256_KID         — a UUID for this key
 *
 * Usage:
 *   npx tsx scripts/jwt-rotate.ts            # human-readable
 *   npx tsx scripts/jwt-rotate.ts --env      # .env-paste-ready format
 *
 * The private key is printed to stdout — pipe it straight into a
 * secret manager. DO NOT redirect to a file in this repo (`.env` and
 * `*.pem` are gitignored but the safer path is "never touches disk").
 *
 * Rotation playbook (zero-downtime):
 *   1. Run this script; copy the new env vars into the secret store.
 *   2. Deploy the new env vars to the API process with the OLD
 *      `JWT_RS256_PUBLIC_KEY` extended to include both keys (the
 *      verify path is a single-key lookup today; multi-key support
 *      is a Phase 2 ticket — for now the rotation has a brief
 *      acceptance gap when the cutover happens).
 *   3. Wait one access-token TTL (default 1 h) for all outstanding
 *      old tokens to expire.
 *   4. Remove the old private key from the secret store.
 *
 * For the HS256 → RS256 cutover, the dual-issuer verify path in
 * src/services/jwt.ts accepts BOTH algorithms as long as the legacy
 * JWT_SECRET is also configured. After the longest-lived HS256
 * token has expired (24 h by default), unset JWT_SECRET and only
 * RS256 is honoured.
 */

import * as crypto from 'crypto';
import { randomUUID } from 'crypto';

function generate() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey, kid: randomUUID() };
}

function main() {
  const envMode = process.argv.includes('--env');
  const { publicKey, privateKey, kid } = generate();

  if (envMode) {
    // Single line each — paste into .env or a secret manager.
    process.stdout.write(`JWT_ALGORITHM=RS256\n`);
    process.stdout.write(`JWT_RS256_KID=${kid}\n`);
    process.stdout.write(`JWT_RS256_PUBLIC_KEY="${publicKey.replace(/\n/g, '\\n')}"\n`);
    process.stdout.write(`JWT_RS256_PRIVATE_KEY="${privateKey.replace(/\n/g, '\\n')}"\n`);
  } else {
    process.stdout.write('# Fresh RS256 keypair generated at ' + new Date().toISOString() + '\n');
    process.stdout.write('\n');
    process.stdout.write('## KID (key id)\n' + kid + '\n\n');
    process.stdout.write('## Public key (set as JWT_RS256_PUBLIC_KEY)\n' + publicKey + '\n');
    process.stdout.write('## Private key (set as JWT_RS256_PRIVATE_KEY)\n' + privateKey + '\n');
    process.stdout.write('\n');
    process.stdout.write('# Then set JWT_ALGORITHM=RS256 on the API process.\n');
    process.stdout.write('# Keep JWT_SECRET in place during the rollover (dual-issuer mode);\n');
    process.stdout.write('# unset it after one access-token TTL (default 1 h) has passed.\n');
  }
}

main();
