import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// NeoBank — the investor-facing demo. Sibling of dashboard/, same stack
// (React 19 + Vite 7 + Tailwind v4 + react-router-dom v7). Served as a
// separate SPA so the demo can be opened standalone on a laptop during
// pitches without dragging in the console/admin chrome.
//
// `base: '/demo-portal/'` matches the Express static-serve mount in
// src/app.ts (`app.use('/demo-portal', express.static(...))`) so the
// built index.html's asset URLs (/demo-portal/assets/*.js etc.) resolve
// against the same prefix the SPA itself is served from. Mirrors the
// dashboard/ setup at /dashboard/. Adjust if the Express mount changes.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/demo-portal/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    // 5174 so dev can run dashboard (5173) and demo-portal side-by-side.
    port: 5174,
    proxy: {
      '/api': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
});
