# @void/auth

Default auth implementation for the void-starter. Wraps Better-Auth with Drizzle adapter, Google OAuth, magic link, and admin/role plugins.

## Required env vars

- `BETTER_AUTH_SECRET` - 32+ char random string. Generate: `openssl rand -base64 32`
- `BETTER_AUTH_URL` - Base URL of the app (e.g. `http://localhost:3000` in dev, prod URL in prod)
- `GOOGLE_CLIENT_ID` - From Google Cloud Console > APIs & Services > Credentials
- `GOOGLE_CLIENT_SECRET` - paired with the above
- `DATABASE_URL` - inherited from `@void/db`
- `NEXT_PUBLIC_APP_URL` - base URL exposed to the browser, used by `auth.client.ts` (defaults to `http://localhost:3000`)

## Public API

- `getCurrentUser(): Promise<SessionUser | null>` - read current session
- `requireAuth(): Promise<SessionUser>` - throws `UnauthorizedError` if no session
- `requireRole(role): Promise<SessionUser>` - throws `ForbiddenError` if role mismatch (admin always passes)
- `signIn.email({ email, password })`, `signIn.google(callbackURL?)`, `signIn.magicLink({ email })`
- `signOut()`
- `defineAction({ schema, auth, handler })` - auth-aware Server Action wrapper around `@void/core/server-action`
- `authClient` (from `@void/auth/client`) - browser-side client with React hooks (`useSession`)
- Errors: `InvalidCredentialsError`, `EmailAlreadyTakenError`, `MagicLinkExpiredError`
- Policies: `canAccessAdminPanel(user)`
- Helpers: `displayName(input)`, `computeInitials(name)`

## Switching to Clerk

If an MVP requires SaaS-grade B2B auth (SSO/SCIM/orgs), install `_modules/auth-clerk/` which provides an alternative `auth.repository.ts`. The rest of the app code stays intact thanks to the stable public API.

See `docs/AUTH.md` for the full switch procedure (added in Phase D).
