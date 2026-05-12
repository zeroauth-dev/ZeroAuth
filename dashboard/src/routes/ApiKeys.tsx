import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ApiKey, type Environment } from '../lib/api';
import { Badge, Button, Card, CardBody, CardHeader, CopyButton, EmptyState, Input, Label, Modal, pushToast, Select, Skeleton } from '../components/ui';
import { fmtDateTime, fmtRelativeTime, truncate } from '../lib/format';

const ALL_SCOPES = [
  'zkp:verify',
  'zkp:register',
  'nonce:create',
  'identity:read',
  'devices:read',
  'devices:write',
  'users:read',
  'users:write',
  'verifications:read',
  'verifications:write',
  'attendance:read',
  'attendance:write',
  'audit:read',
] as const;

export function ApiKeys() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['keys'], queryFn: () => api.listKeys() });

  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; warning: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);

  const revoke = useMutation({
    mutationFn: (keyId: string) => api.revokeKey(keyId),
    onSuccess: () => {
      pushToast('success', 'API key revoked.');
      qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (err) => {
      pushToast('danger', err instanceof ApiError ? err.message : 'Could not revoke key.');
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Tenant API keys used to authenticate calls to <span className="font-mono text-xs">/v1/*</span>. Max 10 active.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ New API key</Button>
      </header>

      <Card>
        <CardHeader title="Active and revoked keys" description="The full key is shown once at creation. Only the prefix is stored after that." />
        <CardBody className="p-0">
          {keys.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : keys.data && keys.data.keys.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">Name</th>
                    <th className="px-5 py-2 font-medium">Prefix</th>
                    <th className="px-5 py-2 font-medium">Env</th>
                    <th className="px-5 py-2 font-medium">Scopes</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Last used</th>
                    <th className="px-5 py-2 font-medium">Created</th>
                    <th className="px-5 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {keys.data.keys.map((k) => (
                    <tr key={k.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 text-[var(--color-text)]">{k.name}</td>
                      <td className="px-5 py-2 font-mono text-xs">{k.key_prefix}…</td>
                      <td className="px-5 py-2"><Badge tone={k.environment === 'live' ? 'brand' : 'neutral'}>{k.environment}</Badge></td>
                      <td className="px-5 py-2">
                        <div className="flex flex-wrap gap-1">
                          {k.scopes.slice(0, 3).map((s) => (
                            <span key={s} className="rounded bg-[var(--color-bg-surface)] px-1.5 py-0.5 font-mono text-[10px]">{s}</span>
                          ))}
                          {k.scopes.length > 3 ? <span className="text-[10px]">+{k.scopes.length - 3}</span> : null}
                        </div>
                      </td>
                      <td className="px-5 py-2"><Badge tone={k.status === 'active' ? 'success' : 'danger'}>{k.status}</Badge></td>
                      <td className="px-5 py-2 text-xs">{fmtRelativeTime(k.last_used_at)}</td>
                      <td className="px-5 py-2 text-xs">{fmtDateTime(k.created_at)}</td>
                      <td className="px-5 py-2 text-right">
                        {k.status === 'active' ? (
                          <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(k)}>Revoke</Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No API keys yet"
              description="Create your first key to start calling /v1/* from your integration."
              action={<Button size="sm" onClick={() => setCreating(true)}>Create API key</Button>}
            />
          )}
        </CardBody>
      </Card>

      <CreateKeyModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(key, warning) => {
          setCreating(false);
          setNewKey({ key, warning });
          qc.invalidateQueries({ queryKey: ['keys'] });
        }}
      />

      <Modal
        open={newKey !== null}
        onClose={() => { /* require confirmation */ }}
        title="Save your API key"
        description="This is the only time the full key will be shown."
        footer={
          <Button onClick={() => setNewKey(null)}>I've saved it</Button>
        }
      >
        {newKey ? (
          <div className="space-y-3">
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-2 font-mono text-xs break-all">
              {newKey.key}
            </div>
            <div className="flex justify-end">
              <CopyButton value={newKey.key} label="Copy key" />
            </div>
            <div className="rounded-md border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-warn)]">
              {newKey.warning}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="Revoke API key"
        description="Any service using this key will start receiving 401 responses immediately. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeTarget(null)} disabled={revoke.isPending}>Cancel</Button>
            <Button
              variant="danger"
              loading={revoke.isPending}
              onClick={() => {
                if (!revokeTarget) return;
                revoke.mutate(revokeTarget.id, {
                  onSuccess: () => setRevokeTarget(null),
                });
              }}
            >
              Revoke {truncate(revokeTarget?.name ?? '', 24)}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          You're about to revoke <span className="font-mono text-[var(--color-text)]">{revokeTarget?.key_prefix}…</span> ({revokeTarget?.environment}).
        </p>
      </Modal>
    </div>
  );
}

function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string, warning: string) => void;
}) {
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<Environment>('live');
  const [scopes, setScopes] = useState<string[]>([...ALL_SCOPES]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setScopes((cur) => (cur.includes(scope) ? cur.filter((s) => s !== scope) : [...cur, scope]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.createKey({
        name: name.trim() || undefined,
        environment,
        scopes,
      });
      onCreated(res.key, res.warning);
      setName('');
      setEnvironment('live');
      setScopes([...ALL_SCOPES]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create key.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create new API key"
      description="Pick a name + environment + scopes. The full key is shown once."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button form="create-key-form" type="submit" loading={busy}>Create key</Button>
        </>
      }
    >
      <form id="create-key-form" onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="e.g. Production verifier service" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="env">Environment</Label>
          <Select id="env" value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
            <option value="live">live (production traffic)</option>
            <option value="test">test (sandbox, not metered)</option>
          </Select>
        </div>
        <div>
          <Label>Scopes</Label>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-2">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                <span className="font-mono">{s}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-dim)]">Restrict scopes for least privilege. You can revoke and replace anytime.</p>
        </div>

        {error ? (
          <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
