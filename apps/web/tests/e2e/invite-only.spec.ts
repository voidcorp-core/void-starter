import { expect, test } from '@playwright/test';
// The dedicated subpath, never the `@repo/auth` barrel: Playwright loads specs
// in plain Node, and the barrel re-exports `auth.service.ts`, which imports
// `next/headers` and is unresolvable outside the Next runtime. `access-mode.ts`
// has no imports at all, so it is safe to read from any context.
import { ACCESS_MODE } from '@repo/auth/access-mode';
import {
  admitForSignUp,
  closeTestSql,
  deleteTestUser,
  enterThroughInvitationLink,
} from './_helpers';

/**
 * The invite-only account creation contract (ADR 63).
 *
 * These specs assert the behaviour that distinguishes an `invite_only` project
 * from a public one, so they only mean something where the factory wrote that
 * mode: the starter itself ships `public_verified`. A project generated from
 * `fixtures/manifests/web-internal-tool.yaml` runs them for real, which is what
 * makes the manifest declaration verifiable rather than a claim.
 *
 * The guard is a plain `if` around the suite rather than a per-test skip
 * marker, so a project of the wrong shape registers no test at all instead of
 * registering suppressed ones -- suppression markers hide dropped coverage.
 *
 * The refusal is asserted on the HTTP endpoints rather than on the forms,
 * because hiding a sign-up form is cosmetic: what has to hold is that no
 * account is created for an uninvited address on any path Better Auth exposes.
 */

const hasDb = Boolean(process.env['DATABASE_URL']);
const isInviteOnlyProject = ACCESS_MODE === 'invite_only';

if (hasDb && isInviteOnlyProject) {
  test.describe('invite-only account creation', () => {
    const uninvited = `e2e-uninvited-${Date.now()}@example.test`;
    const password = 'TestPassword123!';

    test.afterAll(async () => {
      await deleteTestUser(uninvited);
      await closeTestSql();
    });

    test('refuses email sign-up for an address that holds no invitation', async ({ request }) => {
      const response = await request.post('/api/auth/sign-up/email', {
        data: { email: uninvited, password, name: 'Uninvited' },
        failOnStatusCode: false,
      });

      expect(response.ok()).toBe(false);
    });

    test('creates no account through the magic-link path either', async ({ request }) => {
      await request.post('/api/auth/sign-in/magic-link', {
        data: { email: uninvited },
        failOnStatusCode: false,
      });

      // Whatever the magic-link endpoint answers, no account may exist
      // afterwards: a successful password sign-in would prove one was created.
      const signIn = await request.post('/api/auth/sign-in/email', {
        data: { email: uninvited, password },
        failOnStatusCode: false,
      });
      expect(signIn.ok()).toBe(false);
    });

    test('does not reveal whether an address was ever invited', async ({ request }) => {
      const neverInvited = await request.post('/api/auth/sign-up/email', {
        data: { email: `e2e-never-${Date.now()}@example.test`, password, name: 'Never' },
        failOnStatusCode: false,
      });
      const alsoUninvited = await request.post('/api/auth/sign-up/email', {
        data: { email: uninvited, password, name: 'Uninvited' },
        failOnStatusCode: false,
      });

      expect(neverInvited.status()).toBe(alsoUninvited.status());
    });

    test('keeps the invitation admin screen behind authentication', async ({ page }) => {
      await page.goto('/admin/invitations');

      await expect(page).not.toHaveURL(/\/admin\/invitations$/);
    });

    /**
     * The invitation is a credential, not a list membership (ADR 65). Holding a
     * pending invitation is not enough: the address must also present the token
     * it was issued with. Without this, anyone who guesses an invited address
     * could create that account first and burn the invitation.
     */
    test('refuses an invited address that presents no token', async ({ request }) => {
      const invited = `e2e-notoken-${Date.now()}@example.test`;
      await admitForSignUp(invited);

      const response = await request.post('/api/auth/sign-up/email', {
        data: { email: invited, password, name: 'No Token' },
        failOnStatusCode: false,
      });

      expect(response.ok()).toBe(false);
      await deleteTestUser(invited);
    });

    test('refuses an invited address that presents the wrong token', async ({ request }) => {
      const invited = `e2e-wrongtoken-${Date.now()}@example.test`;
      const other = `e2e-othertoken-${Date.now()}@example.test`;
      await admitForSignUp(invited);
      // A real token, issued for a different address: a leaked link must not
      // open an account it was not issued for.
      const foreignToken = await admitForSignUp(other);
      await enterThroughInvitationLink(request, foreignToken);

      const response = await request.post('/api/auth/sign-up/email', {
        data: { email: invited, password, name: 'Wrong Token' },
        failOnStatusCode: false,
      });

      expect(response.ok()).toBe(false);
      await deleteTestUser(invited);
      await deleteTestUser(other);
    });

    test('admits an invited address that presents its own token', async ({ request }) => {
      const invited = `e2e-goodtoken-${Date.now()}@example.test`;
      const token = await admitForSignUp(invited);
      await enterThroughInvitationLink(request, token);

      const response = await request.post('/api/auth/sign-up/email', {
        data: { email: invited, password, name: 'Good Token' },
        failOnStatusCode: false,
      });

      expect(response.ok()).toBe(true);
      await deleteTestUser(invited);
    });
  });
}
