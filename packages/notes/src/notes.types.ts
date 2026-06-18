import type { Note } from '@repo/db/schema';
import { z } from 'zod';

/**
 * Notes domain schemas and types. Schema and type live together (ADR 09):
 * the type is derived from the schema via `z.infer`, so there is one source
 * of truth for the create-note input contract.
 *
 * `Note` is the persisted row shape, re-exported from `@repo/db/schema` so
 * consumers of `@repo/notes` never reach into `@repo/db` directly.
 */
export const createNoteSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120, 'Title is too long'),
  body: z.string().max(10_000, 'Body is too long').default(''),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export type { Note };
