import { expect, test } from '@playwright/test';
import { closeTestSql, deleteTestUser, markEmailVerified, signUpViaHttp } from './_helpers';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('sign-in / sign-out flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-signin-${Date.now()}@example.test`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async ({ request }) => {
    await signUpViaHttp(request, {
      email: testEmail,
      password: testPassword,
      name: 'E2E SignIn User',
    });
    await markEmailVerified(testEmail);
  });

  test.afterAll(async () => {
    await deleteTestUser(testEmail);
    await closeTestSql();
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
    await page.getByRole('button', { name: 'Open user menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL('/', { timeout: 10_000 });
  });
});
