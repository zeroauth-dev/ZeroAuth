import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, CardBody, Button, Skeleton } from '../components/ui';

export function OverviewPage() {
  const { company } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['attendance'], queryFn: () => api.attendance() });
  const { data: emp } = useQuery({ queryKey: ['employees'], queryFn: () => api.listEmployees() });

  const wifiUnset = !company?.wifi?.bssids?.length;
  const claimed = emp?.employees.filter((e) => e.status === 'claimed').length ?? 0;
  const pending = emp?.employees.filter((e) => e.status === 'invited').length ?? 0;

  const stats = [
    { label: 'Check-ins logged', value: data?.summary.accepted ?? 0 },
    { label: 'Active employees', value: claimed },
    { label: 'Pending invites', value: pending },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">{company?.name ?? 'Your company'}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{company?.location || 'Attendance overview'}</p>
      </div>

      {wifiUnset && (
        <Card className="border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5">
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-[var(--color-text)]">Set your office network first</div>
              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                Attendance is gated on your office WiFi. Add the router before inviting employees.
              </p>
            </div>
            <Link to="/company"><Button size="sm">Configure</Button></Link>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardBody>
              {isLoading ? <Skeleton className="h-9 w-12" /> : <div className="font-display text-3xl font-semibold">{s.value}</div>}
              <div className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">{s.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link to="/employees">
          <Card className="h-full transition-colors hover:border-[var(--color-accent)]/50">
            <CardBody>
              <div className="text-sm font-medium">Manage employees →</div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Provision an employee and share the one-time invite QR.</p>
            </CardBody>
          </Card>
        </Link>
        <Link to="/attendance">
          <Card className="h-full transition-colors hover:border-[var(--color-accent)]/50">
            <CardBody>
              <div className="text-sm font-medium">Attendance board →</div>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Review check-ins and export the day's CSV.</p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
