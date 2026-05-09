# @void/auth

`@void/auth` is the canonical service example for the void-starter. Mirror its
file layout (`auth.repository.ts`, `auth.service.ts`, `auth.policy.ts`,
`auth.helper.ts`, `auth.errors.ts`, `auth.types.ts`, `auth.test.ts` -- 7-file
pattern; ADR 8) when creating new services. Apps consume the public surface
(`@void/auth`); only the route handler at `/api/auth/[...all]` imports the
underlying instance from `@void/auth/repository`.

Default auth implementation for the void-starter. Wraps Better-Auth with Drizzle adapter, Google OAuth, magic link, and admin/role plugins.

## Required env vars

- `BETTER_AUTH_SECRET` - 32+ char random string. Generate: `openssl rand -base64 32`
- `BETTER_AUTH_URL` - Base URL of the app (e.g. `http://localhost:3000` in dev, prod URL in prod)
- `GOOGLE_CLIENT_ID` - From Google Cloud Console > APIs & Services > Credentials
- `GOOGLE_CLIENT_SECRET` - paired with the above
- `DATABASE_URL` - inherited from `@void/db`
- `NEXT_PUBLIC_APP_URL` - base URL exposed to the browser, used by `auth.client.ts` (defaults to `http://localhost:3000`)

## Public API

### Server-side (Server Components, route handlers, middleware)

- `getCurrentUser(): Promise<SessionUser | null>` - read current session
- `requireAuth(): Promise<SessionUser>` - throws `UnauthorizedError` if no session
- `requireRole(role): Promise<SessionUser>` - throws `ForbiddenError` if role mismatch (admin always passes)
- `signOut()` - clear the current session

### Server Actions

- `defineAction({ schema, auth, handler })` - typed RPC Server Action factory; auth-aware wrapper around `@void/core/server-action`
- `defineFormAction({ schema, auth, handler })` - `useActionState`-compatible Server Action factory for `<form action={...}>`

### Browser (Client Components)

All sign-in flows live on the browser client and ship cookies to the
Better-Auth handler natively:

- `authClient.signIn.email({ email, password })`
- `authClient.signIn.social({ provider: 'google', callbackURL })`
- `authClient.signIn.magicLink({ email })`
- `authClient.signOut()`
- `authClient.useSession()` - React hook returning `{ data, isPending, error }`

Server-side sign-in is intentionally not exposed: it requires manual
`Set-Cookie` passthrough and is a niche need (e.g. one-time token
redemption). Add a deliberate typed helper if a flow demands it.

### Other

- Errors: `InvalidCredentialsError`, `EmailAlreadyTakenError`, `MagicLinkExpiredError`
- Policies: `canAccessAdminPanel(user)`
- Helpers: `displayName(input)`, `computeInitials(name)`

## Switching to Clerk

If an MVP requires SaaS-grade B2B auth (SSO/SCIM/orgs), install `_modules/auth-clerk/` which provides an alternative `auth.repository.ts`. The rest of the app code stays intact thanks to the stable public API.

See `docs/AUTH.md` for the full switch procedure (added in Phase D).
