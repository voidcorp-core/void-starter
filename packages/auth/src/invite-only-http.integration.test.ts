import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getDb } from '@repo/db';
import { invitations, users } from '@repo/db/schema';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// The starter itself ships `public_verified`, so nothing in its own CI ever
// exercises the invite-only hook. That is the gap that let ADR 63 ship an
// unverified token and then let ADR 65 ship a broken admission: both defects
// were only visible in a generated project. Forcing the mode here brings the
// contract under the starter's own CI, against its real Postgres.
vi.mock('./access-mode', () => ({
  ACCESS_MODE: 'invite_only',
  isInviteOnly: () => true,
}));

/**
 * The invite-only admission contract over the real HTTP path (ADR 65).
 *
 * The distinction from `invitation.service.test.ts` is the entry point: this
 * drives Better Auth's own handler with a `Request`, so the token travels the
 * way it does in production -- through the router, the endpoint dispatch and
 * whatever context propagation sits between them -- instead of being handed to
 * the rule as a parameter. A unit test cannot observe a token that is lost
 * before the rule is called.
 */

const databaseUrl = process.env['DATABASE_URL'];
const authSecret = process.env['BETTER_AUTH_SECRET'];

const TEST_EMAIL_PREFIX = 'test-invite-http-';
const TEST_EMAIL_PATTERN = `${TEST_EMAIL_PREFIX}%@example.com`;
const PASSWORD = 'InviteOnlyTestPassw0rd!';

async function sweep(): Promise<void> {
  const db = getDb();
  await db.delete(users).where(like(users.email, TEST_EMAIL_PATTERN));
  await db.delete(invitations).where(like(invitations.email, TEST_EMAIL_PATTERN));
}

/** Seeds a pending invitation and returns the raw token it was issued with. */
async function seedInvitation(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await getDb()
    .insert(invitations)
    .values({
      id: randomUUID(),
      email: email.trim().toLowerCase(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      invitedBy: 'invite-only-http-test',
    });
  return token;
}

/** Whether an account exists for the address, which is what admission means. */
async function accountExists(email: string): Promise<boolean> {
  const rows = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
  return rows.length > 0;
}

/** Whether the address's invitation has been burnt by the post-creation hook. */
async function invitationConsumed(email: string): Promise<boolean> {
  const rows = await getDb()
    .select({ usedAt: invitations.usedAt })
    .from(invitations)
    .where(eq(invitations.email, email));
  return rows.length > 0 && rows.every((row) => row.usedAt !== null);
}

function signUpRequest(email: string, cookie?: string): Request {
  return new Request('http://localhost:3000/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Invite Only HTTP' }),
  });
}

describe.skipIf(!databaseUrl || !authSecret)('invite-only admission over HTTP', () => {
  beforeAll(async () => {
    await sweep();
  });

  afterAll(async () => {
    await sweep();
  });

  it('admits an invited address that presents its own token', async () => {
    const { getAuth } = await import('./auth.repository');
    const email = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;
    const token = await seedInvitation(email);

    const response = await getAuth().handler(signUpRequest(email, `void_invitation=${token}`));

    expect(response.status).toBeLessThan(400);
    // The status is what the endpoint says; the row is what actually happened.
    expect(await accountExists(email)).toBe(true);
    expect(await invitationConsumed(email)).toBe(true);
  });

  it('refuses an invited address that presents no token', async () => {
    const { getAuth } = await import('./auth.repository');
    const email = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;
    await seedInvitation(email);

    const response = await getAuth().handler(signUpRequest(email));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await accountExists(email)).toBe(false);
    // A refused attempt must not burn the invitation the invitee still needs.
    expect(await invitationConsumed(email)).toBe(false);
  });

  it('refuses a token issued for a different address', async () => {
    const { getAuth } = await import('./auth.repository');
    const email = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;
    const other = `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`;
    await seedInvitation(email);
    const foreignToken = await seedInvitation(other);

    const response = await getAuth().handler(
      signUpRequest(email, `void_invitation=${foreignToken}`),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await accountExists(email)).toBe(false);
    // Neither the targeted invitation nor the one the token belongs to is spent.
    expect(await invitationConsumed(email)).toBe(false);
    expect(await invitationConsumed(other)).toBe(false);
  });
});
