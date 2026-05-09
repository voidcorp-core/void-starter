import type { APIRequestContext } from '@playwright/test';
import postgres from 'postgres';

/**
 * Test helpers for E2E suites that need DB access or HTTP signup.
 *
 * Why this file exists:
 * `@void/db` and `@void/auth/repository` carry `import 'server-only'`, which
 * throws when loaded outside Next.js (Playwright's plain-Node test loader
 * picks the default condition, where `server-only` exports a throwing module).
 * Tests therefore cannot import those packages even with deferred imports.
 *
 * For E2E setup and teardown:
 *   - Use the dev server via Playwright's `request` API to perform user
 *     actions (sign up, sign in) -- exercises the same HTTP path as a real
 *     user, no internal coupling.
 *   - Use a raw `postgres` client for fixture seeding and cleanup -- bypasses
 *     `@void/db`'s server-only boundary and Drizzle's runtime entirely.
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

export async function deleteTestUser(email: string): Promise<void> {
  await getTestSql()`DELETE FROM users WHERE email = ${email}`;
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
 */
export async function signUpViaHttp(
  request: APIRequestContext,
  body: { email: string; password: string; name: string },
) {
  return await request.post('/api/auth/sign-up/email', {
    data: body,
    failOnStatusCode: true,
  });
}
