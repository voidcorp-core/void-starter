import { expect, test } from '@playwright/test';
import { closeTestSql, deleteTestUser, promoteToAdmin, signUpViaHttp } from './_helpers';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('role guard for /admin', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-role-${Date.now()}@example.test`;
  const testPassword = 'TestPassword123!';

  test.beforeAll(async ({ request }) => {
    await signUpViaHttp(request, {
      email: testEmail,
      password: testPassword,
      name: 'E2E Role User',
    });
  });

  test.afterAll(async () => {
    await deleteTestUser(testEmail);
    await closeTestSql();
  });

  test('regular user cannot see admin content on /admin', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

    await page.goto('/admin');
    // requireRole('admin') throws ForbiddenError; the error boundary renders.
    // The users table heading should NOT be visible for a regular user.
    await expect(page.getByRole('heading', { name: /users/i })).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('promoted admin can see the users table on /admin', async ({ page }) => {
    await promoteToAdmin(testEmail);

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill(testPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible({ timeout: 10_000 });
    // The card title includes the user count, e.g. "Users (1)"
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
  });
});
