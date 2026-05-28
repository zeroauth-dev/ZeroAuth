/**
 * Tenant Users view — DPDP §2(t)-compliant rendering of enrolled users.
 *
 * Precursor to C-107 (sprint 1 in `docs/plan/bfsi-v1/04-commits.md`).
 * The full route is registered in App.tsx in C-107 sprint 1; this
 * file ships the component skeleton + its PII-blacklist test so the
 * structural contract is locked down before any wiring lands.
 *
 * Forbidden surfaces (enforced by `__tests__/users.test.tsx`):
 *   - No `full_name` column.
 *   - No `email` column.
 *   - No `phone` column.
 *   - No `employee_code` column.
 *
 * Allowed surfaces:
 *   - DID
 *   - Commitment (truncated to first 12 hex chars + "...")
 *   - Environment
 *   - Created at
 *
 * The columns are an ALLOWLIST. Adding a column here is an
 * ADR-grade decision; the schema-purity test (`tests/schema-purity.test.ts`)
 * and the DPDP §2(t) memo skeleton (`docs/compliance/dpdp-2t-memo.md`)
 * are the two artefacts the reviewer checks before broadening the
 * allowlist.
 */

import { useQuery } from '@tanstack/react-query';
import { listUsers, type TenantUserRow } from '../../lib/users-api';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

// ─── Tokens ─────────────────────────────────────────────────────
//
// Column allowlist defined as a const tuple. The render path indexes
// off this — adding a column to the table requires adding it here
// first, which forces the reviewer through the comment block above.

const ALLOWED_COLUMNS = ['DID', 'Commitment', 'Environment', 'Created at'] as const;

/**
 * Truncate a long hex commitment for table rendering. First 12 chars
 * + ellipsis. Matches the design token in the C-107 spec.
 */
function truncateCommitment(commitment: string): string {
  if (!commitment) return '—';
  if (commitment.length <= 12) return commitment;
  return `${commitment.slice(0, 12)}…`;
}

export interface UsersViewProps {
  /**
   * Optional cursor for pagination. Sprint 1 wires this to a "load
   * more" affordance; for the skeleton we accept it but don't render
   * a control.
   */
  cursor?: string;
  /** Optional row limit, default 50 on the server side. */
  limit?: number;
}

export function UsersView({ cursor, limit }: UsersViewProps = {}) {
  const query = useQuery({
    queryKey: ['users', { cursor, limit }],
    queryFn: () => listUsers({ cursor, limit }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Enrolled identities for this tenant. This view renders only the
          decentralized identifier and the Poseidon commitment — the data
          principal is not identifiable from this surface under DPDP §2(t).
        </p>
      </header>

      <Card>
        <CardHeader title="Enrolled identities" />
        <CardBody className="p-0">
          {query.isLoading ? (
            <div className="space-y-2 p-5" data-testid="users-loading">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : query.isError ? (
            <div
              className="m-5 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]"
              role="alert"
            >
              Could not load users. Try again in a moment.
            </div>
          ) : query.data && query.data.users.length > 0 ? (
            <UsersTable rows={query.data.users} />
          ) : (
            <EmptyState
              title="No users enrolled yet."
              description="When the first identity enrols, its DID and commitment will appear here. No personal data is rendered on this view."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function UsersTable({ rows }: { rows: TenantUserRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="users-table">
        <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
          <tr>
            {ALLOWED_COLUMNS.map((col) => (
              <th key={col} className="px-5 py-2 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)]">
          {rows.map((row) => (
            <tr key={row.id} className="text-[var(--color-text-secondary)]">
              <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]" data-testid="user-did">
                {row.did || '—'}
              </td>
              <td className="px-5 py-2 font-mono text-xs" data-testid="user-commitment">
                {truncateCommitment(row.commitment)}
              </td>
              <td className="px-5 py-2" data-testid="user-environment">
                <Badge tone={row.environment === 'live' ? 'success' : 'neutral'}>
                  {row.environment}
                </Badge>
              </td>
              <td className="px-5 py-2 text-xs" data-testid="user-created-at">
                {fmtDateTime(row.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default UsersView;
