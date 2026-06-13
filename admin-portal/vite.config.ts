import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ZeroAuth — Attendance Admin portal. Sibling of dashboard/ and
// demo-portal/, same stack (React 19 + Vite 7 + Tailwind v4 +
// react-router-dom v7 + @tanstack/react-query). Served as a separate
// SPA so HR admins land on a focused company-management surface without
// the developer-console / bank-demo chrome.
//
// `base: '/admin/'` matches the Express static-serve mount wired up in
// src/app.ts (`app.use('/admin', express.static(...))`, done separately)
// so the built index.html's asset URLs (/admin/assets/*.js etc.) resolve
// against the same prefix the SPA is served from. Mirrors dashboard/ at
// /dashboard/ and demo-portal/ at /bank-demo/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/admin/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    // 5175 so dev can run dashboard (5173) + demo-portal (5174) +
    // admin-portal (5175) side-by-side. Proxies same-origin /api and
    // /v1 to the host-bound dev API on 3030.
    port: 5175,
    proxy: {
      '/api': 'http://localhost:3030',
      '/v1': 'http://localhost:3030',
    },
  },
});
