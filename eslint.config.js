// ESLint flat config for ZeroAuth (eslint v9 + typescript-eslint v8)
// Run with `npm run lint`.

import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // ignored everywhere
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'dashboard/**',
      'website/**',
      'circuits/**',
      'contracts/**',
      'artifacts/**',
      'cache/**',
      'typechain-types/**',
      'scripts/generate-whitepaper.py',
    ],
  },

  // Base TypeScript recommended rules (non-type-aware = fast, no project lookup)
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Express middleware needs `(req as any).foo = bar` to attach context.
      // We could swap to module augmentation later, but for now allow any.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // We intentionally use `void promise.catch(...)` for fire-and-forget work
      '@typescript-eslint/no-floating-promises': 'off',
      // Empty catch blocks are sometimes intentional (swallow optional ops)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Hardhat scripts use console output
      'no-console': 'off',
    },
  },

  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests reach into private internals via casts on purpose
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
);
