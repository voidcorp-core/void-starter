import { bigint, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Documents table -- metadata for private objects held in R2 (ADR 68).
 *
 * The bytes never live here. What lives here is everything the application
 * needs to decide who may touch an object: its owner, its immutable key, and
 * what the client claimed it was uploading. Because a presigned PUT goes
 * straight from the browser to R2, this row is written *before* the object
 * exists, which is why `status` is part of the schema rather than derived.
 *
 * A row is `pending` from the moment the upload is authorized until the server
 * has seen the object with its own eyes (a HEAD against R2, comparing the real
 * size and content type to what was claimed). Only then does it become
 * `stored` and start being listed. A `pending` row whose upload never happened
 * is inert: it grants nothing, and its key is already taken so it cannot be
 * reused.
 *
 * `objectKey` is immutable and unique. It is generated server-side and never
 * derived from the filename, so a hostile name cannot escape its prefix or
 * collide with another owner's object. The original name is kept separately,
 * for display only.
 *
 * Cascade delete on `ownerId` drops the rows with the user. It does NOT drop
 * the objects: erasure of the bytes is a storage operation the service performs
 * explicitly (ADR 69), and a foreign key cannot reach into R2.
 */
export const documents = pgTable(
  'documents',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    /** Bytes. `bigint` because a document store outgrows `integer` (2 GB). */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    storedAt: timestamp('stored_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('documents_object_key_idx').on(table.objectKey),
    // Every read is "this owner's documents, newest first"; the index matches
    // that access path rather than the primary key it never queries by.
    index('documents_owner_created_idx').on(table.ownerId, table.createdAt),
  ],
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
