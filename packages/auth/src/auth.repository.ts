import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAppEnv } from '@void/core/env';
import { logger } from '@void/core/logger';
import { getDb } from '@void/db';
import * as schema from '@void/db/schema';
import { betterAuth } from 'better-auth';
import { admin, magicLink } from 'better-auth/plugins';
import { z } from 'zod';

/**
 * Better-Auth wiring for `@void/auth`.
 *
 * This module is server-only. The `getAuth()` factory constructs the
 * canonical Better-Auth instance on first call, then caches it for the
 * lifetime of the process (lazy + memoized, same pattern as `getDb()`).
 * Env validation is deferred to the first `getAuth()` invocation so that
 * `next build` can complete without auth env vars being set — they are only
 * required at runtime (dev server start or first request in production).
 *
 * Schema mapping: our Drizzle tables use plural names (`users`,
 * `sessions`, ...) while Better-Auth's canonical models are singular
 * (`user`, `session`, ...). The `schema` option of `drizzleAdapter`
 * remaps each model to the corresponding Drizzle table object, which
 * is the pattern documented at
 * https://www.better-auth.com/docs/adapters/drizzle#modifying-table-names
 *
 * Plugins:
 *   - `admin` — role-based admin endpoints. We standardize on a single
 *     `'admin'` role; new roles can be added later without a schema
 *     migration because `users.role` is `text` not `enum`.
 *   - `magicLink` — passwordless email links. The `sendMagicLink`
 *     callback here is a development stub that logs the URL via the
 *     project logger. The production sender lands in Phase D as the
 *     `_modules/email-resend` integration; swap the body of this
 *     callback when that module is wired in.
 *
 * Note on `tsconfig.json`: this package overrides `declaration: false`
 * because Better-Auth 1.6.x ships its own nested `zod@4` while the
 * monorepo standardizes on `zod@3`. The inferred return type of
 * `betterAuth(...)` therefore traverses
 * `better-auth/node_modules/zod/v4/core`, which is a non-portable path
 * for `.d.ts` emit (TS2742). Workspace packages consume `@void/auth`
 * directly from TypeScript source via `package.json#exports`, so no
 * `.d.ts` files are needed. Revisit when the project migrates to
 * `zod@4` (Phase D backlog) and the install dedupes to a single copy.
 */

function initAuth() {
  const env = createAppEnv({
    server: {
      BETTER_AUTH_SECRET: z.string().min(32),
      BETTER_AUTH_URL: z.string().url(),
      GOOGLE_CLIENT_ID: z.string().min(1),
      GOOGLE_CLIENT_SECRET: z.string().min(1),
    },
    client: {},
    runtimeEnv: {
      BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
      BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
      GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
      GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
    },
  });

  return betterAuth({
    secret: env['BETTER_AUTH_SECRET'],
    baseURL: env['BETTER_AUTH_URL'],
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    socialProviders: {
      google: {
        clientId: env['GOOGLE_CLIENT_ID'],
        clientSecret: env['GOOGLE_CLIENT_SECRET'],
      },
    },
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
      magicLink({
        sendMagicLink: async ({ email, token, url }) => {
          logger.warn(
            { email, url, token },
            'magic link (dev only - install @void/email module for prod)',
          );
        },
      }),
    ],
  });
}

let cached: ReturnType<typeof initAuth> | undefined;

/**
 * Returns the Better-Auth instance. Lazy + memoized: the instance is created
 * on first call (env validation + DB adapter init), then cached for the
 * lifetime of the process. Never evaluated at module load time, so `next build`
 * can complete without auth env vars being present.
 */
export function getAuth() {
  if (cached) return cached;
  cached = initAuth();
  return cached;
}

export type Auth = ReturnType<typeof getAuth>;
