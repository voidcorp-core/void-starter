import { expect, test } from '@playwright/test';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('sign-up flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-signup-${Date.now()}@example.test`;

  // `@void/db` and `@void/auth/repository` carry `import 'server-only'`, which
  // throws when loaded outside Next.js (e.g. by Playwright's plain-Node test
  // loader). Importing them at module top makes the suite crash before
  // `test.skip` can fire. We therefore defer the imports to the hooks below,
  // which only run when the suite is NOT skipped.
  test.afterAll(async () => {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import('@void/db'),
      import('@void/db/schema'),
      import('drizzle-orm'),
    ]);
    await getDb().delete(users).where(eq(users.email, testEmail));
  });

  test('user can sign up and reach dashboard or verification page', async ({ page }) => {
    await page.goto('/sign-up');

    await page.getByLabel('Name').fill('E2E Test User');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Better-Auth can redirect to /dashboard directly or to /verify-email when
    // requireEmailVerification is true. Accept either outcome.
    await expect(page).toHaveURL(/\/(dashboard|verify-email)/, { timeout: 10_000 });
  });
});
