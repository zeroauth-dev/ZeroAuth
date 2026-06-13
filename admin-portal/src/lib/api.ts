/**
 * Typed client for the HR admin API (`/api/hr/*`).
 *
 * Auth is the HttpOnly `zeroauth_hr_jwt` cookie (path-scoped `/api/hr`), so
 * every call sends `credentials: 'include'` and there is no token to store.
 * In dev, vite proxies `/api` to the host API on :3030; in prod the portal is
 * served same-origin at `/admin`, so `/api/hr/*` resolves directly.
 */

export interface HrAdmin { id: string; email: string; fullName?: string | null; tenantId: string; }
export interface CompanyWifi { ssidLabel: string; bssids: string[]; minSignalPercent: number; }
export interface Company { id: string; name: string; location: string; wifi: CompanyWifi; status: string; }

export type EmployeeStatus = 'provisioned' | 'invited' | 'claimed' | 'revoked';
export interface Employee {
  id: string;
  employee_id: string;
  full_name: string;
  department: string | null;
  email: string | null;
  status: EmployeeStatus;
  invite_code_expires_at: string | null;
  claimed_at: string | null;
  created_at: string;
}
export interface Invite { code: string; deeplink: string; expiresAt: string | null; }

export interface AttendanceEvent {
  event_type: 'check_in' | 'check_out';
  result: 'accepted' | 'rejected';
  occurred_at: string;
  full_name: string | null;
  employee_id: string | null;
}
export interface AttendanceSummary { total: number; accepted: number; rejected: number; }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/hr${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, b.error ?? 'error', b.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  signup: (b: { email: string; password: string; companyName: string; location?: string }) =>
    req<{ token: string; hrAdmin: HrAdmin; company: Company }>('/signup', { method: 'POST', body: JSON.stringify(b) }),
  login: (b: { email: string; password: string }) =>
    req<{ token: string; hrAdmin: HrAdmin }>('/login', { method: 'POST', body: JSON.stringify(b) }),
  logout: () => req<{ ok: true }>('/logout', { method: 'POST' }),
  account: () => req<{ hrAdmin: HrAdmin; company: Company | null }>('/account'),

  getCompany: () => req<{ company: Company | null }>('/company'),
  saveCompany: (b: { ssidLabel: string; bssids: string[]; minSignalPercent: number; location?: string }) =>
    req<{ company: Company | null }>('/company', { method: 'POST', body: JSON.stringify(b) }),

  listEmployees: () => req<{ employees: Employee[] }>('/employees'),
  provision: (b: { employeeId: string; fullName: string; department?: string; email?: string }) =>
    req<{ employee: Employee; invite: Invite }>('/employees', { method: 'POST', body: JSON.stringify(b) }),
  setEmployeeStatus: (id: string, status: 'revoked' | 'invited') =>
    req<{ employee: Employee }>(`/employees/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  attendance: () => req<{ events: AttendanceEvent[]; summary: AttendanceSummary }>('/attendance'),

  /** Stream the CSV through fetch (so the cookie is sent) and trigger a download. */
  async exportCsv(): Promise<void> {
    const res = await fetch('/api/hr/attendance/export', { credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, 'export_failed', 'Could not export attendance.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'attendance.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
