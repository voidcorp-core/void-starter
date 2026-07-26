import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { createAppEnv } from '@repo/core/env';
import { AppError } from '@repo/core/errors';
import { logger } from '@repo/core/logger';
import { getDb } from '@repo/db';
import * as schema from '@repo/db/schema';
import {
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '@repo/email-resend/server';
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
 *   - `magicLink` — passwordless email links. Verification, password-reset
 *     and magic-link callbacks all use the selected Resend adapter in
 *     production. Local development falls back to explicit URL logging only
 *     when neither Resend variable is configured.
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

type AuthEmail =
  | { kind: 'verification'; email: string; url: string }
  | { kind: 'password-reset'; email: string; url: string }
  | { kind: 'magic-link'; email: string; url: string };

/**
 * Deliver an authentication email through Resend when configured. A local
 * project with neither variable retains the deliberate console-link workflow;
 * partial configuration always fails, and production never logs a credential
 * URL. Exported for contract tests without constructing Better Auth or a DB.
 */
export async function deliverAuthEmail(
  input: AuthEmail,
  environment: Record<string, string | undefined> = process.env,
): Promise<'development-log' | 'resend'> {
  const apiKey = environment['RESEND_API_KEY']?.trim();
  const from = environment['EMAIL_FROM']?.trim();
  const configured = Boolean(apiKey && from);
  const partiallyConfigured = Boolean(apiKey || from) && !configured;

  if (!configured) {
    if (environment['NODE_ENV'] === 'production' || partiallyConfigured) {
      throw new AppError({
        message:
          'Authentication email delivery requires both RESEND_API_KEY and EMAIL_FROM in production.',
        code: 'AUTH_EMAIL_NOT_CONFIGURED',
        status: 500,
      });
    }
    logger.warn(
      { email: input.email, url: input.url, kind: input.kind },
      'authentication email (development only - configure Resend for production)',
    );
    return 'development-log';
  }

  const options = {
    environment: {
      RESEND_API_KEY: apiKey,
      EMAIL_FROM: from,
      EMAIL_REPLY_TO: environment['EMAIL_REPLY_TO'],
      EMAIL_APP_NAME: environment['EMAIL_APP_NAME'],
    },
  };
  if (input.kind === 'verification') {
    await sendVerificationEmail({ to: input.email, url: input.url }, options);
  } else if (input.kind === 'password-reset') {
    await sendPasswordResetEmail({ to: input.email, url: input.url }, options);
  } else {
    await sendMagicLinkEmail({ to: input.email, url: input.url }, options);
  }
  return 'resend';
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
      sendResetPassword: async ({ user, url }) => {
        await deliverAuthEmail({ kind: 'password-reset', email: user.email, url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverAuthEmail({ kind: 'verification', email: user.email, url });
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
          await deliverAuthEmail({ kind: 'magic-link', email, url });
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
