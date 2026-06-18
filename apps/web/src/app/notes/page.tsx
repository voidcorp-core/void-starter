import { requireAuth } from '@repo/auth';
import { listNotes } from '@repo/notes';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { NoteComposer } from './NoteComposer';

/**
 * Notes page -- the canonical Cache Components demo. `requireAuth()` gates the
 * page and yields the user; `listNotes(user.id)` is a `'use cache'` service
 * read tagged `notes:list:user:<id>`, so it serves from cache until
 * `createNoteAction` invalidates that exact tag. The component just renders
 * what the service returns -- it is unaware of caching or invalidation
 * (docs/CACHING.md section 4).
 */
export default async function NotesPage() {
  const user = await requireAuth();
  const notes = await listNotes(user.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-6">
      <h1 className="text-3xl font-semibold">Notes</h1>
      <NoteComposer />
      <Card>
        <CardHeader>
          <CardTitle>Your notes ({notes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes yet. Create your first one above.
            </p>
          ) : (
            <ul className="space-y-3">
              {notes.map((note) => (
                <li key={note.id} className="border-b border-border pb-3 last:border-b-0">
                  <p className="font-medium">{note.title}</p>
                  {note.body && <p className="text-sm text-muted-foreground">{note.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
