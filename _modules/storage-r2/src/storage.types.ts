import type { Document } from '@repo/db/schema';
import { z } from 'zod';

/**
 * Private-documents domain schemas, plus the storage port the application
 * depends on. Schema and type live together (ADR 09): every type below is
 * derived from its schema via `z.infer`.
 */

/**
 * What the browser is allowed to declare it is uploading.
 *
 * These bounds are not advisory. The content type is baked into the presigned
 * signature, so an upload that sends a different one is rejected by R2 itself
 * with a signature mismatch, and the declared size is checked against the
 * object's real size before the document is ever listed. An allowlist rather
 * than a denylist: a document store that accepts `text/html` or
 * `image/svg+xml` and later serves it back is a stored-XSS vector, and the
 * whole point of this profile is that the bytes are personal data.
 */
export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
] as const;

/** 25 MB. Large enough for real documents, small enough to bound abuse. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const contentTypeSchema = z.enum(ALLOWED_CONTENT_TYPES);

/**
 * The name shown to humans, never used to build the object key.
 *
 * Path separators and NUL are rejected outright: they carry no meaning in a
 * display name and every one of them is a traversal attempt somewhere down the
 * line -- in a `Content-Disposition` header, in an export to a filesystem, in a
 * zip built from these names later.
 */
export const filenameSchema = z
  .string()
  .trim()
  .min(1, 'A filename is required')
  .max(255, 'Filename is too long')
  .regex(/^[^/\\]+$/, 'Filename must not contain a path separator')
  // Kept out of the pattern above: a NUL byte inside a regex literal is
  // itself flagged as suspicious, and the intent reads better spelled out.
  .refine((value) => !value.includes('\u0000'), 'Filename must not contain a null byte');

export const documentSizeSchema = z
  .number()
  .int('Size must be a whole number of bytes')
  .positive('An empty document cannot be uploaded')
  .max(MAX_DOCUMENT_BYTES, 'Document exceeds the maximum size');

export const requestUploadSchema = z.strictObject({
  filename: filenameSchema,
  contentType: contentTypeSchema,
  sizeBytes: documentSizeSchema,
});

export type RequestUploadInput = z.infer<typeof requestUploadSchema>;

export const documentIdSchema = z.uuid('Not a document identifier');

/**
 * An object as the storage provider sees it. Deliberately minimal: the port
 * exposes what the admission and confirmation rules need, and nothing that
 * would tie the service to S3 semantics.
 */
export type StoredObject = {
  sizeBytes: number;
  contentType: string | undefined;
};

/**
 * The storage port (docs/FACTORY.md section 6). Application code depends on
 * this; `storage.object-store.ts` is the only file that knows R2 exists, so a
 * different provider is a new implementation of this type and nothing else.
 *
 * Signing is deliberately part of the port rather than an implementation
 * detail: the whole access model of this profile is "the server decides, then
 * hands out a short-lived URL", so a provider that cannot sign cannot back it.
 */
export type ObjectStorage = {
  /** A URL the browser may PUT exactly this content type to, once, briefly. */
  signUpload(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
  /** A URL the browser may GET, briefly. */
  signDownload(input: { key: string; filename: string; expiresInSeconds: number }): Promise<string>;
  /** What the provider actually holds, or undefined if there is no object. */
  head(key: string): Promise<StoredObject | undefined>;
  /** Erase the object. Succeeds if it is already absent (ADR 69). */
  remove(key: string): Promise<void>;
};

export type { Document };
