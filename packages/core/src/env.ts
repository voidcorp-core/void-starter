import { createEnv } from '@t3-oss/env-nextjs';
import type { ZodType } from 'zod';

type EnvShape<
  TServer extends Record<string, ZodType>,
  TClient extends Record<`NEXT_PUBLIC_${string}`, ZodType>,
> = {
  server: TServer;
  client: TClient;
  runtimeEnv: Record<string, string | undefined>;
};

export function createAppEnv<
  TServer extends Record<string, ZodType>,
  TClient extends Record<`NEXT_PUBLIC_${string}`, ZodType>,
>({ server, client, runtimeEnv }: EnvShape<TServer, TClient>) {
  return createEnv({
    server,
    client,
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: process.env['SKIP_ENV_VALIDATION'] === 'true',
  });
}

/**
 * Read a required environment variable, throwing a clear error when missing.
 *
 * Use this for env reads that should fail loud at command-time (e.g. config
 * files consumed by CLIs such as drizzle-kit, where the schema-based
 * `createAppEnv` is overkill but a silent default is a footgun).
 *
 * For Next.js runtime env validation prefer {@link createAppEnv}, which adds
 * Zod schema validation on top of presence checks.
 */
export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
