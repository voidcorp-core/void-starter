import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ObjectStorage } from './storage.types';

vi.mock('server-only', () => ({}));

/**
 * The R2 adapter signs offline: a presigned URL is computed locally from the
 * credentials, so what the signature covers is observable without a network
 * call. The credentials below are inert placeholders.
 *
 * This is the guarantee the in-memory `ObjectStorage` of the service and
 * integration suites cannot observe: a stand-in never fails on a signature,
 * so only the real adapter's URL says whether R2 will refuse a mismatch.
 */

let storage: ObjectStorage;

beforeAll(async () => {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'access-key-id');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret-access-key');
  vi.stubEnv('R2_BUCKET_NAME', 'bucket');
  ({ r2ObjectStorage: storage } = await import('./storage.object-store'));
});

function signedHeadersOf(url: string): string[] {
  return (new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
}

describe('r2ObjectStorage.signUpload', () => {
  it('signs the content type, so R2 refuses a PUT that declares another one', async () => {
    const url = await storage.signUpload({
      key: 'documents/owner/doc.pdf',
      contentType: 'application/pdf',
      expiresInSeconds: 60,
    });

    expect(signedHeadersOf(url)).toContain('content-type');
  });
});
