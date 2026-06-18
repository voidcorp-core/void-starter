'use client';

import type { ActionState } from '@repo/auth';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { useActionState } from 'react';
import { createNoteAction } from '@/actions/notes.actions';

const initialState: ActionState<{ id: string }> = { ok: false, fieldErrors: {} };

/**
 * Client composer wired to `createNoteAction` via React 19 `useActionState`.
 * On success the action calls `updateTag`, so the server-rendered notes list
 * repopulates on the next navigation/refresh. Not exported from a barrel;
 * the notes page imports it directly.
 */
export function NoteComposer() {
  const [state, formAction, isPending] = useActionState(createNoteAction, initialState);
  const titleErrors = !state.ok ? (state.fieldErrors?.['title'] ?? []) : [];
  const bodyErrors = !state.ok ? (state.fieldErrors?.['body'] ?? []) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>New note</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              placeholder="Title"
              invalid={titleErrors.length > 0}
              disabled={isPending}
            />
            {titleErrors.length > 0 && <p className="text-sm text-destructive">{titleErrors[0]}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body">Body</Label>
            <Input
              id="body"
              name="body"
              placeholder="Optional"
              invalid={bodyErrors.length > 0}
              disabled={isPending}
            />
            {bodyErrors.length > 0 && <p className="text-sm text-destructive">{bodyErrors[0]}</p>}
          </div>
          {!state.ok && state.formError && (
            <p className="text-sm text-destructive">{state.formError.message}</p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>
              {isPending ? 'Saving...' : 'Add note'}
            </Button>
            {state.ok && (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                Added
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
