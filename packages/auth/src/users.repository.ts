import 'server-only';

import { getDb } from '@repo/db';
import { type User, users } from '@repo/db/schema';
import { desc, isNull } from 'drizzle-orm';

/**
 * Repository for user-domain reads that are not part of the Better-Auth session
 * path (which `auth.repository.ts` owns). Pure I/O: hits the DB, never caches
 * (docs/CACHING.md section 3). The `users` table is auth's schema territory, so
 * these reads live in `@repo/auth` rather than spawning a separate package.
 */

/** The slice of a user row an admin list needs -- avoids leaking every column. */
export type AdminUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'createdAt'>;

/**
 * List active (non-soft-deleted) users, newest first. `limit` caps the result
 * set; the admin screen does not paginate yet.
 */
export async function listActiveUsers(limit = 50): Promise<AdminUser[]> {
  const db = getDb();
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(desc(users.createdAt))
    .limit(limit);
}
