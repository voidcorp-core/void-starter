'use client';

import { Button } from '@repo/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createDownloadUrlAction, deleteDocumentAction } from '@/actions/documents.actions';

type DocumentRow = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
};

/**
 * The listing, with the two actions that need a round trip per click.
 *
 * A download URL is minted on demand rather than rendered into the list. It is
 * a bearer token for the object and lives for a minute, so putting one in the
 * HTML would hand out a working link to every document on the page, to whatever
 * the page is later cached or copied into (ADR 68).
 */
export function DocumentList({ documents }: { documents: DocumentRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function download(documentId: string) {
    setError(undefined);
    setBusyId(documentId);
    try {
      const { url } = await createDownloadUrlAction({ documentId });
      window.location.assign(url);
    } catch {
      setError('That document could not be opened.');
    } finally {
      setBusyId(undefined);
    }
  }

  async function erase(documentId: string) {
    setError(undefined);
    setBusyId(documentId);
    try {
      await deleteDocumentAction({ documentId });
      router.refresh();
    } catch {
      // The service keeps the row when the object could not be erased, so the
      // document is still listed and the operation can be retried.
      setError('That document could not be deleted. Try again.');
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-destructive text-sm">{error}</p>}
      <ul className="space-y-3">
        {documents.map((document) => (
          <li
            key={document.id}
            className="flex items-center justify-between gap-4 border-border border-b pb-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{document.filename}</p>
              <p className="text-muted-foreground text-sm">
                {formatBytes(document.sizeBytes)} - {new Date(document.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => download(document.id)}
                disabled={busyId === document.id}
              >
                Download
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => erase(document.id)}
                disabled={busyId === document.id}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
