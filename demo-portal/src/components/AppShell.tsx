/**
 * NeoBank top-bar AppShell.
 *
 * Wraps every demo route so the wordmark + nav + sign-in/profile
 * affordance stay anchored. Top-bar (not sidebar) because NeoBank is
 * a consumer bank, not a developer console — investors should never
 * feel like they are inside a control panel.
 *
 * Layout:  [ Brand ]   [ Personal · Business · About ]   [ RightEdge ]
 *
 * RightEdge is dynamic:
 *   loading           → skeleton
 *   unauthenticated   → "Sign in" button -> /signin
 *   authenticated     → profile menu with display name + Sign out
 *
 * Pages render their own content inside <main><Outlet /></main>; the
 * shell does not impose a max-width so routes can be edge-to-edge
 * (Landing hero) or centred (SignIn card) as each prefers.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Brand } from './Brand';
import { Button } from './Button';
import { useSession } from '../lib/session';
import { cn } from '../lib/cn';

// ─── Nav definition ───────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Personal' },
  { to: '/business', label: 'Business' },
  { to: '/about', label: 'About' },
];

// ─── Right-edge: profile menu / sign-in button / skeleton ─────────

function ProfileMenu({ displayName, onLogout }: { displayName: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-full border border-[var(--color-border)]',
          'bg-[var(--color-bg-raised)] py-1.5 pl-1.5 pr-3',
          'text-sm font-medium text-[var(--color-text)] transition-colors',
          'hover:border-[var(--color-text-dim)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-full bg-[var(--color-accent)] text-xs font-bold text-white"
        >
          {initial}
        </span>
        <span className="hidden sm:inline">{displayName.split(' ')[0]}</span>
        <svg
          width={12} height={12} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-50 mt-2 min-w-[12rem] overflow-hidden rounded-lg',
            'border border-[var(--color-border)] bg-[var(--color-bg-raised)] shadow-lg',
          )}
        >
          <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-[var(--color-text-dim)]">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--color-text)]">
              {displayName}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onLogout(); }}
            className={cn(
              'block w-full px-4 py-2.5 text-left text-sm text-[var(--color-text)]',
              'transition-colors hover:bg-[var(--color-bg)]',
            )}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RightEdge() {
  const navigate = useNavigate();
  const { status, session, logout } = useSession();

  if (status === 'loading') {
    return (
      <div
        aria-hidden="true"
        className="h-9 w-24 animate-pulse rounded-full bg-[var(--color-border-subtle)]"
      />
    );
  }

  if (status === 'authenticated' && session) {
    return (
      <ProfileMenu
        displayName={session.user.displayName}
        onLogout={async () => {
          await logout();
          navigate('/', { replace: true });
        }}
      />
    );
  }

  return (
    <Button variant="primary" size="md" onClick={() => navigate('/signin')}>
      Sign in
    </Button>
  );
}

// ─── Mobile sheet ─────────────────────────────────────────────────

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
}

function MobileSheet({ open, onClose }: MobileSheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        className={cn(
          'fixed inset-x-0 top-16 z-40 border-b border-[var(--color-border)]',
          'bg-[var(--color-bg-raised)] shadow-lg',
        )}
        role="dialog"
        aria-label="Site navigation"
      >
        <nav className="flex flex-col gap-1 p-4">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2.5 text-base font-medium transition-colors',
                  isActive
                    ? 'bg-[var(--color-bg)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-dim)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ─── AppShell ────────────────────────────────────────────────────

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the drawer on any route change.
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <header
        className={cn(
          'sticky top-0 z-20 border-b border-[var(--color-border)]',
          'bg-[var(--color-bg)]/95 backdrop-blur',
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          {/* Left — wordmark (+ mobile hamburger) */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className={cn(
                'md:hidden inline-flex size-9 items-center justify-center rounded-md',
                'border border-[var(--color-border)] text-[var(--color-text-dim)]',
                'transition-colors hover:bg-[var(--color-bg-raised)] hover:text-[var(--color-text)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40',
              )}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
            >
              <svg
                width={16} height={16} viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth={1.8}
                strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>

            <Link
              to="/"
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
              aria-label="NeoBank — home"
            >
              <Brand variant="small" />
            </Link>
          </div>

          {/* Centre — nav (desktop only) */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                // `end` keeps the Personal link from staying active
                // on every descendant route.
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-[var(--color-text)]'
                      : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Right — sign-in / profile */}
          <div className="flex items-center gap-2">
            <RightEdge />
          </div>
        </div>

        <MobileSheet open={mobileOpen} onClose={() => setMobileOpen(false)} />
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export default AppShell;
