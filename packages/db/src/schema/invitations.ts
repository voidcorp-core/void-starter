import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Invitations table -- the access ledger for `auth.access_mode: invite_only`
 * (see docs/FACTORY.md section 7 and ADR 63).
 *
 * The manifest declares who may hold an account; this table is what makes the
 * declaration true. Better-Auth's user-create hook reads it before every
 * account creation and refuses any address it does not list, which closes the
 * three paths that would otherwise create a user: `signUpEmail`, a magic link,
 * and a social provider callback.
 *
 * `email` is stored already normalized (trimmed, lowercased) because it is the
 * join key with the incoming sign-up address, and a case difference must not
 * open a second door. The partial unique index allows exactly one *pending*
 * invitation per address while still permitting a fresh one after the previous
 * was consumed or revoked -- a plain unique index would make re-inviting a
 * revoked address impossible.
 *
 * `tokenHash` stores a SHA-256 digest, never the token itself: the token is
 * mailed to the invitee and is a bearer credential, so a database leak must not
 * hand over usable invitation links. Consumption is recorded in `usedAt` by the
 * post-creation hook rather than the pre-creation one, so a failed account
 * creation does not burn the invitation.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    invitedBy: text('invited_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_pending_email_idx')
      .on(table.email)
      .where(sql`${table.usedAt} is null and ${table.revokedAt} is null`),
  ],
);

export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
