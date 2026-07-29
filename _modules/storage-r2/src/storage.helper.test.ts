import { describe, expect, it } from 'vitest';
import { buildObjectKey, extensionForContentType, matchesClaimedUpload } from './storage.helper';

describe('extensionForContentType', () => {
  it('derives the extension from the content type, never from the filename', () => {
    expect(extensionForContentType('application/pdf')).toBe('pdf');
    expect(extensionForContentType('image/jpeg')).toBe('jpg');
    expect(extensionForContentType('text/plain')).toBe('txt');
  });
});

describe('buildObjectKey', () => {
  const ownerId = 'user_123';
  const documentId = '11111111-2222-4333-8444-555555555555';

  it('scopes the key to the owner and the document identity', () => {
    const key = buildObjectKey({ ownerId, documentId, contentType: 'application/pdf' });

    expect(key).toBe(`documents/${ownerId}/${documentId}.pdf`);
  });

  it('ignores the filename entirely, so a hostile name cannot shape the key', () => {
    // Whatever the user called the file, the key is a function of identity and
    // content type only. There is no argument here to smuggle a path through.
    const key = buildObjectKey({ ownerId, documentId, contentType: 'image/png' });

    expect(key.endsWith('.png')).toBe(true);
    expect(key.split('/')).toHaveLength(3);
  });

  it('rejects an owner id that could escape its prefix', () => {
    expect(() =>
      buildObjectKey({ ownerId: '../root', documentId, contentType: 'image/png' }),
    ).toThrow();
  });
});

describe('matchesClaimedUpload', () => {
  const claimed = { sizeBytes: 1024, contentType: 'application/pdf' };

  it('accepts an object that is exactly what was authorized', () => {
    expect(matchesClaimedUpload(claimed, { sizeBytes: 1024, contentType: 'application/pdf' })).toBe(
      true,
    );
  });

  it('refuses an object larger than the size the signature was issued for', () => {
    // The presigned URL constrains the content type but not the length, so the
    // size claim is only worth what this check makes it worth.
    expect(matchesClaimedUpload(claimed, { sizeBytes: 1025, contentType: 'application/pdf' })).toBe(
      false,
    );
  });

  it('refuses an object whose stored content type is not the authorized one', () => {
    expect(matchesClaimedUpload(claimed, { sizeBytes: 1024, contentType: 'text/html' })).toBe(
      false,
    );
  });

  it('refuses when the provider reports no content type at all', () => {
    // Absent is not "close enough": it means nothing verified what was written.
    expect(matchesClaimedUpload(claimed, { sizeBytes: 1024, contentType: undefined })).toBe(false);
  });

  it('refuses an absent object', () => {
    expect(matchesClaimedUpload(claimed, undefined)).toBe(false);
  });
});
