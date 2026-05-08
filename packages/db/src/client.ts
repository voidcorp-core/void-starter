import { createAppEnv } from '@void/core/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema';

type Schema = typeof schema;
type QueryClient = ReturnType<typeof postgres>;
export type Database = ReturnType<typeof drizzle<Schema>>;

declare global {
  var __voidQueryClient: QueryClient | undefined;
  var __voidDb: Database | undefined;
}

let cached: Database | undefined;

function initDb(): Database {
  const env = createAppEnv({
    server: { DATABASE_URL: z.string().url() },
    client: {},
    runtimeEnv: { DATABASE_URL: process.env['DATABASE_URL'] },
  });

  const queryClient = globalThis.__voidQueryClient ?? postgres(env['DATABASE_URL']);
  const db = globalThis.__voidDb ?? drizzle(queryClient, { schema });

  if (process.env['NODE_ENV'] !== 'production') {
    globalThis.__voidQueryClient = queryClient;
    globalThis.__voidDb = db;
  }

  return db;
}

/**
 * Returns the Drizzle client. Lazy + memoized: the postgres-js pool is created
 * on first call, then cached for the lifetime of the process. In non-production
 * the cache is also stashed on `globalThis` so HMR-reloaded modules reuse the
 * same pool instead of leaking a new one per save.
 *
 * This is a Node singleton, not request-scoped. For request-scoped caching
 * layered above (Cache Components, `"use cache"`), see ADR 10.
 *
 * Call once per request handler / Server Action and reuse the returned
 * reference within that scope.
 */
export function getDb(): Database {
  if (cached) return cached;
  cached = globalThis.__voidDb ?? initDb();
  return cached;
}

export type DbClient = Database;
