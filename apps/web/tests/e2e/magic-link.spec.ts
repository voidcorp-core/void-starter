import { expect, test } from '@playwright/test';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('magic link flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-magic-${Date.now()}@example.test`;

  // `@void/db` carries `import 'server-only'`, which throws when loaded outside
  // Next.js (e.g. by Playwright's plain-Node test loader). Defer the imports
  // to the hook so the suite can be skipped on a fresh clone without DATABASE_URL.
  test.afterAll(async () => {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import('@void/db'),
      import('@void/db/schema'),
      import('drizzle-orm'),
    ]);
    await getDb().delete(users).where(eq(users.email, testEmail));
  });

  test.fixme('user receives magic link in dev-server stdout and can sign in via it' /**
   * fixme reason: capturing magic-link URLs from the dev-server process stdout requires
   * either:
   *   (a) a custom webServer.stderr/stdout pipe in playwright.config.ts (not yet supported
   *       as a stable Playwright API), or
   *   (b) a lightweight test helper that starts the dev server with piped stdio and
   *       scans lines for the `magic link` log emitted by `auth.repository.ts`.
   *
   * Neither approach is available in the starter without additional infrastructure.
   * The implementation should be revisited once Playwright adds native stdout capture
   * for webServer processes, or when the email module (Phase D / @void/email) provides
   * a real inbox-inspection mechanism (e.g. Mailpit in dev).
   *
   * Stub outline (for the implementer):
   *   1. Navigate to /magic-link.
   *   2. Fill the email input and submit.
   *   3. Capture the URL logged by the `sendMagicLink` callback.
   *   4. page.goto(capturedUrl).
   *   5. expect(page).toHaveURL('/dashboard', { timeout: 10_000 }).
   */, async ({ page }) => {
    await page.goto('/magic-link');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByRole('button', { name: /send magic link/i }).click();

    // TODO: capture dev-server log line to extract the magic-link URL.
    // Replace this placeholder assertion with the extracted URL navigation.
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 5_000 });
  });
});
