'use client';

// The dedicated subpath, never the `@repo/storage-r2` barrel: the barrel
// re-exports the R2 adapter and the repository, both of which carry
// `server-only`, so reaching it from a client component fails the build.
// `storage.types.ts` has no runtime imports of its own.
import { ALLOWED_CONTENT_TYPES, MAX_DOCUMENT_BYTES } from '@repo/storage-r2/types';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { confirmUploadAction, requestUploadAction } from '@/actions/documents.actions';

/**
 * Three-step upload, which is what direct-to-R2 costs on the client (ADR 68).
 *
 * A plain `<form action={...}>` cannot express it: the bytes never go to the
 * server, so between authorizing and confirming there is a PUT to a third party
 * that no Server Action can perform on the browser's behalf. Hence a submit
 * handler rather than `useActionState`.
 *
 * The `Content-Type` sent on the PUT must be exactly the one that was
 * authorized. It is part of the signature, so R2 answers 403 to anything else
 * -- which is the point, and also the most likely thing to break if this file is
 * ever edited carelessly.
 */
export function DocumentUploader() {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem('file');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;

    if (!file) {
      setError('Choose a file first.');
      return;
    }

    setError(undefined);
    setBusy(true);
    try {
      const authorized = await requestUploadAction({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const stored = await fetch(authorized.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!stored.ok) {
        throw new Error(`The storage provider refused the upload (${stored.status})`);
      }

      // Until this returns, the document is `pending` and invisible to every
      // read. The server checks here what it could not check during the upload.
      await confirmUploadAction({ documentId: authorized.documentId });

      form.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={upload} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept={ALLOWED_CONTENT_TYPES.join(',')}
              disabled={busy}
            />
            <p className="text-muted-foreground text-sm">
              PDF, JPEG, PNG, WebP or plain text, up to{' '}
              {Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB.
            </p>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
