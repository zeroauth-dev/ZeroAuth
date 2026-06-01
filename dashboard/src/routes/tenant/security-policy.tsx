/**
 * Tenant Security Policy view — ADR 0017 (blockchain-agnostic posture).
 *
 * Three independent provider slots, each opt-in per tenant:
 *
 *   1. `did_provider`           — where DIDs are registered.
 *      Defaults to `off-chain` (DB only, no chain dependency).
 *
 *   2. `verifier_provider`      — whether to additionally re-verify
 *      proofs on-chain. Defaults to `off-chain` (snarkjs only).
 *
 *   3. `audit_anchor_provider`  — where the audit hash chain is
 *      anchored. Defaults to `none` (hash chain only, no external
 *      anchor).
 *
 * Defaults are off-chain across the board so a fresh tenant has zero
 * blockchain dependency. Selecting a chain-anchored provider opts that
 * tenant into the corresponding gate in `src/services/identity.ts`,
 * `src/services/anchor-job.ts`, and `src/services/zkp.ts`.
 *
 * The page reads from `GET /api/console/security-policy`, lets the
 * operator pick one value per dropdown, and writes back via `POST
 * /api/console/security-policy`. Each option carries an inline
 * explanation so the operator does not need to context-switch into
 * `adr/0017-blockchain-agnostic-posture.md` to make an informed pick.
 *
 * The form's "Save" button is disabled until the in-memory state
 * differs from the server-state — saving a no-op write would still be
 * idempotent server-side, but the affordance signals to the operator
 * whether their edit is staged.
 *
 * Non-goals on this page:
 *   - Editing chain config strings (RPC URL, contract addresses,
 *     signing-key id). Those live alongside the provider choice on the
 *     server `security_policy` JSONB and round-trip via the proxy, but
 *     they're configured by the platform ops team, not the tenant
 *     operator. Phase 1 sprint 5 (C-150-something) adds a chain-config
 *     panel for the `custom-chain` case.
 *   - Editing Play Integrity / allowed-origins knobs. Those are owned
 *     by their respective dedicated pages (`/integrity`, `/cors`).
 *
 * Tests in `routes/tenant/__tests__/security-policy.test.tsx` will pin
 * the structural contract: the three dropdowns exist, each carries the
 * platform-supported option set, and the inline explanation panel
 * updates on every change.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Label,
  Select,
  Skeleton,
  pushToast,
} from '../../components/ui';
import {
  AUDIT_ANCHOR_PROVIDERS,
  DEFAULT_POLICY,
  DID_PROVIDERS,
  VERIFIER_PROVIDERS,
  type AuditAnchorProvider,
  type DidProvider,
  type SecurityPolicy,
  type VerifierProvider,
  getSecurityPolicy,
  updateSecurityPolicy,
} from '../../lib/security-policy-api';

// ─── Inline explanations ────────────────────────────────────────
//
// Per-option helper text. Kept short so the dropdown stays scannable;
// the ADR carries the rationale + threat-model implications.

const DID_PROVIDER_HELP: Record<DidProvider, { label: string; help: string }> = {
  'off-chain': {
    label: 'Off-chain (default)',
    help:
      'DIDs live in PostgreSQL only. Zero blockchain dependency. Recommended for the default tenant and any deployment that does not require an on-chain DID registry.',
  },
  'base-sepolia': {
    label: 'Base Sepolia (testnet)',
    help:
      'DIDs are additionally registered on Base Sepolia L2 (chain 84532). Suitable for staging and demo environments; not production-grade.',
  },
  'base-mainnet': {
    label: 'Base Mainnet',
    help:
      'DIDs are registered on Base Mainnet. Production-grade L2 anchoring. Requires the platform ops team to provision an RPC URL and a funded signer key.',
  },
  'custom-chain': {
    label: 'Custom chain',
    help:
      'Use a tenant-supplied EVM RPC + a tenant-deployed DIDRegistry. Requires the chain-config panel (RPC URL, registry address) to be populated server-side; coordinate with platform ops before selecting.',
  },
};

const VERIFIER_PROVIDER_HELP: Record<VerifierProvider, { label: string; help: string }> = {
  'off-chain': {
    label: 'Off-chain (default)',
    help:
      'Proofs are verified locally with snarkjs against the boot-pinned verification key. The platform default — fast, deterministic, zero gas cost.',
  },
  'on-chain': {
    label: 'On-chain',
    help:
      'Proofs are additionally re-verified against the Groth16Verifier contract on the configured chain. Adds round-trip cost; useful when a third-party auditor wants an independent witness of every verification.',
  },
};

const AUDIT_ANCHOR_PROVIDER_HELP: Record<AuditAnchorProvider, { label: string; help: string }> = {
  none: {
    label: 'None (default)',
    help:
      'Audit hash chain is computed and stored in PostgreSQL only. Tamper-evident locally; no external anchor. The platform default.',
  },
  'signed-transcript': {
    label: 'Signed transcript',
    help:
      'Daily terminal-hash transcripts are signed with the platform signing key and stored alongside the chain. Light-weight tamper evidence for auditors without on-chain anchoring.',
  },
  'base-sepolia': {
    label: 'Base Sepolia (testnet)',
    help:
      'Daily terminal hashes are anchored on Base Sepolia L2. Suitable for staging; not production-grade tamper evidence.',
  },
  'base-mainnet': {
    label: 'Base Mainnet',
    help:
      'Daily terminal hashes are anchored on Base Mainnet. Production-grade external tamper evidence. Requires platform-ops chain config and a funded signer.',
  },
  'witness-cosign': {
    label: 'Witness cosign',
    help:
      'Daily terminal hashes are co-signed by a quorum of independent witnesses (configured via the platform-ops witness registry). Used by regulated tenants who need cross-organisation tamper evidence without on-chain settlement.',
  },
};

// ─── Page component ─────────────────────────────────────────────

export function SecurityPolicyView() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['security-policy'],
    queryFn: getSecurityPolicy,
  });

  // Local form state, seeded from the server response. We don't render
  // the dropdowns from `query.data` directly so an in-flight edit isn't
  // clobbered by a background refetch.
  const [draft, setDraft] = useState<SecurityPolicy>(DEFAULT_POLICY);
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: updateSecurityPolicy,
    onSuccess: (saved) => {
      // Mirror the post-merge response into both the query cache and
      // local state. The server may have defaulted an unknown value
      // (defence in depth); reflecting the merge means the UI is the
      // source of truth after a save.
      queryClient.setQueryData(['security-policy'], saved);
      setDraft(saved);
      pushToast('success', 'Security policy saved.');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to save security policy.';
      pushToast('danger', msg);
    },
  });

  const dirty =
    query.data !== undefined
    && (draft.didProvider !== query.data.didProvider
      || draft.verifierProvider !== query.data.verifierProvider
      || draft.auditAnchorProvider !== query.data.auditAnchorProvider);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Security policy</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          ADR 0017 — three blockchain-agnostic provider slots. Defaults are off-chain across the
          board; opt your tenant into a chain-anchored provider only when an external anchoring
          requirement applies. Each selection is auditable via the standard audit chain.
        </p>
      </header>

      {query.isError ? (
        <div
          className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]"
          role="alert"
          data-testid="security-policy-error"
        >
          Could not load the current security policy. The defaults below are shown for reference;
          saving will create a fresh policy entry.
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Provider configuration"
          description="Pick one provider per slot. Help text below each selector explains the trade-offs."
          action={<CurrentMixBadge policy={draft} />}
        />
        <CardBody>
          {query.isLoading ? (
            <div className="space-y-4" data-testid="security-policy-loading">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : (
            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (!dirty || mutation.isPending) return;
                mutation.mutate(draft);
              }}
              data-testid="security-policy-form"
            >
              <ProviderField<DidProvider>
                id="did-provider"
                title="DID provider"
                value={draft.didProvider}
                options={DID_PROVIDERS}
                describe={DID_PROVIDER_HELP}
                onChange={(v) => setDraft((d) => ({ ...d, didProvider: v }))}
              />
              <ProviderField<VerifierProvider>
                id="verifier-provider"
                title="Verifier provider"
                value={draft.verifierProvider}
                options={VERIFIER_PROVIDERS}
                describe={VERIFIER_PROVIDER_HELP}
                onChange={(v) => setDraft((d) => ({ ...d, verifierProvider: v }))}
              />
              <ProviderField<AuditAnchorProvider>
                id="audit-anchor-provider"
                title="Audit anchor provider"
                value={draft.auditAnchorProvider}
                options={AUDIT_ANCHOR_PROVIDERS}
                describe={AUDIT_ANCHOR_PROVIDER_HELP}
                onChange={(v) => setDraft((d) => ({ ...d, auditAnchorProvider: v }))}
              />

              <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border-subtle)] pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!dirty || mutation.isPending}
                  onClick={() => {
                    if (query.data) setDraft(query.data);
                  }}
                  data-testid="security-policy-discard"
                >
                  Discard changes
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={mutation.isPending}
                  disabled={!dirty || mutation.isPending}
                  data-testid="security-policy-save"
                >
                  Save policy
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────

interface ProviderFieldProps<T extends string> {
  id: string;
  title: string;
  value: T;
  options: readonly T[];
  describe: Record<T, { label: string; help: string }>;
  onChange: (next: T) => void;
}

function ProviderField<T extends string>({
  id,
  title,
  value,
  options,
  describe,
  onChange,
}: ProviderFieldProps<T>) {
  return (
    <div className="grid gap-2 md:grid-cols-[200px_1fr] md:items-start">
      <Label htmlFor={id}>{title}</Label>
      <div>
        <Select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          data-testid={id}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {describe[opt].label}
            </option>
          ))}
        </Select>
        <p
          className="mt-2 text-xs text-[var(--color-text-secondary)]"
          data-testid={`${id}-help`}
        >
          {describe[value].help}
        </p>
      </div>
    </div>
  );
}

/**
 * Small visual summary of the current draft — three coloured badges
 * that tell the operator at a glance how "on-chain" their tenant is.
 * Brand tone for chain-anchored picks, neutral for off-chain/none.
 */
function CurrentMixBadge({ policy }: { policy: SecurityPolicy }) {
  const tone = (v: string) =>
    v === 'off-chain' || v === 'none' ? 'neutral' : 'brand';
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={tone(policy.didProvider)}>did:{policy.didProvider}</Badge>
      <Badge tone={tone(policy.verifierProvider)}>vk:{policy.verifierProvider}</Badge>
      <Badge tone={tone(policy.auditAnchorProvider)}>
        anchor:{policy.auditAnchorProvider}
      </Badge>
    </div>
  );
}

export default SecurityPolicyView;
