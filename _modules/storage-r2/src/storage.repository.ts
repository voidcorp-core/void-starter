import 'server-only';

import { AppError } from '@repo/core/errors'; // allow-boundary: @repo/core is the always-allowed base of the graph
import { getDb } from '@repo/db';
import { documents } from '@repo/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { DocumentGateway } from './storage.service';
import type { Document } from './storage.types';

/**
 * Documents repository -- pure I/O against the `documents` ledger.
 * Repositories NEVER cache (docs/CACHING.md section 3).
 *
 * Every read is scoped by owner in the query itself rather than filtered after
 * the fact, so a row belonging to someone else never reaches the service in the
 * first place.
 */

export async function insertDocument(row: Document): Promise<Document> {
  const [inserted] = await getDb().insert(documents).values(row).returning();
  if (!inserted) {
    throw new AppError({
      message: 'Failed to record the document',
      code: 'DOCUMENT_INSERT_FAILED',
    });
  }
  return inserted;
}

export async function findDocumentForOwner(
  id: string,
  ownerId: string,
): Promise<Document | undefined> {
  const [row] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerId, ownerId)))
    .limit(1);
  return row;
}

export async function listStoredDocuments(ownerId: string): Promise<Document[]> {
  return await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.ownerId, ownerId), eq(documents.status, 'stored')))
    .orderBy(desc(documents.createdAt));
}

export async function markDocumentStored(id: string, storedAt: Date): Promise<boolean> {
  const rows = await getDb()
    .update(documents)
    .set({ status: 'stored', storedAt })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  return rows.length > 0;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(documents)
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  return rows.length > 0;
}

/**
 * The gateway the application uses by default. Assembled here because this is
 * the one place that knows both the port shape and the concrete Drizzle calls.
 */
export const defaultDocumentGateway: DocumentGateway = {
  insertDocument,
  findDocumentForOwner,
  listStoredDocuments,
  markDocumentStored,
  deleteDocument,
};
