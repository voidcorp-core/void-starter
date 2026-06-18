import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';
import * as repository from './notes.repository';
import type { CreateNoteInput, Note } from './notes.types';

/**
 * Notes service -- the layer that owns caching for the notes domain
 * (docs/CACHING.md). Reads declare `'use cache'` + a USER-SCOPED `cacheTag`
 * so a write can invalidate exactly one user's list without touching anyone
 * else's (the cross-tenant rule in CACHING.md section 6). The matching
 * `updateTag(\`notes:list:user:\${userId}\`)` lives in the Server Action
 * (apps/web/src/actions/notes.actions.ts), never here -- invalidation is an
 * action-layer concern.
 *
 * This file declares `'use cache'` per-read function; it must NOT carry a
 * file-level `'use server'` directive (they are different scopes; CACHING.md
 * section 6).
 */

export async function listNotes(userId: string): Promise<Note[]> {
  'use cache';
  cacheTag(`notes:list:user:${userId}`);
  cacheLife('minutes');
  return repository.listNotesByUser(userId);
}

/**
 * Create a note. A thin passthrough to the repository with NO cache directive:
 * writes are never cached (CACHING.md section 6). The caller (the action)
 * invalidates the user's `notes:list` tag after this resolves.
 */
export async function createNote(input: CreateNoteInput & { userId: string }): Promise<Note> {
  return repository.createNote(input);
}
