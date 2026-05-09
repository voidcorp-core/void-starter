import { expect, test } from '@playwright/test';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('sign-in / sign-out flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-signin-${Date.now()}@example.test`;
  const testPassword = 'TestPassword123!';

  // `@void/db` and `@void/auth/repository` carry `import 'server-only'`, which
  // throws when loaded outside Next.js (e.g. by Playwright's plain-Node test
  // loader). Defer the imports to the hooks so the suite can be skipped on a
  // fresh clone without DATABASE_URL.
  test.beforeAll(async () => {
    const { getAuth } = await import('@void/auth/repository');
    await getAuth().api.signUpEmail({
      body: { email: testEmail, password: testPassword, name: 'E2E SignIn User' },
    });
  });

  test.afterAll(async () => {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import('@void/db'),
      import('@void/db/schema'),
      import('drizzle-orm'),
    ]);
    await getDb().delete(users).where(eq(users.email, testEmail));
  });

  test('user can sign in and reach dashboard', async ({ page }) => {
    await page.goto('/sign-in');

    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('signed-in user can sign out and return to home', async ({ page }) => {
    // Sign in first
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

    // Open UserMenu and click sign out
    await page.getByRole('button', { name: /avatar|menu/i }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL('/', { timeout: 10_000 });
  });
});
