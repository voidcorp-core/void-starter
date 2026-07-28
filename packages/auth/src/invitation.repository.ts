import 'server-only';

import { getDb } from '@repo/db'; // allow-boundary: docs/ARCHITECTURE.md:112 declares the @repo/auth -> @repo/db edge
import { type Invitation, invitations } from '@repo/db/schema'; // allow-boundary: same declared edge
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Repository for the invite-only access ledger (ADR 63).
 *
 * Pure I/O against `invitations`: every function here takes already normalized
 * inputs and returns rows, with no policy decision of its own. Whether a row
 * admits a sign-up is decided by `resolveInvitationState` in the helper layer
 * and orchestrated by `invitation.service.ts`, so the rule stays testable
 * without a database.
 *
 * Callers must pass an email that already went through
 * `normalizeInvitationEmail`. Normalizing here instead would hide the
 * requirement from the type system without removing it, since the stored column
 * is normalized at write time.
 */

/**
 * Returns the newest invitation for an address, whatever its state.
 *
 * Deliberately not filtered to pending rows: the caller needs to tell a revoked
 * invitation from an absent one for logging and for the admin screen, and the
 * partial unique index already guarantees at most one pending row per address.
 */
export async function findLatestInvitationByEmail(
  normalizedEmail: string,
): Promise<Invitation | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.email, normalizedEmail))
    .orderBy(desc(invitations.createdAt))
    .limit(1);
  return row;
}

/** Inserts a new invitation row and returns it. */
export async function insertInvitation(row: {
  id: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
  invitedBy: string;
}): Promise<Invitation> {
  const db = getDb();
  const [inserted] = await db.insert(invitations).values(row).returning();
  if (!inserted) {
    throw new Error('Invitation insert returned no row');
  }
  return inserted;
}

/**
 * Marks the pending invitation for an address as consumed.
 *
 * The `used_at is null` guard makes the update idempotent under concurrency:
 * two racing account creations for one address produce one successful update
 * and one no-op, and the caller learns which it was from the boolean. Returns
 * false when there was nothing pending to consume.
 */
export async function markInvitationUsed(normalizedEmail: string, usedAt: Date): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(invitations)
    .set({ usedAt })
    .where(
      and(
        eq(invitations.email, normalizedEmail),
        isNull(invitations.usedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  return updated.length > 0;
}

/**
 * Revokes the pending invitation for an address. Same idempotency guard as
 * consumption: revoking twice is a no-op that reports false the second time,
 * and an already consumed invitation is never retroactively revoked.
 */
export async function revokeInvitation(normalizedEmail: string, revokedAt: Date): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(invitations)
    .set({ revokedAt })
    .where(
      and(
        eq(invitations.email, normalizedEmail),
        isNull(invitations.usedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  return updated.length > 0;
}

/** Lists invitations newest first for the admin screen. Never exposes `tokenHash`. */
export async function listInvitations(
  limit = 50,
): Promise<
  Array<Pick<Invitation, 'id' | 'email' | 'expiresAt' | 'usedAt' | 'revokedAt' | 'createdAt'>>
> {
  const db = getDb();
  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      usedAt: invitations.usedAt,
      revokedAt: invitations.revokedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .orderBy(desc(invitations.createdAt))
    .limit(limit);
}
