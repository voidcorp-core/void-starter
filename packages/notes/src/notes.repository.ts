import 'server-only';

import { AppError } from '@repo/core/errors';
import { getDb } from '@repo/db';
import { notes } from '@repo/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { CreateNoteInput, Note } from './notes.types';

/**
 * Notes repository -- pure I/O against the `notes` table. Repositories NEVER
 * cache (docs/CACHING.md section 3): they are the layer the rest of the
 * system trusts to reflect ground truth, so caching here would let a write
 * race a stale read. Caching lives one layer up, in `notes.service.ts`.
 */

export async function listNotesByUser(userId: string): Promise<Note[]> {
  const db = getDb();
  return db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.createdAt));
}

export async function createNote(input: CreateNoteInput & { userId: string }): Promise<Note> {
  const db = getDb();
  const [row] = await db
    .insert(notes)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      title: input.title,
      body: input.body,
    })
    .returning();

  if (!row) {
    throw new AppError({ message: 'Note insert returned no row', code: 'DB_NO_ROW' });
  }
  return row;
}
