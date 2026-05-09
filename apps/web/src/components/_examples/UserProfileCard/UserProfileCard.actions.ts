'use server';

import { defineFormAction } from '@void/auth';
import { getDb } from '@void/db';
import { users } from '@void/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export const updateProfileAction = defineFormAction({
  schema: z.object({ name: z.string().min(1, 'Name is required').max(100) }),
  auth: 'required',
  handler: async (input, ctx) => {
    const db = getDb();
    await db
      .update(users)
      .set({ name: input.name })
      .where(eq(users.id, ctx.user?.id ?? ''));
    return { name: input.name };
  },
});
