import { createEnv } from '@t3-oss/env-nextjs';

/**
 * Thin wrapper around `@t3-oss/env-nextjs`'s `createEnv` that pins the two
 * defaults we want for every app: `emptyStringAsUndefined: true` (so a
 * blank `.env` value is rejected by `.min(1)` instead of slipping through
 * as `""`) and `skipValidation` driven by `SKIP_ENV_VALIDATION` (so
 * `next build` can run without a full env).
 *
 * The signature is typed as `typeof createEnv` rather than via a custom
 * generic so that t3-oss's full inference (server/client/shared schema
 * dictionaries, `NEXT_PUBLIC_*` prefix enforcement, runtimeEnv shape
 * derived from the schemas) reaches the call site untouched. A custom
 * generic constraint loses inference because the wrapper's bounded
 * generics narrow to their constraint at the inner `createEnv` call.
 */
export const createAppEnv: typeof createEnv = (opts) =>
  createEnv({
    emptyStringAsUndefined: true,
    skipValidation: process.env['SKIP_ENV_VALIDATION'] === 'true',
    ...opts,
  });

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
