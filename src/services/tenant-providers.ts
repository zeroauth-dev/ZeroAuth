/**
 * ADR 0017 — Blockchain-agnostic provider resolution.
 *
 * A pure function that takes a tenant's `security_policy` JSONB and
 * returns the resolved {did, verifier, audit-anchor} provider triple
 * together with any associated chain-config strings. Defaults are
 * off-chain, off-chain, none — a tenant whose policy is `{}` or
 * `null` runs the platform with zero blockchain dependency.
 *
 * The resolver lives in its own module so the gate logic in
 * `identity.ts`, `anchor-job.ts`, and `zkp.ts` does not duplicate the
 * "what does this string mean" branch. Pure: no DB access, no env
 * reads. Tests in `tests/tenant-providers.test.ts`.
 *
 * Invalid provider values (e.g. a stale `did_provider='legacy-x'`
 * carried by an old tenant row, or a typo in a manual JSONB edit) fall
 * back to the default rather than throwing — the platform's defence-
 * in-depth posture is "if unsure, stay off-chain", which keeps the
 * weakest path the safest.
 */

import { TenantSecurityPolicy } from '../types';

export type DidProvider = 'off-chain' | 'base-sepolia' | 'base-mainnet' | 'custom-chain';
export type VerifierProvider = 'off-chain' | 'on-chain';
export type AuditAnchorProvider =
  | 'none'
  | 'signed-transcript'
  | 'base-sepolia'
  | 'base-mainnet'
  | 'witness-cosign';

const DID_PROVIDERS: readonly DidProvider[] = [
  'off-chain',
  'base-sepolia',
  'base-mainnet',
  'custom-chain',
] as const;
const VERIFIER_PROVIDERS: readonly VerifierProvider[] = ['off-chain', 'on-chain'] as const;
const AUDIT_ANCHOR_PROVIDERS: readonly AuditAnchorProvider[] = [
  'none',
  'signed-transcript',
  'base-sepolia',
  'base-mainnet',
  'witness-cosign',
] as const;

export interface ResolvedProviders {
  didProvider: DidProvider;
  verifierProvider: VerifierProvider;
  auditAnchorProvider: AuditAnchorProvider;
  baseRpcUrl: string | null;
  didRegistryAddress: string | null;
  groth16VerifierAddress: string | null;
  auditAnchorContractAddress: string | null;
}

/**
 * Defaults the platform applies when a tenant's `security_policy` is
 * absent or doesn't specify a provider. Off-chain across the board —
 * a fresh tenant has zero blockchain dependency.
 */
export const DEFAULT_PROVIDERS: Readonly<ResolvedProviders> = Object.freeze({
  didProvider: 'off-chain' as DidProvider,
  verifierProvider: 'off-chain' as VerifierProvider,
  auditAnchorProvider: 'none' as AuditAnchorProvider,
  baseRpcUrl: null,
  didRegistryAddress: null,
  groth16VerifierAddress: null,
  auditAnchorContractAddress: null,
});

function pickDidProvider(raw: unknown): DidProvider {
  return DID_PROVIDERS.includes(raw as DidProvider)
    ? (raw as DidProvider)
    : DEFAULT_PROVIDERS.didProvider;
}

function pickVerifierProvider(raw: unknown): VerifierProvider {
  return VERIFIER_PROVIDERS.includes(raw as VerifierProvider)
    ? (raw as VerifierProvider)
    : DEFAULT_PROVIDERS.verifierProvider;
}

function pickAuditAnchorProvider(raw: unknown): AuditAnchorProvider {
  return AUDIT_ANCHOR_PROVIDERS.includes(raw as AuditAnchorProvider)
    ? (raw as AuditAnchorProvider)
    : DEFAULT_PROVIDERS.auditAnchorProvider;
}

function pickString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Resolve a tenant's provider triple + chain-config strings. Pure
 * function — no DB, no env, no IO. Pass `null` or `undefined` for the
 * platform-wide defaults; pass a policy with one or more provider
 * fields to opt that tenant into a specific chain stack.
 */
export function resolveProviders(
  securityPolicy: TenantSecurityPolicy | null | undefined,
): ResolvedProviders {
  if (!securityPolicy || typeof securityPolicy !== 'object') {
    return { ...DEFAULT_PROVIDERS };
  }

  return {
    didProvider: pickDidProvider(securityPolicy.did_provider),
    verifierProvider: pickVerifierProvider(securityPolicy.verifier_provider),
    auditAnchorProvider: pickAuditAnchorProvider(securityPolicy.audit_anchor_provider),
    baseRpcUrl: pickString(securityPolicy.base_rpc_url),
    didRegistryAddress: pickString(securityPolicy.did_registry_address),
    groth16VerifierAddress: pickString(securityPolicy.groth16_verifier_address),
    auditAnchorContractAddress: pickString(securityPolicy.audit_anchor_contract_address),
  };
}
