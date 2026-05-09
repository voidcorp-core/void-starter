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
