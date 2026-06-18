import 'server-only';

import { type AdminUser, listActiveUsers } from './users.repository';

/**
 * User-domain service. Composes the repository for callers (Server Components,
 * route handlers) so they never touch the DB directly (the layering rule in
 * CLAUDE.md / docs/ARCHITECTURE.md).
 *
 * `listUsers` is deliberately NOT cached. User rows are written by Better-Auth
 * (sign-up, role changes, bans) which the app does not wrap in a Server Action,
 * so there is no `updateTag()` site to invalidate a cached list -- a cache here
 * would serve stale data after every sign-up. Caching is only correct for reads
 * you can invalidate (docs/CACHING.md). Authorization is the caller's job; the
 * admin page gates with `requireRole('admin')`.
 */
export async function listUsers(): Promise<AdminUser[]> {
  return listActiveUsers();
}
