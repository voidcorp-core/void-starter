import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Users table -- Better-Auth canonical schema (1.6.x) including the admin
 * plugin's ban controls, plus a Void soft-delete extension.
 *
 *   - `role` (admin-plugin convention, kept as text not enum so new roles
 *      do not require a schema migration)
 *   - `banned` / `banReason` / `banExpires` (admin-plugin ban controls; the
 *      plugin writes `banned: false` on every signUpEmail and reads the trio
 *      on every session check, so the columns MUST exist or Better-Auth
 *      throws "field does not exist in the user Drizzle schema" at user
 *      creation time)
 *   - `deletedAt` for soft-delete (Void extension; Better-Auth does not
 *      manage this column; service-layer queries must filter
 *      `WHERE deleted_at IS NULL`).
 *
 * Drizzle plural table name `users` is remapped to Better-Auth's singular
 * `user` model via `modelName` in the adapter config (Phase B Task B13).
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name'),
  image: text('image'),
  role: text('role').notNull().default('user'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
