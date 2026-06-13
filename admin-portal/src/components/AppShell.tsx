import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { Button } from './ui';
import { cn } from '../lib/cn';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/employees', label: 'Employees', end: false },
  { to: '/company', label: 'Network', end: false },
  { to: '/attendance', label: 'Attendance', end: false },
];

export function AppShell() {
  const { admin, company } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    nav('/login', { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-5">
      <header className="flex items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-2.5">
          <span className="font-display text-lg font-semibold">ZeroAuth</span>
          <span className="rounded-md bg-[var(--color-accent)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-accent-light)]">
            Attendance
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
          <span className="hidden max-w-[200px] truncate sm:inline">{company?.name ?? admin?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cn(
                'relative px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)]',
              )
            }
          >
            {({ isActive }) => (
              <>
                {n.label}
                {isActive && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--color-accent)]" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 py-7">
        <Outlet />
      </main>
    </div>
  );
}
