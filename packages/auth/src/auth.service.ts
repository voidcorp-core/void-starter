import 'server-only';

import { ForbiddenError } from '@repo/core/errors';
import { logger } from '@repo/core/logger';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getAuth } from './auth.repository';
import { type Role, type SessionUser, sessionUserSchema } from './auth.types';

/**
 * Public server-side auth API for `@repo/auth`.
 *
 * Consumed by React Server Components, route handlers, and middleware
 * inside `apps/web`. Browser code uses `auth.client.ts` (the Better-Auth
 * fetch client) instead, including all sign-in flows (`authClient.signIn.*`).
 * The functions here read the session from request headers via
 * `next/headers`, so they only work inside a Next.js request scope.
 *
 * Errors are thrown, never returned. The `defineAction` middleware in
 * `@repo/core/server-action` maps `AppError` subclasses to API responses
 * with the appropriate HTTP status; let exceptions propagate.
 *
 * Sign-in is intentionally not exposed here. Server-side sign-in requires
 * manual cookie passthrough (`returnHeaders: true` + Set-Cookie forwarding)
 * which is a niche need; if a future flow needs it (e.g. token redemption),
 * add a single typed helper deliberately rather than re-exposing
 * `auth.api.signIn*` as a half-shaped surface.
 */

/**
 * Marker that gates auth env validation. When `BETTER_AUTH_SECRET` is unset we
 * treat the runtime as "auth not configured" and `getCurrentUser()` short-circuits
 * to `null` instead of crashing. This preserves the starter contract: a fresh
 * clone with no `.env.local` can still render unauthenticated marketing pages,
 * and protected routes correctly send anonymous visitors to sign-in
 * (`requireAuth()` redirects with a `?callbackURL`).
 *
 * The first time auth is called without configuration we emit a single warning
 * so a misconfigured production deploy still surfaces the issue in logs.
 */
let warnedAboutMissingAuthConfig = false;

function isAuthConfigured(): boolean {
  if (process.env['BETTER_AUTH_SECRET']) return true;
  if (!warnedAboutMissingAuthConfig) {
    warnedAboutMissingAuthConfig = true;
    logger.warn(
      'BETTER_AUTH_SECRET is not set; treating all requests as unauthenticated. Set it in .env.local to enable auth.',
    );
  }
  return false;
}

/**
 * Read the current session user. Use in:
 *   - React Server Components (page.tsx, layout.tsx) for conditional rendering
 *   - Route handlers (route.ts) for non-action endpoints
 *
 * For Server Actions, prefer `defineAction({ auth: 'required', ... })` from
 * `@repo/auth` — it wires auth into the action's typed context so the handler
 * receives `ctx.user` directly, without re-reading headers.
 *
 * Defensive parsing: if Better-Auth returns a session shape that does not
 * match `sessionUserSchema` (for example a future field we have not yet
 * mapped), we treat it as anonymous rather than crashing. This trades
 * a small amount of strictness for forward compatibility with Better-Auth
 * minor releases.
 *
 * Resilience: when `BETTER_AUTH_SECRET` is unset we return `null` rather than
 * throw. This keeps the starter usable in unconfigured environments (fresh
 * clone, smoke E2E without `.env.local`) while still failing-loud at the
 * sign-in path, where the user explicitly opts in to auth.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // `connection()` signals to Next.js cacheComponents / dynamicIO that this
  // render requires a real request context and must not be statically prerendered.
  await connection();
  if (!isAuthConfigured()) return null;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  const parsed = sessionUserSchema.safeParse(session.user);
  return parsed.success ? parsed.data : null;
}

const SIGN_IN_PATH = '/sign-in';

/**
 * Build the sign-in redirect target for an unauthenticated PAGE request,
 * preserving where the user was headed via `?callbackURL`. `pathname` comes
 * from the proxy's `x-pathname` header (our own value, already same-origin).
 * Auth routes are never appended as a callback, which would loop or bounce the
 * user back to a sign-in/sign-up screen after authenticating. Pure + exported
 * so the routing rule is unit-testable without a request scope.
 */
export function buildSignInRedirect(pathname: string | undefined): string {
  if (!pathname || pathname.startsWith('/sign-') || pathname.startsWith('/reset-password')) {
    return SIGN_IN_PATH;
  }
  return `${SIGN_IN_PATH}?callbackURL=${encodeURIComponent(pathname)}`;
}

/**
 * Require an authenticated user at a PAGE boundary. When there is no session,
 * `redirect()` to the sign-in screen (carrying a `?callbackURL` so the user
 * returns to where they were headed) rather than throwing -- a generic error
 * boundary is the wrong UX for "you need to sign in" (ADR 35). Returns the
 * user otherwise.
 *
 * Use in Server Components and route handlers. For Server Actions prefer
 * `defineAction({ auth: 'required', ... })` from `@repo/auth`, which instead
 * throws `UnauthorizedError` (mapped to a form/RPC error) -- redirecting from
 * inside an action is the wrong layer.
 */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    const requestHeaders = await headers();
    redirect(buildSignInRedirect(requestHeaders.get('x-pathname') ?? undefined));
  }
  return user;
}

/**
 * Require a specific role at a PAGE boundary. No session redirects to sign-in
 * (via `requireAuth`); an authenticated user who lacks the role gets a
 * `ForbiddenError` (403) -- a genuine authorization failure, distinct from
 * "not signed in", so it surfaces through the error boundary rather than a
 * redirect. Admin always satisfies any role check (standard role hierarchy).
 *
 * Use in Server Components and route handlers. For Server Actions prefer
 * `defineAction({ auth: 'role:admin', ... })` from `@repo/auth`.
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
