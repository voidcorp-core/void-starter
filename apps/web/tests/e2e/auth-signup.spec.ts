import { expect, test } from '@playwright/test';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';
import { eq } from 'drizzle-orm';

const hasDb = Boolean(process.env['DATABASE_URL']);

test.describe('sign-up flow', () => {
  test.skip(!hasDb, 'set DATABASE_URL to run auth E2E (starter ships without a live DB)');

  const testEmail = `e2e-signup-${Date.now()}@example.test`;

  test.afterAll(async () => {
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
