import 'server-only';

import { ForbiddenError, UnauthorizedError } from '@void/core/errors';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { getAuth } from './auth.repository';
import { type Role, type SessionUser, sessionUserSchema } from './auth.types';

/**
 * Public server-side auth API for `@void/auth`.
 *
 * Consumed by React Server Components, route handlers, and middleware
 * inside `apps/web`. Browser code uses `auth.client.ts` (the Better-Auth
 * fetch client) instead, including all sign-in flows (`authClient.signIn.*`).
 * The functions here read the session from request headers via
 * `next/headers`, so they only work inside a Next.js request scope.
 *
 * Errors are thrown, never returned. The `defineAction` middleware in
 * `@void/core/server-action` maps `AppError` subclasses to API responses
 * with the appropriate HTTP status; let exceptions propagate.
 *
 * Sign-in is intentionally not exposed here. Server-side sign-in requires
 * manual cookie passthrough (`returnHeaders: true` + Set-Cookie forwarding)
 * which is a niche need; if a future flow needs it (e.g. token redemption),
 * add a single typed helper deliberately rather than re-exposing
 * `auth.api.signIn*` as a half-shaped surface.
 */

/**
 * Read the current session user. Use in:
 *   - React Server Components (page.tsx, layout.tsx) for conditional rendering
 *   - Route handlers (route.ts) for non-action endpoints
 *
 * For Server Actions, prefer `defineAction({ auth: 'required', ... })` from
 * `@void/auth` — it wires auth into the action's typed context so the handler
 * receives `ctx.user` directly, without re-reading headers.
 *
 * Defensive parsing: if Better-Auth returns a session shape that does not
 * match `sessionUserSchema` (for example a future field we have not yet
 * mapped), we treat it as anonymous rather than crashing. This trades
 * a small amount of strictness for forward compatibility with Better-Auth
 * minor releases.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // `connection()` signals to Next.js cacheComponents / dynamicIO that this
  // render requires a real request context and must not be statically prerendered.
  await connection();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const parsed = sessionUserSchema.safeParse(session.user);
  return parsed.success ? parsed.data : null;
}

/**
 * Require an authenticated user; throw `UnauthorizedError` (401) if not.
 *
 * Use in Server Components and route handlers. For Server Actions prefer
 * `defineAction({ auth: 'required', ... })` from `@void/auth`, which raises
 * the same error class but wires `ctx.user` into the handler.
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Authentication required');
  return user;
}

/**
 * Require a specific role; throw `UnauthorizedError` (401) without a session
 * or `ForbiddenError` (403) if the role check fails. Admin always satisfies
 * any role check (standard role-hierarchy pattern).
 *
 * Use in Server Components and route handlers. For Server Actions prefer
 * `defineAction({ auth: 'role:admin', ... })` from `@void/auth`.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.role !== role && user.role !== 'admin') {
    throw new ForbiddenError(`Role "${role}" required`);
  }
  return user;
}

/**
 * Sign the current session out. Returns Better-Auth's structured response
 * (the cookie clearing happens via the response object Better-Auth
 * attaches to the request context). Server Actions legitimately need this
 * (e.g. a `<form action={signOutAction}>` button), so it stays here even
 * though sign-in does not — the symmetry breaks intentionally.
 */
export async function signOut() {
  return getAuth().api.signOut({ headers: await headers() });
}
