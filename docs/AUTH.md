# Auth

This document is the operational guide to `@void/auth`: the public surface, the sign-in flows, the session lifecycle, role-based access, the procedure to swap Better-Auth for Clerk, the procedure to add a new OAuth provider, and the procedure to customize email templates. The architectural rationale lives in `docs/DECISIONS.md` (entry 02 for Better-Auth vs Clerk, entry 25 for the server-only boundary). The day-to-day patterns live in `docs/PATTERNS.md`.

Every snippet here mirrors what already ships under `packages/auth/src/` and `apps/web/src/`. If your code disagrees, the doc is the source of truth -- update the code, or open an ADR to change the convention.

---

## 1. Intent and rules

`@void/auth` is a thin domain wrapper over Better-Auth that ships:

- Server-side session helpers (`getCurrentUser`, `requireAuth`, `requireRole`, `signOut`).
- Auth-aware Server Action factories (`defineAction`, `defineFormAction`) that wire the Better-Auth session into `ctx.user`.
- A browser-safe `authClient` for sign-in / sign-up flows in Client Components.
- Typed domain errors (`InvalidCredentialsError`, `EmailAlreadyTakenError`, `MagicLinkExpiredError`).
- Pure presentation helpers (`computeInitials`, `displayName`).
- A policy hook (`canAccessAdminPanel`) for centralized authorization.

Three rules govern every change:

- **Server-only modules carry `import 'server-only'`.** `auth.service`, `auth.repository`, and `auth-action` all do (ADR 25). A Client Component that accidentally pulls a server symbol fails loud at build time, not at runtime.
- **Browser code imports from `@void/auth/client`.** Sign-in flows, sign-up, password reset, magic-link forms -- they all call `authClient.signIn.*`, `authClient.signUp.*`, `authClient.signOut`. Never import the barrel from a Client Component (it pulls server-only symbols).
- **Server Actions use the auth-aware factories.** `defineAction` and `defineFormAction` re-exported from `@void/auth` resolve the session via `getCurrentUser()` and inject `ctx.user`. The bare versions in `@void/core/server-action` resolve only `'public'` -- they exist for testability of the core, not for app code.

---

## 2. Public API of `@void/auth`

Every export below lives at `packages/auth/src/index.ts` (the barrel) unless the comment says otherwise.

### Server-side session helpers (`auth.service.ts`)

- **`getCurrentUser(): Promise<SessionUser | null>`** -- read the current session user via `next/headers`. Use in Server Components and route handlers. Returns `null` if no session, or if the session shape no longer matches `sessionUserSchema`.
- **`requireAuth(): Promise<SessionUser>`** -- throw `UnauthorizedError` (401) if no session. Returns the user otherwise.
- **`requireRole(role: Role): Promise<SessionUser>`** -- throw `UnauthorizedError` if no session, `ForbiddenError` (403) if the role check fails. Admin satisfies any role check (standard hierarchy).
- **`signOut()`** -- invalidate the current session at the Better-Auth API level. Cookie clearing happens via the response Better-Auth attaches.

### Server Action factories (`auth-action.ts`)

- **`defineAction({ schema, auth, handler })`** -- typed RPC factory. Returns a function `(input) => Promise<TResult>`. Use with react-hook-form's `handleSubmit`.
- **`defineFormAction({ schema, auth, handler })`** -- FormData factory for `<form action={...}>` and React 19's `useActionState`. Returns a function `(prevState, formData) => Promise<ActionState<TResult>>`.
- **`ActionState<T>`** -- the structured return type of `defineFormAction`. Either `{ ok: true, data: T }` or `{ ok: false, fieldErrors, formError? }`.
- **`initialActionState`** -- the initial `ActionState` you pass to `useActionState`.

### Client-side surface (`auth.client.ts`, imported via `@void/auth/client`)

- **`authClient`** -- the Better-Auth fetch client. Surfaces `signIn.email`, `signIn.social`, `signUp.email`, `signOut`, `magicLink.signIn`, `forgetPassword`, `resetPassword`. Typed end-to-end against the server's plugin set. Browser-only.

### Errors (`auth.errors.ts`)

- **`InvalidCredentialsError`** -- 401, code `INVALID_CREDENTIALS`. Email or password mismatch.
- **`EmailAlreadyTakenError`** -- 409, code `EMAIL_TAKEN`. Sign-up against an existing email.
- **`MagicLinkExpiredError`** -- 410, code `MAGIC_LINK_EXPIRED`. Token outside its expiry window.

### Helpers (`auth.helper.ts`)

- **`computeInitials(name: string): string`** -- 2-char initials for an avatar fallback (`'Alice Bob'` to `'AB'`, `'Alice'` to `'AL'`, empty to `'??'`).
- **`displayName(user: { name, email }): string`** -- best human-readable label, prefers `name`, falls back to email local part.

### Policies (`auth.policy.ts`)

- **`canAccessAdminPanel(user: SessionUser | null): boolean`** -- pure predicate. The canonical policy shipped with the starter; apps grow `canEditPost`, `canInviteMember`, etc. on top.

### Types (`auth.types.ts`)

- **`SessionUser`** (and `sessionUserSchema`) -- `{ id, email, name, image, role }`. The shape Better-Auth normalizes.
- **`Role`** (and `roleSchema`) -- `'user' | 'admin'`.
- **`AuthSession`** -- `{ user: SessionUser, expiresAt: Date }`.

---

## 3. Sign-in flow diagrams

Three flows ship today. All start in a Client Component (the auth pages under `apps/web/src/app/(auth)/`) and end with a session cookie set by Better-Auth.

### Email and password sign-in

```
Client form (apps/web/src/app/(auth)/sign-in/page.tsx)
  -> authClient.signIn.email({ email, password })          [browser fetch]
    -> Better-Auth /api/auth/[...all]/sign-in/email        [packages/auth, route handler]
      -> verify password against accounts.password         [Argon2id]
      -> create session row in sessions                    [DB]
      -> Set-Cookie: session_token=...                     [httpOnly, Secure, SameSite=Lax]
    -> redirect to /dashboard                              [client-side]
```

### Google OAuth

```
Client clicks "Sign in with Google"
  -> authClient.signIn.social({ provider: 'google' })      [browser]
    -> redirect to https://accounts.google.com/...         [302]
    -> user authenticates with Google
    -> Google callback https://yourdomain/api/auth/callback/google
      -> Better-Auth verifies the OIDC token
      -> link by email if existing user                    [accounts upsert]
      -> create session row                                [DB]
      -> Set-Cookie + redirect to /dashboard
```

### Magic link

```
Client enters email (apps/web/src/app/(auth)/magic-link/page.tsx)
  -> authClient.magicLink.signIn({ email })                [browser]
    -> Better-Auth magicLink plugin
      -> insert verifications row { identifier: email, value: token, expiresAt }
      -> sendMagicLink callback fires                      [packages/auth/src/auth.repository.ts]
        -> dev: logger.warn prints email + URL + token     [pino, no email sent]
        -> prod: _modules/email-resend wired here          [Resend API call]
  -> User clicks link in email
  -> Better-Auth /api/auth/[...all]/magic-link?token=...
    -> verify token, check expiry                          [throws MagicLinkExpiredError if past]
    -> create session row + Set-Cookie + redirect
```

The `sendMagicLink` body in `auth.repository.ts` is currently a `logger.warn` stub. Replace it with a Resend call when activating `_modules/email-resend`. See section 7.

---

## 4. Session lifecycle

Better-Auth manages the lifecycle; `@void/auth` exposes the read paths.

- **Creation.** On successful sign-in (any flow). A row is inserted into `sessions` with `id`, `token`, `userId`, `expiresAt`, and metadata (`ipAddress`, `userAgent`). The cookie `session_token` is set with the row's `token` value.
- **Storage.** Two halves: cookie holds the token (httpOnly, Secure in prod, SameSite=Lax); DB row holds the full session record. Reading `getCurrentUser()` joins them via `auth.api.getSession({ headers })`.
- **Refresh.** Better-Auth slides the expiry on activity (default config). Each authenticated request extends the session window.
- **Rotation.** On auth-state change (sign-in, sign-out, role upgrade), Better-Auth issues a new token and invalidates the old DB row. Any leaked old token becomes useless immediately.
- **Sign-out.** `signOut()` deletes the DB row and clears the cookie. The `apps/web/src/actions/auth.actions.ts` `signOutAction` is the canonical caller.

Cascade behavior: when a user is deleted from `users`, the `sessions.userId` foreign key (`onDelete: 'cascade'`, see `packages/db/src/schema/sessions.ts`) drops every outstanding session in the same transaction. No orphans.

---

## 5. Role-based access with `requireRole`

The simplest pattern: gate a Server Component or route handler with one line.

```tsx
// apps/web/src/app/admin/page.tsx
import { requireRole } from '@void/auth';

export default async function AdminPage() {
  await requireRole('admin'); // throws ForbiddenError (403) if not admin
  // ... render admin UI
}
```

Behavior:

- **No session.** `requireRole` first calls `requireAuth`, which throws `UnauthorizedError` (401). The Next.js `error.tsx` boundary renders, or your custom handler redirects to `/sign-in`.
- **Session, wrong role.** `ForbiddenError` (403). Render a 403 page or redirect to a "no access" route.
- **Session, role match (or admin).** Returns the `SessionUser`. Continue rendering.

The same logic works inside Server Actions via the auth-aware factory:

```ts
// apps/web/src/actions/posts.actions.ts
import { defineFormAction } from '@void/auth';
import { z } from 'zod';

export const deletePostAction = defineFormAction({
  schema: z.object({ postId: z.string().uuid() }),
  auth: 'role:admin',
  async handler({ postId }, { user }) {
    // user is typed as { id, role: 'admin' | 'user' }
    // role check already passed at this point
    await deletePostFromRepo(postId);
    return { ok: true };
  },
});
```

Inside `defineFormAction`, the auth resolver throws `UnauthorizedError` or `ForbiddenError`, which the core wrapper catches and maps to `{ ok: false, formError: { code, message } }`. The client renders `formError` without a try / catch.

For complex authorization (resource ownership, soft-delete state, tenant scoping), extract a `<name>.policy.ts` per ADR 08 and call it from the service:

```ts
// packages/posts/src/posts.policy.ts
export function canEditPost(user: SessionUser, post: Post): boolean {
  return user.id === post.authorId || user.role === 'admin';
}
```

---

## 6. Switching to Clerk via `_modules/auth-clerk`

For the rationale, see ADR 02. The starter ships Better-Auth as default for data sovereignty, brand integrity, and custom-domain-by-default. Activate Clerk only when an MVP genuinely needs B2B SaaS features at J1 (SSO, SCIM, advanced organizations) AND the trade-off is acceptable.

The full procedure lives in `_modules/auth-clerk/README.md`. Five steps, one PR (partial swaps leave the app broken):

1. **Replace the repository.** Copy `_modules/auth-clerk/src/auth.repository.ts` over `packages/auth/src/auth.repository.ts`. Adapt the `metadataRole === 'admin'` branch to whatever Clerk metadata key your project commits to.
2. **Update `packages/auth/package.json` deps.** Remove `better-auth`, `@better-auth/drizzle-adapter`, `@void/db`, `drizzle-orm`. Add `@clerk/nextjs`. Keep `server-only`, `zod`, `@void/core`.
3. **Swap env vars.** Remove `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Add `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (and the optional sign-in / sign-up route overrides). Google OAuth moves to the Clerk dashboard.
4. **Replace the catch-all handler with `clerkMiddleware()`.** Delete `apps/web/src/app/api/auth/[...all]/route.ts`. Replace `apps/web/src/proxy.ts` with `export default clerkMiddleware()`. Drop `api/auth` from the matcher.
5. **Wrap `RootLayout` with `<ClerkProvider>`.** Edit `apps/web/src/app/layout.tsx`. Replace the starter's `(auth)/sign-in/` and `(auth)/sign-up/` pages with Clerk's prebuilt components or the catch-all `<SignIn path="/sign-in" />` pattern. Replace `<UserMenu>` with `<UserButton afterSignOutUrl="/" />`. Drop `auth.client.ts`.

This is a per-MVP decision, not a global one. Once swapped, do not swap back -- session shape and user-row ownership are not symmetric.

---

## 7. Adding a new OAuth provider

Three steps, using GitHub as the example.

1. **Add env vars.** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`. Set them in `.env.local` for dev and in Vercel "Sensitive" type for prod (see `docs/SECURITY.md` section 4).

2. **Update the env schema in `packages/auth/src/auth.repository.ts`.** Extend the `createAppEnv` block:

   ```ts
   const env = createAppEnv({
     server: {
       BETTER_AUTH_SECRET: z.string().min(32),
       BETTER_AUTH_URL: z.string().url(),
       GOOGLE_CLIENT_ID: z.string().min(1),
       GOOGLE_CLIENT_SECRET: z.string().min(1),
       GITHUB_CLIENT_ID: z.string().min(1),
       GITHUB_CLIENT_SECRET: z.string().min(1),
     },
     client: {},
     runtimeEnv: {
       BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'],
       BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'],
       GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'],
       GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'],
       GITHUB_CLIENT_ID: process.env['GITHUB_CLIENT_ID'],
       GITHUB_CLIENT_SECRET: process.env['GITHUB_CLIENT_SECRET'],
     },
   });
   ```

3. **Add the provider to the Better-Auth config.** Same file, inside `betterAuth({ ... })`:

   ```ts
   socialProviders: {
     google: {
       clientId: env['GOOGLE_CLIENT_ID'],
       clientSecret: env['GOOGLE_CLIENT_SECRET'],
     },
     github: {
       clientId: env['GITHUB_CLIENT_ID'],
       clientSecret: env['GITHUB_CLIENT_SECRET'],
     },
   },
   ```

   The browser side picks it up automatically: `authClient.signIn.social({ provider: 'github' })` works the next time `bun run dev` rebuilds. No client changes needed.

Do not commit real OAuth secrets. The dev pair stays in `.env.local`; prod values live in Vercel.

---

## 8. Customizing email templates

Today the magic-link sender is a development stub. The path to real email is wired but not active by default.

- **Default (dev).** `sendMagicLink` in `packages/auth/src/auth.repository.ts` calls `logger.warn({ email, url, token }, 'magic link (dev only ...)')`. Open the dev console, copy the URL, paste it in the browser. No mail server needed.
- **Production.** Activate `_modules/email-resend` (placeholder today, see `_modules/email-resend/README.md`). The module ships React Email templates colocated with the adapter and replaces the body of `sendMagicLink` with a Resend API call. The `RESEND_API_KEY` env var gates activation.

When activating Resend, update `sendMagicLink` directly in `auth.repository.ts`:

```ts
magicLink({
  sendMagicLink: async ({ email, url }) => {
    const { sendMagicLinkEmail } = await import('@void/email-resend/server');
    await sendMagicLinkEmail({ to: email, url });
  },
}),
```

The same pattern (`forgetPassword`, `verifyEmail` callbacks) applies to password reset and email verification when the Better-Auth `emailAndPassword.requireEmailVerification: true` flow needs production-grade email.

---

## Cross-references

- `docs/DECISIONS.md` -- entry 02 (Better-Auth as default), entry 21 (`defineFormAction`), entry 25 (`server-only` boundary).
- `docs/ARCHITECTURE.md` -- topology, layering, action layer placement.
- `docs/PATTERNS.md` -- Server Action patterns, file naming, code style.
- `docs/SECURITY.md` -- session security defaults, secret management, CSP.
- `docs/CACHING.md` -- why `@void/auth` does not yet use Cache Components.
- `docs/MODULES.md` -- catalogue: `_modules/auth-clerk` (alternative repository), `_modules/email-resend` (placeholder).
