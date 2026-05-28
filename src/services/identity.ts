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
