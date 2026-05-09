# @void/auth-clerk

Opt-in scaffold that documents how to swap `@void/auth`'s Better-Auth repository for a Clerk-backed one. **This module is a scaffold, not a runtime drop-in.** Copying `src/auth.repository.ts` alone does not produce a working app — Clerk's session model, sign-in flow, and middleware all differ from Better-Auth's. The full swap procedure is below.

For the decision rationale (why Better-Auth ships as default and Clerk is opt-in), read `docs/DECISIONS.md` entry **02. Better-Auth as default, Clerk as opt-in module**.

## When to swap

The starter ships Better-Auth because three Void Factory non-negotiables outweigh Clerk's superior DX: data sovereignty (user records on the deploy's own Postgres), brand integrity (no vendor branding visible at any tier), and custom auth domain by default (no Clerk Pro upgrade required to use `auth.<your-domain>`). Pick Clerk for a specific MVP only when the trade-off flips:

- the project legitimately needs B2B SaaS features at J1 (SSO, SCIM, advanced organizations) AND the data sovereignty trade-off is acceptable for that one project;
- the project's branding posture tolerates Clerk's free-tier badge, OR the project is on Clerk Pro from the start (custom domain, no Clerk branding);
- the team explicitly wants to delegate auth maintenance to Clerk's ops in exchange for the per-MAU cost.

This is a per-MVP decision, not a global one. The starter's default stays Better-Auth.

## Conceptual differences vs Better-Auth

| Dimension | Better-Auth (default) | Clerk (this module) |
| --- | --- | --- |
| Data location | Your Postgres (`@void/db`) | Clerk's infrastructure |
| User table | `users` row owned by you | Clerk-owned; mirror via webhook if you need a local copy |
| Session read | `getAuth().api.getSession({ headers })` | `auth()` reads `next/headers` internally; `currentUser()` returns the `User` |
| Sign-in surface | `authClient` (browser fetch client) | `<SignIn />` / `<SignUp />` Clerk components |
| Roles | `users.role` text column on your DB | `publicMetadata.role` on the Clerk user, or organization role |
| Sign-out (server) | `getAuth().api.signOut({ headers })` | No server export; use `<UserButton>` or the `useClerk()` browser hook |
| Auth handler | `apps/web/src/app/api/auth/[...all]/route.ts` (`toNextJsHandler`) | None; `clerkMiddleware()` in `apps/web/src/proxy.ts` handles auth |
| Custom domain | Yes, via `BETTER_AUTH_URL` | Requires Clerk Pro (paid plan) |
| Branding (free tier) | None (your code, your UI) | Clerk badge on hosted UI |
| Cost | Self-hosted (your Vercel + Neon plan) | Free up to 10k MAU, then per-MAU |

## Swap procedure

Five steps. Do them all in one PR; partial swaps leave the app broken.

1. **Replace the repository.** Copy `_modules/auth-clerk/src/auth.repository.ts` over `packages/auth/src/auth.repository.ts`. Drop the inline `Role` / `SessionUser` types from the copy and import them from `./auth.types` instead — the shapes match by design. Audit the role-mapping branch (`metadataRole === 'admin'`) and adapt to whatever metadata key your Clerk project commits to.

2. **Update `packages/auth/package.json` deps.** Remove `better-auth`, `@better-auth/drizzle-adapter`, `@void/db`, and `drizzle-orm` (the latter two are dev deps used only by the Better-Auth Drizzle adapter). Add `@clerk/nextjs` at the same major as this module. Keep `server-only`, `zod`, `@void/core`, and the `next` peer dep.

   ```diff
   "dependencies": {
   -  "@better-auth/drizzle-adapter": "^1.6.0",
     "@void/core": "workspace:*",
   -  "@void/db": "workspace:*",
   -  "better-auth": "^1.6.0",
   +  "@clerk/nextjs": "^6.39.0",
     "server-only": "^0.0.1",
     "zod": "^3.23.0"
   }
   ```

3. **Update env vars.** Remove the Better-Auth block from your environment, add the Clerk block. The Better-Auth call sites in `auth.repository.ts` go away with the file replacement; `auth.client.ts` and `auth-action.ts` need their imports re-pointed (see steps 4 and 5).

   | Remove | Add |
   | --- | --- |
   | `BETTER_AUTH_SECRET` | `CLERK_SECRET_KEY` |
   | `BETTER_AUTH_URL` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` |
   | `GOOGLE_CLIENT_ID` | (Google OAuth lives in Clerk dashboard) |
   | `GOOGLE_CLIENT_SECRET` | (Google OAuth lives in Clerk dashboard) |

   Optional Clerk env vars:

   | Variable | Purpose |
   | --- | --- |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Override the default `/sign-in` route. |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Override the default `/sign-up` route. |
   | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Where to send users post sign-in. |
   | `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Where to send users post sign-up. |

4. **Replace the Better-Auth catch-all handler with Clerk middleware.** Delete `apps/web/src/app/api/auth/[...all]/route.ts` — Clerk does not use a catch-all route handler. Replace the body of `apps/web/src/proxy.ts` with `clerkMiddleware()` from `@clerk/nextjs/server`:

   ```ts
   import { clerkMiddleware } from '@clerk/nextjs/server';

   export default clerkMiddleware();

   export const config = {
     matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
   };
   ```

   Note the matcher dropped `api/auth` (the catch-all is gone) and the proxy now exports `default` instead of a named `proxy` function. Clerk's helper provides the proxy function itself; the rename matches Next 16's `proxy.ts` convention (per `docs/DECISIONS.md` entry 24). If you need to keep a custom proxy on top of Clerk's middleware (locale detection, rate-limiting hooks), use the `clerkMiddleware((auth, req) => { ... })` callback form documented at https://clerk.com/docs/references/nextjs/clerk-middleware.

5. **Wrap `RootLayout` with `<ClerkProvider>` and add the Clerk UI.** Edit `apps/web/src/app/layout.tsx`:

   ```tsx
   import { ClerkProvider } from '@clerk/nextjs';

   export default function RootLayout({ children }: { children: ReactNode }) {
     return (
       <ClerkProvider>
         <html lang="en" suppressHydrationWarning>
           {/* existing body, ThemeProvider, AnalyticsProvider, etc. */}
         </html>
       </ClerkProvider>
     );
   }
   ```

   Then replace the starter's `apps/web/src/app/(auth)/sign-in/` and `/sign-up/` pages with Clerk's prebuilt components or the catch-all `<SignIn path="/sign-in" />` pattern. Replace `<UserMenu>` (which uses `authClient.signOut()`) with `<UserButton afterSignOutUrl="/" />`. Drop the `auth.client.ts` file from `packages/auth/src/` (Clerk's client surface is `useUser()`, `useClerk()`, `useAuth()` from `@clerk/nextjs`).

After the five steps, run `bun install` from the repo root, then `bun run lint`, `bun run type-check`, `bun run test`, `bun run build`. Fix the inevitable cascade — the `defineAction` / `defineFormAction` resolvers in `@void/auth/auth-action` still call `getCurrentUser`, which now returns the Clerk-shaped session, so existing actions keep working as long as the role mapping is honest.

## What survives the swap

- `auth.service.ts` (`requireAuth`, `requireRole`, `getCurrentUser`) — depends only on `getCurrentUser()` from the repository, which keeps the same signature.
- `auth.policy.ts` (`canAccessAdminPanel`) — depends only on `SessionUser`.
- `auth.types.ts` (`Role`, `SessionUser`, schemas) — unchanged.
- `auth.helper.ts` (`displayName`, `computeInitials`) — unchanged.
- `auth-action.ts` (`defineAction`, `defineFormAction` re-exports) — unchanged because it only depends on `getCurrentUser`.

## What does not survive

- `auth.client.ts` — Better-Auth fetch client; replaced by Clerk's React hooks.
- `signOut()` in `auth.service.ts` — Clerk's server module does not expose it; remove the export.
- The catch-all auth route — Clerk uses middleware, not a route handler.
- The Better-Auth schema migrations in `packages/db/src/schema/auth.ts` — Clerk owns the user table. Keep your `users` table only if you mirror it via Clerk webhooks; otherwise drop it and reference `userId` (a string) directly on your domain tables.

## Rollback

If the swap goes badly and you need to revert:

1. `git revert` the swap commit (a single commit per the procedure above keeps this clean).
2. Run `bun install` to restore the Better-Auth lockfile entries.
3. Restore the env vars (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_*`) on the deploy.
4. Re-run the database migrations if you dropped the auth tables.

The fact that the starter ships Better-Auth files unchanged means rollback is always a `git revert` away, never a manual reconstruction.

## Notes

- The version of `@clerk/nextjs` pinned in this module's `package.json` is the latest stable major at the time the scaffold landed. Bump it during the swap if a newer major exists; the API surface (`auth()`, `currentUser()`, `<ClerkProvider>`, `clerkMiddleware()`) has been stable since 2024.
- This module is **not** a workspace dep of `apps/web`. The starter never consumes `@void/auth-clerk` automatically — adopting Clerk is an explicit, irreversible-without-revert per-MVP decision.
- The single file under `src/` is the only meaningful content. The package barrel (`src/index.ts`) deliberately re-exports nothing, matching the convention of `@void/sentry` and `@void/posthog` (the other opt-in modules in `_modules/`).
