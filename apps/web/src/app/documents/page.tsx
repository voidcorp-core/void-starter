import { requireAuth } from '@repo/auth';
import { defaultDocumentGateway, listDocuments } from '@repo/storage-r2';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { DocumentList } from './DocumentList';
import { DocumentUploader } from './DocumentUploader';

/**
 * Private documents (ADR 68).
 *
 * Present only in a project generated with `data.files: cloudflare-r2-eu`; the
 * factory prunes this route otherwise. `requireAuth()` gates the page and yields
 * the owner whose documents are listed -- the service takes that id and scopes
 * every query by it, so this page can only ever render its own user's rows.
 *
 * Deliberately not cached, unlike the notes page. A listing here is a listing of
 * personal documents whose only correct staleness is none: a document erased on
 * one device must not keep appearing on another.
 */
export default async function DocumentsPage() {
  const user = await requireAuth();
  const documents = await listDocuments({ ownerId: user.id, gateway: defaultDocumentGateway });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-16">
      <header className="space-y-2">
        <h1 className="font-semibold text-3xl">Documents</h1>
        <p className="text-muted-foreground">
          Files are stored privately in the EU. Nobody but you can read them, and a download link is
          minted for a single minute when you ask for one.
        </p>
      </header>

      <DocumentUploader />

      <Card>
        <CardHeader>
          <CardTitle>Your documents ({documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No document yet. Upload your first one above.
            </p>
          ) : (
            <DocumentList
              documents={documents.map((document) => ({
                id: document.id,
                filename: document.filename,
                sizeBytes: document.sizeBytes,
                createdAt: document.createdAt.toISOString(),
              }))}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
