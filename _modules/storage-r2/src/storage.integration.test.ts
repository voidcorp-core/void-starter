import { randomUUID } from 'node:crypto';
import { getDb } from '@repo/db';
import { documents, users } from '@repo/db/schema';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultDocumentGateway } from './storage.repository';
import {
  confirmDocumentUpload,
  createDocumentDownloadUrl,
  deleteDocument,
  listDocuments,
  requestDocumentUpload,
} from './storage.service';
import type { ObjectStorage, StoredObject } from './storage.types';

vi.mock('server-only', () => ({}));

/**
 * The documents contract against the real ledger (ADR 66, ADR 68).
 *
 * The starter ships `data.files: none`, so nothing in its own pipeline ever
 * reaches this table: the surfaces are pruned at generation and the contract
 * only runs inside a generated project. That is the exact blind spot ADR 66
 * exists to close, and the one that cost DEV-474 two canary round trips.
 *
 * The distinction from `storage.service.test.ts` is the gateway. That suite
 * drives the rules against an in-memory map, which cannot observe an owner
 * scope that is wrong in SQL, a status filter that never reaches the query, or
 * a row that a cascade quietly removed. This one uses `defaultDocumentGateway`
 * -- real Drizzle, real Postgres -- and substitutes only the object store,
 * because R2 credentials do not exist in CI and the port is what makes that
 * substitution honest.
 */

const databaseUrl = process.env['DATABASE_URL'];

const TEST_EMAIL_PREFIX = 'test-documents-';
const TEST_EMAIL_PATTERN = `${TEST_EMAIL_PREFIX}%@example.com`;

/** An object store that records what it was asked to do, and nothing more. */
function memoryStorage(): ObjectStorage & {
  objects: Map<string, StoredObject>;
  removed: string[];
} {
  const objects = new Map<string, StoredObject>();
  const removed: string[] = [];
  return {
    objects,
    removed,
    signUpload: async ({ key }) => `https://storage.test/${key}?upload`,
    signDownload: async ({ key }) => `https://storage.test/${key}?download`,
    head: async (key) => objects.get(key),
    remove: async (key) => {
      objects.delete(key);
      removed.push(key);
    },
  };
}

async function seedUser(): Promise<string> {
  const id = `user_${randomUUID().replaceAll('-', '')}`;
  await getDb()
    .insert(users)
    .values({
      id,
      name: 'Documents Test',
      email: `${TEST_EMAIL_PREFIX}${randomUUID()}@example.com`,
      emailVerified: true,
    });
  return id;
}

async function sweep(): Promise<void> {
  const db = getDb();
  // Documents cascade with their owner, which this also happens to prove.
  await db.delete(users).where(like(users.email, TEST_EMAIL_PATTERN));
}

const upload = {
  filename: 'contract.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
} as const;

describe.skipIf(!databaseUrl)('documents against the real ledger', () => {
  beforeAll(async () => {
    await sweep();
  });

  afterAll(async () => {
    await sweep();
  });

  it('keeps an authorized upload invisible until it is confirmed', async () => {
    const ownerId = await seedUser();
    const storage = memoryStorage();

    const authorized = await requestDocumentUpload({
      ownerId,
      input: upload,
      gateway: defaultDocumentGateway,
      storage,
    });

    // The row exists, but no read returns it: `pending` is not a document.
    expect(await listDocuments({ ownerId, gateway: defaultDocumentGateway })).toEqual([]);
    await expect(
      createDocumentDownloadUrl({
        ownerId,
        documentId: authorized.documentId,
        gateway: defaultDocumentGateway,
        storage,
      }),
    ).rejects.toThrow();

    storage.objects.set(`documents/${ownerId}/${authorized.documentId}.pdf`, {
      sizeBytes: 2048,
      contentType: 'application/pdf',
    });
    await confirmDocumentUpload({
      ownerId,
      documentId: authorized.documentId,
      gateway: defaultDocumentGateway,
      storage,
    });

    const listed = await listDocuments({ ownerId, gateway: defaultDocumentGateway });
    expect(listed.map((row) => row.id)).toEqual([authorized.documentId]);
  });

  it('scopes every read to the owner in SQL, not after the fact', async () => {
    const ownerId = await seedUser();
    const strangerId = await seedUser();
    const storage = memoryStorage();

    const authorized = await requestDocumentUpload({
      ownerId,
      input: upload,
      gateway: defaultDocumentGateway,
      storage,
    });
    storage.objects.set(`documents/${ownerId}/${authorized.documentId}.pdf`, {
      sizeBytes: 2048,
      contentType: 'application/pdf',
    });
    await confirmDocumentUpload({
      ownerId,
      documentId: authorized.documentId,
      gateway: defaultDocumentGateway,
      storage,
    });

    expect(await listDocuments({ ownerId: strangerId, gateway: defaultDocumentGateway })).toEqual(
      [],
    );
    await expect(
      createDocumentDownloadUrl({
        ownerId: strangerId,
        documentId: authorized.documentId,
        gateway: defaultDocumentGateway,
        storage,
      }),
    ).rejects.toThrow();
    await expect(
      deleteDocument({
        ownerId: strangerId,
        documentId: authorized.documentId,
        gateway: defaultDocumentGateway,
        storage,
      }),
    ).rejects.toThrow();
    // The stranger's failed delete must not have touched the object either.
    expect(storage.removed).toEqual([]);
  });

  it('refuses a second document on an object key that is already taken', async () => {
    // The unique index is the last line of defence behind the key builder. If a
    // key were ever derived from something a caller controls, this is what
    // stops one owner from writing over another's object.
    const ownerId = await seedUser();
    const storage = memoryStorage();
    const first = await requestDocumentUpload({
      ownerId,
      input: upload,
      gateway: defaultDocumentGateway,
      storage,
    });
    const row = await defaultDocumentGateway.findDocumentForOwner(first.documentId, ownerId);

    await expect(
      defaultDocumentGateway.insertDocument({
        ...(row as NonNullable<typeof row>),
        id: randomUUID(),
      }),
    ).rejects.toThrow();
  });

  it('erases the object and the row, and leaves nothing behind with the user', async () => {
    const ownerId = await seedUser();
    const storage = memoryStorage();
    const authorized = await requestDocumentUpload({
      ownerId,
      input: upload,
      gateway: defaultDocumentGateway,
      storage,
    });
    const key = `documents/${ownerId}/${authorized.documentId}.pdf`;
    storage.objects.set(key, { sizeBytes: 2048, contentType: 'application/pdf' });
    await confirmDocumentUpload({
      ownerId,
      documentId: authorized.documentId,
      gateway: defaultDocumentGateway,
      storage,
    });

    await deleteDocument({
      ownerId,
      documentId: authorized.documentId,
      gateway: defaultDocumentGateway,
      storage,
    });

    expect(storage.removed).toEqual([key]);
    expect(storage.objects.has(key)).toBe(false);
    const remaining = await getDb()
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.ownerId, ownerId));
    expect(remaining).toEqual([]);
  });

  it('drops a user’s documents with the user, which the object store cannot see', async () => {
    // The cascade is real and worth pinning, but it is also the reason erasure
    // is a service operation: deleting the user removes every row and leaves
    // every object in the bucket, unnamed and unreachable.
    const ownerId = await seedUser();
    const storage = memoryStorage();
    const authorized = await requestDocumentUpload({
      ownerId,
      input: upload,
      gateway: defaultDocumentGateway,
      storage,
    });
    storage.objects.set(`documents/${ownerId}/${authorized.documentId}.pdf`, {
      sizeBytes: 2048,
      contentType: 'application/pdf',
    });

    await getDb().delete(users).where(eq(users.id, ownerId));

    const remaining = await getDb()
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.ownerId, ownerId));
    expect(remaining).toEqual([]);
    expect(storage.objects.size).toBe(1);
  });
});
