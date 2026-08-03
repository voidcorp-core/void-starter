import 'server-only';

import { randomUUID } from 'node:crypto';
import { NotFoundError, ValidationError } from '@repo/core/errors'; // allow-boundary: @repo/core is the always-allowed base of the graph
import { logger } from '@repo/core/logger'; // allow-boundary: @repo/core is the always-allowed base of the graph
import { buildObjectKey, matchesClaimedUpload } from './storage.helper';
import {
  type Document,
  documentIdSchema,
  type ObjectStorage,
  type RequestUploadInput,
  requestUploadSchema,
} from './storage.types';

/**
 * Private-documents rules (ADR 68, ADR 69).
 *
 * The bytes go straight from the browser to R2, so this layer never handles a
 * file. What it owns is every decision around one: who may upload, what they
 * may upload, whether what arrived is what was authorized, who may read it back,
 * and what erasing it means.
 *
 * Both the ledger and the storage port arrive as parameters rather than module
 * imports, for the reason the invitation service does the same: the rules stay
 * testable without Postgres or a network, and a consuming app can substitute
 * either side. `storage.repository.ts` assembles the default ledger and
 * `storage.object-store.ts` the default R2 adapter.
 */

/** How long a signed URL lives. Short: a presigned URL is a bearer token. */
const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60;

/** The ledger operations the rules need. Implemented by `storage.repository.ts`. */
export type DocumentGateway = {
  insertDocument(row: Document): Promise<Document>;
  findDocumentForOwner(id: string, ownerId: string): Promise<Document | undefined>;
  listStoredDocuments(ownerId: string): Promise<Document[]>;
  markDocumentStored(id: string, storedAt: Date): Promise<boolean>;
  deleteDocument(id: string): Promise<boolean>;
};

type OwnerScoped = {
  ownerId: string;
  documentId: string;
  gateway: DocumentGateway;
  storage: ObjectStorage;
};

/**
 * Load a document the caller is entitled to, or fail as if it did not exist.
 *
 * Answering "forbidden" for someone else's document would confirm that the
 * identifier is real. Every refusal here is the same `NotFoundError`, whether
 * the row belongs to another owner or to nobody.
 */
async function requireOwnedDocument(
  gateway: DocumentGateway,
  documentId: string,
  ownerId: string,
): Promise<Document> {
  const id = documentIdSchema.parse(documentId);
  const document = await gateway.findDocumentForOwner(id, ownerId);
  if (!document) {
    throw new NotFoundError('Document not found');
  }
  return document;
}

/**
 * Authorize an upload and hand back a URL the browser can PUT to directly.
 *
 * The row is written first, on purpose. It is what makes the object key exist
 * in the application's world before it exists in the bucket, so a completed
 * upload always has somewhere to be recorded, and an abandoned one is a
 * `pending` row that grants nothing.
 */
export async function requestDocumentUpload(input: {
  ownerId: string;
  input: RequestUploadInput;
  gateway: DocumentGateway;
  storage: ObjectStorage;
}): Promise<{ documentId: string; uploadUrl: string; expiresInSeconds: number }> {
  const parsed = requestUploadSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid upload request');
  }

  const documentId = randomUUID();
  const objectKey = buildObjectKey({
    ownerId: input.ownerId,
    documentId,
    contentType: parsed.data.contentType,
  });

  await input.gateway.insertDocument({
    id: documentId,
    ownerId: input.ownerId,
    objectKey,
    filename: parsed.data.filename,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    status: 'pending',
    createdAt: new Date(),
    storedAt: null,
  });

  // The content type is part of the signature: R2 rejects a PUT that sends a
  // different one, so this is an enforced constraint and not a hint.
  const uploadUrl = await input.storage.signUpload({
    key: objectKey,
    contentType: parsed.data.contentType,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  logger.info({ documentId, ownerId: input.ownerId }, 'document upload authorized');
  return { documentId, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

/**
 * Verify what actually landed in the bucket, then publish it.
 *
 * This is the compensating control for never seeing the bytes. The signature
 * constrained the content type but nothing constrained the length, so an
 * over-sized object is possible and must not survive: it is erased along with
 * its row, rather than left `pending` in a bucket that is paid for.
 */
export async function confirmDocumentUpload(input: OwnerScoped): Promise<Document> {
  const document = await requireOwnedDocument(input.gateway, input.documentId, input.ownerId);
  const actual = await input.storage.head(document.objectKey);

  if (!matchesClaimedUpload(document, actual)) {
    logger.warn(
      {
        documentId: document.id,
        claimedBytes: document.sizeBytes,
        actualBytes: actual?.sizeBytes,
      },
      'document upload did not match what was authorized',
    );
    await input.storage.remove(document.objectKey);
    await input.gateway.deleteDocument(document.id);
    throw new ValidationError('The uploaded file did not match the authorized upload');
  }

  const storedAt = new Date();
  await input.gateway.markDocumentStored(document.id, storedAt);
  return { ...document, status: 'stored', storedAt };
}

/** The owner's documents, newest first. `pending` rows are not documents yet. */
export async function listDocuments(input: {
  ownerId: string;
  gateway: DocumentGateway;
}): Promise<Document[]> {
  return await input.gateway.listStoredDocuments(input.ownerId);
}

/**
 * A short-lived URL for the owner to read their own document.
 *
 * A `pending` document has no readable object, and answering anything but "not
 * found" would leak that the identifier exists.
 */
export async function createDocumentDownloadUrl(input: OwnerScoped): Promise<string> {
  const document = await requireOwnedDocument(input.gateway, input.documentId, input.ownerId);
  if (document.status !== 'stored') {
    throw new NotFoundError('Document not found');
  }

  return await input.storage.signDownload({
    key: document.objectKey,
    filename: document.filename,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
}

/**
 * Erase a document: the object first, then the row (ADR 69).
 *
 * The order is the whole design. Dropping the row first would lose the only
 * pointer to the object, leaving personal data in the bucket that nothing can
 * name -- unerasable in practice, and invisible to any later audit. If the
 * object cannot be erased, the row stays and the caller sees the failure, so
 * the erasure can be retried rather than silently half-applied.
 */
export async function deleteDocument(input: OwnerScoped): Promise<void> {
  const document = await requireOwnedDocument(input.gateway, input.documentId, input.ownerId);

  await input.storage.remove(document.objectKey);
  await input.gateway.deleteDocument(document.id);

  logger.info({ documentId: document.id, ownerId: input.ownerId }, 'document erased');
}
