/**
 * Public status page — `/admin/status`. NO auth. Polls `/api/health`
 * (the unauthenticated subsystem envelope from src/routes/health.ts)
 * plus one soft `POST /v1/identity/register` probe to confirm the
 * tenant-auth chain is live (expects 401). Auto-refreshes every 30s.
 * Probes: API health, Postgres (implicit from /api/health 200), Redis
 * (only if surfaced — default install is in-process + Postgres
 * rate-limit table), blockchain RPC (opt-in per ADR 0017), tenant
 * surface. Does not consume QueryClient — works for fully
 * unauthenticated visitors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, CardBody, CardHeader, Button } from '../../components/ui';
import { fmtDateTime, fmtRelativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';

// ─── Wire types ──────────────────────────────────────────────────

interface HealthEnvelope {
  status?: string;
  service?: string;
  version?: string;
  message?: string;
  timestamp?: string;
  subsystems?: {
    blockchain?: {
      status?: string;
      network?: string;
      chainId?: number | null;
      latestBlock?: number | null;
    };
    redis?: { status?: string; url?: string | null };
  };
}

type ProbeState = 'up' | 'degraded' | 'down' | 'not_configured' | 'unknown';

interface ProbeRow {
  key: string;
  label: string;
  state: ProbeState;
  detail: string;
  meta?: Array<{ key: string; value: string }>;
}

interface SnapshotResult {
  fetchedAt: string;
  health: HealthEnvelope | null;
  healthHttp: number | null;
  healthError: string | null;
  tenantProbeHttp: number | null;
  tenantProbeCode: string | null;
  tenantProbeError: string | null;
}

// ─── Tokens ──────────────────────────────────────────────────────

const HEALTH_URL = '/api/health';
// The unauthenticated probe MUST hit a v1 endpoint that responds with
// 401 + machine code when no API key is presented. /v1/identity/register
// is the post-ADR-0017 face-first surface; tenant-auth rejects before
// any handler runs.
const TENANT_PROBE_URL = '/v1/identity/register';
const REFRESH_MS = 30_000;
const REQUEST_TIMEOUT_MS = 6_000;

const STATE_TONE: Record<ProbeState, 'success' | 'warn' | 'danger' | 'neutral'> = {
  up: 'success',
  degraded: 'warn',
  down: 'danger',
  not_configured: 'neutral',
  unknown: 'neutral',
};

const STATE_LABEL: Record<ProbeState, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  not_configured: 'Not configured',
  unknown: 'Unknown',
};

// ─── Fetch helpers ───────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSnapshot(): Promise<SnapshotResult> {
  const fetchedAt = new Date().toISOString();
  let health: HealthEnvelope | null = null;
  let healthHttp: number | null = null;
  let healthError: string | null = null;
  let tenantProbeHttp: number | null = null;
  let tenantProbeCode: string | null = null;
  let tenantProbeError: string | null = null;

  try {
    const res = await fetchWithTimeout(HEALTH_URL, { headers: { Accept: 'application/json' } });
    healthHttp = res.status;
    if (res.ok) {
      try { health = (await res.json()) as HealthEnvelope; }
      catch (err) { healthError = err instanceof Error ? err.message : 'Failed to parse /api/health JSON.'; }
    } else {
      healthError = `HTTP ${res.status}`;
    }
  } catch (err) {
    healthError = err instanceof Error ? err.message : 'Network error contacting /api/health.';
  }

  try {
    const res = await fetchWithTimeout(TENANT_PROBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
    tenantProbeHttp = res.status;
    if (res.status === 401 || res.status === 400) {
      try {
        const body = (await res.json()) as { error?: string };
        tenantProbeCode = typeof body?.error === 'string' ? body.error : null;
      } catch { /* non-JSON body — http status is enough */ }
    }
  } catch (err) {
    tenantProbeError = err instanceof Error ? err.message : 'Network error contacting /v1/identity probe.';
  }

  return { fetchedAt, health, healthHttp, healthError, tenantProbeHttp, tenantProbeCode, tenantProbeError };
}

// ─── Probe projection ────────────────────────────────────────────

function projectProbes(snap: SnapshotResult): ProbeRow[] {
  const rows: ProbeRow[] = [];

  if (snap.healthHttp === 200 && snap.health?.status === 'healthy') {
    rows.push({
      key: 'api',
      label: 'API health',
      state: 'up',
      detail: snap.health.message ?? 'Healthy.',
      meta: [
        { key: 'service', value: snap.health.service ?? 'ZeroAuth' },
        { key: 'version', value: snap.health.version ?? 'unknown' },
        { key: 'reported', value: fmtDateTime(snap.health.timestamp ?? null) },
      ],
    });
  } else {
    rows.push({
      key: 'api',
      label: 'API health',
      state: snap.healthHttp === null ? 'down' : 'degraded',
      detail: snap.healthError ?? `Unexpected response (HTTP ${snap.healthHttp ?? 'no response'}).`,
    });
  }

  rows.push({
    key: 'db',
    label: 'Database (Postgres)',
    state: snap.healthHttp === 200 ? 'up' : snap.healthHttp === null ? 'down' : 'degraded',
    detail:
      snap.healthHttp === 200
        ? 'Connection pool reachable (implicit — the API would not boot without a working schema).'
        : 'Cannot confirm DB reachability — /api/health did not return 200.',
  });

  const redis = snap.health?.subsystems?.redis;
  if (redis && typeof redis.status === 'string') {
    const up = redis.status === 'connected' || redis.status === 'ready';
    rows.push({
      key: 'redis',
      label: 'Redis',
      state: up ? 'up' : 'degraded',
      detail: `Reported state: ${redis.status}.`,
      meta: redis.url ? [{ key: 'endpoint', value: redis.url }] : undefined,
    });
  } else {
    rows.push({
      key: 'redis',
      label: 'Redis',
      state: 'not_configured',
      detail: 'Not opted in. In-process session store + Postgres-backed rate-limit table are the live defaults.',
    });
  }

  const chain = snap.health?.subsystems?.blockchain;
  if (chain && typeof chain.status === 'string') {
    const state: ProbeState =
      chain.status === 'connected' ? 'up'
        : chain.status === 'not configured' ? 'not_configured'
        : chain.status === 'error' ? 'down'
        : 'degraded';
    rows.push({
      key: 'blockchain',
      label: 'Blockchain RPC',
      state,
      detail:
        state === 'up' ? `Connected to ${chain.network ?? 'chain'} (chain id ${chain.chainId ?? '—'}, latest block ${chain.latestBlock ?? '—'}).`
          : state === 'not_configured' ? 'Off-chain mode. ADR 0017 — chain providers are opt-in per tenant.'
          : 'Chain provider configured but unreachable. Last RPC call failed.',
      meta: state === 'up' ? [
        { key: 'network', value: String(chain.network ?? '—') },
        { key: 'chainId', value: String(chain.chainId ?? '—') },
        { key: 'latestBlock', value: String(chain.latestBlock ?? '—') },
      ] : undefined,
    });
  } else {
    rows.push({
      key: 'blockchain',
      label: 'Blockchain RPC',
      state: 'unknown',
      detail: 'No blockchain subsystem reported by the API.',
    });
  }

  if (snap.tenantProbeError) {
    rows.push({ key: 'tenant-probe', label: 'Tenant API surface', state: 'down', detail: snap.tenantProbeError });
  } else if (snap.tenantProbeHttp === 401) {
    rows.push({
      key: 'tenant-probe',
      label: 'Tenant API surface',
      state: 'up',
      detail: `Auth chain alive — POST /v1/identity/register correctly rejected (401 ${snap.tenantProbeCode ?? 'no_code'}).`,
    });
  } else {
    rows.push({
      key: 'tenant-probe',
      label: 'Tenant API surface',
      state: 'degraded',
      detail: `POST /v1/identity/register returned HTTP ${snap.tenantProbeHttp ?? 'no response'}${snap.tenantProbeCode ? ` (${snap.tenantProbeCode})` : ''}. Expected 401.`,
    });
  }

  return rows;
}

function summariseTone(rows: ProbeRow[]): { tone: 'success' | 'warn' | 'danger'; label: string } {
  if (rows.some((r) => r.state === 'down')) return { tone: 'danger', label: 'Major issue' };
  if (rows.some((r) => r.state === 'degraded')) return { tone: 'warn', label: 'Partial degradation' };
  return { tone: 'success', label: 'All systems operational' };
}

// ─── Page ────────────────────────────────────────────────────────

export function StatusPage() {
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchSnapshot();
      setSnapshot(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [autoRefresh, refresh]);

  const rows = useMemo(() => (snapshot ? projectProbes(snapshot) : []), [snapshot]);
  const summary = useMemo(() => (rows.length > 0 ? summariseTone(rows) : null), [rows]);

  return (
    <div className="min-h-screen bg-[var(--color-bg)] px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text)]">ZeroAuth status</h1>
            {summary ? (
              <Badge tone={summary.tone} data-testid="status-summary-badge">{summary.label}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Live operational posture of the public API. No biometric data is ever stored, transmitted, or
            logged — the verifier accepts proofs and signatures only.
          </p>
          {snapshot ? (
            <p className="text-xs text-[var(--color-text-dim)]" data-testid="status-fetched-at">
              Last checked {fmtRelativeTime(snapshot.fetchedAt)} ({fmtDateTime(snapshot.fetchedAt)}).
            </p>
          ) : null}
        </header>

        <Card>
          <CardHeader
            title="Subsystem probes"
            description="Auto-refreshes every 30 seconds. Each probe is sourced from the unauthenticated /api/health envelope plus one soft probe against the tenant API surface."
            action={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={autoRefresh ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => setAutoRefresh((v) => !v)}
                  data-testid="status-toggle-autorefresh"
                >
                  {autoRefresh ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { void refresh(); }}
                  loading={loading}
                  data-testid="status-refresh-now"
                >
                  Refresh
                </Button>
              </div>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-[var(--color-border-subtle)]" data-testid="status-probe-list">
              {rows.length === 0
                ? Array.from({ length: 5 }).map((_, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-bg-surface)]" />
                      <div className="h-5 w-24 animate-pulse rounded bg-[var(--color-bg-surface)]" />
                    </li>
                  ))
                : rows.map((row) => <ProbeRowView key={row.key} row={row} />)}
            </ul>
          </CardBody>
        </Card>

        <footer className="text-center text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-dim)]">
          Zero biometric data stored · Ever
        </footer>
      </div>
    </div>
  );
}

function ProbeRowView({ row }: { row: ProbeRow }) {
  return (
    <li
      className={cn(
        'flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6',
        row.state === 'down' && 'bg-[var(--color-danger)]/5',
        row.state === 'degraded' && 'bg-[var(--color-warn)]/5',
      )}
      data-testid={`status-probe-${row.key}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--color-text)]">{row.label}</div>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{row.detail}</p>
        {row.meta && row.meta.length > 0 ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-[var(--color-text-dim)] sm:grid-cols-3">
            {row.meta.map((m) => (
              <div key={m.key} className="flex flex-col">
                <dt className="uppercase tracking-wide">{m.key}</dt>
                <dd className="truncate font-mono text-[var(--color-text-secondary)]">{m.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="shrink-0">
        <Badge tone={STATE_TONE[row.state]} data-testid={`status-state-${row.key}`}>
          {STATE_LABEL[row.state]}
        </Badge>
      </div>
    </li>
  );
}

export default StatusPage;
