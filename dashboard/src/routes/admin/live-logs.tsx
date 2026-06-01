/**
 * Admin live-logs view — auto-scrolling tail of the structured log
 * stream produced by the backend Winston transport.
 *
 * Wire: `GET /api/admin/logs/stream` (SSE). Each event is a JSON
 * line of shape `{ timestamp, level, service, message, extras? }`.
 *
 * Operator controls: pause/resume (paused events accumulate in a
 * holding pen, flushed on resume), filter-by-level (select), filter
 * by service substring (case-insensitive), clear visible buffer.
 *
 * Sits under /admin/ because tailing every service's log lines is a
 * platform-operator action; the backend SSE endpoint is gated by
 * admin auth in src/routes/admin.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Select } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { cn } from '../../lib/cn';

// ─── Types ──────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LevelFilter = 'all' | LogLevel;

interface LogLine {
  /** Monotonic client-side id so React keys stay stable. */
  id: number;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  extras: Record<string, unknown> | null;
}

interface WireLine {
  timestamp?: string;
  level?: string;
  service?: string;
  message?: string;
  extras?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

// ─── Tokens ─────────────────────────────────────────────────────

const STREAM_URL = '/api/admin/logs/stream';
const MAX_BUFFER = 500;
const LEVELS: LevelFilter[] = ['all', 'debug', 'info', 'warn', 'error'];
const LEVEL_TONES: Record<LogLevel, 'neutral' | 'brand' | 'warn' | 'danger'> = {
  debug: 'neutral',
  info: 'brand',
  warn: 'warn',
  error: 'danger',
};

// ─── Projection ─────────────────────────────────────────────────

function isLogLevel(value: unknown): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function projectWire(wire: WireLine, id: number): LogLine {
  return {
    id,
    timestamp: typeof wire.timestamp === 'string' ? wire.timestamp : new Date().toISOString(),
    level: isLogLevel(wire.level) ? wire.level : 'info',
    service: typeof wire.service === 'string' && wire.service.length > 0 ? wire.service : 'unknown',
    message: typeof wire.message === 'string' ? wire.message : '',
    extras:
      wire.extras && typeof wire.extras === 'object' && !Array.isArray(wire.extras)
        ? (wire.extras as Record<string, unknown>)
        : null,
  };
}

// ─── Stream hook ────────────────────────────────────────────────

interface StreamHookResult {
  lines: LogLine[];
  pendingCount: number;
  streamError: string | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  clear: () => void;
}

function useLogStream(): StreamHookResult {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [paused, setPausedState] = useState(false);

  // Refs back the pause toggle so the EventSource callback (which
  // closes over the initial state) always reads the live value.
  const pausedRef = useRef(false);
  const pendingRef = useRef<LogLine[]>([]);
  const nextIdRef = useRef(1);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    if (!next && pendingRef.current.length > 0) {
      const flushed = pendingRef.current;
      pendingRef.current = [];
      setPendingCount(0);
      setLines((prev) => [...prev, ...flushed].slice(-MAX_BUFFER));
    }
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    pendingRef.current = [];
    setPendingCount(0);
  }, []);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(STREAM_URL, { withCredentials: true });
    const onMessage = (raw: MessageEvent) => {
      if (typeof raw.data !== 'string' || raw.data.length === 0) return;
      let wire: WireLine;
      try { wire = JSON.parse(raw.data) as WireLine; } catch { return; }
      const line = projectWire(wire, nextIdRef.current++);
      if (pausedRef.current) {
        pendingRef.current = [...pendingRef.current, line].slice(-MAX_BUFFER);
        setPendingCount(pendingRef.current.length);
        return;
      }
      setLines((prev) => [...prev, line].slice(-MAX_BUFFER));
    };
    const onError = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreamError('Lost the connection to the log stream. Refresh to retry.');
      }
    };
    es.addEventListener('message', onMessage);
    es.addEventListener('log', onMessage);
    es.onerror = onError;
    return () => {
      es.removeEventListener('message', onMessage);
      es.removeEventListener('log', onMessage);
      es.close();
    };
  }, []);

  return { lines, pendingCount, streamError, paused, setPaused, clear };
}

// ─── Page ───────────────────────────────────────────────────────

export function LiveLogsView() {
  const { lines, pendingCount, streamError, paused, setPaused, clear } = useLogStream();
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [serviceFilter, setServiceFilter] = useState('');

  const filteredLines = useMemo(() => {
    const needle = serviceFilter.trim().toLowerCase();
    return lines.filter((line) => {
      if (levelFilter !== 'all' && line.level !== levelFilter) return false;
      if (needle.length > 0 && !line.service.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [lines, levelFilter, serviceFilter]);

  // Auto-scroll to the bottom on new lines — unless the operator is
  // paused (then they're inspecting and we shouldn't yank the viewport).
  const tailRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (paused) return;
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' });
  }, [filteredLines.length, paused]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Live logs</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Auto-scrolling tail of the structured server log. Pause to inspect a
          line without losing the next batch; the holding pen flushes back in
          on resume. Shows the most recent {MAX_BUFFER} lines.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Controls"
          description="Pause, filter by level or service, or clear the visible buffer."
          action={
            <Badge tone={paused ? 'warn' : 'success'} data-testid="live-logs-status">
              {paused ? `Paused (+${pendingCount})` : 'Streaming'}
            </Badge>
          }
        />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="live-logs-level">Level</Label>
              <Select
                id="live-logs-level"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
                data-testid="live-logs-level-filter"
              >
                {LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl === 'all' ? 'All levels' : lvl}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="live-logs-service">Service contains</Label>
              <Input
                id="live-logs-service"
                placeholder="e.g. anchor"
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                data-testid="live-logs-service-filter"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant={paused ? 'primary' : 'secondary'}
                onClick={() => setPaused(!paused)}
                data-testid="live-logs-pause-toggle"
              >
                {paused ? 'Resume' : 'Pause'}
              </Button>
            </div>
            <div className="flex items-end">
              <Button type="button" variant="ghost" onClick={clear} data-testid="live-logs-clear">
                Clear
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Stream"
          description={`Showing ${filteredLines.length} of ${lines.length} buffered lines.`}
          action={<Badge tone="brand">SSE</Badge>}
        />
        <CardBody className="p-0">
          {streamError ? (
            <div
              className="m-5 rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-4 py-3 text-sm text-[var(--color-warn)]"
              role="alert"
              data-testid="live-logs-error"
            >
              {streamError}
            </div>
          ) : null}
          {filteredLines.length === 0 ? (
            <EmptyState
              title={lines.length === 0 ? 'Waiting for log lines…' : 'No lines match the current filter.'}
              description={lines.length === 0 ? 'The stream is open. The next line emitted by any service will appear here.' : 'Loosen the level filter or clear the service substring to see more.'}
            />
          ) : (
            <LogTable lines={filteredLines} tailRef={tailRef} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────

const HEADERS = ['Time', 'Level', 'Service', 'Message', 'Extras'] as const;

function LogTable({
  lines,
  tailRef,
}: {
  lines: LogLine[];
  tailRef: React.MutableRefObject<HTMLTableRowElement | null>;
}) {
  return (
    <div className="max-h-[60vh] overflow-auto" data-testid="live-logs-scroll">
      <table className="w-full text-left text-xs" data-testid="live-logs-table">
        <thead className="sticky top-0 bg-[var(--color-bg-raised)] text-[var(--color-text-dim)]">
          <tr>
            {HEADERS.map((h) => (
              <th key={h} className="px-4 py-2 font-medium uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)] font-mono">
          {lines.map((line, idx) => (
            <tr
              key={line.id}
              ref={idx === lines.length - 1 ? tailRef : null}
              className={cn(
                'text-[var(--color-text-secondary)]',
                line.level === 'error' && 'bg-[var(--color-danger)]/5',
                line.level === 'warn' && 'bg-[var(--color-warn)]/5',
              )}
              data-testid="live-logs-row"
            >
              <td className="whitespace-nowrap px-4 py-1 text-[var(--color-text-dim)]">{fmtDateTime(line.timestamp)}</td>
              <td className="px-4 py-1">
                <Badge tone={LEVEL_TONES[line.level]}>{line.level}</Badge>
              </td>
              <td className="whitespace-nowrap px-4 py-1 text-[var(--color-text)]" data-testid="live-logs-row-service">
                {line.service}
              </td>
              <td className="px-4 py-1 text-[var(--color-text)]" data-testid="live-logs-row-message">
                {line.message}
              </td>
              <td className="px-4 py-1 text-[var(--color-text-dim)]">
                <ExtrasCell extras={line.extras} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Extras cell ────────────────────────────────────────────────

function ExtrasCell({ extras }: { extras: Record<string, unknown> | null }) {
  if (!extras) return <span>—</span>;
  let compact = '[unserialisable]';
  let full = compact;
  try {
    compact = JSON.stringify(extras);
    full = JSON.stringify(extras, null, 2);
  } catch {
    /* keep fallback */
  }
  return (
    <span title={full} className="block max-w-[420px] truncate">
      {compact}
    </span>
  );
}

export default LiveLogsView;
