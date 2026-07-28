import { fileURLToPath } from 'node:url';
import { baseConfig } from '@repo/config/vitest.base';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./tests/vitest.setup.ts'],
    },
    resolve: {
      // Absolute, so the alias resolves the same way whatever directory vitest
      // is invoked from. A relative './src' silently resolved against the
      // caller's cwd and failed for any test crossing the '@/' boundary.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
  }),
);
