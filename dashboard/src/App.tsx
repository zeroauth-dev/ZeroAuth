import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { AppShell, EnvironmentProvider } from './components/layout/AppShell';
import { ToastViewport } from './components/ui';
import { Login } from './routes/public/Login';
import { Signup } from './routes/public/Signup';
import { SignupComplete } from './routes/public/SignupComplete';
import { Overview } from './routes/Overview';
import { ApiKeys } from './routes/ApiKeys';
import { Users } from './routes/Users';
import { Devices } from './routes/Devices';
import { Verifications } from './routes/Verifications';
import { Attendance } from './routes/Attendance';
import { Audit } from './routes/Audit';
import { Settings } from './routes/Settings';
import { NotFound } from './routes/NotFound';

// The QR-proof demo is the only consumer of the qrserver.com image
// host today; lazy-loading keeps it (and any future scanner deps) out
// of the main bundle until the operator opens /demo/qr-proof-login.
const QrProofLogin = lazy(() => import('./routes/demo/QrProofLogin'));

// Live verifications view (SSE-streamed, ADR 0017 face-first flow).
// Lazy-loaded so the EventSource cost is paid only when the operator
// opens the live tab. Coexists with the polled /verifications view for
// the transition window.
const VerificationsLive = lazy(() => import('./routes/tenant/verifications'));
const UsersLive = lazy(() => import('./routes/tenant/users'));
const AuditIntegrityView = lazy(() => import('./routes/tenant/audit-integrity'));

function RouteSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-current border-r-transparent text-[var(--color-text-dim)]" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Router basename has to track where the dashboard is mounted, which
 * differs by host:
 *   - console.zeroauth.dev/* → SPA lives at the root, basename = "/"
 *   - zeroauth.dev/dashboard/* (legacy) and localhost dev (Vite serves
 *     at /dashboard/ to match the production prefix) → basename = "/dashboard"
 *
 * Build-time Vite base is "/dashboard/" because the JS+CSS bundle has
 * to load from /dashboard/assets/* on every host (Express mounts the
 * static files there); but URL routing is a runtime concern, so we
 * compute it from window.location instead of from import.meta.env.
 */
function resolveBasename(): string {
  if (typeof window === 'undefined') return '/dashboard';
  if (window.location.hostname.startsWith('console.')) return '/';
  return '/dashboard';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        // Don't retry 4xx; do retry 5xx and network errors up to 1x.
        const status = (err as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-current border-r-transparent text-[var(--color-text-dim)]" />
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter basename={resolveBasename()}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <EnvironmentProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/signup-complete" element={<SignupComplete />} />

              <Route element={<RequireAuth />}>
                <Route element={<AppShell />}>
                  <Route index element={<Navigate to="/overview" replace />} />
                  <Route path="/overview" element={<Overview />} />
                  <Route path="/api-keys" element={<ApiKeys />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/verifications" element={<Verifications />} />
                  <Route path="/attendance" element={<Attendance />} />
                  <Route path="/audit" element={<Audit />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route
                    path="/demo/qr-proof-login"
                    element={
                      <RouteSuspense>
                        <QrProofLogin />
                      </RouteSuspense>
                    }
                  />

                  {/* ADR 0017 face-first views — live SSE counterparts to
                      the polled /verifications + /users. Both coexist
                      during the transition; the polled views remain for
                      operators who don't want a live EventSource open. */}
                  <Route
                    path="/verifications-live"
                    element={
                      <RouteSuspense>
                        <VerificationsLive />
                      </RouteSuspense>
                    }
                  />
                  <Route
                    path="/users-live"
                    element={
                      <RouteSuspense>
                        <UsersLive />
                      </RouteSuspense>
                    }
                  />
                  <Route
                    path="/audit-integrity"
                    element={
                      <RouteSuspense>
                        <AuditIntegrityView />
                      </RouteSuspense>
                    }
                  />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>

              <ToastViewport />
            </EnvironmentProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
