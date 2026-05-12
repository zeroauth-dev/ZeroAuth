import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Device } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Modal, pushToast, Select, Skeleton } from '../components/ui';
import { fmtDateTime, fmtRelativeTime } from '../lib/format';

export function Devices() {
  const qc = useQueryClient();
  const { environment } = useEnvironment();
  const [statusFilter, setStatusFilter] = useState<Device['status'] | ''>('');
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['devices', environment, statusFilter],
    queryFn: () => api.listDevices({
      environment,
      status: statusFilter || undefined,
      limit: 100,
    }),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Devices registered against your {environment} environment.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ Register device</Button>
      </header>

      <Card>
        <CardHeader
          title="Registered devices"
          action={
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as Device['status'] | '')}
              className="h-8 w-32 text-xs"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="retired">Retired</option>
            </Select>
          }
        />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : list.data && list.data.devices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">Name</th>
                    <th className="px-5 py-2 font-medium">External ID</th>
                    <th className="px-5 py-2 font-medium">Location</th>
                    <th className="px-5 py-2 font-medium">Battery</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Last seen</th>
                    <th className="px-5 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.devices.map((d) => (
                    <tr key={d.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 text-[var(--color-text)]">{d.name}</td>
                      <td className="px-5 py-2 font-mono text-xs">{d.external_id}</td>
                      <td className="px-5 py-2 text-xs">{d.location_id ?? '—'}</td>
                      <td className="px-5 py-2 text-xs">{d.battery_level === null ? '—' : `${d.battery_level}%`}</td>
                      <td className="px-5 py-2"><Badge tone={d.status === 'active' ? 'success' : d.status === 'inactive' ? 'warn' : 'neutral'}>{d.status}</Badge></td>
                      <td className="px-5 py-2 text-xs">{fmtRelativeTime(d.last_seen_at)}</td>
                      <td className="px-5 py-2 text-xs">{fmtDateTime(d.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No devices yet"
              description="Devices appear here once they call POST /v1/devices."
              action={<Button size="sm" onClick={() => setCreating(true)}>Register a device</Button>}
            />
          )}
        </CardBody>
      </Card>

      <CreateDeviceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['devices'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
          pushToast('success', 'Device registered.');
        }}
      />
    </div>
  );
}

function CreateDeviceModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { environment } = useEnvironment();
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [batteryLevel, setBatteryLevel] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; externalId?: string; locationId?: string; batteryLevel?: number }) =>
      api.createDevice({ environment, ...body }),
    onSuccess: () => {
      setName(''); setExternalId(''); setLocationId(''); setBatteryLevel('');
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not register device.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    const battery = batteryLevel ? Number.parseInt(batteryLevel, 10) : undefined;
    if (battery !== undefined && (Number.isNaN(battery) || battery < 0 || battery > 100)) {
      setError('Battery level must be an integer 0–100.'); return;
    }
    create.mutate({
      name: name.trim(),
      externalId: externalId.trim() || undefined,
      locationId: locationId.trim() || undefined,
      batteryLevel: battery,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a device"
      description={`Adds a row to the ${environment} environment.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button form="create-device-form" type="submit" loading={create.isPending}>Register</Button>
        </>
      }
    >
      <form id="create-device-form" onSubmit={onSubmit} className="space-y-3">
        <div><Label htmlFor="d-name">Name</Label><Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><Label htmlFor="d-ext">External ID (optional)</Label><Input id="d-ext" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="device_001" /></div>
        <div><Label htmlFor="d-loc">Location ID (optional)</Label><Input id="d-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} placeholder="blr-hq" /></div>
        <div><Label htmlFor="d-batt">Battery level (optional)</Label><Input id="d-batt" type="number" min={0} max={100} value={batteryLevel} onChange={(e) => setBatteryLevel(e.target.value)} placeholder="92" /></div>
        {error ? <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">{error}</div> : null}
      </form>
    </Modal>
  );
}
