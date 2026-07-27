import { expect, test } from '@playwright/test';
import { closeTestSql, deleteTestUser } from './_helpers';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('sign-up flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-signup-${Date.now()}@example.test`;

  test.afterAll(async () => {
    await deleteTestUser(testEmail);
    await closeTestSql();
  });

  test('user can sign up and reach the email verification notice', async ({ page }) => {
    await page.goto('/sign-up');

    await page.getByLabel('Name').fill('E2E Test User');
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Better-Auth does not create a session while email verification is
    // required. The app must explain the next step instead of sending the
    // anonymous user through /dashboard and back to /sign-in.
    await expect(page).toHaveURL('/verify-email/pending', { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /check your email/i })).toBeVisible();
  });
});
