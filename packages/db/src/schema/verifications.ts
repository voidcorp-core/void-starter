import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Verifications table — Better-Auth canonical schema (1.6.x). Backs
 * magic-link tokens, email-verification tokens, password-reset tokens,
 * and any other short-lived identifier/value pair the auth library
 * needs to persist with an expiry. The 1.6.x shape includes
 * `updatedAt`; do not regress to the older draft without it.
 */
export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
