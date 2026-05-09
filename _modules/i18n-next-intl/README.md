# @void/i18n-next-intl

> **Status: PLACEHOLDER** -- no implementation shipped yet. This is a wire scaffold documenting scope, env vars, and integration points. Implement when a real MVP needs it.

Opt-in scaffold for internationalization via `next-intl` with locale-segment routing (`/[locale]/...`), JSON message files, and a locale switcher component. Activate when an MVP serves users in more than one language.

## Why this module

Most early-stage MVPs ship in one language (typically English or French) and pay for premature i18n with deeper folder structures, every link going through a `Link`-from-`@/i18n` indirection, and translator workflows that nobody is using yet. Activating i18n later is mechanical (codemod-able) but pointless work if the product never ships in a second language. Defer until there is a real second-language requirement, then turn this on. `next-intl` is the 2026 default for App Router because it ships first-class Server Components support, proper static generation per locale, and a small runtime.

## Required env vars

| Variable | Type | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | public | Fallback locale when none can be inferred from the URL or Accept-Language header (e.g. `en`). |
| `NEXT_PUBLIC_SUPPORTED_LOCALES` | public | Comma-separated list of supported locale codes (e.g. `en,fr,es`). The middleware uses this list to validate the URL segment. |

Both are read at build time and inlined; changing them requires a redeploy. This is intentional -- locales are a static contract of the build, not a runtime toggle.

## Install (when implementing)

The module mirrors next-intl's App Router pattern with a route segment group `[locale]`.

1. Add the dependency to `apps/web/package.json`:

   ```json
   "dependencies": {
     "next-intl": "^4.0.0"
   }
   ```

2. Run `bun install` from the repo root.

3. Add the `next-intl` proxy at `apps/web/src/proxy.ts` (per ADR 24, the Next 16 file convention):

   ```ts
   import createMiddleware from 'next-intl/middleware';

   export default createMiddleware({
     locales: process.env['NEXT_PUBLIC_SUPPORTED_LOCALES']!.split(','),
     defaultLocale: process.env['NEXT_PUBLIC_DEFAULT_LOCALE']!,
     localePrefix: 'as-needed',
   });

   export const config = {
     matcher: ['/((?!api|_next|.*\\..*).*)'],
   };
   ```

   If a future module also needs the proxy slot (e.g. `_modules/rate-limit-upstash`), compose them with `next-intl`'s `createMiddleware` returning a function that the rate limiter wraps.

4. Move app routes under a locale segment. Restructure `apps/web/src/app/` so every route file lives at `apps/web/src/app/[locale]/<segment>/page.tsx`. The marketing root becomes `apps/web/src/app/[locale]/page.tsx`. The locale segment is a Next.js dynamic segment populated by the proxy.

5. Add message files at `apps/web/messages/<locale>.json`. Start with `en.json` and `fr.json`. Use a flat-keys-with-dots convention (`auth.signIn.title`, `auth.signIn.submit`) -- it scales further than nested objects when feature counts grow. ICU MessageFormat is supported out of the box for plurals and dates.

6. Add a `<LocaleSwitcher>` component to `@void/ui` (per ADR 18, build it on Radix DropdownMenu). It calls `next-intl`'s `useRouter` to navigate between locales while preserving the current pathname and search params.

7. Update the layout. Add `apps/web/src/app/[locale]/layout.tsx` calling `setRequestLocale(locale)` before rendering, so Server Components downstream can call `useTranslations` synchronously without a Suspense boundary.

## Components

- next-intl proxy with locale matching and prefix strategy
- `apps/web/src/app/[locale]/...` route tree
- `apps/web/messages/{en,fr}.json` message files (one per locale)
- `<LocaleSwitcher>` component in `@void/ui`
- `apps/web/src/i18n/request.ts` next-intl config file declaring locale loading

## Integration points

- `apps/web/src/proxy.ts` -- next-intl middleware (per ADR 24)
- `apps/web/src/app/[locale]/...` -- locale-prefixed route tree
- `apps/web/messages/{en,fr,...}.json` -- translation files
- `apps/web/src/i18n/request.ts` -- next-intl config entry
- `packages/ui/src/locale-switcher.tsx` -- locale switcher built on Radix DropdownMenu (ADR 18)
- `packages/auth/src/auth.types.ts` -- consider adding `users.locale` so authenticated users persist their preference

## Upstream docs

- https://next-intl.dev -- canonical docs
- https://next-intl.dev/docs/getting-started/app-router -- App Router setup
- https://next-intl.dev/docs/routing -- routing strategies (prefix, domain-based, none)
- https://next-intl.dev/docs/usage/messages -- message format and pluralization

## Removal (after implementing)

The inverse of install:

1. Move every route from `apps/web/src/app/[locale]/<segment>` back to `apps/web/src/app/<segment>`.
2. Drop the `next-intl` proxy from `apps/web/src/proxy.ts`.
3. Delete `apps/web/messages/`, `apps/web/src/i18n/`, the `<LocaleSwitcher>` component, and any `useTranslations` call sites.
4. Drop the `next-intl` dep from `apps/web/package.json`.
5. Unset `NEXT_PUBLIC_DEFAULT_LOCALE` and `NEXT_PUBLIC_SUPPORTED_LOCALES` in Vercel.
6. Run `bun install` to drop the lockfile entries.

Removal is rare in practice -- once an MVP ships in two languages, going back to one is a product decision that almost never happens.
