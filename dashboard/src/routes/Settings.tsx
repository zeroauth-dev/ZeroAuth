import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Card, CardBody, CardHeader, Skeleton } from '../components/ui';
import { fmtDateTime, fmtNumber } from '../lib/format';

export function Settings() {
  const { account, status } = useAuth();
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api.usage() });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Account, plan, and tenant configuration.
        </p>
      </header>

      <Card>
        <CardHeader title="Account" description="Identity for the developer console session." />
        <CardBody>
          {status === 'loading' || !account ? (
            <div className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <Row label="Email" value={account.email} />
              <Row label="Company" value={account.companyName ?? '—'} />
              <Row label="Status" value={<Badge tone={account.status === 'active' ? 'success' : 'warn'}>{account.status}</Badge>} />
              <Row label="Tenant ID" value={<span className="font-mono text-xs">{account.id}</span>} />
              <Row label="Created" value={fmtDateTime(account.createdAt)} />
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Plan + limits" description="Per-tenant rate limit and monthly quota." />
        <CardBody>
          {!account ? (
            <Skeleton className="h-16" />
          ) : (
            <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <Row label="Plan" value={<Badge tone="brand">{account.plan}</Badge>} />
              <Row label="Rate limit" value={`${fmtNumber(account.rateLimit)} req / 15 min`} />
              <Row label="Monthly quota" value={account.monthlyQuota === -1 ? 'unlimited' : `${fmtNumber(account.monthlyQuota)} requests`} />
              {usage.data ? (
                <Row
                  label="Used this month"
                  value={`${fmtNumber(usage.data.currentMonth.used)} / ${usage.data.currentMonth.remaining === 'unlimited' ? '∞' : fmtNumber(usage.data.currentMonth.limit)}`}
                />
              ) : null}
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Danger zone"
          description="Account-level destructive actions. Self-service is not enabled yet — reach out to support to suspend or delete a tenant."
        />
        <CardBody className="text-sm text-[var(--color-text-secondary)]">
          <p>
            To request tenant suspension or deletion, email{' '}
            <a href="mailto:security@zeroauth.dev" className="text-[var(--color-brand)] hover:underline">security@zeroauth.dev</a>{' '}
            from the address registered on this account. Include the tenant ID above so the request is processed quickly.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">{label}</dt>
      <dd className="mt-1 text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
