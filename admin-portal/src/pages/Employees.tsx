import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { api, ApiError, type Invite, type EmployeeStatus } from '../lib/api';
import {
  Card, CardBody, Button, Input, Label, Badge, Modal, EmptyState, Skeleton, CopyButton, pushToast,
} from '../components/ui';

const STATUS_TONE: Record<EmployeeStatus, 'success' | 'accent' | 'neutral' | 'danger'> = {
  claimed: 'success',
  invited: 'accent',
  provisioned: 'neutral',
  revoked: 'danger',
};

const EMPTY_FORM = { employeeId: '', fullName: '', department: '', email: '' };

export function EmployeesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['employees'], queryFn: () => api.listEmployees() });
  const [addOpen, setAddOpen] = useState(false);
  const [invite, setInvite] = useState<{ invite: Invite; name: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const provision = useMutation({
    mutationFn: () =>
      api.provision({
        employeeId: form.employeeId.trim(),
        fullName: form.fullName.trim(),
        department: form.department || undefined,
        email: form.email || undefined,
      }),
    onSuccess: (res) => {
      setAddOpen(false);
      setForm(EMPTY_FORM);
      setInvite({ invite: res.invite, name: res.employee.full_name });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => pushToast('danger', e instanceof ApiError ? e.message : 'Could not provision.'),
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'revoked' | 'invited' }) => api.setEmployeeStatus(v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['employees'] }),
    onError: (e) => pushToast('danger', e instanceof ApiError ? e.message : 'Could not update.'),
  });

  const employees = data?.employees ?? [];
  const canSubmit = form.employeeId.trim() && form.fullName.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">Employees</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Provision an employee, then share the one-time invite. They claim it in the ZeroAuth app.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>Add employee</Button>
      </div>

      <Card>
        {isLoading ? (
          <CardBody className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</CardBody>
        ) : employees.length === 0 ? (
          <EmptyState
            title="No employees yet"
            description="Add your first employee to generate an invite QR."
            action={<Button onClick={() => setAddOpen(true)}>Add employee</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] text-left text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Employee ID</th>
                  <th className="px-6 py-3 font-medium">Department</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                    <td className="px-6 py-3 font-medium text-[var(--color-text)]">{e.full_name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-[var(--color-text-secondary)]">{e.employee_id}</td>
                    <td className="px-6 py-3 text-[var(--color-text-secondary)]">{e.department || '—'}</td>
                    <td className="px-6 py-3"><Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      {e.status === 'revoked' ? (
                        <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: e.id, status: 'invited' })}>Restore</Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: e.id, status: 'revoked' })}>Revoke</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add employee"
        description="They'll get a one-time invite to claim in the ZeroAuth app."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => provision.mutate()} loading={provision.isPending} disabled={!canSubmit}>Generate invite</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div><Label>Full name</Label><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Asha Rao" /></div>
          <div><Label>Employee ID</Label><Input value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} placeholder="EMP-0142" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Ops" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="asha@…" /></div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!invite}
        onClose={() => setInvite(null)}
        title={`Invite for ${invite?.name ?? ''}`}
        description="Have the employee scan this in the ZeroAuth app. Single-use, expires in 48 hours."
        footer={<Button onClick={() => setInvite(null)}>Done</Button>}
      >
        {invite && (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl bg-white p-4">
              <QRCodeSVG value={invite.invite.deeplink} size={184} />
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-3 py-1.5 font-mono text-sm tracking-wider">
                {invite.invite.code}
              </code>
              <CopyButton value={invite.invite.code} />
            </div>
            <p className="text-center text-xs text-[var(--color-text-dim)]">
              The code is single-use. If they miss the window, revoke and re-invite.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
