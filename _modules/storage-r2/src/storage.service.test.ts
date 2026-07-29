import { NotFoundError, ValidationError } from '@repo/core/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmDocumentUpload,
  createDocumentDownloadUrl,
  deleteDocument,
  listDocuments,
  requestDocumentUpload,
} from './storage.service';
import type { Document, ObjectStorage, StoredObject } from './storage.types';

vi.mock('server-only', () => ({}));

const OWNER = 'user_owner';
const STRANGER = 'user_stranger';

function documentRow(overrides: Partial<Document> = {}): Document {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    ownerId: OWNER,
    objectKey: `documents/${OWNER}/11111111-2222-4333-8444-555555555555.pdf`,
    filename: 'contract.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
    status: 'stored',
    createdAt: new Date('2026-07-29T10:00:00Z'),
    storedAt: new Date('2026-07-29T10:00:05Z'),
    ...overrides,
  };
}

/** An in-memory stand-in for the ledger, so the rules are tested without Postgres. */
function fakeGateway(rows: Document[] = []) {
  const store = new Map(rows.map((row) => [row.id, row]));
  return {
    store,
    insertDocument: vi.fn(async (row: Document) => {
      store.set(row.id, row);
      return row;
    }),
    findDocumentForOwner: vi.fn(async (id: string, ownerId: string) => {
      const row = store.get(id);
      return row && row.ownerId === ownerId ? row : undefined;
    }),
    listStoredDocuments: vi.fn(async (ownerId: string) =>
      [...store.values()].filter((row) => row.ownerId === ownerId && row.status === 'stored'),
    ),
    markDocumentStored: vi.fn(async (id: string, storedAt: Date) => {
      const row = store.get(id);
      if (row) store.set(id, { ...row, status: 'stored', storedAt });
      return true;
    }),
    deleteDocument: vi.fn(async (id: string) => store.delete(id)),
  };
}

function fakeStorage(object?: StoredObject): ObjectStorage & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    signUpload: vi.fn(async ({ key }) => `https://r2.test/${key}?sig=put`),
    signDownload: vi.fn(async ({ key }) => `https://r2.test/${key}?sig=get`),
    head: vi.fn(async () => object),
    remove: vi.fn(async (key: string) => {
      removed.push(key);
    }),
  };
}

describe('requestDocumentUpload', () => {
  let gateway: ReturnType<typeof fakeGateway>;

  beforeEach(() => {
    gateway = fakeGateway();
  });

  const input = {
    filename: 'contract.pdf',
    contentType: 'application/pdf',
    sizeBytes: 1024,
  } as const;

  it('records the document as pending before handing out the URL', async () => {
    const storage = fakeStorage();

    const result = await requestDocumentUpload({ ownerId: OWNER, input, gateway, storage });

    const row = gateway.store.get(result.documentId);
    expect(row?.status).toBe('pending');
    expect(row?.ownerId).toBe(OWNER);
    expect(result.uploadUrl).toContain('sig=put');
  });

  it('signs the exact content type, so a different one cannot be uploaded', async () => {
    const storage = fakeStorage();

    await requestDocumentUpload({ ownerId: OWNER, input, gateway, storage });

    expect(storage.signUpload).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
  });

  it('refuses a content type outside the allowlist', async () => {
    const storage = fakeStorage();

    await expect(
      requestDocumentUpload({
        ownerId: OWNER,
        input: { ...input, contentType: 'text/html' as never },
        gateway,
        storage,
      }),
    ).rejects.toThrow(ValidationError);
    expect(storage.signUpload).not.toHaveBeenCalled();
  });

  it('refuses a document beyond the size limit before signing anything', async () => {
    const storage = fakeStorage();

    await expect(
      requestDocumentUpload({
        ownerId: OWNER,
        input: { ...input, sizeBytes: 26 * 1024 * 1024 },
        gateway,
        storage,
      }),
    ).rejects.toThrow(ValidationError);
    expect(storage.signUpload).not.toHaveBeenCalled();
  });
});

describe('confirmDocumentUpload', () => {
  const pending = documentRow({ status: 'pending', storedAt: null });

  it('publishes the document once the stored object matches what was authorized', async () => {
    const gateway = fakeGateway([pending]);
    const storage = fakeStorage({ sizeBytes: 1024, contentType: 'application/pdf' });

    await confirmDocumentUpload({ ownerId: OWNER, documentId: pending.id, gateway, storage });

    expect(gateway.store.get(pending.id)?.status).toBe('stored');
  });

  it('erases the object and the row when the upload is not what was authorized', async () => {
    // Nothing over-sized may survive confirmation: leaving it would keep an
    // object nobody vouched for, in a bucket that is paid for and is meant to
    // hold only what the rules allowed.
    const gateway = fakeGateway([pending]);
    const storage = fakeStorage({ sizeBytes: 99_999, contentType: 'application/pdf' });

    await expect(
      confirmDocumentUpload({ ownerId: OWNER, documentId: pending.id, gateway, storage }),
    ).rejects.toThrow(ValidationError);

    expect(storage.removed).toEqual([pending.objectKey]);
    expect(gateway.store.has(pending.id)).toBe(false);
  });

  it('refuses to confirm a document belonging to someone else', async () => {
    const gateway = fakeGateway([pending]);
    const storage = fakeStorage({ sizeBytes: 1024, contentType: 'application/pdf' });

    await expect(
      confirmDocumentUpload({ ownerId: STRANGER, documentId: pending.id, gateway, storage }),
    ).rejects.toThrow(NotFoundError);
    expect(gateway.store.get(pending.id)?.status).toBe('pending');
  });
});

describe('createDocumentDownloadUrl', () => {
  it('signs a short-lived URL for the owner', async () => {
    const row = documentRow();
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();

    const url = await createDocumentDownloadUrl({
      ownerId: OWNER,
      documentId: row.id,
      gateway,
      storage,
    });

    expect(url).toContain('sig=get');
    expect(storage.signDownload).toHaveBeenCalledWith(
      expect.objectContaining({ key: row.objectKey, filename: row.filename }),
    );
  });

  it('answers a stranger exactly as it answers an unknown identifier', async () => {
    // Distinguishing "not yours" from "does not exist" tells the caller which
    // identifiers are real, which is the same oracle the invitation endpoints
    // are careful not to be.
    const row = documentRow();
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();

    const stranger = createDocumentDownloadUrl({
      ownerId: STRANGER,
      documentId: row.id,
      gateway,
      storage,
    });
    const missing = createDocumentDownloadUrl({
      ownerId: OWNER,
      documentId: '99999999-2222-4333-8444-555555555555',
      gateway,
      storage,
    });

    await expect(stranger).rejects.toThrow(NotFoundError);
    await expect(missing).rejects.toThrow(NotFoundError);
    expect(storage.signDownload).not.toHaveBeenCalled();
  });

  it('refuses a document whose upload was never confirmed', async () => {
    const row = documentRow({ status: 'pending', storedAt: null });
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();

    await expect(
      createDocumentDownloadUrl({ ownerId: OWNER, documentId: row.id, gateway, storage }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('listDocuments', () => {
  it('returns only the owner’s stored documents', async () => {
    const mine = documentRow();
    const alsoMine = documentRow({ id: '22222222-2222-4333-8444-555555555555', status: 'pending' });
    const theirs = documentRow({ id: '33333333-2222-4333-8444-555555555555', ownerId: STRANGER });
    const gateway = fakeGateway([mine, alsoMine, theirs]);

    const documents = await listDocuments({ ownerId: OWNER, gateway });

    expect(documents.map((row) => row.id)).toEqual([mine.id]);
  });
});

describe('deleteDocument', () => {
  it('erases the object before dropping the row', async () => {
    // Order matters: dropping the row first would lose the only pointer to the
    // object, leaving personal data in the bucket that nothing can name.
    const row = documentRow();
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();

    await deleteDocument({ ownerId: OWNER, documentId: row.id, gateway, storage });

    expect(storage.removed).toEqual([row.objectKey]);
    expect(gateway.store.has(row.id)).toBe(false);
  });

  it('keeps the row when the object could not be erased', async () => {
    // A row whose object still exists is recoverable: it can be retried. A
    // deleted row whose object survived is not, and an erasure request that
    // silently half-succeeded is the worst outcome of the three.
    const row = documentRow();
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();
    storage.remove = vi.fn(async () => {
      throw new Error('R2 unavailable');
    });

    await expect(
      deleteDocument({ ownerId: OWNER, documentId: row.id, gateway, storage }),
    ).rejects.toThrow();
    expect(gateway.store.has(row.id)).toBe(true);
  });

  it('refuses to delete a document belonging to someone else', async () => {
    const row = documentRow();
    const gateway = fakeGateway([row]);
    const storage = fakeStorage();

    await expect(
      deleteDocument({ ownerId: STRANGER, documentId: row.id, gateway, storage }),
    ).rejects.toThrow(NotFoundError);
    expect(storage.removed).toEqual([]);
    expect(gateway.store.has(row.id)).toBe(true);
  });
});
