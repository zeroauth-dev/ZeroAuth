import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './lib/auth';
import { ToastViewport } from './components/ui';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { CompanyPage } from './pages/Company';
import { EmployeesPage } from './pages/Employees';
import { AttendancePage } from './pages/Attendance';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/" element={<OverviewPage />} />
              <Route path="/company" element={<CompanyPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ToastViewport />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
