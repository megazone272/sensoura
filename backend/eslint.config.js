// ESLint flat configuration (ESLint v9).
//
// The backend is TypeScript with ESM. This config type-agnostically lints
// `src/` (and the test suite) without requiring a type-aware ruleset, so it
// runs fast in CI and in the container image.
//
// `npm run lint` → `eslint src`
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'models/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: false },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // The codebase uses `any` in a few provider-payload boundaries where the
      // shape is validated at runtime by zod; keep those explicit but not fatal.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
