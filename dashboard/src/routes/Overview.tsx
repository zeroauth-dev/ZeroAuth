import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Skeleton } from '../components/ui';
import { fmtCompact, fmtDateTime, fmtNumber, fmtRelativeTime } from '../lib/format';

export function Overview() {
  const { environment } = useEnvironment();
  const overview = useQuery({
    queryKey: ['overview', environment],
    queryFn: () => api.overview(environment),
  });
  const usage = useQuery({
    queryKey: ['usage'],
    queryFn: () => api.usage(),
  });

  const counts = overview.data?.counts;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Snapshot of devices, users, verifications, and attendance for the{' '}
          <span className="font-medium text-[var(--color-text)]">{environment}</span> environment.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Devices" value={counts?.devices} loading={overview.isLoading} />
        <StatCard label="Users" value={counts?.users} loading={overview.isLoading} />
        <StatCard label="Verifications" value={counts?.verifications} loading={overview.isLoading} />
        <StatCard label="Attendance" value={counts?.attendanceEvents} loading={overview.isLoading} />
        <StatCard label="Audit events" value={counts?.auditEvents} loading={overview.isLoading} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent verifications"
            description="The latest verification attempts; pass/fail status and method."
            action={<Link to="/verifications" className="text-xs text-[var(--color-brand)] hover:underline">View all</Link>}
          />
          <CardBody className="p-0">
            {overview.isLoading ? (
              <SkeletonRows />
            ) : overview.data?.recentVerifications.length ? (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {overview.data.recentVerifications.slice(0, 8).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--color-text)]">
                        <span className="font-medium">{v.method}</span>
                        {v.reference_id ? <span className="ml-2 text-xs text-[var(--color-text-dim)] font-mono">{v.reference_id}</span> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{fmtRelativeTime(v.occurred_at)}</div>
                    </div>
                    <Badge tone={v.result === 'pass' ? 'success' : v.result === 'fail' ? 'danger' : 'warn'}>{v.result}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No verifications yet"
                description="Send a verification event from a tenant API key to populate this list."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            description="The newest rows in the business audit log."
            action={<Link to="/audit" className="text-xs text-[var(--color-brand)] hover:underline">Open log</Link>}
          />
          <CardBody className="p-0">
            {overview.isLoading ? (
              <SkeletonRows />
            ) : overview.data?.recentAuditEvents.length ? (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {overview.data.recentAuditEvents.slice(0, 8).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-[var(--color-text)]">
                        <span className="font-mono text-xs text-[var(--color-text-dim)] mr-1.5">{e.action}</span>
                        {e.summary}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        {e.actor_type} · {fmtRelativeTime(e.created_at)}
                      </div>
                    </div>
                    <Badge tone={e.status === 'success' ? 'success' : 'danger'}>{e.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No audit events yet"
                description="Every write through the API or console produces an event here."
              />
            )}
          </CardBody>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Usage this month" description="API calls counted against your plan." />
          <CardBody>
            {usage.isLoading ? (
              <Skeleton className="h-24" />
            ) : usage.data ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-semibold text-[var(--color-text)]">{fmtNumber(usage.data.currentMonth.used)}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">of {usage.data.currentMonth.remaining === 'unlimited' ? 'unlimited' : fmtNumber(usage.data.currentMonth.limit)}</div>
                </div>
                <UsageBar used={usage.data.currentMonth.used} limit={usage.data.currentMonth.limit === -1 ? null : usage.data.currentMonth.limit} />
                <div className="text-xs text-[var(--color-text-secondary)]">Rate limit: {fmtNumber(usage.data.rateLimit.requestsPer15Min)} requests / 15 minutes ({usage.data.plan} plan)</div>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Getting started" description="First steps for a new tenant." />
          <CardBody>
            <ol className="space-y-3 text-sm">
              <ChecklistItem done={(counts?.devices ?? 0) > 0} title="Register your first device" hint="Run POST /v1/devices or use the Devices tab." to="/devices" />
              <ChecklistItem done={(counts?.users ?? 0) > 0} title="Enroll a tenant user" hint="POST /v1/users or use the Users tab." to="/users" />
              <ChecklistItem done={(counts?.verifications ?? 0) > 0} title="Record your first verification" hint="POST /v1/verifications from your integration." to="/verifications" />
            </ol>
          </CardBody>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader title="Recent API calls" description="Last 50 requests across your tenant." />
          <CardBody className="p-0">
            {usage.isLoading ? (
              <SkeletonRows />
            ) : usage.data?.recentCalls.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                    <tr>
                      <th className="px-5 py-2 font-medium">When</th>
                      <th className="px-5 py-2 font-medium">Method</th>
                      <th className="px-5 py-2 font-medium">Endpoint</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium text-right">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {usage.data.recentCalls.slice(0, 25).map((c) => (
                      <tr key={String(c.id)} className="text-[var(--color-text-secondary)]">
                        <td className="px-5 py-2 whitespace-nowrap">{fmtDateTime(c.created_at)}</td>
                        <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]">{c.method}</td>
                        <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]">{c.endpoint}</td>
                        <td className="px-5 py-2">
                          <Badge tone={c.status_code < 400 ? 'success' : c.status_code < 500 ? 'warn' : 'danger'}>
                            {c.status_code}
                          </Badge>
                        </td>
                        <td className="px-5 py-2 text-right font-mono text-xs">{c.response_time_ms ?? '—'} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No API calls yet"
                description="Hit a /v1/* endpoint with one of your API keys and it'll show up here."
                action={<Link to="/api-keys"><Button variant="secondary" size="sm">Mint a key</Button></Link>}
              />
            )}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return (
    <Card>
      <div className="px-4 py-3">
        <div className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
          {loading ? <Skeleton className="h-7 w-12" /> : value === undefined ? '—' : fmtCompact(value)}
        </div>
      </div>
    </Card>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return <div className="h-2 rounded bg-[var(--color-bg-surface)]"><div className="h-2 rounded bg-[var(--color-brand)]/40" style={{ width: '100%' }} /></div>;
  }
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const tone = pct < 70 ? 'var(--color-success)' : pct < 90 ? 'var(--color-warn)' : 'var(--color-danger)';
  return (
    <div className="h-2 overflow-hidden rounded bg-[var(--color-bg-surface)]">
      <div className="h-2 rounded transition-all" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

function ChecklistItem({ done, title, hint, to }: { done: boolean; title: string; hint: string; to: string }) {
  return (
    <li className="flex items-start gap-3">
      <div
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
          done ? 'border-[var(--color-success)] bg-[var(--color-success)]/20 text-[var(--color-success)]' : 'border-[var(--color-border)] text-[var(--color-text-dim)]'
        }`}
      >
        {done ? (
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${done ? 'text-[var(--color-text-secondary)] line-through' : 'text-[var(--color-text)]'}`}>{title}</div>
        <div className="text-xs text-[var(--color-text-secondary)]">{hint}</div>
      </div>
      {!done ? <Link to={to} className="text-xs text-[var(--color-brand)] hover:underline">Open</Link> : null}
    </li>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2 px-5 py-4">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
    </div>
  );
}
