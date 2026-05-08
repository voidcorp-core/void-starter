import { createAppEnv } from '@void/core/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema';

/**
 * Lazy, hot-reload-safe Drizzle client.
 *
 * Design notes:
 * - Lazy: env validation and pool construction run on first `db.*` access,
 *   not on module evaluation. Build-time tools that may statically import
 *   `@void/db/client` (knip, type-check) do not require `DATABASE_URL`.
 * - `globalThis` cache: Next.js dev-mode hot reload re-evaluates modules on
 *   every save; without this cache we'd open (and leak) a fresh postgres
 *   pool per change. Production keeps a single per-process instance.
 * - No explicit `{ max }`: the Neon pooled endpoint manages connection
 *   limits server-side and postgres-js defaults are correct for serverless.
 * - Zod URL validation via `createAppEnv` catches typos (missing scheme,
 *   `localhost` without `postgres://`) at first access.
 *
 * Idiomatic 2026 Drizzle + Next.js 16 / RSC singleton pattern.
 */

type Schema = typeof schema;
type QueryClient = ReturnType<typeof postgres>;
type Database = ReturnType<typeof drizzle<Schema>>;

const globalForDb = globalThis as typeof globalThis & {
  __voidQueryClient?: QueryClient;
  __voidDb?: Database;
};

const isProduction = process.env['NODE_ENV'] === 'production';

function initDb(): Database {
  const env = createAppEnv({
    server: { DATABASE_URL: z.string().url() },
    client: {},
    runtimeEnv: { DATABASE_URL: process.env['DATABASE_URL'] },
  });

  const queryClient = globalForDb.__voidQueryClient ?? postgres(env['DATABASE_URL']);
  if (!isProduction) globalForDb.__voidQueryClient = queryClient;

  const instance = drizzle(queryClient, { schema });
  if (!isProduction) globalForDb.__voidDb = instance;

  return instance;
}

/**
 * Drizzle client. Connection pool opens lazily on first `db.*` access and is
 * cached on `globalThis` in development to survive Next.js hot reload.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const instance = globalForDb.__voidDb ?? initDb();
    return Reflect.get(instance, prop, receiver);
  },
});

export type DbClient = Database;
