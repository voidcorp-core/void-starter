'use server';

import { defineAction } from '@repo/auth';
import {
  confirmDocumentUpload,
  createDocumentDownloadUrl,
  defaultDocumentGateway,
  deleteDocument,
  r2ObjectStorage,
  requestDocumentUpload,
  requestUploadSchema,
} from '@repo/storage-r2';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

/**
 * The private-documents surface (ADR 68, ADR 69).
 *
 * These actions exist only in a project generated with
 * `data.files: cloudflare-r2-eu`; the factory prunes this file otherwise.
 *
 * Every one of them is `auth: 'required'` and passes `ctx.user.id` as the owner.
 * That argument is the entire access model: the service scopes every query by
 * it, so a document identifier guessed or copied from elsewhere resolves to
 * nothing. No action here takes an owner from its input.
 *
 * The bytes never pass through this layer. `requestUpload` hands back a URL the
 * browser PUTs to directly, and `confirmUpload` is what makes that upload real
 * -- until it runs, the document does not exist as far as every read is
 * concerned.
 */

const documentIdInput = z.object({ documentId: z.uuid() });

/**
 * Authorize an upload and return the URL to PUT to.
 *
 * The size travels in the request because the server has to commit to it before
 * the upload happens; it is checked against the object's real size at
 * confirmation, which is where a lie is caught.
 */
export const requestUploadAction = defineAction({
  schema: requestUploadSchema,
  auth: 'required',
  handler: async (input, ctx) => {
    return await requestDocumentUpload({
      ownerId: ctx.user.id,
      input,
      gateway: defaultDocumentGateway,
      storage: r2ObjectStorage,
    });
  },
});

/** Verify what landed in the bucket, then publish the document. */
export const confirmUploadAction = defineAction({
  schema: documentIdInput,
  auth: 'required',
  handler: async (input, ctx) => {
    const document = await confirmDocumentUpload({
      ownerId: ctx.user.id,
      documentId: input.documentId,
      gateway: defaultDocumentGateway,
      storage: r2ObjectStorage,
    });

    revalidatePath('/documents');

    return { documentId: document.id, filename: document.filename };
  },
});

/**
 * Mint a short-lived download URL.
 *
 * The URL is a bearer token for one object, which is why it lives for a minute
 * and is minted per click rather than embedded in the listing.
 */
export const createDownloadUrlAction = defineAction({
  schema: documentIdInput,
  auth: 'required',
  handler: async (input, ctx) => {
    const url = await createDocumentDownloadUrl({
      ownerId: ctx.user.id,
      documentId: input.documentId,
      gateway: defaultDocumentGateway,
      storage: r2ObjectStorage,
    });

    return { url };
  },
});

/** Erase the object and its row (ADR 69). */
export const deleteDocumentAction = defineAction({
  schema: documentIdInput,
  auth: 'required',
  handler: async (input, ctx) => {
    await deleteDocument({
      ownerId: ctx.user.id,
      documentId: input.documentId,
      gateway: defaultDocumentGateway,
      storage: r2ObjectStorage,
    });

    revalidatePath('/documents');

    return { deleted: true };
  },
});
