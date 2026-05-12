import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Verification } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Card, CardBody, CardHeader, EmptyState, Select, Skeleton } from '../components/ui';
import { fmtDateTime, truncate } from '../lib/format';

export function Verifications() {
  const { environment } = useEnvironment();
  const [method, setMethod] = useState<Verification['method'] | ''>('');
  const [result, setResult] = useState<Verification['result'] | ''>('');

  const list = useQuery({
    queryKey: ['verifications', environment, method, result],
    queryFn: () => api.listVerifications({
      environment,
      method: method || undefined,
      result: result || undefined,
      limit: 100,
    }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Verifications</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Read-only feed of verification events from your {environment} environment.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Recent verifications"
          action={
            <div className="flex gap-2">
              <Select value={method} onChange={(e) => setMethod(e.target.value as Verification['method'] | '')} className="h-8 w-32 text-xs" aria-label="Filter by method">
                <option value="">All methods</option>
                <option value="zkp">zkp</option>
                <option value="fingerprint">fingerprint</option>
                <option value="face">face</option>
                <option value="depth">depth</option>
                <option value="saml">saml</option>
                <option value="oidc">oidc</option>
                <option value="manual">manual</option>
              </Select>
              <Select value={result} onChange={(e) => setResult(e.target.value as Verification['result'] | '')} className="h-8 w-32 text-xs" aria-label="Filter by result">
                <option value="">All results</option>
                <option value="pass">pass</option>
                <option value="fail">fail</option>
                <option value="challenge">challenge</option>
              </Select>
            </div>
          }
        />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : list.data && list.data.verifications.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">When</th>
                    <th className="px-5 py-2 font-medium">Method</th>
                    <th className="px-5 py-2 font-medium">Result</th>
                    <th className="px-5 py-2 font-medium">Reason</th>
                    <th className="px-5 py-2 font-medium">Confidence</th>
                    <th className="px-5 py-2 font-medium">Reference</th>
                    <th className="px-5 py-2 font-medium">User</th>
                    <th className="px-5 py-2 font-medium">Device</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.verifications.map((v) => (
                    <tr key={v.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 whitespace-nowrap text-xs">{fmtDateTime(v.occurred_at)}</td>
                      <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]">{v.method}</td>
                      <td className="px-5 py-2"><Badge tone={v.result === 'pass' ? 'success' : v.result === 'fail' ? 'danger' : 'warn'}>{v.result}</Badge></td>
                      <td className="px-5 py-2 text-xs">{v.reason ?? '—'}</td>
                      <td className="px-5 py-2 text-xs">{v.confidence_score === null ? '—' : v.confidence_score}</td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(v.reference_id, 14)}</td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(v.user_id, 8)}</td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(v.device_id, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No verifications match"
              description="Try clearing the filters, or generate one by calling POST /v1/verifications from your integration."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
