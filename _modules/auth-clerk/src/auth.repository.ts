import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';

/**
 * Clerk-backed scaffold for the `@void/auth` repository surface.
 *
 * This file is a SCAFFOLD, not a runtime drop-in. The starter ships
 * Better-Auth in `packages/auth/src/auth.repository.ts` (per
 * `docs/DECISIONS.md` entry 02). Swapping providers requires the README's
 * full procedure; copying this file alone will not produce a working app.
 *
 * Types are defined locally so this scaffold stands alone for review.
 * After you copy this file into `packages/auth/src/auth.repository.ts`, drop
 * the local `Role` / `SessionUser` declarations and import them from
 * `./auth.types` instead — the shapes match by design.
 *
 * Conceptual mapping vs Better-Auth:
 *
 *   Better-Auth:                      Clerk:
 *   `getAuth()` factory               `auth()` reads request headers,
 *   returns an instance with          returns `{ userId, sessionId, ... }`.
 *   `.api.getSession({ headers })`    `currentUser()` returns the full
 *                                     `User` object (one extra round-trip).
 *
 * Clerk's session model differs from Better-Auth's in three load-bearing ways:
 *
 *   1. Clerk reads cookies via `next/headers` internally. There is no
 *      explicit `headers` argument to forward — `auth()` and `currentUser()`
 *      pull them from the request scope. They throw outside a request scope,
 *      so no module-load-time evaluation is possible (matches Better-Auth's
 *      `getCurrentUser` posture; only the call signature differs).
 *
 *   2. Clerk owns the role taxonomy through `publicMetadata.role` (per-user)
 *      or via organization roles. The starter's `Role` is `'user' | 'admin'`
 *      (`packages/auth/src/auth.types.ts`); a real swap requires writing
 *      `publicMetadata.role` from the Clerk dashboard or via
 *      `clerkClient.users.updateUser()` after sign-up. The mapping below is
 *      a placeholder — adapt it to whatever role field your Clerk project
 *      commits to.
 *
 *   3. Clerk does not expose `signOut()` from `@clerk/nextjs/server` for
 *      Server Actions; sign-out goes through the `<UserButton>` UI or the
 *      `useClerk().signOut()` browser hook. A `signOut` Server Action
 *      requires a custom route that clears Clerk's session cookie. The
 *      `signOut` export from `auth.service.ts` becomes a no-op or is
 *      removed in the swap.
 *
 * The exported `getCurrentUser()` mimics the shape of
 * `@void/auth/service`'s `getCurrentUser()` — same return type
 * (`SessionUser | null`), same defensive posture — so the service layer
 * keeps working unchanged after the swap. `requireAuth()` and
 * `requireRole()` from `auth.service.ts` continue to work because they
 * only depend on this signature.
 */

type Role = 'user' | 'admin';

type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
};

const DEFAULT_ROLE: Role = 'user';

/**
 * Read the current session user via Clerk. Returns `null` when:
 *
 *   - the request is unauthenticated (`auth().userId` is null), OR
 *   - Clerk returns a `User` without a primary email address — we treat
 *     the malformed shape as anonymous rather than throwing, mirroring
 *     `@void/auth`'s defensive parse with `sessionUserSchema.safeParse`.
 *
 * Role resolution: this scaffold reads `publicMetadata.role` and falls
 * back to `'user'`. Adapt the predicate if your project commits to
 * organization-based roles or a different metadata key.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await currentUser();
  if (!user) return null;

  const primaryEmail = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  )?.emailAddress;
  if (!primaryEmail) return null;

  const metadataRole = user.publicMetadata?.['role'];
  const role: Role = metadataRole === 'admin' ? 'admin' : DEFAULT_ROLE;

  return {
    id: user.id,
    email: primaryEmail,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    image: user.imageUrl ?? null,
    role,
  };
}
