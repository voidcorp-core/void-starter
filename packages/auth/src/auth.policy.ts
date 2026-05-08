import type { SessionUser } from './auth.types';

/**
 * Authorization policies for `@void/auth`.
 *
 * Policies are pure, synchronous predicates over a `SessionUser | null`.
 * They centralize "can this user do X" decisions so that UI guards (hide
 * a nav link), Server Action guards (`if (!canX) throw new ForbiddenError`),
 * and route handler guards all consult the same source of truth.
 *
 * Keep policies pure. If you need IO (e.g. to look up a workspace
 * membership), put it in `auth.service.ts` and let the service compose
 * the IO + policy. This file should never grow async functions.
 *
 * `canAccessAdminPanel` is the canonical example shipped with the starter;
 * apps grow their own policies (`canEditPost`, `canInviteMember`, ...) on
 * top of it.
 */
export function canAccessAdminPanel(user: SessionUser | null): boolean {
  return user?.role === 'admin';
}
