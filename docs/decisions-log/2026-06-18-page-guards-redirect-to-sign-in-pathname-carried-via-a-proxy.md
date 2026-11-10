---
date: 2026-06-18
title: "Page guards redirect to sign-in; pathname carried via a proxy header"
status: accepted
migratedFrom: docs/DECISIONS.md
---

## 2026-06-18: Page guards redirect to sign-in; pathname carried via a proxy header

- **Date:** 2026-06-18
- **Decision:** `requireAuth()` (and `requireRole()` for the no-session case) `redirect('/sign-in?callbackURL=<path>')` instead of throwing `UnauthorizedError` when there is no session. The requested path reaches the Server Component through an `x-pathname` request header set in `apps/web/src/proxy.ts` (Next does not expose the pathname in RSC). The pure `buildSignInRedirect(pathname)` helper builds the target and refuses to append an auth route as the callback (no loop). The sign-in page reads `callbackURL` from the URL at submit time and runs it through `safeInternalPath` (`@repo/core/sanitize`) before using it, blocking open-redirect. An authenticated user who lacks a required role still gets `ForbiddenError` (403) -- a real authorization failure, not a "please sign in".
- **Why:** An anonymous visitor hitting a protected page (`/dashboard`) previously threw `UnauthorizedError`, which the generic `error.tsx` boundary rendered as "Something went wrong" -- the wrong UX for "you need to sign in", and it dropped the user's intended destination. Redirecting to sign-in with a `callbackURL` is the state-of-the-art App Router pattern (Clerk's `auth.protect()`, Auth.js, Better-Auth examples all do it) and matches the intent already written in the `isAuthConfigured` docstring. The proxy header is the idiomatic way to surface the pathname to RSC, and `proxy.ts` is already the documented request-boundary plug point (ADR 24). Reading `callbackURL` from `window.location.search` (not `useSearchParams`) keeps the sign-in page free of a forced Suspense boundary under cacheComponents. `safeInternalPath` is non-negotiable: a raw `?callbackURL` flowing into `router.push` / Better-Auth `callbackURL` is a textbook open-redirect.
- **Rejected alternatives:**
  - _Keep throwing `UnauthorizedError` and special-case it in `error.tsx`_: the boundary would have to parse the error and call `redirect()` from a Client Component error boundary -- a rustine; redirects belong at the guard, server-side, before render.
  - _`forbidden()` / `unauthorized()` (Next `authInterrupts`)_: still experimental; enabling the flag for this is more surface than the redirect needs. Revisit if it stabilizes.
  - _Redirect on wrong-role too_: silently bouncing an authenticated user hides a genuine 403. Throwing keeps the authorization failure visible and distinct from the unauthenticated case.
  - _Read the pathname with `useSearchParams`/headers without the proxy_: RSC has no pathname API; the proxy header is the supported mechanism.
- **When to revisit:** When Next ships a stable RSC pathname API, drop the `x-pathname` header. When `forbidden()`/`unauthorized()` stabilize, reconsider rendering a dedicated 403/401 segment instead of the error boundary for the wrong-role case.
