import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Sessions table -- Better-Auth canonical schema (1.6.x) including the
 * admin plugin's `impersonatedBy` column. Includes the `token` column
 * required by Better-Auth 1.6.x (unique, used as the session cookie value).
 *
 * Cascade delete on `userId` is intentional: removing a user must drop
 * every outstanding session. Do not switch to set null / restrict.
 *
 * `impersonatedBy` is admin-plugin territory: when an admin impersonates
 * a user, Better-Auth writes the admin's id here so the session can be
 * unwound. `set null` on the admin's deletion preserves the impersonated
 * user's session record (they are still a valid user) and just drops the
 * audit pointer.
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  impersonatedBy: text('impersonated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
