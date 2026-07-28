import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
// The dedicated subpath, never the `@repo/auth` barrel: Playwright loads specs
// in plain Node and the barrel reaches `next/headers`. `access-mode.ts` has no
// imports at all, so it is safe from any context.
import { ACCESS_MODE } from '@repo/auth/access-mode';
import postgres from 'postgres';

/**
 * Test helpers for E2E suites that need DB access or HTTP signup.
 *
 * Why this file exists:
 * `@repo/db` and `@repo/auth/repository` carry `import 'server-only'`, which
 * throws when loaded outside Next.js (Playwright's plain-Node test loader
 * picks the default condition, where `server-only` exports a throwing module).
 * Tests therefore cannot import those packages even with deferred imports.
 *
 * For E2E setup and teardown:
 *   - Use the dev server via Playwright's `request` API to perform user
 *     actions (sign up, sign in) -- exercises the same HTTP path as a real
 *     user, no internal coupling.
 *   - Use a raw `postgres` client for fixture seeding and cleanup -- bypasses
 *     `@repo/db`'s server-only boundary and Drizzle's runtime entirely.
 *
 * The dev server applies migrations before E2E in CI (drizzle-kit migrate is
 * a CI step). Locally the contributor runs the same step before
 * `bun run test:e2e`.
 */

let sql: postgres.Sql | null = null;

function getTestSql(): postgres.Sql {
  if (sql) return sql;
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is required for E2E tests that touch the DB');
  sql = postgres(url, { onnotice: () => {} });
  return sql;
}

export async function closeTestSql(): Promise<void> {
  if (!sql) return;
  await sql.end({ timeout: 5 });
  sql = null;
}

/** Whether this generated project gates account creation on an invitation. */
const isInviteOnlyProject = ACCESS_MODE === 'invite_only';

/**
 * Make an address eligible for account creation, and nothing more.
 *
 * On an invite-only project (ADR 63) the user-create hook refuses any address
 * the `invitations` ledger does not list, so every suite that needs a
 * pre-existing user must admit it first. On any other access mode this is a
 * no-op and sign-up is open.
 *
 * The row is seeded directly rather than through `issueInvitationForAdmin`
 * because that service sits behind `server-only`, for the same reason the rest
 * of this file talks to Postgres directly. Only the digest column is filled: the
 * token is never redeemed here, admission is keyed on the address.
 *
 * This is fixture setup, not coverage of the invitation contract itself --
 * that lives in `invite-only.spec.ts`, which asserts the refusal.
 */
export async function admitForSignUp(email: string): Promise<void> {
  if (!isInviteOnlyProject) return;
  const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await getTestSql()`
    INSERT INTO invitations (id, email, token_hash, expires_at, invited_by)
    VALUES (
      ${randomUUID()},
      ${email.trim().toLowerCase()},
      ${tokenHash},
      ${expiresAt},
      ${'e2e-helper'}
    )
  `;
}

/**
 * Remove every trace of a test address: the account and, on an invite-only
 * project, the ledger row consumed to create it. Leaving the invitation behind
 * would collide with the partial unique index the next time the same address is
 * seeded.
 */
export async function deleteTestUser(email: string): Promise<void> {
  await getTestSql()`DELETE FROM users WHERE email = ${email}`;
  await getTestSql()`DELETE FROM invitations WHERE email = ${email.trim().toLowerCase()}`;
}

export async function promoteToAdmin(email: string): Promise<void> {
  await getTestSql()`UPDATE users SET role = 'admin' WHERE email = ${email}`;
}

/**
 * Mark a user's email as verified directly in the DB. Required after
 * `signUpViaHttp` because the Better-Auth config has
 * `requireEmailVerification: true`, which blocks sign-in until the
 * verification flow completes. In real product use the user clicks an
 * email link; in E2E we fast-forward the column.
 */
export async function markEmailVerified(email: string): Promise<void> {
  await getTestSql()`UPDATE users SET email_verified = true WHERE email = ${email}`;
}

/**
 * Sign up a user via the public Better-Auth HTTP endpoint. Returns the
 * response so callers can assert status. Use this in `test.beforeAll`
 * for suites that need a pre-existing user without driving the UI.
 *
 * Admits the address first, so the caller gets the user it asked for whatever
 * access mode the project was generated with. A suite whose subject IS the
 * public sign-up must call the endpoint directly instead, as
 * `invite-only.spec.ts` does.
 */
export async function signUpViaHttp(
  request: APIRequestContext,
  body: { email: string; password: string; name: string },
) {
  await admitForSignUp(body.email);
  return await request.post('/api/auth/sign-up/email', {
    data: body,
    failOnStatusCode: true,
  });
}
