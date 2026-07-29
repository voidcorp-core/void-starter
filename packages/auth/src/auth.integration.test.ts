import { randomUUID } from 'node:crypto';
import { getDb } from '@repo/db';
import { invitations, users } from '@repo/db/schema';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isInviteOnly } from './access-mode';

// `server-only` throws in non-Next.js environments (including vitest). Mock it
// globally here so imports of `@repo/db` and `@repo/auth` work in tests.
vi.mock('server-only', () => ({}));

/**
 * Integration test for the full Better-Auth flow against a real Postgres DB.
 *
 * Skip semantics: this suite skips unless BOTH `DATABASE_URL` and
 * `BETTER_AUTH_SECRET` are present in the environment. Although
 * `auth.repository` is now lazy (`getAuth()` defers env validation to first
 * call), the gating is kept here so CI never runs these against a missing DB.
 * The same gating pattern as
 * `packages/db/src/schema/users.integration.test.ts`.
 *
 * To run locally:
 *   vercel env pull .env.local
 *   source <(grep -v '^#' .env.local | sed -e 's/^/export /')
 *   bun run --filter @repo/auth test
 *
 * Access mode: on a project generated with `auth.access_mode: invite_only`
 * (ADR 63) an open sign-up is refused by the user-create hook, so the happy
 * path seeds an invitation first and a second case pins the refusal. Both read
 * `ACCESS_MODE` rather than hardcoding a mode, so this suite is correct in every
 * generated project without the factory having to rewrite it.
 *
 * The repository sets `requireEmailVerification: true` (a real production
 * safeguard - do not change it). The test bypasses verification by writing
 * `users.emailVerified = true` directly via Drizzle after sign-up. This is a
 * test-only escape hatch; the production path goes through email magic links.
 *
 * Response shapes verified against
 * `node_modules/better-auth/dist/api/routes/sign-{up,in,out}.d.mts` for
 * better-auth@1.6.x:
 *   signUpEmail -> { token: string | null, user: User }
 *   signInEmail -> { redirect: boolean, token: string, url?: string, user: User }
 *   signOut     -> { success: boolean }
 */

const databaseUrl = process.env['DATABASE_URL'];
const authSecret = process.env['BETTER_AUTH_SECRET'];

const TEST_EMAIL_PREFIX = 'test-int-';
const TEST_EMAIL_PATTERN = `${TEST_EMAIL_PREFIX}%@example.com`;

async function sweepTestRows(): Promise<void> {
  const db = getDb();
  await db.delete(users).where(like(users.email, TEST_EMAIL_PATTERN));
  await db.delete(invitations).where(like(invitations.email, TEST_EMAIL_PATTERN));
}

describe.skipIf(!databaseUrl || !authSecret)('auth integration', () => {
  beforeAll(async () => {
    // Sweep orphans from any prior failed runs so a leftover row never
    // blocks a fresh sign-up via the unique-email constraint, nor a leftover
    // pending invitation via the partial unique index.
    await sweepTestRows();
  });

  afterAll(async () => {
    await sweepTestRows();
  });

  it('signs up, verifies email, signs in, and signs out a new user', async () => {
    // Lazy-import the repository so module-load env validation only runs when
    // the suite actually executes. With the skipIf gate above, this import
    // path is only ever reached when BETTER_AUTH_SECRET is set.
    const { getAuth } = await import('./auth.repository');
    const auth = getAuth();

    const id = randomUUID();
    const email = `${TEST_EMAIL_PREFIX}${id}@example.com`;
    const password = 'IntegrationTestPassw0rd!';
    const name = 'Test Integration';

    // 0. On an invite-only project this address holds no invitation, so the
    //    user-create hook refuses it by design (ADR 63). Seed the ledger so the
    //    suite exercises the real admission path rather than asserting a
    //    behaviour the manifest forbids. On any other access mode this is a
    //    no-op and the sign-up below is the open one.
    //
    //    The token has to travel with the request too: admission requires the
    //    credential, not just the address (ADR 65). It normally arrives in the
    //    cookie `/invite/<token>` parks, which is what these headers stand in
    //    for -- there is no HTTP layer under a direct `auth.api` call.
    const admissionHeaders = new Headers();
    if (isInviteOnly()) {
      const { issueInvitationForAdmin } = await import('./invitation.service');
      const { INVITATION_COOKIE_NAME } = await import('./invitation.helper');
      const invitation = await issueInvitationForAdmin({
        email,
        invitedBy: 'auth-integration-test',
      });
      expect(invitation.email).toBe(email);
      admissionHeaders.set('cookie', `${INVITATION_COOKIE_NAME}=${invitation.token}`);
    }

    // 1. Sign up: Better-Auth hashes the password and inserts both the
    //    `users` row and the `accounts` row (provider='credential').
    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
      headers: admissionHeaders,
    });
    expect(signUpResult).toBeDefined();
    expect(signUpResult.user).toBeDefined();
    expect(signUpResult.user.email).toBe(email);
    expect(signUpResult.user.name).toBe(name);

    // 2. Test-only escape hatch: bypass email verification so sign-in works.
    //    Production users go through the magic-link flow instead.
    const db = getDb();
    const updated = await db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.email, email))
      .returning();
    expect(updated).toHaveLength(1);
    expect(updated[0]?.emailVerified).toBe(true);

    // 3. Sign in with the same credentials. Returns a fresh session token
    //    plus the user payload. `redirect` is false because we did not pass
    //    a `callbackURL`.
    const signInResult = await auth.api.signInEmail({
      body: { email, password },
    });
    expect(signInResult).toBeDefined();
    expect(signInResult.user.email).toBe(email);
    expect(signInResult.user.id).toBe(signUpResult.user.id);
    expect(typeof signInResult.token).toBe('string');
    expect(signInResult.token.length).toBeGreaterThan(0);
    expect(signInResult.redirect).toBe(false);

    // 4. Sign out. Better-Auth's `signOut` requires the request headers to
    //    locate the active session cookie. We forward a cookie carrying the
    //    just-issued session token; the route deletes the row and returns
    //    `{ success: true }`.
    const signOutHeaders = new Headers({
      cookie: `better-auth.session_token=${signInResult.token}`,
    });
    const signOutResult = await auth.api.signOut({ headers: signOutHeaders });
    expect(signOutResult).toBeDefined();
    expect(signOutResult.success).toBe(true);
  });

  it.runIf(isInviteOnly())('refuses an address that holds no invitation', async () => {
    const { getAuth } = await import('./auth.repository');
    const auth = getAuth();

    const email = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;

    await expect(
      auth.api.signUpEmail({
        body: { email, password: 'IntegrationTestPassw0rd!', name: 'Uninvited' },
      }),
    ).rejects.toThrow();

    // The refusal must leave no trace of the account: a hook that threw after
    // the insert would still have created a user this project never admitted.
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(0);
  });
});
