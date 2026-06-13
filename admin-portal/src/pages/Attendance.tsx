import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { Card, CardBody, Button, Badge, EmptyState, Skeleton, pushToast } from '../components/ui';

export function AttendancePage() {
  const { data, isLoading } = useQuery({ queryKey: ['attendance'], queryFn: () => api.attendance() });
  const [exporting, setExporting] = useState(false);
  const events = data?.events ?? [];

  async function exportCsv() {
    setExporting(true);
    try {
      await api.exportCsv();
    } catch (e) {
      pushToast('danger', e instanceof ApiError ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  const cards: { label: string; value: number; tone?: 'success' | 'danger' }[] = [
    { label: 'Events', value: data?.summary.total ?? 0 },
    { label: 'Accepted', value: data?.summary.accepted ?? 0, tone: 'success' },
    { label: 'Rejected', value: data?.summary.rejected ?? 0, tone: 'danger' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Attendance</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Every check-in and check-out, newest first.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} loading={exporting} disabled={!events.length}>Export CSV</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardBody>
              <div
                className={`font-display text-3xl font-semibold ${
                  c.tone === 'success' ? 'text-[var(--color-success)]' : c.tone === 'danger' ? 'text-[var(--color-danger)]' : ''
                }`}
              >
                {c.value}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">{c.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <CardBody className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</CardBody>
        ) : events.length === 0 ? (
          <EmptyState
            title="No attendance yet"
            description="Check-ins appear here once employees claim their invite and mark attendance on the office network."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <th className="px-6 py-3 font-medium">Employee</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Result</th>
                  <th className="px-6 py-3 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <td className="px-6 py-3 font-medium text-[var(--color-text)]">
                      {e.full_name || '—'}
                      {e.employee_id ? <span className="ml-2 font-mono text-xs text-[var(--color-text-dim)]">{e.employee_id}</span> : null}
                    </td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{e.event_type === 'check_in' ? 'Check in' : 'Check out'}</td>
                    <td className="px-6 py-3"><Badge tone={e.result === 'accepted' ? 'success' : 'danger'}>{e.result}</Badge></td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{new Date(e.occurred_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
