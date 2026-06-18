'use server';

import { defineFormAction } from '@repo/auth';
import { createNote, createNoteSchema } from '@repo/notes';
import { updateTag } from 'next/cache';

/**
 * Create a note for the current user, then invalidate that user's cached
 * notes list so the next read repopulates (docs/CACHING.md: writes invalidate
 * at the action layer). The tag matches the user-scoped `cacheTag` declared in
 * `@repo/notes` `listNotes`. defineFormAction wires FormData parsing, auth
 * resolution and error mapping (ADR 21); `auth: 'required'` guarantees a user.
 */
export const createNoteAction = defineFormAction({
  schema: createNoteSchema,
  auth: 'required',
  handler: async (input, ctx) => {
    const userId = ctx.user.id;
    const note = await createNote({ userId, title: input.title, body: input.body });
    updateTag(`notes:list:user:${userId}`);
    return { id: note.id };
  },
});
