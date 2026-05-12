import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AttendanceEvent } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Card, CardBody, CardHeader, EmptyState, Select, Skeleton } from '../components/ui';
import { fmtDateTime, truncate } from '../lib/format';

export function Attendance() {
  const { environment } = useEnvironment();
  const [type, setType] = useState<AttendanceEvent['event_type'] | ''>('');
  const [result, setResult] = useState<AttendanceEvent['result'] | ''>('');

  const list = useQuery({
    queryKey: ['attendance', environment, type, result],
    queryFn: () => api.listAttendance({
      environment,
      type: type || undefined,
      result: result || undefined,
      limit: 100,
    }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Check-in and check-out events from your {environment} environment.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Recent events"
          action={
            <div className="flex gap-2">
              <Select value={type} onChange={(e) => setType(e.target.value as AttendanceEvent['event_type'] | '')} className="h-8 w-32 text-xs" aria-label="Filter by type">
                <option value="">All types</option>
                <option value="check_in">Check-in</option>
                <option value="check_out">Check-out</option>
              </Select>
              <Select value={result} onChange={(e) => setResult(e.target.value as AttendanceEvent['result'] | '')} className="h-8 w-32 text-xs" aria-label="Filter by result">
                <option value="">All results</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
          }
        />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : list.data && list.data.attendance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">When</th>
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-5 py-2 font-medium">Result</th>
                    <th className="px-5 py-2 font-medium">User</th>
                    <th className="px-5 py-2 font-medium">Device</th>
                    <th className="px-5 py-2 font-medium">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.attendance.map((e) => (
                    <tr key={e.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 whitespace-nowrap text-xs">{fmtDateTime(e.occurred_at)}</td>
                      <td className="px-5 py-2"><Badge tone={e.event_type === 'check_in' ? 'brand' : 'neutral'}>{e.event_type.replace('_', ' ')}</Badge></td>
                      <td className="px-5 py-2"><Badge tone={e.result === 'accepted' ? 'success' : 'danger'}>{e.result}</Badge></td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(e.user_id, 8)}</td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(e.device_id, 8)}</td>
                      <td className="px-5 py-2 font-mono text-xs">{truncate(e.verification_id, 8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No attendance events match"
              description="Events appear here once devices call POST /v1/attendance."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
