import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      // TAC-11 acceptance: every branch of the safety rules and weekly progression is tested.
      thresholds: {
        'src/workouts/progress-week.ts': {
          branches: 100,
          lines: 100,
          functions: 100,
          statements: 100,
        },
        'src/workouts/validate-plan.ts': {
          branches: 100,
          lines: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
