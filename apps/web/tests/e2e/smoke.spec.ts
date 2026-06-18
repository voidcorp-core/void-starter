import { expect, test } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /void factory/i })).toBeVisible();
});

test('dashboard rejects unauthenticated visitors', async ({ page }) => {
  // requireAuth() throws UnauthorizedError; the error.tsx boundary renders.
  // Without a session cookie, the page should NOT render the user profile card.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Profile' })).not.toBeVisible();
});

test('reset-password confirm shows the invalid state without a token', async ({ page }) => {
  // The email link lands here with ?token=...; visiting bare (or with
  // ?error=INVALID_TOKEN) must render the invalid-link card, not the form.
  await page.goto('/reset-password/confirm');
  await expect(page.getByRole('heading', { name: /invalid or expired link/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /choose a new password/i })).not.toBeVisible();
});
