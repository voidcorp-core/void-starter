'use server';

import { defineAction, signOut } from '@repo/auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';

/**
 * Sign the current user out, then redirect home.
 *
 * Wrapped in `defineAction` rather than written as a bare `'use server'`
 * function (see docs/PATTERNS.md "Server Actions"): the wrapper gives auth
 * resolution + structured logging for free. `auth: 'required'` rejects an
 * unauthenticated caller with `UnauthorizedError`; the empty schema documents
 * "no input". `redirect('/')` throws NEXT_REDIRECT, which the wrapper
 * re-throws so Next.js performs the navigation.
 */
export const signOutAction = defineAction({
  schema: z.object({}),
  auth: 'required',
  handler: async () => {
    await signOut();
    redirect('/');
  },
});
