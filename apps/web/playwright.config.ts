import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './tests/e2e/_config';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // CI runs the suite in shards (.github/workflows/ci.yml): each writes a blob
  // report that the required `e2e` job merges into one HTML report on failure.
  reporter: process.env['CI'] ? [['blob'], ['list']] : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
