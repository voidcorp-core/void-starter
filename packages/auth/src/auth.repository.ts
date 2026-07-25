import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAppEnv } from '@repo/core/env';
import { AppError } from '@repo/core/errors';
import { logger } from '@repo/core/logger';
import { getDb } from '@repo/db';
import * as schema from '@repo/db/schema';
import { betterAuth } from 'better-auth';
import { admin, magicLink } from 'better-auth/plugins';
import { z } from 'zod';

/**
 * Better-Auth wiring for `@repo/auth`.
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
 * because the inferred return type of `betterAuth(...)` references
 * better-auth's internal type aliases (`InferSignUpEmailCtx`,
 * `InferUserUpdateCtx`, ...) defined under
 * `better-auth/dist/client/path-to-object.mjs`, a path TypeScript
 * refuses to synthesize into a portable `.d.ts` (TS2883). Workspace
 * packages consume `@repo/auth` directly from TypeScript source via
 * `package.json#exports`, so no `.d.ts` files are needed. Revisit when
 * better-auth re-exports its `Auth<TOptions>` shape without those
 * internal references.
 */

/**
 * Builds the Better-Auth `socialProviders` entry for Google, but ONLY when
 * both credentials are present. Returns `undefined` otherwise so the auth
 * instance comes up with email/password + magic link alone -- Google is
 * opt-in (see README and docs/AUTH.md). Pure and synchronous so the
 * "Google is optional" contract is unit-testable without constructing the
 * full Better-Auth instance (which needs a DB).
 */
export function resolveGoogleProvider(env: {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
}): { google: { clientId: string; clientSecret: string } } | undefined {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return undefined;
  return { google: { clientId, clientSecret } };
}

function initAuth() {
  const env = createAppEnv({
    server: {
      BETTER_AUTH_SECRET: z.string().min(32),
      BETTER_AUTH_URL: z.url(),
      // Optional: Google OAuth is opt-in. When unset, email/password and
      // magic link still work. Both must be present to enable the provider.
      GOOGLE_CLIENT_ID: z.string().min(1).optional(),
      GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    },
    client: {},
    runtimeEnv: {
      BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
      BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
      GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
      GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
    },
  });

  const googleProvider = resolveGoogleProvider(env);

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
        rateLimit: schema.rateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        // Match the magic-link development contract below: local projects are
        // usable without a mail vendor, but production must wire a real sender
        // instead of leaking a verification URL into logs.
        if (process.env['NODE_ENV'] === 'production') {
          throw new AppError({
            message:
              'Verification email sender is not configured. Wire @repo/email (Resend) before accepting production sign-ups.',
            code: 'VERIFICATION_EMAIL_NOT_CONFIGURED',
            status: 500,
          });
        }
        logger.warn(
          { email: user.email, url },
          'verification email (dev only - install @repo/email module for prod)',
        );
      },
    },
    // Persist rate-limit counters in Postgres so the limit holds across
    // serverless invocations -- the default in-memory store is per-invocation
    // and grants every request its own bucket on Vercel (ADR 33; same reason
    // @repo/core/createMemoryRateLimit is dev/test only). Better-Auth enables
    // rate limiting in production by default; customRules tighten the
    // brute-force-prone endpoints below the global 100/60s default.
    rateLimit: {
      storage: 'database',
      modelName: 'rateLimit',
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/magic-link': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 10 },
        '/forget-password': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
    // Conditional spread (not `socialProviders: undefined`) keeps
    // exactOptionalPropertyTypes happy when Google is not configured.
    ...(googleProvider ? { socialProviders: googleProvider } : {}),
    plugins: [
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          // Production guard: the dev stub never delivers a real email. Fail
          // loudly so a misconfigured deploy cannot silently swallow magic-link
          // logins. Wire _modules/email-resend and replace this body before go-live.
          if (process.env['NODE_ENV'] === 'production') {
            throw new AppError({
              message:
                'Magic link email sender is not configured. Wire @repo/email (Resend) before enabling magic link in production.',
              code: 'MAGIC_LINK_NOT_CONFIGURED',
              status: 500,
            });
          }
          // Dev only: log the URL (which already embeds the token) so the
          // developer can follow the link. The raw token is not logged separately.
          logger.warn(
            { email, url },
            'magic link (dev only - install @repo/email module for prod)',
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
