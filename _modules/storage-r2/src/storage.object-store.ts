import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createAppEnv } from '@repo/core/env'; // allow-boundary: @repo/core is the always-allowed base of the graph
import { z } from 'zod';
import { resolveR2Endpoint } from './storage.helper';
import type { ObjectStorage, StoredObject } from './storage.types';

/**
 * The R2 adapter -- the only file in the codebase that knows the storage
 * provider by name. Everything else depends on the `ObjectStorage` port
 * (docs/FACTORY.md section 6), so replacing R2 means writing another file like
 * this one and nothing more.
 *
 * R2 speaks the S3 API, so this is the AWS SDK pointed at Cloudflare's
 * endpoint, per Cloudflare's own documentation:
 * https://developers.cloudflare.com/r2/api/s3/presigned-urls/
 *
 * Two facts from that page shape the code below. `region` must be the literal
 * `auto` -- the SDK requires a region and R2 ignores it. And presigned URLs
 * only work against the S3 API hostname, never a custom domain, which is why
 * the endpoint is built from the account id rather than from any project URL.
 *
 * A third fact was learned the expensive way, and lives in `resolveR2Endpoint`:
 * the hostname has to carry the bucket's jurisdiction. Composing it without one
 * points every presigned URL at a host that refuses this bucket, and the
 * browser reports that as a CORS failure -- which sends you configuring CORS
 * rules that were never the problem.
 */

let cached: S3Client | undefined;

function getClient(): S3Client {
  if (cached) return cached;

  const env = createAppEnv({
    server: {
      CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
      R2_ACCESS_KEY_ID: z.string().min(1),
      R2_SECRET_ACCESS_KEY: z.string().min(1),
      R2_BUCKET_NAME: z.string().min(1),
      // Both optional: a bucket in the default jurisdiction has neither, and
      // the factory binds the endpoint whenever it provisioned the bucket.
      R2_ENDPOINT: z.string().url().optional(),
      R2_JURISDICTION: z.string().optional(),
    },
    client: {},
    runtimeEnv: {
      CLOUDFLARE_ACCOUNT_ID: process.env['CLOUDFLARE_ACCOUNT_ID'],
      R2_ACCESS_KEY_ID: process.env['R2_ACCESS_KEY_ID'],
      R2_SECRET_ACCESS_KEY: process.env['R2_SECRET_ACCESS_KEY'],
      R2_BUCKET_NAME: process.env['R2_BUCKET_NAME'],
      R2_ENDPOINT: process.env['R2_ENDPOINT'],
      R2_JURISDICTION: process.env['R2_JURISDICTION'],
    },
  });

  cached = new S3Client({
    region: 'auto',
    endpoint: resolveR2Endpoint({
      accountId: env['CLOUDFLARE_ACCOUNT_ID'],
      bound: env['R2_ENDPOINT'],
      jurisdiction: env['R2_JURISDICTION'],
    }),
    credentials: {
      accessKeyId: env['R2_ACCESS_KEY_ID'],
      secretAccessKey: env['R2_SECRET_ACCESS_KEY'],
    },
  });
  return cached;
}

function bucket(): string {
  const name = process.env['R2_BUCKET_NAME'];
  if (!name) throw new Error('Missing required env var: R2_BUCKET_NAME');
  return name;
}

export const r2ObjectStorage: ObjectStorage = {
  async signUpload({ key, contentType, expiresInSeconds }) {
    // `ContentType` enters the signature, so R2 answers 403 to a PUT that
    // declares anything else. This is what makes the allowlist enforceable on
    // an upload the server never sees.
    return await getSignedUrl(
      getClient(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  },

  async signDownload({ key, filename, expiresInSeconds }) {
    return await getSignedUrl(
      getClient(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        // The stored object carries no name; the browser gets the original one
        // back at download time. Quoted, because a filename may contain a
        // comma or a space and an unquoted value would truncate the header.
        ResponseContentDisposition: `attachment; filename="${filename.replaceAll('"', '')}"`,
      }),
      { expiresIn: expiresInSeconds },
    );
  },

  async head(key): Promise<StoredObject | undefined> {
    try {
      const response = await getClient().send(
        new HeadObjectCommand({ Bucket: bucket(), Key: key }),
      );
      return { sizeBytes: response.ContentLength ?? 0, contentType: response.ContentType };
    } catch (error) {
      // An absent object is an answer, not a failure: it is the normal state
      // of an authorized upload the browser never completed.
      if (isNotFound(error)) return undefined;
      throw error;
    }
  },

  async remove(key) {
    // S3 delete is idempotent and answers 204 for an object that was never
    // there, which is the behaviour erasure wants: retrying must converge.
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
