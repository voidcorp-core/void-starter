import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Notes table -- the starter's first real domain entity (Void extension, not
 * Better-Auth). It exists to demonstrate the Cache Components read/write
 * pattern end to end (see @repo/notes and docs/CACHING.md): a user-scoped
 * cached read at the service layer, invalidated by `updateTag` at the action
 * layer on every write.
 *
 * Cascade delete on `userId` is intentional: removing a user drops their
 * notes. `body` defaults to '' so a title-only note is valid.
 */
export const notes = pgTable('notes', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
