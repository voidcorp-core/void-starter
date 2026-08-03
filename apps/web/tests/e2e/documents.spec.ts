import { expect, test } from '@playwright/test';
import { closeTestSql, deleteTestUser, markEmailVerified, signUpViaHttp } from './_helpers';

/**
 * The private-documents flow against real object storage (ADR 68).
 *
 * This is the only test in the repository that exercises the R2 adapter for
 * real: the unit suite substitutes the port, and the integration suite
 * substitutes the object store because CI has no bucket. What runs here is a
 * browser performing the three-step upload -- authorize, PUT straight to the
 * provider, confirm -- which is also the only place the bucket's CORS rule is
 * exercised, since CORS exists nowhere except in a browser.
 *
 * The guard is a plain `if` around the suite rather than a per-test skip marker,
 * for the reason spelled out in `invite-only.spec.ts`: a project of the wrong
 * shape registers no test at all instead of registering suppressed ones. A
 * project generated without `data.files: cloudflare-r2-eu` has no such surface,
 * and the starter itself never sets these variables.
 */

const hasDb = Boolean(process.env['DATABASE_URL']);
const hasR2 = Boolean(
  process.env['R2_BUCKET_NAME'] &&
    process.env['R2_ACCESS_KEY_ID'] &&
    process.env['R2_SECRET_ACCESS_KEY'] &&
    process.env['CLOUDFLARE_ACCOUNT_ID'],
);

if (hasDb && hasR2) {
  test.describe('private documents', () => {
    const email = `e2e-documents-${Date.now()}@example.test`;
    const password = 'TestPassword123!';

    test.beforeAll(async ({ request }) => {
      await signUpViaHttp(request, { email, password, name: 'Documents E2E' });
      await markEmailVerified(email);
    });

    test.afterAll(async () => {
      await deleteTestUser(email);
      await closeTestSql();
    });

    test('uploads, lists, downloads and erases a document', async ({ page }) => {
      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

      await page.goto('/documents');
      await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

      // A real PDF, small but structurally valid: the content type is baked
      // into the presigned signature, so R2 refuses a PUT that declares
      // anything else. Sending bytes that do not match the declaration is the
      // failure this whole flow is built to make impossible.
      await page.getByLabel('File').setInputFiles({
        name: 'e2e-contract.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
      });
      await page.getByRole('button', { name: 'Upload' }).click();

      // Appearing in the listing means the server HEADed the object and found
      // it to be what was authorized. Until then the row is `pending` and no
      // read returns it.
      await expect(page.getByText('e2e-contract.pdf')).toBeVisible({ timeout: 30_000 });

      const download = page.waitForEvent('download', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Download' }).click();
      expect((await download).suggestedFilename()).toBe('e2e-contract.pdf');

      await page.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('e2e-contract.pdf')).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText('No document yet')).toBeVisible();
    });

    test('refuses a file type the profile does not accept', async ({ page }) => {
      // The allowlist is enforced twice, and this asserts the first: the server
      // never signs a URL for a type it does not accept, so nothing reaches the
      // bucket at all. The second enforcement is R2 refusing a mismatched PUT.
      await page.goto('/sign-in');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL('/dashboard', { timeout: 10_000 });

      await page.goto('/documents');
      await page.getByLabel('File').setInputFiles({
        name: 'payload.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<script>alert(1)</script>'),
      });
      await page.getByRole('button', { name: 'Upload' }).click();

      await expect(page.getByText('payload.html')).toBeHidden();
      await expect(page.getByText('No document yet')).toBeVisible();
    });
  });
}
