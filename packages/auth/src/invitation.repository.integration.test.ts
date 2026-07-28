import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Integration test for the invite-only ledger against a real Postgres (ADR 63).
 *
 * Everything asserted here is a property of the database, not of TypeScript:
 * the partial unique index that allows one pending invitation per address while
 * still permitting a fresh one after revocation, and the `used_at is null`
 * guards that make consumption and revocation idempotent under a race. The unit
 * suites inject a fake gateway and therefore cannot observe any of it -- they
 * prove the rule, this proves the storage the rule relies on.
 *
 * Same gating as the sibling suites: skipped without `DATABASE_URL`, which the
 * CI job provides after applying the migrations. The starter ships without a
 * live database on purpose.
 */

const databaseUrl = process.env['DATABASE_URL'];

describe.skipIf(!databaseUrl)('invitation ledger integration', () => {
  const issued: string[] = [];

  async function repository() {
    return import('./invitation.repository');
  }

  function freshEmail(label: string): string {
    const email = `invite-int-${label}-${randomUUID()}@example.com`;
    issued.push(email);
    return email;
  }

  async function insert(email: string, overrides: { expiresAt?: Date } = {}) {
    const { insertInvitation } = await repository();
    return insertInvitation({
      id: randomUUID(),
      email,
      tokenHash: randomUUID(),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000),
      invitedBy: 'integration-admin',
    });
  }

  afterAll(async () => {
    const { getDb } = await import('@repo/db');
    const { invitations } = await import('@repo/db/schema');
    const { inArray } = await import('drizzle-orm');
    if (issued.length > 0) {
      await getDb().delete(invitations).where(inArray(invitations.email, issued));
    }
  });

  it('round-trips an invitation and finds it by its normalized address', async () => {
    const { findLatestInvitationByEmail } = await repository();
    const email = freshEmail('roundtrip');

    const inserted = await insert(email);
    const found = await findLatestInvitationByEmail(email);

    expect(found?.id).toBe(inserted.id);
    expect(found?.usedAt).toBeNull();
    expect(found?.revokedAt).toBeNull();
  });

  it('refuses a second pending invitation for the same address', async () => {
    const email = freshEmail('duplicate');
    await insert(email);

    await expect(insert(email)).rejects.toThrow();
  });

  it('allows a fresh invitation once the previous one was revoked', async () => {
    const { revokeInvitation } = await repository();
    const email = freshEmail('reinvite');
    await insert(email);

    expect(await revokeInvitation(email, new Date())).toBe(true);

    // The partial index only covers pending rows, so this must succeed. A plain
    // unique index on `email` would make re-inviting a revoked address impossible.
    await expect(insert(email)).resolves.toMatchObject({ email });
  });

  it('allows a fresh invitation once the previous one was consumed', async () => {
    const { markInvitationUsed } = await repository();
    const email = freshEmail('reconsume');
    await insert(email);

    expect(await markInvitationUsed(email, new Date())).toBe(true);
    await expect(insert(email)).resolves.toMatchObject({ email });
  });

  it('consumes at most once, so a replayed account creation cannot burn a second row', async () => {
    const { markInvitationUsed } = await repository();
    const email = freshEmail('consume-once');
    await insert(email);

    expect(await markInvitationUsed(email, new Date())).toBe(true);
    expect(await markInvitationUsed(email, new Date())).toBe(false);
  });

  it('never revokes an already consumed invitation', async () => {
    const { markInvitationUsed, revokeInvitation } = await repository();
    const email = freshEmail('consumed-then-revoked');
    await insert(email);

    expect(await markInvitationUsed(email, new Date())).toBe(true);
    expect(await revokeInvitation(email, new Date())).toBe(false);
  });

  it('reports a no-op when revoking an address that holds nothing pending', async () => {
    const { revokeInvitation } = await repository();

    expect(await revokeInvitation(freshEmail('never-invited'), new Date())).toBe(false);
  });

  it('returns the newest row for an address that was invited more than once', async () => {
    const { findLatestInvitationByEmail, revokeInvitation } = await repository();
    const email = freshEmail('newest');

    await insert(email);
    await revokeInvitation(email, new Date());
    const second = await insert(email);

    expect((await findLatestInvitationByEmail(email))?.id).toBe(second.id);
  });

  it('never exposes the token digest to the admin listing', async () => {
    const { listInvitations } = await repository();
    const email = freshEmail('listing');
    await insert(email);

    const rows = await listInvitations();
    const row = rows.find((candidate) => candidate.email === email);

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('tokenHash');
  });
});
