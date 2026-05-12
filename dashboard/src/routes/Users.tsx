import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type User } from '../lib/api';
import { useEnvironment } from '../components/layout/AppShell';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Modal, pushToast, Select, Skeleton } from '../components/ui';
import { fmtDateTime, fmtRelativeTime } from '../lib/format';

export function Users() {
  const qc = useQueryClient();
  const { environment } = useEnvironment();
  const [statusFilter, setStatusFilter] = useState<User['status'] | ''>('');
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: ['users', environment, statusFilter],
    queryFn: () => api.listUsers({ environment, status: statusFilter || undefined, limit: 100 }),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            People enrolled in your {environment} environment. No biometric template is ever sent or stored from this view.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>+ Enroll user</Button>
      </header>

      <Card>
        <CardHeader
          title="Enrolled users"
          action={
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as User['status'] | '')}
              className="h-8 w-32 text-xs"
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          }
        />
        <CardBody className="p-0">
          {list.isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : list.data && list.data.users.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-dim)]">
                  <tr>
                    <th className="px-5 py-2 font-medium">Name</th>
                    <th className="px-5 py-2 font-medium">External ID</th>
                    <th className="px-5 py-2 font-medium">Email</th>
                    <th className="px-5 py-2 font-medium">Employee code</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                    <th className="px-5 py-2 font-medium">Last verified</th>
                    <th className="px-5 py-2 font-medium">Enrolled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-subtle)]">
                  {list.data.users.map((u) => (
                    <tr key={u.id} className="text-[var(--color-text-secondary)]">
                      <td className="px-5 py-2 text-[var(--color-text)]">{u.full_name}</td>
                      <td className="px-5 py-2 font-mono text-xs">{u.external_id}</td>
                      <td className="px-5 py-2 text-xs">{u.email ?? '—'}</td>
                      <td className="px-5 py-2 text-xs">{u.employee_code ?? '—'}</td>
                      <td className="px-5 py-2"><Badge tone={u.status === 'active' ? 'success' : 'warn'}>{u.status}</Badge></td>
                      <td className="px-5 py-2 text-xs">{fmtRelativeTime(u.last_verified_at)}</td>
                      <td className="px-5 py-2 text-xs">{fmtDateTime(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No users yet"
              description="Enroll a user with their identifying metadata. Biometric templates are never stored — only the proof outputs are."
              action={<Button size="sm" onClick={() => setCreating(true)}>Enroll user</Button>}
            />
          )}
        </CardBody>
      </Card>

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['users'] });
          qc.invalidateQueries({ queryKey: ['overview'] });
          pushToast('success', 'User enrolled.');
        }}
      />
    </div>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { environment } = useEnvironment();
  const [fullName, setFullName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { fullName: string; externalId?: string; email?: string; phone?: string; employeeCode?: string }) =>
      api.createUser({ environment, ...body }),
    onSuccess: () => {
      setFullName(''); setExternalId(''); setEmail(''); setPhone(''); setEmployeeCode('');
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not enroll user.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) { setError('Full name is required.'); return; }
    create.mutate({
      fullName: fullName.trim(),
      externalId: externalId.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      employeeCode: employeeCode.trim() || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enroll user"
      description={`Adds a tenant user in ${environment}. Biometric capture happens on-device — only the cryptographic outputs reach ZeroAuth.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button form="create-user-form" type="submit" loading={create.isPending}>Enroll</Button>
        </>
      }
    >
      <form id="create-user-form" onSubmit={onSubmit} className="space-y-3">
        <div><Label htmlFor="u-name">Full name</Label><Input id="u-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
        <div><Label htmlFor="u-ext">External ID (optional)</Label><Input id="u-ext" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="emp_001" /></div>
        <div><Label htmlFor="u-email">Email (optional)</Label><Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" /></div>
        <div><Label htmlFor="u-phone">Phone (optional)</Label><Input id="u-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" /></div>
        <div><Label htmlFor="u-emp">Employee code (optional)</Label><Input id="u-emp" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} placeholder="HR-12345" /></div>
        {error ? <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">{error}</div> : null}
      </form>
    </Modal>
  );
}
