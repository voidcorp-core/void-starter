import { bigint, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Rate-limit table -- backs Better-Auth's built-in rate limiter when it runs
 * with `storage: 'database'` (see packages/auth/src/auth.repository.ts and
 * ADR 33). Better-Auth reads and writes this model directly, so the JS
 * property names must match its expected fields exactly: `id`, `key`, `count`,
 * `lastRequest`. DB column names stay snake_case to match the rest of the
 * schema.
 *
 * Why database storage instead of the default in-memory store: on Vercel
 * serverless (and any horizontally-scaled deploy) an in-memory counter is
 * per-invocation, so it grants every request its own bucket -- no real limit.
 * Persisting counters here makes the limit hold across invocations. This is
 * the same reason `@repo/core/createMemoryRateLimit` is documented dev/test
 * only (docs/SECURITY.md section 6).
 *
 * `lastRequest` is epoch milliseconds (bigint), per Better-Auth's schema.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [index('rate_limits_key_idx').on(table.key)],
);

export type RateLimit = typeof rateLimits.$inferSelect;
export type NewRateLimit = typeof rateLimits.$inferInsert;
