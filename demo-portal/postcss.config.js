/**
 * Tailwind v4 ships its own PostCSS-free pipeline via @tailwindcss/vite
 * (see vite.config.ts). This file is here as a fallback for tooling that
 * looks for a postcss config (e.g. some IDE plugins, Storybook addons).
 * Leave the plugin list empty so the Vite plugin stays authoritative; if
 * you need PostCSS plugins later, add them here.
 */
export default {
  plugins: {},
};
