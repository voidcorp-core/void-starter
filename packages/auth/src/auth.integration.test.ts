import { randomUUID } from 'node:crypto';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration test for the full Better-Auth flow against a real Postgres DB.
 *
 * Skip semantics: this suite skips unless BOTH `DATABASE_URL` and
 * `BETTER_AUTH_SECRET` are present in the environment, because importing
 * `auth.repository` eagerly calls `createAppEnv` and would throw at module
 * load if either is missing. The same gating pattern as
 * `packages/db/src/schema/users.integration.test.ts`.
 *
 * To run locally:
 *   vercel env pull .env.local
 *   source <(grep -v '^#' .env.local | sed -e 's/^/export /')
 *   bun run --filter @void/auth test
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

describe.skipIf(!databaseUrl || !authSecret)('auth integration', () => {
  beforeAll(async () => {
    // Sweep orphans from any prior failed runs so a leftover row never
    // blocks a fresh sign-up via the unique-email constraint.
    const db = getDb();
    await db.delete(users).where(like(users.email, TEST_EMAIL_PATTERN));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(users).where(like(users.email, TEST_EMAIL_PATTERN));
  });

  it('signs up, verifies email, signs in, and signs out a new user', async () => {
    // Lazy-import the repository so module-load env validation only runs when
    // the suite actually executes. With the skipIf gate above, this import
    // path is only ever reached when BETTER_AUTH_SECRET is set.
    const { auth } = await import('./auth.repository');

    const id = randomUUID();
    const email = `${TEST_EMAIL_PREFIX}${id}@example.com`;
    const password = 'IntegrationTestPassw0rd!';
    const name = 'Test Integration';

    // 1. Sign up: Better-Auth hashes the password and inserts both the
    //    `users` row and the `accounts` row (provider='credential').
    const signUpResult = await auth.api.signUpEmail({
      body: { email, password, name },
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
});
