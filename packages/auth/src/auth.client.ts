import { adminClient, magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * Browser-side Better-Auth client for `@void/auth`.
 *
 * Counterpart to `auth.repository.ts`. This module is consumed by client
 * components, hooks, and any browser-only code path. It MUST NOT import
 * `next/headers`, the Drizzle adapter, or anything else that touches the
 * server runtime — those are the server's job.
 *
 * Plugin parity: the client plugin set (`adminClient`, `magicLinkClient`)
 * mirrors the server plugin set (`admin`, `magicLink`) one-to-one. Better-Auth
 * uses this symmetry for end-to-end type inference: `signIn.magicLink(...)`
 * and `useSession().data?.user.role` are typed correctly only when both
 * sides agree. If a server plugin is added or removed, this list must move
 * in lockstep.
 *
 * `baseURL` resolution:
 *   - Reads `NEXT_PUBLIC_APP_URL` so the bundler inlines the value at build
 *     time (the `NEXT_PUBLIC_` prefix is required by Next.js for client
 *     exposure).
 *   - Falls back to `http://localhost:3000` for local dev. Production deploys
 *     must set `NEXT_PUBLIC_APP_URL` explicitly; we do not enforce it via
 *     `createAppEnv` here because that helper is server-only.
 */
export const authClient = createAuthClient({
  baseURL: process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000',
  plugins: [adminClient(), magicLinkClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
