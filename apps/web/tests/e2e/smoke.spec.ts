import { expect, test } from '@playwright/test';

test('homepage loads with title', async ({ page }) => {
  await page.goto('/');
  // The factory replaces the baseline product name with the generated
  // project name, so assert the semantic page contract rather than a
  // template-only string.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('dashboard redirects unauthenticated visitors to sign-in', async ({ page }) => {
  // requireAuth() redirects anonymous visitors to /sign-in carrying a
  // callbackURL (ADR 35) instead of rendering an error boundary.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2Fdashboard/);
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile' })).not.toBeVisible();
});

test('reset-password confirm shows the invalid state without a token', async ({ page }) => {
  // The email link lands here with ?token=...; visiting bare (or with
  // ?error=INVALID_TOKEN) must render the invalid-link card, not the form.
  await page.goto('/reset-password/confirm');
  await expect(page.getByRole('heading', { name: /invalid or expired link/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /choose a new password/i })).not.toBeVisible();
});
