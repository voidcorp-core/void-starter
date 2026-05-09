# @void/posthog

Opt-in PostHog analytics module for void-starter MVPs. Wraps `posthog-js` 1.372.x with the modern `<PostHogProvider>` integration pattern from `posthog-js/react`, gated behind a build-time env var so PostHog never ships in the bundle when the key is unset.

## Why opt-in

Per `docs/DECISIONS.md` entry 04, optional infrastructure activates at build time via env var presence. No `NEXT_PUBLIC_POSTHOG_KEY` means no PostHog runtime, no SDK fetch on the wire, and no third-party traffic from the browser. Add the env var in Vercel and redeploy to flip the module on for an MVP that needs it.

## Required environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | client | Activates browser capture. Build-time inlined so the entire `posthog.init` block dead-code-eliminates when the value is unset at build time. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_HOST` | `/ingest` | API host for capture. The default points at the EU reverse-proxy rewrites declared in `apps/web/next.config.ts`. Override only if you need a non-EU region or a custom proxy path. |

## Install

The module is already wired into `apps/web` so a fresh starter clone activates PostHog simply by setting the env var above and redeploying. The steps below document how to mirror the integration in any future app inside this monorepo.

1. Add the dependency to the consuming app's `package.json`:

   ```json
   "dependencies": {
     "@void/posthog": "workspace:*"
   }
   ```

2. Run `bun install` from the repo root.

3. Wrap the app's `RootLayout` body with `<AnalyticsProvider>` from `@void/posthog/client`. The provider should sit inside `<ThemeProvider>` so PostHog UI surveys (which respect dark mode) inherit the theme:

   ```tsx
   import { AnalyticsProvider } from '@void/posthog/client';
   import { ThemeProvider, Toaster } from '@void/ui';

   export default function RootLayout({ children }: { children: ReactNode }) {
     return (
       <html lang="en" suppressHydrationWarning>
         <body>
           <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
             <AnalyticsProvider>
               {children}
               <Toaster />
             </AnalyticsProvider>
           </ThemeProvider>
         </body>
       </html>
     );
   }
   ```

4. Add the EU reverse-proxy rewrites and `skipTrailingSlashRedirect: true` to the inner `NextConfig` object in `apps/<app>/next.config.ts`:

   ```ts
   const config: NextConfig = {
     // ... cacheComponents, headers, transpilePackages
     skipTrailingSlashRedirect: true,
     async rewrites() {
       return [
         { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
         { source: '/ingest/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
         { source: '/ingest/:path*', destination: 'https://eu.i.posthog.com/:path*' },
       ];
     },
   };
   ```

   `skipTrailingSlashRedirect: true` is mandatory: without it, Next.js issues a 308 redirect from `/ingest/...` to `/ingest/.../` before the rewrite runs, which breaks the proxy. The three rewrite rules cover the static asset CDN, the JS array snippet, and the catch-all capture endpoint that PostHog exercises in that order.

5. Add `'@void/posthog'` to `transpilePackages` in `next.config.ts` (alphabetical):

   ```ts
   transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/posthog', '@void/sentry', '@void/ui'],
   ```

## DCE note

`AnalyticsProvider` reads `NEXT_PUBLIC_POSTHOG_KEY` inside a `useEffect`, but because `NEXT_PUBLIC_*` values are inlined at build time, the entire SDK init branch dead-code-eliminates when the var is absent at build time. Turbopack caveat: the runtime `if (!key) return;` check is preserved on disk, but the `posthog.init` call site is unreachable and the SDK is never fetched from the browser. This matches the documented behaviour of the Sentry module.

To verify in your own deploy, run `bun run build` with `NEXT_PUBLIC_POSTHOG_KEY` unset, then load the homepage and confirm the network tab shows no requests to `/ingest/*` and no `posthog` references in the eagerly loaded chunks.

## Removal

If a future MVP needs to remove PostHog entirely:

1. Drop `"@void/posthog": "workspace:*"` from `apps/<app>/package.json` deps.
2. Remove `'@void/posthog'` from `transpilePackages` in `next.config.ts`.
3. Remove the `skipTrailingSlashRedirect` flag and the three `/ingest/*` rewrite rules from `next.config.ts`.
4. Unwrap `<AnalyticsProvider>` from `apps/<app>/src/app/layout.tsx` and drop the import.
5. Run `bun install` to drop the lockfile entries.

The env var (`NEXT_PUBLIC_POSTHOG_KEY`) can be unset in Vercel without a code change; the module already short-circuits when it is absent. Use the full removal procedure above only when the dependency itself is no longer wanted.

## Notes

- `posthog-js` is a browser-only SDK. The package only ships an `AnalyticsProvider` (a `'use client'` component) under the `/client` subpath; the package barrel exports nothing, by design, so a stray server-side import has nowhere to land.
- `defaults: '2026-01-30'` opts the SDK into the modern PostHog defaults bundle (autocapture, web vitals, session replay flag, etc.) at the snapshot date documented in PostHog's release notes. Bumping the date is a deliberate behavioural change; do it intentionally and read the diff.
- `person_profiles: 'identified_only'` keeps anonymous traffic out of PostHog's person index, which is the recommended setting for B2B SaaS MVPs that only need analytics on signed-in users.
- The EU reverse proxy keeps PostHog traffic on the deploy origin so ad blockers and `connect-src` CSP rules don't drop it. Match the region (`eu` vs `us`) to the PostHog project where the key was issued.
