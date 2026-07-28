import { defaultSecurityHeaders } from '@repo/core/security-headers';
import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const config: NextConfig = {
  // cacheComponents was promoted from experimental to stable in Next 16.0.0.
  // It controls ppr, useCache, and dynamicIO as a single unified configuration.
  cacheComponents: true,
  // TypeScript 7 is a native compiler without the legacy programmatic API that
  // Next 16 probes during `next build`. CI runs `tsc --noEmit` before the build,
  // so this only removes Next's duplicate TypeScript 6-specific check.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Required by the PostHog reverse-proxy rewrites below: without it Next.js
  // issues a 308 trailing-slash redirect on /ingest/... before the rewrite
  // runs, which breaks the proxy. See _modules/analytics-posthog/README.md.
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: defaultSecurityHeaders(),
      },
    ];
  },
  // Reverse-proxy PostHog through the deploy origin so ad blockers and CSP
  // connect-src rules don't drop analytics traffic. The destination region
  // (eu vs us) must match the PostHog project the key was issued in.
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://eu-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/array/:path*',
        destination: 'https://eu-assets.i.posthog.com/array/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://eu.i.posthog.com/:path*',
      },
    ];
  },
  transpilePackages: [
    '@repo/auth',
    '@repo/core',
    '@repo/db',
    '@repo/jobs-vercel-workflow',
    '@repo/notes',
    '@repo/posthog',
    '@repo/sentry',
    '@repo/ui',
  ],
};

// withSentryConfig is always applied; when SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN
// are unset the Sentry runtime never initializes (see _modules/observability-sentry).
// Source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT and
// silently no-ops without them. The tunnel route is auto-wired by Sentry's
// webpack plugin from the tunnelRoute option below.
// withWorkflow enables the "use workflow" / "use step" directives and registers
// the step handlers so only Vercel Queue can deliver to them. It wraps the
// config before Sentry so Sentry still sees the final Next config.
export default withSentryConfig(withWorkflow(config), {
  tunnelRoute: '/sentry-tunnel',
  silent: !process.env['CI'],
});
