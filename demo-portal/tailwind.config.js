/**
 * Tailwind v4 reads tokens from the `@theme` block in src/index.css (the
 * sibling dashboard does the same). This file is intentionally minimal —
 * it exists so editor extensions (VSCode Tailwind IntelliSense) discover
 * the project, and so future v3-style overrides have a home if we ever
 * need them. Real theme tokens live in src/index.css.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
