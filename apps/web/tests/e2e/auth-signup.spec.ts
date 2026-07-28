import { expect, test } from '@playwright/test';
import { admitForSignUp, closeTestSql, deleteTestUser } from './_helpers';

/**
 * The guard is a plain `if` around the suite rather than a per-test skip
 * marker, for the reason spelled out in `invite-only.spec.ts`: a suppressed
 * test reads like coverage that ran, while an unregistered one is visibly
 * absent.
 */
const hasDb = Boolean(process.env['DATABASE_URL']);

if (hasDb) {
  test.describe('sign-up flow', () => {
    const testEmail = `e2e-signup-${Date.now()}@example.test`;

    test.beforeAll(async () => {
      // The subject here is what the form does once an address is allowed to
      // hold an account, not whether it is allowed. On an invite-only project
      // the refusal is `invite-only.spec.ts`; without this admission the form
      // would be driven against a rejection and this suite would assert a
      // contract the manifest forbids.
      await admitForSignUp(testEmail);
    });

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
}
