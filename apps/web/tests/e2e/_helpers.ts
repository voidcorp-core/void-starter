import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { type APIRequestContext, type APIResponse, expect } from '@playwright/test';
// The dedicated subpath, never the `@repo/auth` barrel: Playwright loads specs
// in plain Node and the barrel reaches `next/headers`. `access-mode.ts` has no
// imports at all, so it is safe from any context.
import { ACCESS_MODE } from '@repo/auth/access-mode';
import postgres from 'postgres';
import { BASE_URL } from './_config';

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
 * Make an address eligible for account creation, and return the token that
 * makes it so.
 *
 * On an invite-only project the user-create hook refuses any address that does
 * not hold a pending invitation AND present its token (ADR 65), so a fixture
 * needs both halves: the ledger row, and the token to carry back. Returns
 * undefined on any other access mode, where sign-up is open and no token
 * exists to present.
 *
 * The row is seeded directly rather than through `issueInvitationForAdmin`
 * because that service sits behind `server-only`, for the same reason the rest
 * of this file talks to Postgres directly.
 *
 * This is fixture setup, not coverage of the invitation contract itself --
 * that lives in `invite-only.spec.ts`.
 */
export async function admitForSignUp(email: string): Promise<string | undefined> {
  if (!isInviteOnlyProject) return undefined;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await getTestSql()`
    INSERT INTO invitations (id, email, token_hash, expires_at, invited_by)
    VALUES (
      ${randomUUID()},
      ${email.trim().toLowerCase()},
      ${createHash('sha256').update(token).digest('hex')},
      ${expiresAt},
      ${'e2e-helper'}
    )
  `;
  return token;
}

/**
 * Walks the invitation link so the context holds the cookie an invitee carries
 * into sign-up. No-op when no token exists, so callers can await it
 * unconditionally.
 *
 * The link is opened for real rather than forging a `Cookie` header, because
 * `APIRequestContext` "will populate request cookies from the context" -- it
 * owns its cookie jar, and a hand-written header does not reach the server.
 * That is what made every admission fail in the canary CI while the production
 * code was correct: the fixture, not the rule, was dropping the token.
 * Entering through `/invite/<token>` also matches what an invitee actually
 * does, and covers the route that parks the cookie.
 */
export async function enterThroughInvitationLink(
  request: APIRequestContext,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  await request.get(`/invite/${token}`, { failOnStatusCode: false });
}

/**
 * POST to a Better Auth endpoint the way a browser reaches it.
 *
 * The `Origin` header is not decoration. Better Auth validates the origin of
 * any request that carries a cookie, and refuses one that carries none with
 * `MISSING_OR_NULL_ORIGIN` -- see `validateOrigin` in
 * `better-auth/api/middlewares/origin-check`. A browser always sends it; an
 * `APIRequestContext` never does. So the moment a fixture starts carrying the
 * invitation cookie, every one of its POSTs is refused before reaching the
 * application at all.
 *
 * That refusal is indistinguishable from an admission refusal at the
 * `response.ok()` level, which is how it stayed hidden: the suites asserting a
 * refusal kept passing, and only the one asserting admission went red. Every
 * auth POST therefore goes through here, and refusals are asserted with
 * `expectRefusedByAdmission` rather than on the status alone.
 */
export async function postToAuth(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return await request.post(path, {
    data,
    headers: { origin: BASE_URL },
    failOnStatusCode: false,
  });
}

/** Refusals the transport produces, which no admission rule ever emits. */
const TRANSPORT_REFUSAL_CODES = [
  'MISSING_OR_NULL_ORIGIN',
  'INVALID_ORIGIN',
  'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
];

/**
 * Assert that the application refused the request, and that it was the
 * application: a CSRF or origin refusal never reaches the admission rule, so
 * accepting one as proof of refusal would assert nothing about the contract.
 */
export async function expectRefusedByAdmission(response: APIResponse): Promise<void> {
  expect(response.ok()).toBe(false);
  const code = ((await response.json().catch(() => ({}))) as { code?: string }).code;
  expect(TRANSPORT_REFUSAL_CODES).not.toContain(code);
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
  const token = await admitForSignUp(body.email);
  await enterThroughInvitationLink(request, token);
  const response = await postToAuth(request, '/api/auth/sign-up/email', body);
  // `postToAuth` never throws on status, so the fixture asserts its own
  // precondition here: a suite whose subject is something else must not start
  // from a user that was silently never created.
  expect(response.ok()).toBe(true);
  return response;
}
