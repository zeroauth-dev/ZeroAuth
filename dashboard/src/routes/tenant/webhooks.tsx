/**
 * Tenant Webhooks view — list/create/delete/enable-toggle over
 * /api/console/webhooks/*. The signing secret is rendered exactly once
 * (post-create modal); the list endpoint never returns it. Backed by
 * C-094 (backend webhook endpoint, planned).
 */

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { useEnvironment } from '../../components/layout/AppShell';
import {
  Badge, Button, Card, CardBody, CardHeader, CopyButton, EmptyState,
  Input, Label, Modal, pushToast, Skeleton,
} from '../../components/ui';
import { fmtDateTime, fmtRelativeTime, truncate } from '../../lib/format';
import {
  createWebhook, deleteWebhook, isValidWebhookUrl, KNOWN_EVENTS, listWebhooks,
  setWebhookEnabled, type Webhook, type WebhookCreated, type WebhookEvent,
} from '../../lib/webhooks-api';

const ALL_EVENTS = KNOWN_EVENTS;

/** Tone hint for the last-status badge — green on 2xx, warn on 4xx, danger on 5xx. */
function statusTone(code: number | null): 'success' | 'warn' | 'danger' | 'neutral' {
  if (code === null) return 'neutral';
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'warn';
  if (code >= 500) return 'danger';
  return 'neutral';
}

export function Webhooks() {
  const qc = useQueryClient();
  const { environment } = useEnvironment();
  const [creating, setCreating] = useState(false);
  const [createdEnvelope, setCreatedEnvelope] = useState<WebhookCreated | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);

  const list = useQuery({
    queryKey: ['webhooks', environment],
    queryFn: () => listWebhooks({ environment }),
  });

  const remove = useMutation({
    mutationFn: (webhookId: string) => deleteWebhook(webhookId, environment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks'] });
      pushToast('success', 'Webhook deleted.');
    },
    onError: (err) =>
      pushToast('danger', err instanceof ApiError ? err.message : 'Could not delete webhook.'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setWebhookEnabled(id, environment, enabled),
    // Optimistic: flip the row in cache so the toggle responds instantly.
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: ['webhooks', environment] });
      const prev = qc.getQueryData<Webhook[]>(['webhooks', environment]);
      if (prev) {
        qc.setQueryData<Webhook[]>(
          ['webhooks', environment],
          prev.map((w) => (w.id === id ? { ...w, enabled } : w)),
        );
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['webhooks', environment], ctx.prev);
      pushToast('danger', err instanceof ApiError ? err.message : 'Could not update webhook.');
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            HTTPS endpoints that receive signed event payloads from your {environment} environment.
            Verify the <span className="font-mono text-xs">X-ZeroAuth-Signature</span> header on every delivery.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ Add webhook</Button>
      </header>

      <Card>
        <CardHeader
          title="Registered endpoints"
          description="The signing secret is shown exactly once at creation. Rotate by deleting + recreating."
        />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5" data-testid="webhooks-loading">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : list.isError ? (
            <div className="m-5 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]" role="alert">
              Could not load webhooks. Try again in a moment.
            </div>
          ) : list.data && list.data.length > 0 ? (
            <WebhooksTable
              rows={list.data}
              onToggle={(w) => toggle.mutate({ id: w.id, enabled: !w.enabled })}
              onDelete={(w) => setDeleteTarget(w)}
              toggling={toggle.isPending ? toggle.variables?.id ?? null : null}
            />
          ) : (
            <EmptyState
              title="No webhooks registered yet"
              description="Register an https:// endpoint to receive verification, registration, and audit event payloads."
              action={<Button size="sm" onClick={() => setCreating(true)}>Add webhook</Button>}
            />
          )}
        </CardBody>
      </Card>

      <CreateWebhookModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(envelope) => {
          setCreating(false);
          setCreatedEnvelope(envelope);
          qc.invalidateQueries({ queryKey: ['webhooks'] });
        }}
      />

      {/* One-time signing-secret reveal. Backdrop click does NOT
          dismiss — the operator must press "I've saved it" so we know
          they made a deliberate acknowledgement. */}
      <Modal
        open={createdEnvelope !== null}
        onClose={() => { /* require explicit confirmation */ }}
        title="Save your webhook signing secret"
        description="This is the only time the full secret will be shown. Store it in your secrets manager — you'll need it to verify the X-ZeroAuth-Signature header."
        footer={<Button onClick={() => setCreatedEnvelope(null)}>I&rsquo;ve saved it</Button>}
      >
        {createdEnvelope ? (
          <div className="space-y-3">
            <div className="text-xs text-[var(--color-text-secondary)]">
              Endpoint: <span className="font-mono text-[var(--color-text)]">{createdEnvelope.webhook.url}</span>
            </div>
            <div
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-xs break-all"
              data-testid="signing-secret-reveal"
            >
              {createdEnvelope.signing_secret}
            </div>
            <div className="flex justify-end">
              <CopyButton value={createdEnvelope.signing_secret} label="Copy secret" />
            </div>
            <div className="rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
              {createdEnvelope.warning}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete webhook"
        description="Deliveries will stop immediately. This cannot be undone — to rotate the secret, delete and re-create."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={remove.isPending}>Cancel</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!deleteTarget) return;
                remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
              }}
            >
              Delete {truncate(deleteTarget?.url ?? '', 32)}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          You&rsquo;re about to delete the webhook to <span className="font-mono text-[var(--color-text)]">{deleteTarget?.url}</span>.
        </p>
      </Modal>
    </div>
  );
}

// ─── Webhooks table ─────────────────────────────────────────────

function WebhooksTable({
  rows, onToggle, onDelete, toggling,
}: {
  rows: Webhook[];
  onToggle: (webhook: Webhook) => void;
  onDelete: (webhook: Webhook) => void;
  toggling: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" data-testid="webhooks-table">
        <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
          <tr>
            <th className="px-5 py-2 font-medium">URL</th>
            <th className="px-5 py-2 font-medium">Events</th>
            <th className="px-5 py-2 font-medium">Last delivered</th>
            <th className="px-5 py-2 font-medium">Last status</th>
            <th className="px-5 py-2 font-medium">Enabled</th>
            <th className="px-5 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border-subtle)]">
          {rows.map((row) => (
            <tr key={row.id} className="text-[var(--color-text-secondary)]">
              <td className="px-5 py-2 font-mono text-xs text-[var(--color-text)]" data-testid="webhook-url">
                {row.url || '—'}
              </td>
              <td className="px-5 py-2">
                <div className="flex flex-wrap gap-1" data-testid="webhook-events">
                  {row.events.slice(0, 3).map((evt) => (
                    <Badge key={evt} tone="brand" className="font-mono normal-case">{evt}</Badge>
                  ))}
                  {row.events.length > 3 ? (
                    <span className="text-[10px] text-[var(--color-text-dim)]">+{row.events.length - 3}</span>
                  ) : null}
                  {row.events.length === 0 ? (
                    <span className="text-[10px] text-[var(--color-text-dim)]">(no filters)</span>
                  ) : null}
                </div>
              </td>
              <td
                className="px-5 py-2 text-xs"
                title={row.last_delivered_at ? fmtDateTime(row.last_delivered_at) : 'Never'}
                data-testid="webhook-last-delivered"
              >
                {fmtRelativeTime(row.last_delivered_at)}
              </td>
              <td className="px-5 py-2" data-testid="webhook-last-status">
                {row.last_status_code === null
                  ? <span className="text-xs text-[var(--color-text-dim)]">—</span>
                  : <Badge tone={statusTone(row.last_status_code)}>{row.last_status_code}</Badge>}
              </td>
              <td className="px-5 py-2">
                <EnabledToggle
                  enabled={row.enabled}
                  busy={toggling === row.id}
                  onClick={() => onToggle(row)}
                  label={row.enabled ? `Disable webhook to ${row.url}` : `Enable webhook to ${row.url}`}
                />
              </td>
              <td className="px-5 py-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => onDelete(row)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Enabled toggle (small accessible switch) ───────────────────

function EnabledToggle({
  enabled, busy, onClick, label,
}: {
  enabled: boolean; busy: boolean; onClick: () => void; label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      data-testid="webhook-enabled-toggle"
      className={
        'relative inline-flex h-5 w-9 items-center rounded-full border transition-colors ' +
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 ' +
        'disabled:opacity-50 ' +
        (enabled
          ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/30'
          : 'border-[var(--color-border)] bg-[var(--color-bg-surface)]')
      }
    >
      <span
        className={
          'inline-block size-3.5 transform rounded-full bg-[var(--color-text)] transition-transform ' +
          (enabled ? 'translate-x-4' : 'translate-x-0.5')
        }
      />
    </button>
  );
}

// ─── Create modal ───────────────────────────────────────────────

function CreateWebhookModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (envelope: WebhookCreated) => void;
}) {
  const { environment } = useEnvironment();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([...ALL_EVENTS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleEvent(evt: WebhookEvent) {
    setEvents((cur) => cur.includes(evt) ? cur.filter((e) => e !== evt) : [...cur, evt]);
  }
  function reset() { setUrl(''); setEvents([...ALL_EVENTS]); setError(null); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidWebhookUrl(url)) { setError('Enter an https:// URL on a public hostname.'); return; }
    if (events.length === 0) { setError('Pick at least one event filter.'); return; }
    setBusy(true);
    try {
      const envelope = await createWebhook({ environment, url: url.trim(), events });
      reset();
      onCreated(envelope);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create webhook.');
    } finally {
      setBusy(false);
    }
  }

  const urlValid = url === '' || isValidWebhookUrl(url);
  const canSubmit = isValidWebhookUrl(url) && events.length > 0;

  return (
    <Modal
      open={open}
      onClose={() => { if (busy) return; reset(); onClose(); }}
      title="Add webhook"
      description={`Register a new endpoint in your ${environment} environment.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button form="create-webhook-form" type="submit" loading={busy} disabled={!canSubmit || busy}>
            Create webhook
          </Button>
        </>
      }
    >
      <form id="create-webhook-form" onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="webhook-url">Destination URL</Label>
          <Input
            id="webhook-url"
            type="url"
            placeholder="https://example.com/webhooks/zeroauth"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!urlValid}
            data-testid="webhook-url-input"
          />
          {!urlValid
            ? <p className="mt-1 text-[11px] text-[var(--color-danger)]">Must be an https:// URL on a public hostname.</p>
            : <p className="mt-1 text-[11px] text-[var(--color-text-dim)]">The dispatcher rejects http://, localhost, and private-range hosts.</p>}
        </div>

        <div>
          <Label>Event filters</Label>
          <div
            className="grid grid-cols-1 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2"
            data-testid="event-filter-grid"
          >
            {ALL_EVENTS.map((evt) => (
              <label key={evt} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                <input type="checkbox" checked={events.includes(evt)} onChange={() => toggleEvent(evt)} />
                <span className="font-mono">{evt}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-dim)]">
            At least one event must be selected. You can change filters later by deleting and recreating.
          </p>
        </div>

        {error ? (
          <div
            className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

export default Webhooks;
