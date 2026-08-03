import { ValidationError } from '@repo/core/errors';
import type { StoredObject } from './storage.types';

/**
 * Pure helpers for the documents domain: no I/O, no side effects
 * (docs/PATTERNS.md).
 */

/**
 * The extension is a function of the content type, not of the name the user
 * typed. A key ending in `.pdf` therefore means "this was authorized as a PDF",
 * which is a fact the server established, rather than a claim it copied.
 */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
};

export function extensionForContentType(contentType: string): string {
  const extension = EXTENSIONS[contentType];
  if (!extension) {
    throw new ValidationError(`No extension is defined for content type ${contentType}`);
  }
  return extension;
}

/** Identifiers that are safe to interpolate into a key without escaping. */
const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Build the immutable object key for a document.
 *
 * Both segments are validated rather than escaped. Escaping would let a
 * surprising identifier through in a mangled form; refusing means an owner id
 * that is not a plain identifier is a bug that surfaces here, at the boundary,
 * instead of becoming an object in someone else's prefix.
 */
export function buildObjectKey(input: {
  ownerId: string;
  documentId: string;
  contentType: string;
}): string {
  if (!KEY_SEGMENT.test(input.ownerId)) {
    throw new ValidationError('Owner identifier is not a valid object key segment');
  }
  if (!KEY_SEGMENT.test(input.documentId)) {
    throw new ValidationError('Document identifier is not a valid object key segment');
  }
  return `documents/${input.ownerId}/${input.documentId}.${extensionForContentType(input.contentType)}`;
}

/**
 * Whether the object the provider actually holds is the one that was
 * authorized.
 *
 * This is the compensating control for uploading straight from the browser: the
 * server never sees the bytes, so it verifies afterwards what it could not
 * verify during. The content type is already constrained by the signature; the
 * size is not constrained by anything until here, which is why an over-sized
 * object must be caught at this point and never published.
 */
export function matchesClaimedUpload(
  claimed: { sizeBytes: number; contentType: string },
  actual: StoredObject | undefined,
): boolean {
  if (!actual) return false;
  if (actual.contentType !== claimed.contentType) return false;
  return actual.sizeBytes === claimed.sizeBytes;
}

/**
 * The S3 API host this bucket actually answers on.
 *
 * A bucket created with a jurisdiction is reachable through the matching host
 * only -- `<account>.eu.r2.cloudflarestorage.com` for an EU one. The default
 * host refuses it with credentials that are perfectly valid, and a browser
 * reports that refusal as a CORS failure, because a host that will not serve
 * the bucket will not describe its CORS policy either. The symptom therefore
 * names the wrong cause, and no amount of CORS configuration answers it.
 *
 * `R2_ENDPOINT` is what the provisioning binds and it already carries the
 * jurisdiction, so it wins outright. Composing from the account id is the
 * fallback for a bucket provisioned outside the factory, and it keeps the
 * jurisdiction explicit rather than assuming there is none.
 */
export function resolveR2Endpoint(input: {
  readonly accountId: string;
  readonly bound?: string | undefined;
  readonly jurisdiction?: string | undefined;
}): string {
  if (input.bound) return input.bound;

  const named = input.jurisdiction && input.jurisdiction !== 'default';
  const prefix = named ? `${input.jurisdiction}.` : '';
  return `https://${input.accountId}.${prefix}r2.cloudflarestorage.com`;
}
