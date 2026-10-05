import { defineConfig } from 'vitest/config';

export const baseConfig = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Turbo already runs workspace suites in parallel. Bound the nested pool
    // so each suite does not claim every CPU and starve subprocess tests.
    // Ref: https://v4.vitest.dev/config/maxworkers
    maxWorkers: 2,
    include: ['src/**/*.test.ts'],
    // Skeleton packages (e.g. @repo/db before its schemas land) ship without
    // tests yet; opt in here once at the source so individual packages do not
    // need a per-package `--passWithNoTests` plaster.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/*.test.ts', '**/index.ts'],
    },
  },
});
