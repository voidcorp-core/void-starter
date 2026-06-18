# @repo/posthog

Opt-in PostHog analytics module for void-starter MVPs. Initializes the global `posthog-js` singleton through a dynamic `import()` gated on a build-time env var, so the SDK never ships in the eager client bundle when the key is unset.

## Why opt-in

Per `docs/DECISIONS.md` entry 04, optional infrastructure activates at build time via env var presence. No `NEXT_PUBLIC_POSTHOG_KEY` means no PostHog runtime, no SDK fetch on the wire, and no third-party traffic from the browser. Add the env var in Vercel and redeploy to flip the module on for an MVP that needs it.

## Required environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | client | Activates browser capture. When unset, the effect returns before the dynamic `import('posthog-js')` runs, so the SDK is never loaded. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_HOST` | `/ingest` | API host for capture. The default points at the EU reverse-proxy rewrites declared in `apps/web/next.config.ts`. Override only if you need a non-EU region or a custom proxy path. |

## Install

The module is already wired into `apps/web` so a fresh starter clone activates PostHog simply by setting the env var above and redeploying. The steps below document how to mirror the integration in any future app inside this monorepo.

1. Add the dependency to the consuming app's `package.json`:

   ```json
   "dependencies": {
     "@repo/posthog": "workspace:*"
   }
   ```

2. Run `bun install` from the repo root.

3. Wrap the app's `RootLayout` body with `<AnalyticsProvider>` from `@repo/posthog/client`. The provider should sit inside `<ThemeProvider>` so PostHog UI surveys (which respect dark mode) inherit the theme:

   ```tsx
   import { AnalyticsProvider } from '@repo/posthog/client';
   import { ThemeProvider, Toaster } from '@repo/ui';

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

5. Add `'@repo/posthog'` to `transpilePackages` in `next.config.ts` (alphabetical):

   ```ts
   transpilePackages: ['@repo/auth', '@repo/core', '@repo/db', '@repo/posthog', '@repo/sentry', '@repo/ui'],
   ```

## Zero-bundle note (ADR 32)

`AnalyticsProvider` pulls `posthog-js` in through a DYNAMIC `import()` inside its `useEffect`, gated on `NEXT_PUBLIC_POSTHOG_KEY`. When the key is unset the effect returns before that import runs, so the SDK is split into an async chunk that is never fetched. This does NOT rely on dead-code elimination of a static import: Turbopack does not reliably DCE `NEXT_PUBLIC_*` branches across module boundaries (the same caveat that drove the Sentry dynamic-import gate in ADR 27), so a static `import posthog from 'posthog-js'` would ship the ~190KB SDK regardless of the key.

To verify in your own deploy, run `bun run build` with `NEXT_PUBLIC_POSTHOG_KEY` unset, then load the homepage and confirm the network tab shows no requests to `/ingest/*` and no `posthog` chunk fetched.

## Removal

If a future MVP needs to remove PostHog entirely:

1. Drop `"@repo/posthog": "workspace:*"` from `apps/<app>/package.json` deps.
2. Remove `'@repo/posthog'` from `transpilePackages` in `next.config.ts`.
3. Remove the `skipTrailingSlashRedirect` flag and the three `/ingest/*` rewrite rules from `next.config.ts`.
4. Unwrap `<AnalyticsProvider>` from `apps/<app>/src/app/layout.tsx` and drop the import.
5. Run `bun install` to drop the lockfile entries.

The env var (`NEXT_PUBLIC_POSTHOG_KEY`) can be unset in Vercel without a code change; the module already short-circuits when it is absent. Use the full removal procedure above only when the dependency itself is no longer wanted.

## Notes

- `posthog-js` is a browser-only SDK. The package only ships an `AnalyticsProvider` (a `'use client'` component) under the `/client` subpath; the package barrel exports nothing, by design, so a stray server-side import has nowhere to land.
- `defaults: '2026-01-30'` opts the SDK into the modern PostHog defaults bundle (autocapture, web vitals, session replay flag, etc.) at the snapshot date documented in PostHog's release notes. Bumping the date is a deliberate behavioural change; do it intentionally and read the diff.
- `person_profiles: 'identified_only'` keeps anonymous traffic out of PostHog's person index, which is the recommended setting for B2B SaaS MVPs that only need analytics on signed-in users.
- The EU reverse proxy keeps PostHog traffic on the deploy origin so ad blockers and `connect-src` CSP rules don't drop it. Match the region (`eu` vs `us`) to the PostHog project where the key was issued.
