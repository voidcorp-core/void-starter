import { createAppEnv } from '@void/core/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';
import * as schema from './schema';

const env = createAppEnv({
  server: { DATABASE_URL: z.string().url() },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env['DATABASE_URL'],
  },
});

const queryClient = postgres(env['DATABASE_URL'], { max: 10 });

export const db = drizzle(queryClient, { schema });
export type DbClient = typeof db;
