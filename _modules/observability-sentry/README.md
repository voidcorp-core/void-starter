# @void/sentry

Opt-in Sentry observability module for void-starter MVPs. Wraps `@sentry/nextjs` 10.x with the modern four-file Next.js 16 integration pattern, gated behind build-time env vars so Sentry never ships in the bundle when DSN values are unset.

## Why opt-in

Per `docs/DECISIONS.md` entry 04, optional infrastructure activates at build time via env var presence. No DSN means no Sentry runtime, no chunks in `.next/static/`, and no extra cost on cold starts. Add the env vars in Vercel and redeploy to flip the module on for an MVP that needs it.

## Required environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | server / edge | Activates server-side capture. Absent value means `registerServer` and `registerEdge` short-circuit before `Sentry.init`. |
| `NEXT_PUBLIC_SENTRY_DSN` | client | Activates browser capture. Build-time inlined so the entire `initSentryClient` body dead-code-eliminates when unset. |
| `SENTRY_AUTH_TOKEN` | build | Lets `withSentryConfig` upload source maps to Sentry during `next build`. Set in Vercel under "Sensitive" type. |
| `SENTRY_ORG` | build | Sentry organization slug used by `withSentryConfig` when uploading source maps. |
| `SENTRY_PROJECT` | build | Sentry project slug used by `withSentryConfig` when uploading source maps. |

Optional:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Server / edge tracing sample rate. |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Client tracing sample rate. |

## Install

The module is already wired into `apps/web` so a fresh starter clone activates Sentry simply by setting the env vars above and redeploying. The steps below document how to mirror the integration in any future app inside this monorepo.

1. Add the dependency to the consuming app's `package.json`:

   ```json
   "dependencies": {
     "@void/sentry": "workspace:*"
   }
   ```

2. Run `bun install` from the repo root.

3. In `apps/<app>/src/instrumentation.ts`, dispatch on `process.env.NEXT_RUNTIME` and dynamically import the matching entry. Keep the dynamic imports gated behind `process.env['SENTRY_DSN']` so build-time tree-shaking still excludes Sentry when the DSN is unset:

   ```ts
   export async function register() {
     if (!process.env['SENTRY_DSN']) return;

     if (process.env['NEXT_RUNTIME'] === 'nodejs') {
       const { registerServer } = await import('@void/sentry/server');
       registerServer();
     }

     if (process.env['NEXT_RUNTIME'] === 'edge') {
       const { registerEdge } = await import('@void/sentry/edge');
       registerEdge();
     }
   }

   export { onRequestError } from '@void/sentry/server';
   ```

4. Create `apps/<app>/src/instrumentation-client.ts`. Gate the call on `NEXT_PUBLIC_SENTRY_DSN` so the entire branch dead-code-eliminates when the public DSN is unset:

   ```ts
   import { initSentryClient } from '@void/sentry/client';

   if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
     initSentryClient();
   }
   ```

5. Wrap `next.config.ts` with `withSentryConfig`:

   ```ts
   import { withSentryConfig } from '@sentry/nextjs';

   const config: NextConfig = {
     // ... cacheComponents, headers, transpilePackages
     transpilePackages: ['@void/auth', '@void/core', '@void/db', '@void/ui', '@void/sentry'],
   };

   export default withSentryConfig(config, {
     org: process.env['SENTRY_ORG'],
     project: process.env['SENTRY_PROJECT'],
     authToken: process.env['SENTRY_AUTH_TOKEN'],
     tunnelRoute: '/sentry-tunnel',
     silent: !process.env['CI'],
   });
   ```

6. Add `apps/<app>/src/app/global-error.tsx` so React render errors at the root layout level get captured. Gate the `Sentry.captureException` call on `NEXT_PUBLIC_SENTRY_DSN` so the page also works when Sentry is not installed:

   ```tsx
   'use client';

   import * as Sentry from '@sentry/nextjs';
   import { useEffect } from 'react';

   export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
     useEffect(() => {
       if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
         Sentry.captureException(error);
       }
     }, [error]);

     return (
       <html lang="en">
         <body>
           <h1>Something went wrong</h1>
           {error.digest ? <p>Error ID: {error.digest}</p> : null}
         </body>
       </html>
     );
   }
   ```

## Tunnel route

`withSentryConfig` with `tunnelRoute: '/sentry-tunnel'` automatically wires a route handler that proxies Sentry envelope requests through the deploy origin. This is the recommended setup for projects on Vercel and standard Next.js hosting. There is NO need to hand-author `apps/<app>/src/app/sentry-tunnel/route.ts` for typical setups: Sentry's webpack plugin generates the proxy and you only need to declare the public path via the `tunnelRoute` option.

A manual `apps/<app>/src/app/sentry-tunnel/route.ts` is only required if the project needs custom CSP/proxy logic on top of the proxy (for example, additional header stripping, request-shape validation, or rate limiting). In that case, follow Sentry's "Custom tunnel" docs and replace the handler. Most MVPs should not need it.

## Removal

If a future MVP needs to remove Sentry entirely:

1. Drop `"@void/sentry": "workspace:*"` from `apps/<app>/package.json` deps.
2. Remove `'@void/sentry'` from `transpilePackages` in `next.config.ts`.
3. Replace the `withSentryConfig(config, {...})` wrapper with a plain `export default config;`.
4. Revert `instrumentation.ts` to a noop `register()` (or remove the dynamic import branch).
5. Delete `instrumentation-client.ts` and `app/global-error.tsx`.
6. Run `bun install` to drop the lockfile entry.

The env vars (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) can be unset in Vercel without a code change; the module already short-circuits when they are absent. Use the full removal procedure above only when the dependency itself is no longer wanted.

## Notes

- `@sentry/nextjs` 10.x is shipped as ESM with internal Node-runtime modules. `transpilePackages: ['@void/sentry']` ensures Next.js compiles our wrapper alongside the other workspace packages; Sentry's own webpack plugin handles its internal transpilation.
- `src/server.ts` and `src/edge.ts` carry `import 'server-only'` per `docs/DECISIONS.md` entry 25 so a stray client-side import fails loud at build time.
- `src/client.ts` does NOT carry `'use client'` because `instrumentation-client.ts` is a Next.js instrumentation hook, not a React component file.
- The package barrel `@void/sentry` re-exports nothing meaningful. Always import from the `/server`, `/edge`, or `/client` subpaths so the runtime boundary is explicit at the call site.
