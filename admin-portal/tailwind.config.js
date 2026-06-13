/**
 * Tailwind v4 reads tokens from the `@theme` block in src/index.css (the
 * sibling dashboard / demo-portal do the same). This file is intentionally
 * minimal — it exists so editor extensions (VSCode Tailwind IntelliSense)
 * discover the project. Real theme tokens live in src/index.css.
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
