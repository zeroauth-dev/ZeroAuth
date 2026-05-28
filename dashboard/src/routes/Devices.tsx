import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Device, type DeviceEnrollmentInvite, type DeviceEnrollmentState, type DeviceType } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  EmptyState,
  Input,
  Label,
  Modal,
  pushToast,
  Select,
  Skeleton,
} from '../components/ui';
import { fmtDateTime, fmtRelativeTime } from '../lib/format';

const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  mobile_android: 'Android phone',
  mobile_ios: 'iOS phone',
  kiosk: 'Branch kiosk',
  iot_bridge: 'R307 fingerprint bridge',
  desktop: 'Desktop / laptop',
};

const ENROLLMENT_STATE_TONE: Record<DeviceEnrollmentState, 'warn' | 'success' | 'neutral'> = {
  pending: 'warn',
  enrolled: 'success',
  revoked: 'neutral',
};

export function Devices() {
  const qc = useQueryClient();
  const { environment } = useEnvironment();
  const [statusFilter, setStatusFilter] = useState<Device['status'] | ''>('');
  const [stateFilter, setStateFilter] = useState<DeviceEnrollmentState | ''>('');
  const [creating, setCreating] = useState(false);
  // Holds the enrollment-invite shown to the operator after a
  // successful POST or regenerate. Cleared by the operator when they
  // close the modal — the plaintext code is never recoverable after.
  const [activeInvite, setActiveInvite] = useState<DeviceEnrollmentInvite | null>(null);

  const list = useQuery({
    queryKey: ['devices', environment, statusFilter, stateFilter],
    queryFn: () => api.listDevices({
      environment,
      status: statusFilter || undefined,
      enrollmentState: stateFilter || undefined,
      limit: 100,
    }),
  });

  const revoke = useMutation({
    mutationFn: (deviceId: string) => api.revokeDevice(deviceId, { environment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['overview'] });
      pushToast('success', 'Device revoked.');
    },
    onError: (err) => pushToast('danger', err instanceof ApiError ? err.message : 'Could not revoke device.'),
  });

  const regenerate = useMutation({
    mutationFn: (deviceId: string) => api.regenerateDeviceCode(deviceId, { environment }),
    onSuccess: (invite) => {
      setActiveInvite(invite);
      qc.invalidateQueries({ queryKey: ['devices'] });
      pushToast('success', 'New enrollment code issued.');
    },
    onError: (err) => pushToast('danger', err instanceof ApiError ? err.message : 'Could not re-issue code.'),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Phones, kiosks, and IoT bridges enrolled against your {environment} environment.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ Register device</Button>
      </header>

      <Card>
        <CardHeader
          title="Registered devices"
          action={
            <div className="flex items-center gap-2">
              <Select
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as DeviceEnrollmentState | '')}
                className="h-8 w-36 text-xs"
                aria-label="Filter by enrollment state"
              >
                <option value="">All enrollment states</option>
                <option value="pending">Pending</option>
                <option value="enrolled">Enrolled</option>
                <option value="revoked">Revoked</option>
              </Select>
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
            </div>
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
                    <th className="px-5 py-2 font-medium">Type</th>
                    <th className="px-5 py-2 font-medium">Enrollment</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Location</th>
                    <th className="px-5 py-2 font-medium">Last seen</th>
                    <th className="px-5 py-2 font-medium">Created</th>
                    <th className="px-5 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.devices.map((d) => (
                    <tr key={d.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 text-[var(--color-text)]">
                        <div className="font-medium">{d.name}</div>
                        <div className="font-mono text-[10px] text-[var(--color-text-dim)]">{d.external_id}</div>
                      </td>
                      <td className="px-5 py-2 text-xs">{DEVICE_TYPE_LABELS[d.device_type] ?? d.device_type}</td>
                      <td className="px-5 py-2">
                        <Badge tone={ENROLLMENT_STATE_TONE[d.enrollment_state]}>{d.enrollment_state}</Badge>
                      </td>
                      <td className="px-5 py-2">
                        <Badge tone={d.status === 'active' ? 'success' : d.status === 'inactive' ? 'warn' : 'neutral'}>{d.status}</Badge>
                      </td>
                      <td className="px-5 py-2 text-xs">{d.location_id ?? '—'}</td>
                      <td className="px-5 py-2 text-xs">{fmtRelativeTime(d.last_seen_at)}</td>
                      <td className="px-5 py-2 text-xs">{fmtDateTime(d.created_at)}</td>
                      <td className="px-5 py-2 text-right">
                        <DeviceRowActions
                          device={d}
                          onReissue={() => regenerate.mutate(d.id)}
                          onRevoke={() => {
                            if (window.confirm(`Revoke ${d.name}? Its credentials are voided immediately; the row stays for audit.`)) {
                              revoke.mutate(d.id);
                            }
                          }}
                          busy={(regenerate.isPending && regenerate.variables === d.id) || (revoke.isPending && revoke.variables === d.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No devices yet"
              description="Click ‘Register device’ to mint an enrollment code. The device claims the code over /v1/devices/enroll within 15 minutes."
              action={<Button size="sm" onClick={() => setCreating(true)}>Register a device</Button>}
            />
          )}
        </CardBody>
      </Card>

      <CreateDeviceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(invite) => {
          setCreating(false);
          setActiveInvite(invite);
          qc.invalidateQueries({ queryKey: ['devices'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
        }}
      />

      <EnrollmentInviteModal
        invite={activeInvite}
        onClose={() => setActiveInvite(null)}
      />
    </div>
  );
}

function DeviceRowActions({
  device,
  onReissue,
  onRevoke,
  busy,
}: {
  device: Device;
  onReissue: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  if (device.enrollment_state === 'revoked') {
    return <span className="text-[10px] text-[var(--color-text-dim)]">—</span>;
  }
  return (
    <div className="flex justify-end gap-2">
      {device.enrollment_state === 'pending' ? (
        <Button size="sm" variant="secondary" onClick={onReissue} disabled={busy}>Re-issue code</Button>
      ) : null}
      <Button size="sm" variant="danger" onClick={onRevoke} disabled={busy}>Revoke</Button>
    </div>
  );
}

function CreateDeviceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (invite: DeviceEnrollmentInvite) => void;
}) {
  const { environment } = useEnvironment();
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('mobile_android');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; deviceType: DeviceType; locationId?: string }) =>
      api.createDevice({ environment, ...body }),
    onSuccess: (invite) => {
      setName('');
      setDeviceType('mobile_android');
      setLocationId('');
      setError(null);
      onCreated(invite);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not register device.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    create.mutate({
      name: name.trim(),
      deviceType,
      locationId: locationId.trim() || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register a device"
      description={`Mint a one-time enrollment code. The device claims the code via /v1/devices/enroll within 15 minutes.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button form="create-device-form" type="submit" loading={create.isPending}>Issue enrollment code</Button>
        </>
      }
    >
      <form id="create-device-form" onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="d-name">Display name</Label>
          <Input
            id="d-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="MG Road branch · Kiosk #1"
          />
        </div>
        <div>
          <Label htmlFor="d-type">Device type</Label>
          <Select
            id="d-type"
            value={deviceType}
            onChange={(e) => setDeviceType(e.target.value as DeviceType)}
            required
          >
            {(Object.keys(DEVICE_TYPE_LABELS) as DeviceType[]).map((k) => (
              <option key={k} value={k}>{DEVICE_TYPE_LABELS[k]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="d-loc">Location ID (optional)</Label>
          <Input
            id="d-loc"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="branch-mg-road"
          />
        </div>
        {error ? <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">{error}</div> : null}
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          A device row is created in <strong>pending</strong> state. Hand the enrollment code (shown next) to the device; it has 15 minutes to claim the slot. After claim, the device&apos;s hardware fingerprint binds permanently and the row flips to <strong>enrolled</strong>.
        </div>
      </form>
    </Modal>
  );
}

/**
 * One-time display of the plaintext enrollment code. The server has
 * the SHA-256; this modal is the only place the operator sees the
 * code, so we ship a copy button and a countdown of the 15-minute TTL.
 * If the operator closes this modal without copying, they can re-issue
 * from the device row (which voids the prior code).
 */
function EnrollmentInviteModal({
  invite,
  onClose,
}: {
  invite: DeviceEnrollmentInvite | null;
  onClose: () => void;
}) {
  const expiresAt = useMemo(() => invite ? new Date(invite.enrollment.expires_at) : null, [invite]);
  const [remainingMs, setRemainingMs] = useState<number>(() => expiresAt ? expiresAt.getTime() - Date.now() : 0);

  useEffect(() => {
    if (!expiresAt) return;
    setRemainingMs(expiresAt.getTime() - Date.now());
    const id = window.setInterval(() => {
      setRemainingMs(expiresAt.getTime() - Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  if (!invite) return null;
  const expired = remainingMs <= 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Enrollment code"
      description={`Hand this code to ${invite.device.name}. It works once and expires in ${Math.max(1, Math.floor(15))} minutes.`}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-4 text-center">
          <div className="font-mono text-2xl font-semibold tracking-widest text-[var(--color-text)] select-all">
            {invite.enrollment.code}
          </div>
          <div className="mt-2 flex justify-center">
            <CopyButton value={invite.enrollment.code} label="Copy code" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[var(--color-text-dim)]">Expires in</div>
            <div className={`mt-1 font-mono text-sm ${expired ? 'text-[var(--color-danger)]' : 'text-[var(--color-text)]'}`}>
              {expired ? 'Expired — re-issue from the row' : formatRemaining(remainingMs)}
            </div>
          </div>
          <div>
            <div className="text-[var(--color-text-dim)]">Device row</div>
            <div className="mt-1 font-mono text-[10px] text-[var(--color-text-secondary)]">{invite.device.id}</div>
          </div>
        </div>

        <div>
          <div className="text-xs text-[var(--color-text-dim)]">Deep link (for QR or push)</div>
          <div className="mt-1 flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
            <span className="truncate">{invite.enrollment.deeplink}</span>
            <CopyButton value={invite.enrollment.deeplink} label="Copy" />
          </div>
        </div>

        <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          <strong>Next step on the device:</strong> open the ZeroAuth companion app or kiosk firmware and enter the code (or scan the deep link). The device will POST <code className="font-mono">/v1/devices/enroll</code> with the code + its hardware fingerprint; on success it boots into the enrolled state.
        </div>
      </div>
    </Modal>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
