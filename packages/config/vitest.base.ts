import { defineConfig } from 'vitest/config';

export const baseConfig = defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Skeleton packages (e.g. @void/db before its schemas land) ship without
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
