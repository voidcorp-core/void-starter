import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Accounts table — Better-Auth canonical schema (1.6.x). Stores OAuth
 * provider links (providerId + accountId) and the email/password
 * credential hash (`password`) for the email-and-password plugin.
 *
 * Token expiry uses separate timestamps for access and refresh tokens
 * (accessTokenExpiresAt, refreshTokenExpiresAt) per 1.6.x. The `scope`
 * column persists the OAuth scope string. Cascade delete on user_id is
 * intentional — removing a user drops every linked OAuth identity.
 */
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
