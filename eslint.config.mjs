import { builtinModules } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import aura from './tools/eslint-rules/index.mjs';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/src/generated/**', '**/coverage/**', '**/*.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'error',
    },
  },
  {
    files: ['services/*/src/**/*.ts'],
    rules: {
      // A service may not import another service's code; share through packages/* only.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/*', '@aura/*-service'],
              message: 'Services talk over HTTP or events, never imports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      // ADR-004 engines are pure: no Node APIs, frameworks, persistence or other workspace code.
      'no-restricted-imports': [
        'error',
        {
          paths: builtinModules.map((name) => ({ name, message: 'Domain engines do no I/O.' })),
          patterns: [
            { group: ['node:*'], message: 'Domain engines do no I/O.' },
            {
              group: ['@nestjs/*', '@prisma/*', '@aura/*', '**/services/*', '**/generated/*'],
              message: 'Domain engines depend on nothing but their inputs.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'process',
        'Buffer',
        'require',
        '__dirname',
        'fetch',
        'setTimeout',
        'setInterval',
      ],
    },
  },
  {
    // User-facing text comes from the packages/i18n catalogue (docs/ux/content-style-guide.md).
    files: ['apps/*/src/**/*.tsx'],
    // The staff-only admin console (TAC-32) is English-only for launch; TAC-48 moves it in.
    ignores: ['apps/web/src/app/admin/**', 'apps/web/src/components/admin/**'],
    plugins: { aura },
    rules: { 'aura/no-hardcoded-ui-strings': 'error' },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', 'tests/**/*.ts', 'tools/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
