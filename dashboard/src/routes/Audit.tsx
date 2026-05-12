import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AuditEvent } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, Skeleton } from '../components/ui';
import { fmtDateTime, truncate } from '../lib/format';

export function Audit() {
  const { environment } = useEnvironment();
  const [actionQuery, setActionQuery] = useState('');
  const [pendingAction, setPendingAction] = useState('');
  const [status, setStatus] = useState<AuditEvent['status'] | ''>('');

  const list = useQuery({
    queryKey: ['audit', environment, actionQuery, status],
    queryFn: () => api.audit({
      environment,
      action: actionQuery || undefined,
      status: status || undefined,
      limit: 200,
    }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Append-only record of every write in your {environment} environment. Useful for compliance + incident review.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Filter"
          description="Action is a substring match, e.g. device.created, user.updated, api_key.revoked."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setPendingAction(''); setActionQuery(''); setStatus(''); }}
            >
              Reset
            </Button>
          }
        />
        <CardBody>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => { e.preventDefault(); setActionQuery(pendingAction); }}
          >
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">Action</label>
              <Input value={pendingAction} onChange={(e) => setPendingAction(e.target.value)} placeholder="device.created" />
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5">Status</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as AuditEvent['status'] | '')}>
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="failure">Failure</option>
              </Select>
            </div>
            <Button type="submit" variant="secondary">Apply</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Events" description={`${list.data?.events.length ?? 0} rows`} />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
            </div>
          ) : list.data && list.data.events.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">When</th>
                    <th className="px-5 py-2 font-medium">Actor</th>
                    <th className="px-5 py-2 font-medium">Action</th>
                    <th className="px-5 py-2 font-medium">Entity</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.events.map((e) => (
                    <tr key={e.id} className="text-[var(--color-text-secondary)] align-top">
                      <td className="px-5 py-2 whitespace-nowrap text-xs">{fmtDateTime(e.created_at)}</td>
                      <td className="px-5 py-2"><Badge tone="neutral">{e.actor_type}</Badge></td>
                      <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]">{e.action}</td>
                      <td className="px-5 py-2 font-mono text-xs">{e.entity_type}<span className="text-[var(--color-text-dim)]"> · {truncate(e.entity_id, 10)}</span></td>
                      <td className="px-5 py-2"><Badge tone={e.status === 'success' ? 'success' : 'danger'}>{e.status}</Badge></td>
                      <td className="px-5 py-2 text-xs">{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No matching audit events"
              description="Every write through the API or console gets a row here. Try widening the filters."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
