/**
 * Unit tests for `src/services/tenant-providers.ts` (ADR 0017).
 *
 * The resolver is a pure function: tenant.security_policy JSONB in,
 * resolved provider triple out. Defaults must be off-chain across the
 * board so a fresh tenant (security_policy = {} or null) runs the
 * platform with zero blockchain dependency. Invalid provider values
 * must fall back to defaults rather than throw — the resolver is on
 * the hot path of /v1/identity/register and the daily anchor cron, so
 * a malformed JSONB row can never abort either.
 *
 * Eight tests:
 *   1. null securityPolicy   → defaults
 *   2. undefined            → defaults
 *   3. {} empty             → defaults
 *   4. did_provider explicit       → respected
 *   5. verifier_provider explicit  → respected
 *   6. audit_anchor_provider explicit → respected
 *   7. chain config strings → respected and pass-through
 *   8. invalid provider values → fall back to defaults (no throw)
 */

import {
  resolveProviders,
  DEFAULT_PROVIDERS,
} from '../src/services/tenant-providers';
import type { TenantSecurityPolicy } from '../src/types';

describe('resolveProviders (ADR 0017)', () => {
  it('returns defaults when securityPolicy is null', () => {
    const out = resolveProviders(null);
    expect(out.didProvider).toBe('off-chain');
    expect(out.verifierProvider).toBe('off-chain');
    expect(out.auditAnchorProvider).toBe('none');
    expect(out.baseRpcUrl).toBeNull();
    expect(out.didRegistryAddress).toBeNull();
    expect(out.groth16VerifierAddress).toBeNull();
    expect(out.auditAnchorContractAddress).toBeNull();
  });

  it('returns defaults when securityPolicy is undefined', () => {
    const out = resolveProviders(undefined);
    expect(out).toEqual(DEFAULT_PROVIDERS);
  });

  it('returns defaults when securityPolicy is empty object', () => {
    const out = resolveProviders({});
    expect(out).toEqual(DEFAULT_PROVIDERS);
  });

  it('respects an explicit did_provider', () => {
    const policy: TenantSecurityPolicy = { did_provider: 'base-sepolia' };
    const out = resolveProviders(policy);
    expect(out.didProvider).toBe('base-sepolia');
    // Other slots stay at default — the three providers are independent.
    expect(out.verifierProvider).toBe('off-chain');
    expect(out.auditAnchorProvider).toBe('none');
  });

  it('respects an explicit verifier_provider', () => {
    const policy: TenantSecurityPolicy = { verifier_provider: 'on-chain' };
    const out = resolveProviders(policy);
    expect(out.verifierProvider).toBe('on-chain');
    expect(out.didProvider).toBe('off-chain');
    expect(out.auditAnchorProvider).toBe('none');
  });

  it('respects an explicit audit_anchor_provider', () => {
    const policy: TenantSecurityPolicy = { audit_anchor_provider: 'signed-transcript' };
    const out = resolveProviders(policy);
    expect(out.auditAnchorProvider).toBe('signed-transcript');
    expect(out.didProvider).toBe('off-chain');
    expect(out.verifierProvider).toBe('off-chain');
  });

  it('passes through chain config strings when provided', () => {
    const policy: TenantSecurityPolicy = {
      did_provider: 'custom-chain',
      base_rpc_url: 'https://example-rpc.test',
      did_registry_address: '0xabc',
      groth16_verifier_address: '0xdef',
      audit_anchor_contract_address: '0x123',
    };
    const out = resolveProviders(policy);
    expect(out.didProvider).toBe('custom-chain');
    expect(out.baseRpcUrl).toBe('https://example-rpc.test');
    expect(out.didRegistryAddress).toBe('0xabc');
    expect(out.groth16VerifierAddress).toBe('0xdef');
    expect(out.auditAnchorContractAddress).toBe('0x123');
  });

  it('falls back to defaults when provider values are invalid (no throw)', () => {
    // A stale tenant row with a legacy provider name, or a typo
    // injected via manual JSONB edit. The resolver must NOT throw —
    // the platform's posture is "if unsure, stay off-chain".
    const policy = {
      did_provider: 'legacy-quorum',
      verifier_provider: 'turbo',
      audit_anchor_provider: 'pixie-dust',
      base_rpc_url: '',
      did_registry_address: 42,
    } as unknown as TenantSecurityPolicy;

    let out: ReturnType<typeof resolveProviders> | undefined;
    expect(() => {
      out = resolveProviders(policy);
    }).not.toThrow();

    expect(out!.didProvider).toBe('off-chain');
    expect(out!.verifierProvider).toBe('off-chain');
    expect(out!.auditAnchorProvider).toBe('none');
    // Empty string + non-string values normalise to null.
    expect(out!.baseRpcUrl).toBeNull();
    expect(out!.didRegistryAddress).toBeNull();
  });
});
