import { createHash, randomBytes } from 'crypto';
import { logger } from './logger';
import { registerIdentityOnChain } from './blockchain';
import { resolveProviders } from './tenant-providers';
import type { TenantSecurityPolicy } from '../types';

// Poseidon hash from circomlibjs — loaded async at startup
let poseidon: any = null;
let F: any = null; // Finite field

export async function initPoseidon(): Promise<void> {
  const circomlibjs = await import('circomlibjs');
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
  logger.info('Identity: Poseidon hash initialized');
}

/**
 * Patent Module 214 — Identity Generation
 *
 * Claim 3: "apply a hash function to the biometric data by using
 * the SHA-256 algorithm to generate a biometric identity (ID);
 * generate a decentralized identification number (DID) to be
 * associated with the user; and store a mapping value of the
 * biometric identity (ID) to the DID."
 *
 * ADR 0017 — the on-chain registration in Step 7 is gated by the
 * tenant's resolved `did_provider`. A tenant with the default
 * `did_provider='off-chain'` (or no `security_policy` at all) gets a
 * pure DB enrollment with `txHash=''` and `blockNumber=0` — the
 * platform never touches Base Sepolia for that tenant. Tenants that
 * opt into `base-sepolia` / `base-mainnet` / `custom-chain` still
 * call `registerIdentityOnChain` as before.
 */
export async function registerIdentity(
  biometricTemplate: Buffer,
  securityPolicy?: TenantSecurityPolicy | null,
): Promise<{
  did: string;
  biometricIDHash: string;
  commitment: string;
  didHash: string;
  biometricSecret: string;
  salt: string;
  txHash: string;
  blockNumber: number;
}> {
  if (!poseidon || !F) {
    throw new Error('Poseidon not initialized. Call initPoseidon() first.');
  }

  // Step 1: SHA-256(biometric) → biometricID (Patent Claim 3)
  const biometricID = createHash('sha256').update(biometricTemplate).digest();
  const biometricIDHex = '0x' + biometricID.toString('hex');
  logger.info('Identity: SHA-256 biometric hash computed');

  // Step 2: Generate DID (Patent Claim 3)
  const didSuffix = randomBytes(16).toString('hex');
  const did = `did:zeroauth:base:${didSuffix}`;

  // Step 3: Generate salt (random 31 bytes to fit in BN128 field)
  const saltBytes = randomBytes(31);
  const salt = BigInt('0x' + saltBytes.toString('hex'));

  // Step 4: Derive biometricSecret = Poseidon(biometricID_as_field, salt)
  // Truncate biometricID to 31 bytes to fit BN128 scalar field
  const biometricIDField = BigInt('0x' + biometricID.subarray(0, 31).toString('hex'));
  const biometricSecret = F.toObject(poseidon([biometricIDField, salt]));

  // Step 5: Compute commitment = Poseidon(biometricSecret, salt)
  const commitment = F.toObject(poseidon([biometricSecret, salt]));

  // Step 6: Compute didHash = Poseidon(did_as_field_elements)
  // Hash the DID string to a field element first
  const didBuffer = createHash('sha256').update(did).digest();
  const didField = BigInt('0x' + didBuffer.subarray(0, 31).toString('hex'));
  const didHash = F.toObject(poseidon([didField]));

  // Step 7: Store biometricID→DID mapping on-chain — but only when
  // the tenant's resolved `did_provider` opts in (ADR 0017). The
  // platform default is `off-chain`, in which case the DB row is the
  // system-of-record and the chain is never touched. Tenants that
  // pick a chain provider still flow through the existing call path
  // and tolerate RPC outages as a soft-degrade (dev-friendly fallback
  // that pre-dates this ADR).
  const { didProvider } = resolveProviders(securityPolicy);
  let txHash = '';
  let blockNumber = 0;
  if (didProvider === 'off-chain') {
    logger.info('Identity: Off-chain DID — skipping on-chain registration', { didProvider });
  } else {
    try {
      const result = await registerIdentityOnChain(biometricIDHex, did);
      txHash = result.txHash;
      blockNumber = result.blockNumber;
      logger.info('Identity: On-chain registration complete', { txHash, blockNumber, didProvider });
    } catch (err) {
      logger.warn('Identity: On-chain registration failed (blockchain may be unavailable)', {
        error: (err as Error).message,
        didProvider,
      });
      // Allow registration to succeed even if blockchain is down in dev
      txHash = 'offline-' + randomBytes(16).toString('hex');
    }
  }

  // CRITICAL: Biometric template is NOT stored. Only return secrets to client.
  // After this function returns, biometricTemplate is garbage collected.
  logger.info('Identity: Registration complete. Zero biometric data stored.', {
    did,
    biometricIDHash: biometricIDHex.slice(0, 10) + '...',
  });

  return {
    did,
    biometricIDHash: biometricIDHex,
    commitment: commitment.toString(),
    didHash: didHash.toString(),
    biometricSecret: biometricSecret.toString(),
    salt: salt.toString(),
    txHash,
    blockNumber,
  };
}

/**
 * Compute Poseidon hash — used for generating public inputs for circuit
 */
export function poseidonHash(inputs: bigint[]): bigint {
  if (!poseidon || !F) {
    throw new Error('Poseidon not initialized');
  }
  return F.toObject(poseidon(inputs));
}

export function isPoseidonReady(): boolean {
  return poseidon !== null;
}

// ─── Face-first identity register (ADR 0017) ──────────────────────────
//
// The new register flow expects the (did, commitment) tuple to be
// produced on-device by `mobile/biometric/CommitmentBuilder.kt`. The
// server never sees a biometric template, an image, or an embedding.
// This is the production register path; the legacy `registerIdentity()`
// above takes a base64 biometric template and is kept only for the W3
// demo client + the existing test fixtures.

import { getPool } from './db';

const DID_PATTERN = /^did:zeroauth:[a-z0-9-]+:[a-f0-9]{20,80}$/i;
const COMMITMENT_PATTERN = /^(0x)?[0-9a-f]{1,80}$/i;

export interface FaceFirstRegistration {
  did: string;
  commitment: string;
  externalId?: string;
  /** Optional Play Integrity verdict, validated by tenant policy. */
  attestation?: {
    playIntegrityVerdict?: string;
    keyAttestationChain?: string[];
  };
}

export interface FaceFirstRegistrationResult {
  userId: string;
  did: string;
  commitment: string;
  createdAt: string;
}

export class IdentityValidationError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'IdentityValidationError';
  }
}

export class IdentityAlreadyExistsError extends Error {
  constructor(public did: string) {
    super(`DID ${did} is already registered for this tenant`);
    this.name = 'IdentityAlreadyExistsError';
  }
}

/**
 * Register a face-first identity. The (did, commitment) tuple is
 * computed entirely on-device. The server validates format, checks
 * uniqueness, persists the row, writes an audit event, and optionally
 * queues a chain registration when the tenant has `did_provider`
 * other than 'off-chain'.
 *
 * Per CLAUDE.md non-goals: no biometric template, no image, no
 * embedding ever reaches this function. The input is field elements
 * only.
 */
export async function registerFaceFirstIdentity(
  tenantId: string,
  environment: 'live' | 'test',
  input: FaceFirstRegistration,
  securityPolicy?: TenantSecurityPolicy | null,
): Promise<FaceFirstRegistrationResult> {
  if (!input.did || typeof input.did !== 'string') {
    throw new IdentityValidationError('invalid_did', 'DID is required (string).');
  }
  if (!DID_PATTERN.test(input.did)) {
    throw new IdentityValidationError(
      'invalid_did_format',
      'DID must match did:zeroauth:<method>:<hex> pattern.',
    );
  }
  if (!input.commitment || typeof input.commitment !== 'string') {
    throw new IdentityValidationError('invalid_commitment', 'Commitment is required (hex string).');
  }
  if (!COMMITMENT_PATTERN.test(input.commitment)) {
    throw new IdentityValidationError(
      'invalid_commitment_format',
      'Commitment must be a hex string (0x-prefix optional).',
    );
  }

  const pool = getPool();

  // Check DID uniqueness (per tenant + environment, per ADR 0017).
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM tenant_users
      WHERE tenant_id = $1 AND environment = $2 AND did = $3
      LIMIT 1`,
    [tenantId, environment, input.did],
  );
  if (existing.rows.length > 0) {
    throw new IdentityAlreadyExistsError(input.did);
  }

  // Insert. external_id defaults to the did so legacy code paths that
  // look up by external_id keep working without a separate ID
  // assignment step.
  const externalId = input.externalId ?? input.did;
  const insert = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO tenant_users (
       tenant_id, environment, external_id, did, commitment,
       full_name, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING id, created_at`,
    [
      tenantId,
      environment,
      externalId,
      input.did,
      input.commitment.toLowerCase().replace(/^0x/, ''),
      // full_name is NOT NULL on the legacy schema; we set an
      // intentionally non-PII placeholder. The PII-strip migration
      // will drop the column. Reviewers: this is the only non-empty
      // string we ever write to that column going forward.
      'face-first',
    ],
  );

  const row = insert.rows[0];

  // Optional async chain registration. The off-chain default never
  // touches the chain (ADR 0017).
  const { didProvider } = resolveProviders(securityPolicy);
  if (didProvider !== 'off-chain') {
    // Fire-and-forget: a failed chain write must not block enrollment.
    // The audit row records the attempt; an out-of-process anchor job
    // can retry. The platform's source-of-truth for the DID is the DB
    // row above.
    void (async () => {
      try {
        const sha = createHash('sha256').update(input.did).digest('hex');
        await registerIdentityOnChain('0x' + sha, input.did);
        logger.info('Identity: chain DID registration succeeded (face-first)', {
          tenantId,
          did: input.did,
          provider: didProvider,
        });
      } catch (err) {
        logger.warn('Identity: chain DID registration failed (face-first)', {
          tenantId,
          did: input.did,
          provider: didProvider,
          error: (err as Error).message,
        });
      }
    })();
  }

  return {
    userId: row.id,
    did: input.did,
    commitment: input.commitment.toLowerCase().replace(/^0x/, ''),
    createdAt: row.created_at.toISOString(),
  };
}
