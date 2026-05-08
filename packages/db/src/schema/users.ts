import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Users table — Better-Auth canonical schema (1.6.x) plus two extensions:
 *   - `role` (admin-plugin convention, kept as text not enum so new roles
 *      do not require a schema migration)
 *   - `deletedAt` for soft-delete (Better-Auth does not manage this column;
 *      service-layer queries must filter `WHERE deleted_at IS NULL`).
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
