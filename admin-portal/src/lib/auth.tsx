import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { api, type HrAdmin, type Company } from './api';

interface AuthValue {
  admin: HrAdmin | null;
  company: Company | null;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Resolves the HR session by calling `/api/hr/account`. A 401 throws (the
 * cookie is missing/expired) and lands as `admin: null` → RequireAuth
 * bounces to /login. `retry: false` so an unauthenticated load doesn't
 * hammer the endpoint.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['account'],
    queryFn: () => api.account(),
    retry: false,
    staleTime: 30_000,
  });
  const value: AuthValue = {
    admin: data?.hrAdmin ?? null,
    company: data?.company ?? null,
    loading: isLoading,
    refresh: () => { void qc.invalidateQueries({ queryKey: ['account'] }); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-dim)]">Loading…</div>;
  }
  if (!admin) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
