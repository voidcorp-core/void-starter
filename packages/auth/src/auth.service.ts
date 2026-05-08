import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { headers } from 'next/headers';
import { auth } from './auth.repository';
import { type Role, type SessionUser, sessionUserSchema } from './auth.types';

/**
 * Public server-side auth API for `@void/auth`.
 *
 * Consumed by Server Actions, route handlers, and any other server context
 * inside `apps/web`. Browser code uses `auth.client.ts` (the Better-Auth
 * fetch client) instead. The functions here read the session from request
 * headers via `next/headers`, so they only work inside a Next.js request
 * scope (Server Actions, route handlers, RSC, middleware bridging).
 *
 * Errors are thrown, never returned. The `defineAction` middleware in
 * `@void/core/server-action` maps `AppError` subclasses to API responses
 * with the appropriate HTTP status; let exceptions propagate.
 */

/**
 * Returns the authenticated user, or `null` if no session exists.
 *
 * Defensive parsing: if Better-Auth returns a session shape that does not
 * match `sessionUserSchema` (for example a future field we have not yet
 * mapped), we treat it as anonymous rather than crashing. This trades
 * a small amount of strictness for forward compatibility with Better-Auth
 * minor releases.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const parsed = sessionUserSchema.safeParse(session.user);
  return parsed.success ? parsed.data : null;
}

/**
 * Returns the authenticated user, or throws `UnauthorizedError` (401).
 * Use at the top of any Server Action that requires a logged-in user.
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Authentication required');
  return user;
}

/**
 * Returns the authenticated user when their role matches `role`, or when
 * they are `'admin'` (admin always satisfies any required role — standard
 * role-hierarchy pattern). Throws `UnauthorizedError` (401) when no session
 * exists, or `ForbiddenError` (403) when the role check fails.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== role && user.role !== 'admin') {
    throw new ForbiddenError(`Role "${role}" required`);
  }
  return user;
}

/**
 * Server-side sign-in entry points. Most apps drive sign-in from the
 * browser via `auth.client.ts`; these wrappers exist for Server Actions
 * and route handlers that need to bypass the client. The `google` helper
 * is a thin wrapper over `signInSocial` to give a clean, named entry
 * point per provider and to satisfy `exactOptionalPropertyTypes` (the
 * underlying `callbackURL` field is omitted entirely when undefined,
 * rather than being passed as `undefined`).
 */
export const signIn = {
  email: auth.api.signInEmail,
  google: (callbackURL?: string) =>
    auth.api.signInSocial({
      body: { provider: 'google', ...(callbackURL ? { callbackURL } : {}) },
    }),
  magicLink: auth.api.signInMagicLink,
};

/**
 * Sign the current session out. Returns Better-Auth's structured response
 * (the cookie clearing happens via the response object Better-Auth
 * attaches to the request context).
 */
export async function signOut() {
  return auth.api.signOut({ headers: await headers() });
}
