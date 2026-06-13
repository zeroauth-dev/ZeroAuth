/**
 * Tailwind v4 ships its own PostCSS-free pipeline via @tailwindcss/vite
 * (see vite.config.ts). This file is here as a fallback for tooling that
 * looks for a postcss config (e.g. some IDE plugins). Leave the plugin
 * list empty so the Vite plugin stays authoritative.
 */
export default {
  plugins: {},
};
