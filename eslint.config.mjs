import js from '@eslint/js';
import tseslint from 'typescript-eslint';

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
      // Domain engines are pure (ADR-004): no framework, database, Node or sibling-package imports.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'Domain code does no I/O.' },
            {
              group: ['@nestjs/*', '@prisma/*', '@aura/*'],
              message: 'Domain code imports nothing outside itself.',
            },
          ],
          paths: [
            'fs',
            'path',
            'crypto',
            'http',
            'https',
            'os',
            'child_process',
            'events',
            'stream',
            'util',
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts', 'tests/**/*.ts', 'tools/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
